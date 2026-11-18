// Solmar Bay — boot + main loop. Builds the shared state S, wires every
// system together, and runs the frame loop in a fixed order.
//
// Every factory is called directly with the signature its module actually
// defines (verified against Worker A/B sources during integration):
//   createRenderer(canvas) / createScene() -> {scene, camera, sun, hemi}
//   buildCity(seed) / buildCityMeshes(scene, city, THREE)
//   createPlayer(spawn) / createPlayerMesh(player, THREE)
//   createTraffic(city, rng) / createTrafficMeshes(traffic, THREE)
//   createCar({x, z, heading, kind, color}) / createCarMesh(car, THREE)
//   createPolice() / createMissions(city) / createCombat() / createHud()
//   createMinimap() / createAudio() / createInput() / createEffects(scene)
//   updatePlayer(S, dt) drives the car itself via updateCar(car, ctl, dt, city),
//   so the loop never calls updateCar with S.
//   updateCamera(camera, S, dt) — camera first.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32 } from './random.js';
import { buildCity } from './city.js';
import { createRenderer, createScene, buildCityMeshes, updateCamera, resize } from './render.js';
import { createCar, createCarMesh, damageCar, CAR_COLORS } from './vehicle.js';
import { createPlayer, createPlayerMesh, updatePlayer } from './player.js';
import { createTraffic, createTrafficMeshes, updateTraffic } from './traffic.js';
import { createInput, attachInput } from './input.js';
import { createPolice, updatePolice } from './police.js';
import { createMissions, updateMissions, missionObjective } from './missions.js';
import { createCombat, updateCombat, punch, shoot, reload, switchWeapon, buyAmmo, healPlayer } from './combat.js';
import { createHud, updateHud, toast, showScreen } from './hud.js';
import { createMinimap, drawMinimap } from './minimap.js';
import { createAudio, ensureAudio, updateAudio, sfx, toggleMute } from './audio.js';
import { SAVE_KEY, loadSave, saveGame, clearSave } from './save.js';
import { createEffects, updateEffects, tireSmoke } from './effects.js';
import { getShotParams, stageShot, exposeGTA, markShotFrame } from './shots.js';

function playerPos(S) {
  const p = S.player || {};
  return { x: p.x || 0, z: p.z || 0 };
}

