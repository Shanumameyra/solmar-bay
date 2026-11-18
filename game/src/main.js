// main.js — Solmar Bay bootstrap, game loop and state machine.
// Written fresh from DESIGN.md for the v5 rebuild.
//
// WHAT THIS FILE OWNS
//   - the shared game context G (single source of truth for state, money,
//     wanted, health, mission index, stats)
//   - the title -> playing state machine, including the v4 bug fix:
//     pressing Enter (or clicking / tapping Start) on the title screen
//     MUST start the game. The key listener is attached before any
//     module is loaded, and startGame() queues the start when the world
//     is not booted yet instead of dropping the keypress.
//   - renderer / scene / camera / lights, the game loop, camera follow,
//     busted / wasted flow, autosave, window.__GTA exposure, ?shot=
//   - adapters between this file's systems modules (police, missions,
//     combat, hud, minimap, audio, save, effects, shots) and the core
//     modules (city, vehicle, traffic, player, input, render, config,
//     random) written in parallel by Worker A, plus compact built-in
//     fallbacks so the game stays playable even if a core module is
//     missing or exposes a different shape.
//
// CONTRACT WITH THE CORE MODULES (duck-typed, defensive — every access
// is guarded so a missing module degrades instead of crashing):
//   config.js   : `export const CONFIG = {...}` (optional)
//   random.js   : `export function mulberry32(seed)` (optional)
//   input.js    : `export function createInput(G)` ->
//                 { keys: Set<string> } (main merges autopilot keys in)
//   city.js     : `export function createCity(G)` -> object, may expose
//                 isBlocked(x, z) / collides(x, z); builds into G.scene
//   vehicle.js  : `export function createVehicles(G)` ->
//                 { list, parked, spawn(opts), update(dt) } — a vehicle is
//                 { pos, heading, speed, hp, isSportsCar?, mesh }
//   traffic.js  : `export function createTraffic(G)` ->
//                 { cars, peds, update(dt) } — a ped is
//                 { pos, hp, alive, flee(), stagger(), knockback() }
//   player.js   : `export function createPlayer(G)` ->
//                 { pos, heading, speed, inCar, update(dt),
//                   teleport(x, z, heading?), enterCar(v), exitCar() }
//   render.js   : optional helpers; main.js owns the renderer/scene/
//                 camera and renders directly.
//
// The module is import-safe in Node: the top level only defines constants
// and functions; boot() runs only when document + window exist. Pure
// logic (startGame, handleTitleKey, applyBusted, applyWasted,
// createGameContext) is exported for the v5 logic tests.

export const LAYOUT = {
  cafe: { x: 0, z: 22 },
  docks: { x: 182, z: 24 },
  sportsCar: { x: -182, z: -60 },
  garage: { x: 28, z: 172 },
  safehouse: { x: -100, z: 172 },
  hospital: { x: -152, z: 172 },
  precinct: { x: 152, z: 172 },
  gunshop: { x: 78, z: -28 },
  spawn: { x: 0, z: 26 },
  pier: { x: -192, z: -20 },
};

export const STREETS = [-175, -125, -75, -25, 25, 75, 125, 175];
export const WORLD_HALF = 200;

export const CFG = {
  worldHalf: 200,
  walkSpeed: 5,
  runSpeed: 8,
  carAccel: 12,
  carTopSpeed: 38,
  carSportsTopSpeed: 46,
  carBrake: 20,
  carReverse: 10,
  startMoney: 150,
  bustedFine: 200,
  wastedFine: 100,
  autosaveSeconds: 30,
};

// --- pure game-context factory (no DOM, no THREE) ---------------------------
export function createGameContext() {
  const G = {
    // three.js / rendering (filled by boot)
    THREE: null,
    scene: null,
    camera: null,
    renderer: null,
    clock: null,
    booted: false,
    queuedStart: false,

    // layout + config
    layout: { ...LAYOUT },
    cfg: { ...CFG },

    // core game state
    state: 'title', // title | playing | paused | busted | wasted
    time: 0,
    money: CFG.startMoney,
    wanted: 0,
    health: 100,
    weapon: 'fists',
    ammo: PISTOL_MAG_START,
    reserveAmmo: 24,
    muted: false,
    missionIndex: 0,
    stats: { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: CFG.startMoney },
    lastSavedAt: 0,
    lastAutosave: 0,

    // modules (filled by boot)
    input: null,
    player: null,
    vehicles: null,
    traffic: null,
    city: null,
    render: null,
    police: null,
    missions: null,
    combat: null,
    hud: null,
    minimap: null,
    audio: null,
    save: null,
    effects: null,
    shots: null,

    // runtime helpers
    keys: new Set(), // canonical keyboard state, owned by main.js
    autopilot: null, // { keys: string[] } — scripted input for ?shot=
    shotCamera: null, // { pos, lookAt } — fixed camera while staging shots
    cashPickups: [],
    stateTimer: 0, // counts down busted / wasted overlays
    pendingRespawn: null, // 'precinct' | 'hospital'
    _listeners: {},

    on(name, fn) {
      if (!this._listeners[name]) this._listeners[name] = [];
      this._listeners[name].push(fn);
    },
    emit(name, data) {
      const list = this._listeners[name];
      if (!list) return;
      for (const fn of list) {
        try {
          fn(data);
        } catch (_err) { /* listener errors never break the game */ }
      }
    },
  };
  return G;
}

const PISTOL_MAG_START = 12;

// --- v4 BUG FIX #1: Enter MUST start the game -------------------------------
// startGame is idempotent and never drops the request: if the world is not
// booted yet (user pressed Enter during load) the start is queued and
// boot() runs it the moment the world is ready. No asset-loading gate
// stands between the keypress and gameplay — the title screen is DOM and
// the world is already built by the time the player can see it.
export function startGame(G) {
  if (!G) return 'no-context';
  if (G.state === 'playing') return 'already';
  if (G.state !== 'title') return 'not-title';
  if (!G.booted) {
    G.queuedStart = true;
    return 'queued';
  }
  G.queuedStart = false;
  G.state = 'playing';
  if (G.hud) {
    G.hud.hideTitle();
    G.hud.hideOverlays();
  }
  if (G.audio) G.audio.init();
  if (G.missions) G.missions.startCurrent();
  if (G.hud) G.hud.toast('Welcome to Solmar Bay — Rosa is calling.', 'info');
  G.emit('start');
  return 'started';
}

export function handleTitleKey(G, code) {
  if (!G || G.state !== 'title') return false;
  if (code === 'Enter' || code === 'NumpadEnter') {
    startGame(G);
    return true;
  }
  return false;
}

