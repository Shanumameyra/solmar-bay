// main.js — Solmar Bay boot + game loop (Worker B, v6 fresh)
// Boot order (contract): CONFIG -> rng (seed 7) -> renderer/camera ->
// world = createWorld(scene, rng) -> buildCity(scene, world, rng) -> input ->
// player -> traffic -> police -> missions -> combat -> hud -> minimap ->
// audio -> effects -> save (loadGame) -> shots setup -> fixed-dt (1/60) loop.
// Exposes: window.__GTA, window.render_game_to_text(), window.advanceTime(ms).
// Worker A modules (config/random/world/city/player) are loaded dynamically with
// local fallbacks, so a signature mismatch degrades instead of killing the game.
import * as THREE from '../vendor/three/three.module.min.js';
import { createCar, updateCar } from './vehicle.js';
import { createTraffic, updateTraffic } from './traffic.js';
import { createPolice, updatePolice, addWanted } from './police.js';
import { createMissions, updateMissions } from './missions.js';
import { createCombat, updateCombat } from './combat.js';
import { createHud, updateHud } from './hud.js';
import { createMinimap, drawMinimap } from './minimap.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { saveGame, loadGame } from './save.js';
import { setupShots } from './shots.js';

const STEP = 1 / 60;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- local fallbacks (used only if a Worker A module is missing) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)] };
}

function fallbackWorld() {
  return {
    colliders: [],
    streets: [-175, -125, -75, -25, 25, 75, 125, 175],
    bounds: { min: -200, max: 200 },
    peds: [],
    cashPickups: [],
    dockCorridor: { x0: 168, x1: 192, z0: 12, z1: 38 },
    precinct: { x: 60, z: 100 },
    hospital: { x: 150, z: -100 },
    cafe: { x: 0, z: 0 },
    garage: { x: -40, z: 150 },
    safehouse: { x: -100, z: 150 },
  };
}

function fallbackPlayer(G) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e86c1, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 0.32), bodyMat);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
  head.position.y = 1.75;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x222222 }));
  legs.position.y = 0.32;
  group.add(body); group.add(head); group.add(legs);
  group.position.set(5, 0, 8);
  G.scene.add(group);
  return {
    mesh: group,
    pos: group.position,
    heading: Math.PI,
    speed: 0,
    hp: 100,
    inCar: null,
    car: null,
    update(G2, dt) {
      // Minimal WASD walk (only used if Worker A's player.js is absent).
      const p = G2.player;
      if (p.car) return;
      const k = G2.input.keys;
      const run = k.has('ShiftLeft') || k.has('ShiftRight');
      const spd = run ? 8 : 5;
      let mx = 0, mz = 0;
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
      if (k.has('KeyW')) { mx += fx; mz += fz; }
      if (k.has('KeyS')) { mx -= fx; mz -= fz; }
      if (k.has('KeyA')) { mx -= rx; mz -= rz; }
      if (k.has('KeyD')) { mx += rx; mz += rz; }
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        p.pos.x += (mx / len) * spd * dt;
        p.pos.z += (mz / len) * spd * dt;
        p.speed = spd;
      } else p.speed = 0;
      const B = (G2.world && G2.world.bounds) || { min: -200, max: 200 };
      p.pos.x = clamp(p.pos.x, B.min + 1, B.max - 1);
      p.pos.z = clamp(p.pos.z, B.min + 1, B.max - 1);
      p.mesh.position.set(p.pos.x, 0, p.pos.z);
      p.mesh.rotation.y = p.heading;
      if (G2.input.mouseDX) { p.heading -= G2.input.mouseDX * 0.003; G2.input.mouseDX = 0; }
    },
  };
}

// ---------- input (local; shared via G.input so player.js can read it too) ----------
function createLocalInput(G) {
  const input = {
    keys: new Set(),
    pressed: new Set(), // edge-triggered, cleared at the end of each update()
    mouseDown: false,
    mousePressed: false,
    mouseDX: 0,
    mouseDY: 0,
    // Worker A's player.js reads input.isDown(code); expose it on this object.
    isDown(code) { return input.keys.has(code); },
  };
  const canvas = G.renderer.domElement;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (G.audio) { try { G.audio.unlock(); } catch (err) { /* ignore */ } }
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());
  canvas.addEventListener('mousedown', (e) => {
    input.mouseDown = true;
    input.mousePressed = true;
    if (G.audio) { try { G.audio.unlock(); } catch (err) { /* ignore */ } }
    try { canvas.requestPointerLock(); } catch (err) { /* ignore */ }
  });
  window.addEventListener('mouseup', () => { input.mouseDown = false; });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      input.mouseDX += e.movementX || 0;
      input.mouseDY += e.movementY || 0;
    }
  });
  return input;
}