export function boot() {
  const params = getShotParams();
  const seed = params.seed ?? 7;
  const rng = mulberry32(seed);
  const canvas = document.getElementById('game');

  // --- renderer / scene / camera ---
  const renderer = createRenderer(canvas);
  const { scene, camera } = createScene();

  // --- city ---
  const city = buildCity(seed);
  buildCityMeshes(scene, city, THREE);

  // --- mission marker beam (glowing, pulsing) at the current objective ---
  const markerMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 9, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffe14d, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }),
  );
  markerMesh.visible = false;
  scene.add(markerMesh);

  const S = {
    seed,
    rng,
    config: CONFIG,
    scene,
    camera,
    renderer,
    THREE,
    city,
    peds: [],
    trafficCars: [],
    parkedCars: [],
    player: null,
    cars: [],
    police: null,
    missions: null,
    combat: null,
    hud: null,
    minimap: null,
    audio: null,
    save: { stats: { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 0 } },
    effects: null,
    input: null,
    mode: 'title',
    time: 0,
    messages: [],
    objective: "Go to Rosa's café",
    shot: params.shot || 0,
    shotFrames: 0,
    shotReady: false,
    camHeading: Math.PI,
    saveT: 0,
    onBusted: null,
    onWasted: null,
    saveGame: null,
  };

  // --- effects (needs the scene) ---
  S.effects = createEffects(scene);

  // --- player ---
  const player = createPlayer(city.spawn);
  S.player = player;
  const playerMesh = createPlayerMesh(player, THREE);
  if (playerMesh) {
    S.playerMesh = playerMesh;
    scene.add(playerMesh);
  }

  // --- traffic + peds ---
  const traffic = createTraffic(city, rng);
  S.traffic = traffic;
  S.trafficCars = traffic.cars;
  S.peds = traffic.peds;
  createTrafficMeshes(traffic, THREE);
  for (const car of traffic.cars) if (car.mesh) scene.add(car.mesh);
  for (const ped of traffic.peds) if (ped.mesh) scene.add(ped.mesh);

  // --- parked cars (8, stealable) ---
  const parkedSpots = [
    { x: 25, z: -12, h: Math.PI / 2 }, { x: -25, z: 12, h: -Math.PI / 2 },
    { x: 75, z: -12, h: Math.PI / 2 }, { x: -75, z: 12, h: -Math.PI / 2 },
    { x: 12, z: -75, h: 0 }, { x: -12, z: 75, h: Math.PI },
    { x: -170, z: -10, h: Math.PI }, { x: 125, z: 12, h: -Math.PI / 2 },
  ];
  parkedSpots.forEach((spot, i) => {
    const car = createCar({
      x: spot.x, z: spot.z, heading: spot.h,
      kind: 'sedan', color: CAR_COLORS[i % CAR_COLORS.length],
    });
    car.parked = true;
    const mesh = createCarMesh(car, THREE);
    if (mesh) {
      car.mesh = mesh;
      scene.add(mesh);
    }
    S.parkedCars.push(car);
  });
  S.cars = [...S.parkedCars];

  // --- systems ---
  S.police = createPolice();
  S.missions = createMissions(city);
  S.combat = createCombat();
  S.hud = createHud();
  S.minimap = createMinimap();
  S.audio = createAudio();
  // The audio object is a plain state bag; give the systems the one-shot
  // helpers they call (sfx/honk/door) as bound methods.
  S.audio.sfx = (st, name) => sfx(st, name);
  S.audio.honk = () => sfx(S, 'honk');
  S.audio.door = () => sfx(S, 'door');
  S.input = createInput();
  attachInput(S.input, canvas);
  S.saveGame = (st) => saveGame(st);

  // --- save: apply if one exists ---
  let saved = null;
  try { saved = loadSave(); } catch (e) { saved = null; }
  if (saved) {
    S.save.data = saved;
    S.save.stats = saved.stats || S.save.stats;
    player.money = saved.money;
    if (typeof saved.missionIndex === 'number') S.missions.index = saved.missionIndex;
    S.audio.muted = !!saved.muted;
    S.hasSave = true;
  }

  // --- bust / wasted handlers ---
  S.onBusted = () => {
    const p = S.player;
    const cash = typeof p.money === 'number' ? p.money : 0;
    const lost = Math.min(200, cash);
    if (typeof p.money === 'number') p.money -= lost;
    S.save.stats.busted = (S.save.stats.busted || 0) + 1;
    S.police.stars = 0;
    S.police.heat = 0;
    for (const cop of S.police.cops) cop.bustT = 0;
    S.missions.needsRetry = true;
    toast(S, `Busted! −$${lost}`);
    sfx(S, 'busted');
    try { saveGame(S); } catch (e) { /* ignore */ }
    S.mode = 'busted';
    showScreen(S.hud, 'busted');
    // Respawn at the precinct after 2 s.
    const precinct = S.missions.landmarks.precinct;
    setTimeout(() => {
      p.x = precinct.x;
      p.z = precinct.z;
      p.heading = 0;
      p.car = null;
      p.onFoot = true;
      p.speed = 0;
      S.mode = 'play';
      showScreen(S.hud, null);
    }, 2000);
  };

  S.onWasted = () => {
    const p = S.player;
    const cash = typeof p.money === 'number' ? p.money : 0;
    const lost = Math.min(100, cash);
    if (typeof p.money === 'number') p.money -= lost;
    toast(S, `Wasted! −$${lost}`);
    sfx(S, 'busted');
    try { saveGame(S); } catch (e) { /* ignore */ }
    S.mode = 'wasted';
    showScreen(S.hud, 'wasted');
    const hospital = S.missions.landmarks.hospital;
    setTimeout(() => {
      p.x = hospital.x;
      p.z = hospital.z;
      p.heading = 0;
      p.hp = 100;
      p.car = null;
      p.onFoot = true;
      p.speed = 0;
      S.mode = 'play';
      showScreen(S.hud, null);
    }, 2000);
  };

  // --- keyboard: title / pause / mute / honk / combat keys ---
  window.addEventListener('keydown', (e) => {
    try { ensureAudio(S); } catch (err) { /* ignore */ }
    if (e.code === 'Enter' && S.mode === 'title') {
      S.mode = 'play';
      showScreen(S.hud, null);
      toast(S, "Rosa: Dario, it's Rosa. Come to the café.");
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (S.mode === 'play') {
        S.mode = 'pause';
        showScreen(S.hud, 'pause');
        try { saveGame(S); } catch (err) { /* ignore */ }
      } else if (S.mode === 'pause') {
        S.mode = 'play';
        showScreen(S.hud, null);
      }
    } else if (e.code === 'KeyM') {
      const muted = toggleMute(S);
      toast(S, muted ? 'Muted' : 'Sound on');
    } else if (e.code === 'KeyH' && S.mode === 'play') {
      sfx(S, 'honk');
      for (const ped of S.peds || []) {
        const d = Math.hypot((ped.x ?? 0) - playerPos(S).x, (ped.z ?? 0) - playerPos(S).z);
        if (d < 15) { ped.fleeing = true; ped.fleeT = 2; }
      }
    } else if (S.mode === 'play') {
      if (e.code === 'KeyF') punch(S);
      else if (e.code === 'KeyR') reload(S);
      else if (e.code === 'Digit1') switchWeapon(S, 'fists');
      else if (e.code === 'Digit2') switchWeapon(S, 'pistol');
      else if (e.code === 'KeyB') buyAmmo(S);
    }
  });
  window.addEventListener('mousedown', () => {
    try { ensureAudio(S); } catch (err) { /* ignore */ }
    if (S.mode === 'play') shoot(S);
  });
  window.addEventListener('resize', () => {
    try { resize(renderer, camera); } catch (err) { /* ignore */ }
  });
  // Title buttons (Continue / Start) if present in the DOM.
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      try { ensureAudio(S); } catch (err) { /* ignore */ }
      S.mode = 'play';
      showScreen(S.hud, null);
    });
  }
  const continueBtn = document.getElementById('continue-btn');
  if (continueBtn) {
    if (!S.hasSave) continueBtn.style.display = 'none';
    continueBtn.addEventListener('click', () => {
      try { ensureAudio(S); } catch (err) { /* ignore */ }
      S.mode = 'play';
      showScreen(S.hud, null);
    });
  }

  // --- shot staging ---
  if (params.shot >= 1 && params.shot <= 4) {
    stageShot(S, params.shot);
    if (params.shot === 2) showScreen(S.hud, 'title');
    else showScreen(S.hud, null);
  } else {
    showScreen(S.hud, 'title');
  }

  // --- main loop ---
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    S.time += dt;

    if (S.mode === 'play') {
      updatePlayer(S, dt);
      updateTraffic(S, dt);
      // Handbrake tire smoke.
      const p = S.player;
      if (p && p.car && p.handbrake && Math.abs(p.car.speed || 0) > 8) {
        tireSmoke(S, p.car);
      }
      updatePolice(S, dt);
      updateMissions(S, dt);
      updateCombat(S, dt);
      // Healing at the café / hospital when standing on the spot.
      healPlayer(S);
      // Death check.
      if (typeof S.player?.hp === 'number' && S.player.hp <= 0 && S.mode === 'play') {
        S.onWasted();
      }
      // Autosave every 30 s.
      S.saveT += dt;
      if (S.saveT >= 30) {
        S.saveT = 0;
        try { saveGame(S); } catch (e) { /* ignore */ }
      }
    } else if (S.mode === 'shot') {
      // Staged shots: the city stays alive (traffic rolls) but the
      // player, police and missions are frozen as staged.
      updateTraffic(S, dt);
      updateCombat(S, dt);
    }

    updateEffects(S, dt);
    updateAudio(S, dt);
    updateHud(S, dt);
    drawMinimap(S);
    updateCamera(camera, S, dt);

    // Mission marker beam follows the current objective.
    const marker = S.missions?.marker;
    if (marker) {
      markerMesh.visible = true;
      markerMesh.position.set(marker.x, 4.5, marker.z);
      markerMesh.material.opacity = 0.6 + 0.25 * Math.sin(S.time * 5);
      markerMesh.rotation.y = S.time * 0.8;
    } else {
      markerMesh.visible = false;
    }

    renderer.render(scene, camera);

    if (S.mode === 'shot') markShotFrame(S);
    exposeGTA(S);
  }
  requestAnimationFrame(frame);

  // Referenced so a reader can see the full wiring at a glance.
  void damageCar;
  void missionObjective;
  void clearSave;
  void SAVE_KEY;

  return S;
}

// Auto-boot when loaded as the page's module script.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