export function continueGame(G) {
  if (!G) return 'no-context';
  if (G.save) G.save.load();
  if (G.state === 'title') return startGame(G);
  return 'not-title';
}

export function togglePause(G) {
  if (!G) return 'no-context';
  if (G.state === 'playing') {
    G.state = 'paused';
    if (G.hud) G.hud.showPause();
    if (G.save) G.save.save();
    G.emit('pause');
    return 'paused';
  }
  if (G.state === 'paused') {
    G.state = 'playing';
    if (G.hud) G.hud.hidePause();
    G.emit('resume');
    return 'playing';
  }
  return 'not-applicable';
}

// --- pure fine math (busted / wasted) ---------------------------------------
// Busted: lose $200 (or all cash if less). Wasted: lose $100.
export function applyBusted(G) {
  if (!G) return 0;
  const fine = Math.min(CFG.bustedFine, Math.floor(G.money || 0));
  G.money = Math.max(0, (G.money || 0) - fine);
  G.wanted = 0;
  if (!G.stats) G.stats = { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 0 };
  G.stats.busted = (G.stats.busted || 0) + 1;
  return fine;
}

export function applyWasted(G) {
  if (!G) return 0;
  const fine = Math.min(CFG.wastedFine, Math.floor(G.money || 0));
  G.money = Math.max(0, (G.money || 0) - fine);
  G.health = 100;
  return fine;
}

// --- world-blocked fallback (grid math, DESIGN.md city layout) --------------
// Streets (12 m wide) are open; the plaza block, beach and docks yard are
// open; every other block interior is built up. Used only when the city
// module exposes no collision query.
export function gridBlocked(x, z) {
  if (Math.abs(x) > 198 || Math.abs(z) > 198) return true;
  if (x < -181 || x > 181) return false; // beach / docks yard
  if (Math.abs(x) < 19 && Math.abs(z) < 19) return false; // market plaza
  for (const s of STREETS) {
    if (Math.abs(x - s) <= 6) return false;
    if (Math.abs(z - s) <= 6) return false;
  }
  return true;
}

// --- adapters: systems modules <-> the real world (world.js) -------------
// The world owns plain state: player {x, z, heading, inVehicle, ...},
// cars {x, z, heading, speed, ...}, traffic {cars, parked, peds}. These
// adapters translate that shape for the systems modules (police, missions,
// combat, hud, minimap, shots), which only ever talk through G. Each one
// also accepts the older object shape (a THREE Vector3 `pos`, an `inCar`
// field) so a fallback object still works if the world ever changes.
function wireAdapters(G) {
  G.getPlayerPos = () => {
    const p = G.player;
    if (!p) return { x: 0, y: 0, z: 0 };
    if (p.pos) return p.pos; // fallback player: THREE Vector3
    if (p.position) return p.position;
    if (typeof p.x === 'number') return { x: p.x, y: 0, z: p.z || 0 };
    return { x: 0, y: 0, z: 0 };
  };

  G.getPlayerSpeed = () => {
    const p = G.player;
    if (!p) return 0;
    if (p.inVehicle && typeof p.inVehicle.speed === 'number') {
      return Math.abs(p.inVehicle.speed);
    }
    if (p.inCar && typeof p.inCar.speed === 'number') {
      return Math.abs(p.inCar.speed);
    }
    if (typeof p.speed === 'number') return Math.abs(p.speed);
    return 0;
  };

  G.isInCar = () => {
    const p = G.player;
    if (!p) return false;
    if (typeof p.inVehicle !== 'undefined') return !!p.inVehicle;
    if (typeof p.inCar !== 'undefined') return !!p.inCar;
    if (typeof p.vehicle !== 'undefined') return !!p.vehicle;
    return false;
  };

  G.getCurrentVehicle = () => {
    const p = G.player;
    if (!p) return null;
    return p.inVehicle || p.inCar || p.vehicle || null;
  };

  G.teleportPlayer = (x, z, heading) => {
    const p = G.player;
    if (!p) return false;
    if (typeof p.teleport === 'function') {
      p.teleport(x, z, heading);
      return true;
    }
    // Real player: step out of any car first, then move the state.
    if (p.inVehicle) {
      if (G._exitCar) {
        try {
          G._exitCar(p);
        } catch (_err) {
          p.inVehicle = null;
        }
      } else {
        p.inVehicle = null;
      }
    }
    if (typeof p.x === 'number') {
      p.x = x;
      p.z = z;
      if (typeof heading === 'number') p.heading = heading;
      p.speed = 0;
      if (p.mesh) p.mesh.position.set(x, 0, z);
      return true;
    }
    if (p.pos) {
      p.pos.x = x;
      p.pos.z = z;
      if (typeof heading === 'number') p.heading = heading;
      if (p.mesh) p.mesh.position.set(x, 0, z);
      return true;
    }
    return false;
  };

  G.worldBlocked = (x, z) => {
    if (G._pointInSolid) {
      try {
        return !!G._pointInSolid(x, z);
      } catch (_err) { /* fall through */ }
    }
    const city = G.city;
    if (city) {
      for (const name of ['isBlocked', 'collides', 'isSolid', 'blockedAt']) {
        if (typeof city[name] === 'function') {
          try {
            return !!city[name](x, z);
          } catch (_err) { /* fall through */ }
        }
      }
    }
    return gridBlocked(x, z);
  };

  G.getPeds = () => {
    if (G.traffic && Array.isArray(G.traffic.peds)) return G.traffic.peds;
    if (Array.isArray(G.peds)) return G.peds;
    return [];
  };

  G.damagePlayerVehicle = (amount) => {
    const v = G.getCurrentVehicle();
    if (!v || typeof v.hp !== 'number') return false;
    v.hp = Math.max(0, v.hp - amount);
    if (v.hp <= 0) {
      v.stalled = true;
      v.speed = 0;
      if (typeof v.stall === 'function') {
        try {
          v.stall();
        } catch (_err) { /* ignore */ }
      }
    }
    return true;
  };

  G.spawnVehicle = (opts) => {
    const vs = G.vehicles;
    if (vs && typeof vs.spawn === 'function') return vs.spawn(opts);
    if (vs && typeof vs.spawnVehicle === 'function') return vs.spawnVehicle(opts);
    if (vs && typeof vs.addCar === 'function') return vs.addCar(opts);
    return null;
  };

  G.enterVehicle = (veh) => {
    const p = G.player;
    if (!p || !veh) return false;
    if (typeof p.enterCar === 'function') {
      p.enterCar(veh);
      return true;
    }
    // Real player: claim the car directly (shots / mission staging).
    p.inVehicle = veh;
    veh.parked = false;
    veh.stolen = true;
    veh.driver = 'player';
    p.x = veh.x;
    p.z = veh.z;
    p.heading = veh.heading;
    p.speed = 0;
    return true;
  };

  G.spawnTrafficAt = (x, z, heading) => {
    if (G._spawnTrafficAt) {
      try {
        return G._spawnTrafficAt(x, z, heading);
      } catch (_err) { /* ignore */ }
    }
    const t = G.traffic;
    if (t && typeof t.spawnCarAt === 'function') {
      try {
        return t.spawnCarAt(x, z, heading);
      } catch (_err) { /* ignore */ }
    }
    return null;
  };

  // M2 sports car: ask the vehicle system to place the marked yellow car.
  G.spawnSportsCar = () => {
    const L = G.layout.sportsCar;
    const v = G.spawnVehicle({
      x: L.x, z: L.z, heading: Math.PI / 2,
      sports: true, color: 0xffd21f, parked: true,
    });
    if (v) {
      v.isSportsCar = true;
      v.sportsCar = true;
      v.marked = true;
    }
    return v;
  };
}