// ---------- enter / exit car ----------
function nearestEnterableCar(G, maxD) {
  const p = G.player.pos;
  let best = null, bestD = maxD;
  for (const c of G.vehicles || []) {
    if (c._driver === 'player') continue;
    const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function tryEnterExit(G) {
  const p = G.player;
  if (G.state.entering) return;
  if (p.car) {
    // Exit: step out of the driver's (left) door.
    const car = p.car;
    const h = car.heading;
    const lx = -Math.cos(h), lz = Math.sin(h); // left vector
    p.pos.set(car.pos.x + lx * 1.8, 0, car.pos.z + lz * 1.8);
    if (p.mesh) p.mesh.position.set(p.pos.x, 0, p.pos.z);
    p.heading = h;
    if (p.mesh) p.mesh.rotation.y = h;
    p.speed = 0;
    p.car = null;
    p.inCar = null;
    car._driver = null;
    if (G.audio) G.audio.sfx('door');
    return;
  }
  const car = nearestEnterableCar(G, 4);
  if (!car) return;
  G.state.entering = { car, t: 0.4 };
  if (G.audio) G.audio.sfx('door');
}

function finishEnter(G) {
  const ent = G.state.entering;
  if (!ent) return;
  const car = ent.car;
  const p = G.player;
  G.state.entering = null;
  p.car = car;
  p.inCar = car;
  car._driver = 'player';
  p.pos.set(car.pos.x, 0, car.pos.z);
  p.heading = car.heading;
  // Steal: a parked, unowned car changes hands. Heat only if witnessed.
  if (car.parked && !car.owned && !car.missionCar) {
    car.parked = false;
    car.owned = true;
    if (G.state.stats) G.state.stats.carsStolen = (G.state.stats.carsStolen || 0) + 1;
    let heat = 0;
    let policeNear = false;
    for (const pc of (G.police && G.police.cars) || []) {
      if (Math.hypot(pc.pos.x - p.pos.x, pc.pos.z - p.pos.z) < 50) { policeNear = true; break; }
    }
    if (policeNear) heat = 2;
    else {
      for (const ped of (G.world && G.world.peds) || []) {
        if (ped.pos && Math.hypot(ped.pos.x - p.pos.x, ped.pos.z - p.pos.z) < 30) { heat = 1; break; }
      }
    }
    if (heat > 0) addWanted(G, heat);
    if (G.traffic) {
      const i = G.traffic.parked.indexOf(car);
      if (i >= 0) G.traffic.parked.splice(i, 1);
    }
  }
}

// ---------- camera ----------
function updateCamera(G) {
  const cam = G.camera;
  if (G.cameraOverride) {
    const o = G.cameraOverride;
    cam.position.set(o.pos.x, o.pos.y, o.pos.z);
    cam.lookAt(o.lookAt.x, o.lookAt.y, o.lookAt.z);
    return;
  }
  const p = G.player;
  if (!p || !p.pos) return;
  const h = p.car ? p.car.heading : (p.heading || 0);
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  let dist, height, side, lookAhead;
  if (p.car) { dist = 10.5; height = 4.2; side = 0; lookAhead = 10; }
  else { dist = 6.5; height = 3.0; side = 1.1; lookAhead = 7; }
  const speed = p.car ? Math.abs(p.car.speed || 0) : Math.abs(p.speed || 0);
  dist += Math.min(speed * 0.08, 2.5);
  const tx = p.pos.x - fx * dist + rx * side;
  const tz = p.pos.z - fz * dist + rz * side;
  const k = 1 - Math.pow(0.0001, 1 / 60); // smooth follow
  cam.position.x += (tx - cam.position.x) * Math.min(1, k * 3);
  cam.position.y += ((height) - cam.position.y) * Math.min(1, k * 3);
  cam.position.z += (tz - cam.position.z) * Math.min(1, k * 3);
  cam.lookAt(p.pos.x + fx * lookAhead, 1.6, p.pos.z + fz * lookAhead);
}

// ---------- pedestrians (finisher fix: world.peds was never populated) ----------
const PED_COLORS = [0xc65b8a, 0x3f8f6b, 0x5b7fc4, 0xe8a13c, 0x7a9a3a, 0xe2574c, 0x8a6fbf, 0x2e86c1];
function createPeds(G) {
  const rng = G.rng || { next: () => Math.random() };
  // Home districts: plaza, beachfront, downtown, barrios, side avenues.
  const homes = [
    [0, 0], [-150, -40], [75, 75], [-75, -75], [25, -25], [-25, 25],
    [125, 25], [-125, 75], [75, -125], [-60, -118], [118, -62], [38, -152],
  ];
  const peds = [];
  for (let i = 0; i < 16; i++) {
    const home = homes[i % homes.length];
    const x = home[0] + (rng.next() - 0.5) * 24;
    const z = home[1] + (rng.next() - 0.5) * 24;
    const group = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: PED_COLORS[i % PED_COLORS.length], roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), shirt);
    torso.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skin);
    head.position.y = 1.68;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.7, 0.28), pants);
    legs.position.y = 0.35;
    group.add(torso); group.add(head); group.add(legs);
    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.position.set(x, 0, z);
    G.scene.add(group);
    peds.push({
      mesh: group,
      pos: group.position,
      heading: rng.next() * Math.PI * 2,
      speed: 0,
      flee: false, // set by combat (punch/shot); updatePeds turns it into a run
      _tx: x, _tz: z,
      _fleeT: 0,
      _waitT: rng.next() * 2,
    });
  }
  G.world.peds = peds;
  return peds;
}