// --- dynamic module loading with shape tolerance ---------------------------
async function loadFactory(path, names) {
  try {
    const mod = await import(path);
    for (const name of names) {
      if (typeof mod[name] === 'function') return mod[name];
    }
    if (typeof mod.default === 'function') return mod.default;
    return null;
  } catch (_err) {
    return null;
  }
}

// --- compact fallback city (only if city.js is missing) --------------------
function buildFallbackCity(G) {
  const THREE = G.THREE;
  const scene = G.scene;
  const group = new THREE.Group();
  group.name = 'fallback-city';
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x3d3d3d, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // Beach sand + water (west).
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 400),
    new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-188, 0.02, 0);
  group.add(sand);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 400),
    new THREE.MeshStandardMaterial({ color: 0x1d4e89, roughness: 0.25, metalness: 0.4 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-215, 0.01, 0);
  group.add(water);
  // Docks yard (east).
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 400),
    new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 1 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(186, 0.02, 0);
  group.add(yard);
  // Buildings: pastel boxes in the block interiors (skip plaza/beach/docks).
  const palette = [0xf2c9a0, 0xf7ead1, 0xa8c8d8, 0xe8a0a0, 0xf5d76e, 0x9fc2a8, 0xd8b8d8];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let bx = -175; bx <= 125; bx += 50) {
    for (let bz = -175; bz <= 125; bz += 50) {
      if (Math.abs(bx + 25) < 19 && Math.abs(bz + 25) < 19) continue; // plaza
      const h = 8 + rnd() * 40;
      const mat = new THREE.MeshStandardMaterial({
        color: palette[Math.floor(rnd() * palette.length)],
        roughness: 0.8,
      });
      const b = new THREE.Mesh(geo, mat);
      b.scale.set(30 + rnd() * 8, h, 30 + rnd() * 8);
      b.position.set(bx + 25, h / 2, bz + 25);
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);
    }
  }
  // Containers at the docks.
  const contCols = [0xc0392b, 0x2471a3, 0x1e8449, 0xb7950b];
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(12, 2.6, 2.6),
      new THREE.MeshStandardMaterial({ color: contCols[i % 4], roughness: 0.7 }),
    );
    c.position.set(176 + (i % 2) * 8, 1.3, -60 + i * 13);
    c.rotation.y = (i % 3) * 0.2;
    c.castShadow = true;
    group.add(c);
  }
  // Palms along the beachfront.
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 1 });
  for (let i = 0; i < 24; i++) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 6, 6), trunkMat);
    trunk.position.y = 3;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.5, 7), leafMat);
    leaves.position.y = 7;
    palm.add(trunk, leaves);
    palm.position.set(-182 + rnd() * 4, 0, -190 + i * 16);
    group.add(palm);
  }
  // ROSA'S cafe sign (procedural canvas texture, original text).
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#7a1f2b';
  g2.fillRect(0, 0, 256, 96);
  g2.fillStyle = '#ffd21f';
  g2.font = 'bold 52px Georgia, serif';
  g2.textAlign = 'center';
  g2.textBaseline = 'middle';
  g2.fillText("ROSA'S", 128, 50);
  const signTex = new THREE.CanvasTexture(cv);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 3.75),
    new THREE.MeshBasicMaterial({ map: signTex }),
  );
  sign.position.set(0, 6, 12);
  group.add(sign);
  scene.add(group);
  return {
    group,
    isBlocked: (x, z) => gridBlocked(x, z),
    update() {},
  };
}

// --- compact fallback vehicles + player + traffic --------------------------
// Only used when the parallel core modules are unavailable. Arcade physics
// per DESIGN.md (accel 12, top 38 / sports 46, brake 20, reverse 10).
function buildFallbackVehicles(G) {
  const THREE = G.THREE;
  const scene = G.scene;
  const list = [];
  const parked = [];

  function carMesh(color) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.4), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.0), dark);
    cabin.position.set(0, 1.05, -0.2);
    group.add(body, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.36, wz);
      group.add(w);
    }
    return group;
  }

  function spawn(opts) {
    const o = opts || {};
    const mesh = carMesh(o.color == null ? 0xcc2222 : o.color);
    mesh.position.set(o.x || 0, 0, o.z || 0);
    scene.add(mesh);
    const veh = {
      mesh,
      pos: mesh.position,
      heading: o.heading || 0,
      speed: 0,
      hp: 100,
      sports: !!o.sports,
      isSportsCar: !!o.sports,
      parked: !!o.parked,
      stalled: false,
      stall() { this.stalled = true; },
    };
    list.push(veh);
    if (veh.parked) parked.push(veh);
    return veh;
  }

  // 8 parked stealable cars along streets.
  const spots = [
    [-25, -60, 0.9], [25, 90, 0.2], [-125, 30, 0.5], [75, -120, 0.7],
    [-75, 140, 0.1], [125, 60, 0.3], [-175, 100, 0.8], [175, -40, 0.4],
  ];
  const colors = [0xcc2222, 0x2266cc, 0xdddddd, 0x228822, 0xaa6600, 0x663399, 0x333333, 0x00aaaa];
  spots.forEach(([x, z, h], i) => spawn({ x, z, heading: h, parked: true, color: colors[i] }));

  return {
    list,
    parked,
    spawn,
    update(dt) {
      const keys = G.keys;
      const player = G.player;
      const step = Math.min(dt || 0.016, 0.05);
      for (const veh of list) {
        const driving = player && player.inCar === veh;
        if (!driving) continue;
        if (veh.stalled) {
          veh.speed *= 1 - 2 * step;
          if (G.effects && Math.random() < step * 6) {
            G.effects.smoke(veh.pos.x, 1.2, veh.pos.z, true);
          }
        } else {
          const top = veh.sports ? CFG.carSportsTopSpeed : CFG.carTopSpeed;
          const throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
          const brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
          if (throttle) veh.speed += CFG.carAccel * step;
          else if (brake) veh.speed -= (veh.speed > 0.5 ? CFG.carBrake : CFG.carReverse) * step;
          else veh.speed *= 1 - 0.6 * step;
          veh.speed = Math.max(-CFG.carReverse, Math.min(top, veh.speed));
          const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
            - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
          const steerScale = Math.max(0.25, 1 - Math.abs(veh.speed) / (top * 1.6));
          veh.heading += steer * 1.9 * steerScale * step * (veh.speed >= 0 ? 1 : -1) * (veh.speed !== 0 ? 1 : 0);
          if (keys.has('ShiftLeft') || keys.has('ShiftRight')) {
            veh.speed *= 1 - 1.8 * step; // handbrake
            if (Math.abs(veh.speed) > 8 && G.effects && Math.random() < step * 20) {
              G.effects.tireSmoke(veh.pos.x, 0.2, veh.pos.z);
            }
          }
        }
        const nx = veh.pos.x + Math.sin(veh.heading) * veh.speed * step;
        const nz = veh.pos.z + Math.cos(veh.heading) * veh.speed * step;
        if (!G.worldBlocked(nx, nz)) {
          veh.pos.x = nx;
          veh.pos.z = nz;
        } else {
          if (Math.abs(veh.speed) > 6) {
            veh.hp = Math.max(0, veh.hp - 8);
            if (G.effects) G.effects.sparks(veh.pos.x, 1, veh.pos.z, 8);
            if (G.audio) G.audio.sfx('crash');
          }
          veh.speed *= -0.25; // bounce off
        }
        veh.pos.x = Math.max(-198, Math.min(198, veh.pos.x));
        veh.pos.z = Math.max(-198, Math.min(198, veh.pos.z));
        veh.mesh.position.set(veh.pos.x, 0, veh.pos.z);
        veh.mesh.rotation.y = veh.heading;
        if (player) {
          player.pos.x = veh.pos.x;
          player.pos.z = veh.pos.z;
          player.heading = veh.heading;
          player.speed = veh.speed;
        }
      }
    },
  };
}

function buildFallbackPlayer(G) {
  const THREE = G.THREE;
  const scene = G.scene;
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0xe8b13c, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.32), shirt);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
  head.position.y = 1.68;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.9 }));
  legs.position.y = 0.34;
  group.add(body, head, legs);
  group.position.set(G.layout.spawn.x, 0, G.layout.spawn.z);
  scene.add(group);

  const player = {
    mesh: group,
    pos: group.position,
    heading: Math.PI,
    speed: 0,
    inCar: null,
    _prevE: false,
    teleport(x, z, heading) {
      this.exitCar();
      this.pos.x = x;
      this.pos.z = z;
      if (typeof heading === 'number') this.heading = heading;
      this.speed = 0;
    },
    enterCar(veh) {
      if (!veh) return;
      this.inCar = veh;
      veh.parked = false;
      group.visible = false;
      if (G.audio) G.audio.sfx('door');
      if (G.stats && veh.wasParked) G.stats.carsStolen = (G.stats.carsStolen || 0) + 1;
    },
    exitCar() {
      if (!this.inCar) return;
      const veh = this.inCar;
      this.inCar = null;
      this.pos.x = veh.pos.x - Math.sin(veh.heading) * 2.5;
      this.pos.z = veh.pos.z - Math.cos(veh.heading) * 2.5;
      this.speed = 0;
      group.visible = true;
      group.position.set(this.pos.x, 0, this.pos.z);
      if (G.audio) G.audio.sfx('door');
    },
    update(dt) {
      const step = Math.min(dt || 0.016, 0.05);
      const keys = G.keys;
      if (this.inCar) return; // vehicle system moves the player
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = run ? CFG.runSpeed : CFG.walkSpeed;
      let move = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) move += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) move -= 1;
      let turn = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) turn += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) turn -= 1;
      this.heading += turn * 2.4 * step;
      this.speed = move * speed;
      const nx = this.pos.x + Math.sin(this.heading) * this.speed * step;
      const nz = this.pos.z + Math.cos(this.heading) * this.speed * step;
      if (!G.worldBlocked(nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
      }
      this.pos.x = Math.max(-198, Math.min(198, this.pos.x));
      this.pos.z = Math.max(-198, Math.min(198, this.pos.z));
      group.position.set(this.pos.x, 0, this.pos.z);
      group.rotation.y = this.heading;
      // E: enter / exit car (edge-triggered).
      const eDown = keys.has('KeyE');
      if (eDown && !this._prevE) {
        let best = null;
        let bestD = 4;
        const cars = (G.vehicles && G.vehicles.list) || [];
        for (const veh of cars) {
          const dx = veh.pos.x - this.pos.x;
          const dz = veh.pos.z - this.pos.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < bestD) {
            bestD = d;
            best = veh;
          }
        }
        if (best) {
          const wasParked = best.parked;
          best.wasParked = wasParked;
          this.enterCar(best);
          if (wasParked && G.police) {
            // Stealing in view of police/peds raises wanted.
            const near = G.police.nearestDist ? G.police.nearestDist() : Infinity;
            if (near < 40) G.police.addHeat(2, 'steal-seen');
            else if (near < 80) G.police.addHeat(1, 'steal-witnessed');
          }
        }
      }
      this._prevE = eDown;
      // E while driving is handled here too (exit).
      if (this.inCar && eDown && !this._prevE) this.exitCar();
    },
  };
  return player;
}