function updatePeds(G, dt) {
  const peds = (G.world && G.world.peds) || [];
  const world = G.world;
  const pp = G.player && G.player.pos;
  const rng = G.rng || { next: () => Math.random() };
  const lines = (world && world.streets) || [-175, -125, -75, -25, 25, 75, 125, 175];
  for (const ped of peds) {
    if (!ped.pos || !ped.mesh) continue;
    if (ped.flee) { ped._fleeT = 3; ped.flee = false; }
    let tx = ped._tx, tz = ped._tz, spd = 1.2;
    if (ped._fleeT > 0) {
      // Run away from the player for 3 s.
      ped._fleeT -= dt;
      spd = 3.5;
      if (pp) {
        const dx = ped.pos.x - pp.x, dz = ped.pos.z - pp.z;
        const d = Math.hypot(dx, dz) || 1;
        tx = ped.pos.x + (dx / d) * 10;
        tz = ped.pos.z + (dz / d) * 10;
      }
    } else if (ped._waitT > 0) {
      ped._waitT -= dt;
      ped.speed = 0;
      continue;
    } else if (Math.hypot(tx - ped.pos.x, tz - ped.pos.z) < 1) {
      // New sidewalk target: alongside a street line, never far away.
      const line = lines[Math.floor(rng.next() * lines.length)];
      const along = -190 + rng.next() * 380;
      if (rng.next() < 0.5) { ped._tx = line + 7.8; ped._tz = along; }
      else { ped._tx = along; ped._tz = line + 7.8; }
      ped._tx = Math.max(-195, Math.min(195, ped._tx));
      ped._tz = Math.max(-195, Math.min(195, ped._tz));
      ped._waitT = 0.5 + rng.next() * 2;
      continue;
    }
    const dx = tx - ped.pos.x, dz = tz - ped.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = spd * dt;
    const nx = ped.pos.x + (dx / d) * step;
    const nz = ped.pos.z + (dz / d) * step;
    if (!world || !world.isBlocked || !world.isBlocked(nx, nz, 0.5)) {
      ped.pos.x = nx; ped.pos.z = nz;
      ped.heading = Math.atan2(dx, dz);
    } else {
      // Blocked (a streetlight, a stall): stand still, re-pick next tick.
      ped._tx = ped.pos.x; ped._tz = ped.pos.z;
    }
    ped.speed = spd;
    ped.mesh.position.set(ped.pos.x, 0, ped.pos.z);
    ped.mesh.rotation.y = ped.heading;
  }
}

// ---------- one fixed update step ----------
function update(G, dt) {
  const input = G.input;
  const pressed = (code) => input.pressed.has(code);

  // Busted / wasted interstitial countdown.
  if (G.state.mode === 'busted' || G.state.mode === 'wasted') {
    G.state.modeTimer = (G.state.modeTimer || 0) - dt;
    if (G.state.modeTimer <= 0) {
      G.state.mode = 'playing';
      if (G.hud) updateHud(G);
    }
    input.pressed.clear();
    input.mousePressed = false;
    return;
  }

  // Global keys.
  if (pressed('Enter') && G.state.mode === 'title') {
    G.state.mode = 'playing';
    if (G.audio) { G.audio.unlock(); G.audio.musicStart(); }
    if (G.hud && G.hud.say) G.hud.say('Welcome to Solmar Bay, Dario.');
  }
  if ((pressed('Escape') || pressed('KeyP'))) {
    if (G.state.mode === 'playing') {
      G.state.mode = 'paused';
      if (G.saveGame) G.saveGame(G);
    } else if (G.state.mode === 'paused') {
      G.state.mode = 'playing';
    }
  }
  if (pressed('KeyM')) {
    const m = !(G.state.muted || false);
    G.state.muted = m;
    if (G.audio) G.audio.setMuted(m);
    if (G.hud && G.hud.say) G.hud.say(m ? 'Muted' : 'Sound on');
  }
  if (pressed('KeyH') && G.player.car && G.audio) G.audio.sfx('honk');

  if (G.state.mode !== 'playing') {
    input.pressed.clear();
    input.mousePressed = false;
    return;
  }

  // Enter / exit car (E), with the 0.4 s door animation.
  if (pressed('KeyE')) tryEnterExit(G);
  if (G.state.entering) {
    G.state.entering.t -= dt;
    if (G.state.entering.t <= 0) finishEnter(G);
  }

  // On-foot controller (Worker A) or fallback.
  if (G.player) {
    if (typeof G.player.update === 'function') {
      try { G.player.update(G, dt); } catch (e) { /* keep going */ }
    }
    // Keep the G.player.pos reference glued to the mesh if Worker A moved the mesh.
    if (G.player.mesh && G.player.pos !== G.player.mesh.position) {
      G.player.pos.x = G.player.mesh.position.x;
      G.player.pos.z = G.player.mesh.position.z;
    }
  }

  // Driving.
  const p = G.player;
  if (p && p.car) {
    const k = input.keys;
    let steer = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0); // A=left(+), D=right(-)
    let throttle = k.has('KeyW');
    let brake = k.has('KeyS');
    const handbrake = k.has('ShiftLeft') || k.has('ShiftRight');

    // Auto-unstuck (v6 fix): throttle applied but (almost) no displacement for
    // 4 s -> reverse out for 1.2 s instead of sitting jammed until a timeout.
    const car = p.car;
    G._stuck = G._stuck || { x: car.pos.x, z: car.pos.z, t: 0, rev: 0 };
    const st = G._stuck;
    if (st.rev > 0) {
      st.rev -= dt;
      throttle = false; brake = true; steer = -steer;
      if (st.rev <= 0) { st.t = 0; st.x = car.pos.x; st.z = car.pos.z; }
    } else if (throttle) {
      st.t += dt;
      if (st.t >= 1) {
        const moved = Math.hypot(car.pos.x - st.x, car.pos.z - st.z);
        if (moved < 0.5 && st.t >= 4) {
          st.rev = 1.2; // back out
          st.t = 0;
        } else if (moved >= 0.5) {
          st.t = 0; st.x = car.pos.x; st.z = car.pos.z;
        }
      }
    } else {
      st.t = 0; st.x = car.pos.x; st.z = car.pos.z;
    }

    updateCar(G, car, dt, { throttle, brake, steer, handbrake });
    p.pos.set(car.pos.x, 0, car.pos.z);
    p.heading = car.heading;
    p.speed = Math.abs(car.speed);
  } else if (G.audio) {
    G.audio.engine(0, 0);
  }

  updateTraffic(G, dt);
  updatePeds(G, dt);
  updatePolice(G, dt);
  updateMissions(G, dt);
  updateCombat(G, dt);
  if (G.effects) G.effects.update(dt);
  updateHud(G);
  drawMinimap(G);

  // Periodic autosave (every 30 s).
  G._saveTimer = (G._saveTimer || 0) + dt;
  if (G._saveTimer >= 30) {
    G._saveTimer = 0;
    if (G.saveGame) G.saveGame(G);
  }

  // Live debug / test handle.
  const gta = window.__GTA || {};
  gta.mode = G.state.mode;
  gta.money = G.state.money;
  gta.wanted = (G.police && G.police.stars) || G.state.wanted || 0;
  gta.mission = (G.missions && G.missions.index) || 0;
  gta.speed = p && p.car ? Math.abs(p.car.speed || 0) : Math.abs((p && p.speed) || 0);
  gta.player = { x: p ? p.pos.x : 0, z: p ? p.pos.z : 0, heading: p ? (p.heading || 0) : 0 };
  window.__GTA = gta;

  input.pressed.clear();
  input.mousePressed = false;
  input.mouseDX = 0;
  input.mouseDY = 0;
}