function buildFallbackTraffic(G) {
  const THREE = G.THREE;
  const scene = G.scene;
  const cars = [];
  const peds = [];
  const pedColors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22];

  function trafficCarMesh(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.5, 4.0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }),
    );
    body.position.y = 0.5;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.45, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 }),
    );
    cabin.position.set(0, 0.95, -0.1);
    group.add(body, cabin);
    return group;
  }

  for (let i = 0; i < 10; i++) {
    const street = STREETS[i % STREETS.length];
    const vertical = i % 2 === 0;
    const mesh = trafficCarMesh(pedColors[i % pedColors.length]);
    const car = {
      mesh,
      pos: mesh.position,
      heading: vertical ? 0 : Math.PI / 2,
      speed: 8 + Math.random() * 5,
      street,
      vertical,
      along: -180 + Math.random() * 360,
    };
    mesh.position.set(vertical ? street : car.along, 0, vertical ? car.along : street);
    scene.add(mesh);
    cars.push(car);
  }

  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.8, 0.3),
      new THREE.MeshStandardMaterial({ color: pedColors[i % pedColors.length], roughness: 0.8 }),
    );
    body.position.y = 1.0;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 }),
    );
    head.position.y = 1.65;
    mesh.add(body, head);
    const x = -170 + Math.random() * 340;
    const z = -170 + Math.random() * 340;
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const ped = {
      mesh,
      pos: mesh.position,
      hp: 100,
      alive: true,
      heading: Math.random() * Math.PI * 2,
      speed: 1.2 + Math.random() * 0.8,
      fleeing: 0,
      flee() { this.fleeing = 4; this.speed = 5; },
      stagger() { this.speed = 0.4; setTimeout(() => { if (this.alive) this.speed = 1.5; }, 600); },
      knockback(kx, kz) {
        this.pos.x += kx;
        this.pos.z += kz;
      },
      die() {
        this.alive = false;
        mesh.visible = false;
      },
    };
    peds.push(ped);
  }

  return {
    cars,
    peds,
    spawnCarAt(x, z, heading) {
      const mesh = trafficCarMesh(0x888888);
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      const car = {
        mesh, pos: mesh.position, heading: heading || 0, speed: 10,
        street: 0, vertical: true, along: z,
      };
      cars.push(car);
      return car;
    },
    update(dt) {
      const step = Math.min(dt || 0.016, 0.05);
      const pp = G.getPlayerPos ? G.getPlayerPos() : { x: 0, z: 0 };
      for (const car of cars) {
        car.along += car.speed * step;
        if (car.along > 195) car.along = -195;
        // Yield: slow down if the player car is right ahead.
        const dx = pp.x - car.pos.x;
        const dz = pp.z - car.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 8 && G.isInCar && G.isInCar()) car.speed = Math.max(2, car.speed - 6 * step);
        else if (car.speed < 10) car.speed += 2 * step;
        if (car.vertical) car.pos.set(car.street, 0, car.along);
        else car.pos.set(car.along, 0, car.street);
        car.mesh.position.set(car.pos.x, 0, car.pos.z);
        car.mesh.rotation.y = car.heading;
      }
      for (const ped of peds) {
        if (!ped.alive) continue;
        if (ped.fleeing > 0) ped.fleeing -= step;
        else if (Math.random() < step * 0.1) ped.heading += (Math.random() - 0.5) * 2;
        const nx = ped.pos.x + Math.sin(ped.heading) * ped.speed * step;
        const nz = ped.pos.z + Math.cos(ped.heading) * ped.speed * step;
        if (!G.worldBlocked(nx, nz) && Math.abs(nx) < 195 && Math.abs(nz) < 195) {
          ped.pos.x = nx;
          ped.pos.z = nz;
        } else {
          ped.heading += Math.PI / 2;
        }
        ped.mesh.position.set(ped.pos.x, 0, ped.pos.z);
        ped.mesh.rotation.y = ped.heading;
      }
    },
  };
}

// --- busted / wasted flow (closures over G, assigned in boot) ---------------
function makeBusted(G) {
  return function busted() {
    if (!G || G.state !== 'playing') return;
    const fine = applyBusted(G);
    if (G.missions) G.missions.onBusted();
    if (G.police) {
      G.police.clearWanted();
      G.police.clear();
    }
    if (G.player && typeof G.player.exitCar === 'function') {
      try {
        G.player.exitCar();
      } catch (_err) { /* ignore */ }
    }
    G.state = 'busted';
    G.stateTimer = 2;
    G.pendingRespawn = 'precinct';
    if (G.hud) G.hud.showBusted(fine);
    if (G.audio) G.audio.sting();
    if (G.save) G.save.save();
    G.emit('busted', { fine });
  };
}

function makeWasted(G) {
  return function wasted(source) {
    if (!G || G.state !== 'playing') return;
    const fine = applyWasted(G);
    if (G.police) G.police.clear();
    if (G.player && typeof G.player.exitCar === 'function') {
      try {
        G.player.exitCar();
      } catch (_err) { /* ignore */ }
    }
    G.state = 'wasted';
    G.stateTimer = 2;
    G.pendingRespawn = 'hospital';
    if (G.hud) G.hud.showWasted(fine);
    if (G.audio) G.audio.wastedSting();
    if (G.save) G.save.save();
    G.emit('wasted', { fine, source: source || 'damage' });
  };
}

function respawn(G) {
  const dest = G.pendingRespawn === 'hospital' ? G.layout.hospital : G.layout.precinct;
  if (G.teleportPlayer) G.teleportPlayer(dest.x, dest.z, 0);
  G.pendingRespawn = null;
  G.state = 'playing';
  if (G.hud) G.hud.hideOverlays();
  if (G.hud) G.hud.toast('Back on the streets. Stay sharp.', 'info');
}

// --- camera -----------------------------------------------------------------
function updateCamera(G, dt) {
  const THREE = G.THREE;
  const camera = G.camera;
  if (!camera) return;
  if (G.shotCamera) {
    camera.position.set(G.shotCamera.pos.x, G.shotCamera.pos.y, G.shotCamera.pos.z);
    camera.lookAt(G.shotCamera.lookAt.x, G.shotCamera.lookAt.y, G.shotCamera.lookAt.z);
    return;
  }
  const p = G.getPlayerPos ? G.getPlayerPos() : { x: 0, y: 0, z: 0 };
  const heading = (G.player && typeof G.player.heading === 'number') ? G.player.heading : 0;
  if (G.state === 'title') {
    // Slow orbit over the plaza behind the title screen.
    const t = (G.time || 0) * 0.05;
    camera.position.set(Math.sin(t) * 60, 26, Math.cos(t) * 60);
    camera.lookAt(0, 2, 0);
    return;
  }
  const inCar = G.isInCar ? G.isInCar() : false;
  const dist = inCar ? 11 : 7.5;
  const height = inCar ? 5 : 4;
  const backX = p.x - Math.sin(heading) * dist;
  const backZ = p.z - Math.cos(heading) * dist;
  const k = Math.min(1, (dt || 0.016) * 5);
  camera.position.x += (backX - camera.position.x) * k;
  camera.position.y += (height - camera.position.y) * k;
  camera.position.z += (backZ - camera.position.z) * k;
  if (G.effects) {
    const off = G.effects.shakeOffset();
    if (off) {
      camera.position.x += off.x;
      camera.position.y += off.y;
      camera.position.z += off.z;
    }
  }
  camera.lookAt(
    p.x + Math.sin(heading) * 4,
    1.6,
    p.z + Math.cos(heading) * 4,
  );
}