// ---------- boot ----------
async function boot() {
  // CONFIG
  let CONFIG = { STEP, WORLD_MIN: -200, WORLD_MAX: 200 };
  try {
    const m = await import('./config.js');
    CONFIG = m.CONFIG || m.default || CONFIG;
  } catch (e) { /* fallback CONFIG */ }

  // rng (seed 7)
  let rng = mulberry32(7);
  try {
    const m = await import('./random.js');
    const fn = m.createRandom || m.createRng || m.default;
    if (typeof fn === 'function') rng = fn(7);
  } catch (e) { /* fallback rng */ }

  // renderer / camera
  // Reuse the page's #game-canvas: a fresh canvas appended to <body> lands
  // below the fold (the page canvas is 100vh, the body clips overflow) and
  // the game renders invisibly. Only append our own when the page has none.
  const pageCanvas = (typeof document !== 'undefined') ? document.getElementById('game-canvas') : null;
  const renderer = new THREE.WebGLRenderer({ canvas: pageCanvas || undefined, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth || 1280, window.innerHeight || 720);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  if (!pageCanvas) document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7c98b);
  scene.fog = new THREE.Fog(0xf2c184, 180, 430);
  const camera = new THREE.PerspectiveCamera(62, (window.innerWidth || 1280) / (window.innerHeight || 720), 0.1, 900);
  camera.position.set(20, 6, 30);

  const G = {
    scene, camera, renderer,
    rng, CONFIG,
    vehicles: [],
    state: {
      mode: 'title',
      money: 150,
      wanted: 0,
      missionIndex: 0,
      clockMinutes: 17 * 60 + 40,
      muted: false,
      stats: { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 150 },
      modeTimer: 0,
      entering: null,
    },
    cameraOverride: null,
    shots: { staged: 0 },
    _saveTimer: 0,
  };
  G.renderFrame = () => {
    updateCamera(G);
    renderer.render(scene, camera);
  };
  window.__GTA = { mode: 'title', money: 150, wanted: 0, mission: 0, speed: 0, shotReady: false, screen: 'title' };

  // save (loadGame) — before systems so money/mission restore applies.
  let saved = null;
  try { saved = loadGame(); } catch (e) { saved = null; }
  if (saved) {
    G.state.money = saved.money;
    G.state.missionIndex = saved.missionIndex;
    G.state.stats = saved.stats || G.state.stats;
    G.state.muted = !!saved.muted;
  }
  G.saveGame = (G2) => saveGame(G2 || G);

  // world = createWorld(scene, rng)
  let world = null;
  try {
    const m = await import('./world.js');
    const fn = m.createWorld || m.default;
    if (typeof fn === 'function') {
      world = fn.length >= 2 ? fn(scene, rng) : fn(7);
    }
  } catch (e) { world = null; }
  if (!world || typeof world !== 'object') world = fallbackWorld();
  world.colliders = world.colliders || [];
  world.streets = world.streets || [-175, -125, -75, -25, 25, 75, 125, 175];
  world.bounds = world.bounds || { min: -200, max: 200 };
  world.peds = world.peds || [];
  world.cashPickups = world.cashPickups || [];
  world.dockCorridor = world.dockCorridor || { x0: 168, x1: 192, z0: 12, z1: 38 };
  world.precinct = world.precinct || { x: 60, z: 100 };
  world.hospital = world.hospital || { x: 150, z: -100 };
  G.world = world;

  // buildCity(scene, world, rng)
  try {
    const m = await import('./city.js');
    const fn = m.buildCity || m.default;
    if (typeof fn === 'function') {
      if (fn.length >= 3) fn(scene, world, rng);
      else if (fn.length === 1) fn(7);
      else fn(scene, world, rng);
    }
  } catch (e) { /* city visuals missing — game still runs */ }

  // Lights (only if the city builder did not add any).
  let hasLight = false;
  scene.traverse((o) => { if (o.isDirectionalLight || o.isHemisphereLight) hasLight = true; });
  if (!hasLight) {
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
    sun.position.set(120, 180, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -220; sun.shadow.camera.right = 220;
    sun.shadow.camera.top = 220; sun.shadow.camera.bottom = -220;
    sun.shadow.camera.far = 600;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x8a6f4d, 0.8));
  }

  // input
  G.input = createLocalInput(G);

  // player
  let player = null;
  let updatePlayerFn = null; // Worker A's on-foot controller (exported separately)
  try {
    const m = await import('./player.js');
    const fn = m.createPlayer || m.default;
    updatePlayerFn = (typeof m.updatePlayer === 'function') ? m.updatePlayer : null;
    if (typeof fn === 'function') {
      try { player = fn(G); } catch (e) { player = null; }
      if (!player || !player.pos || typeof player.pos.x !== 'number') {
        try { player = fn(scene, rng); } catch (e) { player = null; }
      }
    }
  } catch (e) { player = null; }
  if (!player || !player.pos) {
    player = fallbackPlayer(G);
    player._isFallback = true;
  }
  // Normalise the player shape every system relies on.
  if (!player.mesh) player.mesh = null;
  if (typeof player.heading !== 'number') player.heading = Math.PI;
  if (typeof player.hp !== 'number') player.hp = 100;
  if (player.car === undefined) player.car = null;
  if (player.inCar === undefined) player.inCar = null;
  if (typeof player.speed !== 'number') player.speed = 0;
  if (player.pos && player.mesh && player.pos !== player.mesh.position) {
    // Worker A may keep pos as {x,z}; glue it to the mesh position.
    if (typeof player.pos.set !== 'function') {
      player.pos = player.mesh.position;
    }
  }
  // Worker A's player moves via the exported updatePlayer(G, dt), not via a
  // method on the player object: wire it up, or on-foot movement is dead
  // (the update() loop below only calls G.player.update). The local fallback
  // player already carries its own update method, so leave it alone.
  if (updatePlayerFn && !player._isFallback && typeof player.update !== 'function') {
    player.update = (G2, dt) => updatePlayerFn(G2, dt);
  }
  G.player = player;

  // traffic -> police -> missions -> combat -> hud -> minimap -> audio -> effects
  G.traffic = createTraffic(G);
  // Pedestrians: no Worker A/B module ever populated world.peds, so the city
  // had no people (combat + shots both read G.world.peds). 16 stylised peds
  // wandering the sidewalks, in the shape those systems expect.
  createPeds(G);
  G.vehicles.push(...(G.traffic.parked || []));
  // M2 sports car: yellow, beachfront (-150,-60), tagged missionCar.
  const sportsCar = createCar(G, { x: -150, z: -60, heading: Math.PI / 2, color: 0xf7d117, sports: true, missionCar: true, parked: true });
  G.vehicles.push(sportsCar);
  G.police = createPolice(G);
  G.missions = createMissions(G);
  G.combat = createCombat(G);
  G.combat.hp = player.hp;
  G.hud = createHud(G);
  G.minimap = createMinimap(G);
  G.audio = createAudio(G);
  if (G.state.muted) G.audio.setMuted(true);
  G.effects = createEffects(G);

  // shots setup
  setupShots(G);

  // Expose test / debug handles.
  G.update = (dt) => update(G, dt);
  window.__GTA_BOOT = G;
  window.render_game_to_text = () => JSON.stringify({
    mode: G.state.mode,
    player: {
      x: Math.round(G.player.pos.x * 100) / 100,
      z: Math.round(G.player.pos.z * 100) / 100,
      heading: Math.round((G.player.heading || 0) * 100) / 100,
      speed: Math.round((G.player.car ? Math.abs(G.player.car.speed || 0) : Math.abs(G.player.speed || 0)) * 100) / 100,
      inCar: !!G.player.car,
    },
    mission: { index: G.missions.index, stage: G.missions.stage, objective: G.missions.objective || '' },
    money: G.state.money,
    wanted: (G.police && G.police.stars) || 0,
    speed: Math.round((G.player.car ? Math.abs(G.player.car.speed || 0) : Math.abs(G.player.speed || 0)) * 3.6),
  });
  window.advanceTime = (ms) => {
    const steps = Math.max(0, Math.round((ms || 0) / (1000 * STEP)));
    for (let i = 0; i < steps; i++) update(G, STEP);
    G.renderFrame();
    return steps;
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Game loop: fixed dt 1/60 accumulator, render every frame.
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      update(G, STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
    G.renderFrame();
  }
  updateHud(G);
  drawMinimap(G);
  requestAnimationFrame(frame);
  return G;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot().catch((e) => console.error('[solmar] boot failed', e)));
  } else {
    boot().catch((e) => console.error('[solmar] boot failed', e));
  }
}