// --- cash pickups ------------------------------------------------------------
function buildCashPickups(G) {
  const THREE = G.THREE;
  const spots = [
    [-19, -60], [19, 90], [-69, 30], [69, -120], [-119, 140],
    [119, 60], [-31, -140], [31, 140],
  ];
  const geo = new THREE.BoxGeometry(0.7, 0.25, 0.5);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd700, emissive: 0xaa8800, emissiveIntensity: 0.6,
    roughness: 0.3, metalness: 0.6,
  });
  for (const [x, z] of spots) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.35, z);
    mesh.rotation.y = Math.random() * Math.PI;
    G.scene.add(mesh);
    G.cashPickups.push({ x, z, taken: false, mesh, value: 25 + Math.floor(Math.random() * 26) });
  }
}

// --- boot --------------------------------------------------------------------
async function boot() {
  const G = createGameContext();
  if (typeof window !== 'undefined') window.__GTA = { shotReady: false, screen: 0, wanted: 0, money: G.money, mission: null, speed: 0 };

  // Bind the UI callbacks FIRST so the title buttons work even while the
  // world is still loading (startGame queues when !booted).
  G.startGame = () => startGame(G);
  G.continueGame = () => continueGame(G);
  G.resumeGame = () => togglePause(G);
  G.restartMission = () => {
    if (G.missions) G.missions.fail('restarted by player');
    if (G.state === 'paused') togglePause(G);
  };
  G.quitToTitle = () => {
    if (G.save) G.save.save();
    G.state = 'title';
    if (G.hud) G.hud.showTitle();
    if (G.police) G.police.clearWanted();
  };
  G.toggleMute = () => {
    G.muted = !G.muted;
    if (G.audio) G.audio.setMuted(G.muted);
  };
  G.busted = makeBusted(G);
  G.wasted = makeWasted(G);

  // --- keyboard: attached BEFORE any await, so Enter can never be lost.
  // Canonical key set (G.keys) + UI keys. Gameplay keys are also visible
  // to the input module through the same Set (merged in the loop).
  const onKeyDown = (e) => {
    if (e.repeat) {
      G.keys.add(e.code);
      return;
    }
    G.keys.add(e.code);
    if (handleTitleKey(G, e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (G.state === 'playing' || G.state === 'paused') togglePause(G);
      return;
    }
    if (e.code === 'KeyM') {
      G.toggleMute();
      return;
    }
    if (G.state !== 'playing') return;
    if (e.code === 'KeyF' && G.combat) G.combat.punch();
    if (e.code === 'KeyR' && G.combat) G.combat.reload();
    if (e.code === 'Digit1' && G.combat) G.combat.switchWeapon(1);
    if (e.code === 'Digit2' && G.combat) G.combat.switchWeapon(2);
    if (e.code === 'KeyH' && G.audio) G.audio.sfx('honk');
  };
  const onKeyUp = (e) => {
    G.keys.delete(e.code);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // --- load the systems modules (written fresh for v5) ---
  const [
    hudMod, saveMod, audioMod, effectsMod, policeMod,
    missionsMod, combatMod, minimapMod, shotsMod,
  ] = await Promise.all([
    import('./hud.js'), import('./save.js'), import('./audio.js'),
    import('./effects.js'), import('./police.js'), import('./missions.js'),
    import('./combat.js'), import('./minimap.js'), import('./shots.js'),
  ]).catch((err) => {
    console.error('[solmar] failed to load systems modules', err);
    return [];
  });

  // --- three.js (vendored, no network) ---
  let THREE = null;
  try {
    THREE = await import('three');
  } catch (err) {
    console.error('[solmar] three.js failed to load', err);
    document.body.innerHTML = '<p style="color:#fff;font-family:sans-serif;padding:40px">'
      + 'Solmar Bay could not load its 3D engine (vendor/three/three.module.min.js).'
      + '</p>';
    return;
  }
  G.THREE = THREE;

  // --- the real world (world.js + render.js + input.js) -------------------
  // The core modules are plain data + math: createWorld builds the city,
  // player, cars, traffic and pickups from seed 7; createGameRenderer
  // builds the three.js scene from that city; updateWorld steps it all.
  // This wiring is the fix for the v5 integration bug: the old boot asked
  // each core module for a factory it does not have (createCity(G),
  // createVehicles(G), a player object with .update/.teleport) and silently
  // ended up with a frozen player at an undefined position. Here every
  // module is called exactly the way it is written.
  const worldMod = await import('./world.js');
  const renderMod = await import('./render.js');
  const inputMod = await import('./input.js');
  const trafficMod = await import('./traffic.js');
  const vehicleMod = await import('./vehicle.js');
  const cityMod = await import('./city.js');
  const playerMod = await import('./player.js');

  const world = worldMod.createWorld(7);
  G.world = world;
  G.player = world.player;
  G.traffic = world.traffic;
  G.cashPickups = world.pickups;
  G.time = 0;
  G.money = world.money;
  G.wanted = world.wanted;

  // Pedestrian shims so combat / HUD code written against {pos, hp, alive,
  // flee, stagger, knockback, die} keeps working on the plain ped state.
  for (const ped of world.traffic.peds) {
    Object.defineProperty(ped, 'pos', {
      configurable: true,
      get() { return { x: this.x, z: this.z }; },
    });
    ped.hp = 100;
    ped.alive = true;
    ped.flee = function flee() {
      this.state = 'flee';
      this.fleeUntil = world.time + 3;
    };
    ped.stagger = function stagger() {
      /* brief stop; the walker re-derives speed next frame */
    };
    ped.knockback = function knockback(dx, dz) {
      this.x += dx;
      this.z += dz;
    };
    ped.die = function die() {
      this.alive = false;
      this.state = 'down';
      this.downUntil = world.time + 4;
    };
  }

  // Collision query for the adapters (player radius 0.45 m) and the
  // exit-car step the teleport adapter needs.
  G._pointInSolid = (x, z) => cityMod.pointInSolid(x, z, 0.45, world.city);
  G._exitCar = (p) => playerMod.exitCar(p, world.city);

  // Vehicle system: the thin shell the adapters + shots expect.
  const spawnVehicle = (opts) => {
    const o = opts || {};
    const type = o.sports ? 'sports' : (o.type || 'sedan');
    const car = vehicleMod.createVehicle(type, o.x || 0, o.z || 0,
      o.heading || 0, { color: o.color, parked: !!o.parked, driver: null });
    world.vehicles.push(car);
    if (car.parked) world.traffic.parked.push(car);
    return car;
  };
  G.vehicles = {
    list: world.vehicles,
    parked: world.traffic.parked,
    spawn: spawnVehicle,
    update() { /* the player's car is driven by updateWorld in the loop */ },
  };

  // Traffic-car spawner for the cover shot (a car needs a route, or the
  // traffic step crashes on car.route[routeIndex]).
  G._spawnTrafficAt = (x, z, heading) => {
    const car = vehicleMod.createVehicle('sedan', x, z, heading || 0,
      { driver: 'traffic' });
    car.route = trafficMod.buildRoute(world.rng, world.city);
    car.routeIndex = 0;
    car.targetSpeed = 8;
    car.stopped = false;
    car.waitTimer = 0;
    world.traffic.cars.push(car);
    world.vehicles.push(car);
    return car;
  };

  // --- renderer / scene / camera (render.js owns all three) --------------
  // Golden hour 17:40, fixed: the sky dome, sun, fog and clouds all come
  // from createGameRenderer, so the light never changes between shots.
  const canvasHost = document.getElementById('game-root') || document.body;
  const canvas = document.createElement('canvas');
  canvasHost.appendChild(canvas);
  const gr = renderMod.createGameRenderer(canvas, world.city);
  G.renderer = gr.renderer;
  G.render = gr;
  G.scene = gr.scene;
  G.camera = gr.camera;
  G.city = { data: world.city, update() {} };

  // Gameplay input (keyboard + mouse) owned by input.js.
  const input = inputMod.createInput(gr.renderer.domElement);
  G.input = input;
  G.inputMod = inputMod;

  // --- HUD + save (DOM is ready before the world, so the title shows fast)
  G.save = saveMod.createSave(G);
  G.hud = hudMod.createHUD(G);
  G.audio = audioMod.createAudio(G);
  G.effects = effectsMod.createEffects(G);
  wireAdapters(G);

  // --- core modules: already wired above (world / render / input) --------
  // createWorld + createGameRenderer + createInput own the core now; there
  // is no second, duck-typed wiring pass. The old fallback builders below
  // stay in the file unused (they are removed at cleanup once QA passes).

  // --- systems modules ---
  G.police = policeMod.createPolice(G);
  G.missions = missionsMod.createMissions(G);
  G.combat = combatMod.createCombat(G);
  G.minimap = minimapMod.createMinimap(G);
  G.shots = shotsMod.createShots(G);

  // (Cash pickups already exist in the world — updateWorld collects them
  // and render.js draws them; nothing extra to build here.)

  // --- mouse: click canvas to lock pointer; click again (locked) to shoot --
  gr.renderer.domElement.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing') return;
    if (e.button !== 0) return;
    if (document.pointerLockElement !== gr.renderer.domElement) {
      try {
        gr.renderer.domElement.requestPointerLock();
      } catch (_err) { /* pointer lock unavailable */ }
      return;
    }
    if (G.combat && G.weapon === 'pistol') G.combat.shoot();
  });
  gr.renderer.domElement.addEventListener('click', () => {
    if (G.audio) G.audio.init();
  });

  window.addEventListener('resize', () => {
    renderMod.resizeRenderer(gr);
  });

  // --- title screen (save peek decides whether Continue shows) ---
  G.hud.showTitle();
  G.booted = true;

  // --- game loop ---
  // --- game loop ------------------------------------------------------------
  // One step per frame: the world (player, cars, traffic, pickups) via
  // updateWorld, then the systems (police, missions, combat), then the
  // renderer draws everything. The world owns money and time; G mirrors
  // them in and out each frame so missions / police / HUD all read one
  // consistent set of numbers.
  let last = performance.now();
  let titleSpin = 0;
  // One deterministic simulation step. The rAF loop calls it with the real
  // frame delta; window.advanceTime (below) calls it with fixed 1/60 s
  // steps so automated tests can drive the game without waiting on the
  // renderer (software GL in a test VM renders far slower than a real GPU,
  // and wall-clock timing would make every movement test flaky).
  function tick(dt) {

    // Scripted input for ?shot= staging: drive forward while staging the
    // cover / chase shots; the real keyboard the rest of the time.
    if (G.autopilot && Array.isArray(G.autopilot.keys)
      && G.autopilot.keys.includes('KeyW')) {
      inputMod.inject(input,
        Object.assign(inputMod.emptySnapshot(), { moveY: 1 }));
    } else {
      inputMod.inject(input, null);
    }
    const snap = inputMod.readInput(input);

    if (G.state === 'playing') {
      titleSpin = 0;
      world.money = G.money;
      world.wanted = G.wanted;
      worldMod.updateWorld(world, snap, dt, {
        onStealCar(car, wasParked) {
          if (!G) return;
          if (wasParked) G.stats.carsStolen = (G.stats.carsStolen || 0) + 1;
          // Stealing in view of the police raises heat (DESIGN.md).
          if (G.police) {
            const near = G.police.nearestDist ? G.police.nearestDist() : Infinity;
            if (near < 40) G.police.addHeat(2, 'steal-seen');
            else if (near < 80) G.police.addHeat(1, 'steal-witnessed');
          }
          void car;
          void wasParked;
        },
        onEnterCar() {
          if (G.audio) G.audio.sfx('door');
        },
        onPickup(pk) {
          G.stats.bestCash = Math.max(G.stats.bestCash || 0, world.money);
          if (G.hud) G.hud.toast(`Cash pickup +$${pk.amount}`, 'cash');
          if (G.audio) G.audio.sfx('cash');
          if (G.effects) G.effects.sparkle(pk.x, 1, pk.z, 0xffd700);
        },
        onPedHit() {
          if (G.police) G.police.addHeat(1, 'hit-ped');
          if (G.audio) G.audio.sfx('crash');
        },
        onCarCollision(c) {
          if (G.effects) G.effects.sparks(c.x, 1, c.z, 8);
          if (G.audio) G.audio.sfx('crash');
        },
        onHonk() {
          if (G.audio) G.audio.sfx('honk');
        },
      });
      trafficMod.revivePeds(world.traffic, world.time);
      G.money = world.money;
      G.time = world.time;
      G.stats.carsStolen = Math.max(
        G.stats.carsStolen || 0, world.stats.carsStolen || 0);
      if (G.police) G.police.update(dt);
      if (G.missions) G.missions.update(dt);
      if (G.combat) G.combat.update(dt);
      if (G.effects) G.effects.update(dt);

      // Autosave every 30 s.
      if (G.time - G.lastAutosave >= CFG.autosaveSeconds) {
        G.lastAutosave = G.time;
        if (G.save) G.save.save();
      }
    } else if (G.state === 'busted' || G.state === 'wasted') {
      G.stateTimer -= dt;
      if (G.effects) G.effects.update(dt);
      if (G.stateTimer <= 0) respawn(G);
    } else if (G.state === 'title') {
      titleSpin += dt;
      // Traffic keeps the title backdrop alive; the player stands still.
      trafficMod.updateTraffic(world.traffic, {
        now: world.time, player: world.player, playerCar: null,
        police: [], scaredUntil: 0,
      }, dt, world.city);
      trafficMod.revivePeds(world.traffic, world.time);
      world.time += dt;
      G.time = world.time;
      if (G.effects) G.effects.update(dt);
    }
    inputMod.endFrame(input);

    // Audio follows speed / police proximity; HUD + minimap refresh.
    if (G.audio) {
      const speed = G.getPlayerSpeed ? G.getPlayerSpeed() : 0;
      const throttle = G.keys.has('KeyW') || G.keys.has('ArrowUp') ? 1 : 0;
      const near = G.police && typeof G.police.nearestDist === 'function'
        ? G.police.nearestDist()
        : Infinity;
      const policeNear = near === Infinity ? 0 : Math.max(0, 1 - near / 80);
      G.audio.update(dt, speed, throttle, policeNear);
    }
    if (G.hud) G.hud.update(dt);
    if (G.minimap) G.minimap.update(dt);
    if (G.shots) G.shots.update(dt);

    // Camera: render.js follows the player; a staged shot (or the title
    // orbit) pins it to a fixed pose instead.
    if (G.state === 'title') {
      // High slow orbit so the title backdrop shows the city, not one roof.
      const t = titleSpin * 0.05;
      world.shotCamera = {
        pos: { x: Math.sin(t) * 72, y: 42, z: Math.cos(t) * 72 },
        lookAt: { x: 0, y: 2, z: 0 },
      };
    } else {
      world.shotCamera = G.shotCamera || null;
    }

    if (typeof window !== 'undefined' && window.__GTA) {
      window.__GTA.wanted = G.wanted || 0;
      window.__GTA.money = G.money || 0;
      window.__GTA.speed = G.getPlayerSpeed ? G.getPlayerSpeed() : 0;
      window.__GTA.mission = G.missions && G.missions.current && G.missions.current()
        ? G.missions.current().id
        : null;
      window.__GTA.screen = G.shots ? G.shots.staged : 0;
      // Debug state for the automated playtest: position, heading, car,
      // mission step, distance to the active marker, parked cars.
      const pp = G.getPlayerPos ? G.getPlayerPos() : { x: 0, z: 0 };
      window.__GTA.dbg = {
        x: pp.x,
        z: pp.z,
        heading: (G.player && typeof G.player.heading === 'number')
          ? G.player.heading
          : 0,
        inCar: G.isInCar ? !!G.isInCar() : false,
        state: G.state,
        time: G.time || 0,
        step: G.missions ? G.missions.stepIndex : 0,
        dist: G.missions && typeof G.missions.distanceToMarker === 'function'
          ? G.missions.distanceToMarker()
          : 0,
        parked: (world.traffic.parked || []).map((c) => ({ x: c.x, z: c.z })),
      };
    }
  }
  // The rAF loop: one simulation step, then one render. Automated tests
  // can pause it (window.__setRafPaused) and drive the simulation with
  // window.advanceTime instead, so a slow software renderer does not
  // make logic tests flaky or slow.
  function frame(now) {
    if (G.rafPaused) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    renderMod.syncWorld(gr, world, dt);
  }
  gr.renderer.setAnimationLoop(frame);

  // --- test hooks (deterministic, non-flaky automation) -------------------
  // render_game_to_text(): one JSON-safe snapshot of the game for tests —
  // mode, player position/speed, visible entities, score, mission timer,
  // state flags. advanceTime(ms): step the simulation forward in fixed
  // 1/60 s steps (rendering once at the end), so a test can hold a key and
  // fast-forward the game instead of waiting on wall-clock frames.
  window.render_game_to_text = () => {
    const pp = G.getPlayerPos ? G.getPlayerPos() : { x: 0, z: 0 };
    const cur = G.missions && G.missions.current
      ? G.missions.current()
      : null;
    return {
      mode: G.state,
      player: {
        x: Math.round(pp.x * 100) / 100,
        z: Math.round(pp.z * 100) / 100,
        heading: Math.round(
          ((G.player && G.player.heading) || 0) * 100) / 100,
        speed: Math.round((G.getPlayerSpeed ? G.getPlayerSpeed() : 0) * 100) / 100,
        inCar: G.isInCar ? !!G.isInCar() : false,
        health: G.health || 0,
      },
      money: Math.floor(G.money || 0),
      wanted: G.wanted || 0,
      time: Math.round((G.time || 0) * 100) / 100,
      mission: cur ? {
        id: cur.id,
        name: cur.name,
        step: G.missions.stepIndex,
        dist: Math.round(
          (G.missions.distanceToMarker
            ? G.missions.distanceToMarker()
            : 0) * 100) / 100,
        timer: Math.round((G.missions.stepTimer || 0) * 10) / 10,
      } : null,
      entities: {
        trafficCars: (world.traffic.cars || []).length,
        parkedCars: (world.traffic.parked || []).length,
        peds: (world.traffic.peds || []).length,
        policeCars: (G.police ? G.police.cars.length : 0),
        pickupsLeft: (world.pickups || []).filter((p) => !p.taken).length,
      },
      flags: {
        title: G.state === 'title',
        playing: G.state === 'playing',
        paused: G.state === 'paused',
        busted: G.state === 'busted',
        wasted: G.state === 'wasted',
        shotStaged: G.shots ? G.shots.staged : 0,
      },
    };
  };
  window.advanceTime = (ms, render) => {
    const steps = Math.max(1, Math.round((ms || 0) / (1000 / 60)));
    for (let i = 0; i < steps; i++) tick(1 / 60);
    if (render !== false) renderMod.syncWorld(gr, world, 1 / 60);
    return window.render_game_to_text();
  };
  // Pause the rAF loop (the game freezes; advanceTime still steps it).
  // Tests use this so a slow software renderer does not compete with the
  // simulation. Never called by the game itself.
  window.__setRafPaused = (v) => {
    G.rafPaused = !!v;
  };

  // --- ?shot= staging + a start queued during load ---
  if (G.shots) G.shots.stageFromURL();
  if (G.queuedStart) startGame(G);
}

// Auto-boot in a browser only. In Node (tests) document is undefined and
// nothing runs at import time.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  boot().catch((err) => {
    console.error('[solmar] boot failed', err);
  });
}
