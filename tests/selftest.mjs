// Solmar Bay — pure-logic selftest (Node, no browser).
// Imports the game's logic modules directly, with 'three' answered by the
// in-memory stub from tests/three-hooks.mjs. Run:
//   node --import ./tests/register-three.mjs tests/selftest.mjs
import * as THREE from 'three';
import { CONFIG } from '../game/src/config.js';
import { mulberry32, range, int, choice, shuffle } from '../game/src/random.js';
import { buildCity, collidesWithBuildings, clampToCity } from '../game/src/city.js';
import { createCar, createCarMesh, updateCar, damageCar, CAR_COLORS } from '../game/src/vehicle.js';
import { createPlayer, createPlayerMesh, updatePlayer } from '../game/src/player.js';
import { createTraffic, createTrafficMeshes, updateTraffic, lightState } from '../game/src/traffic.js';
import { createPolice, addHeat, updatePolice } from '../game/src/police.js';
import { createMissions, updateMissions, missionObjective } from '../game/src/missions.js';
import { createCombat, updateCombat, punch, shoot, reload, switchWeapon, buyAmmo, healPlayer } from '../game/src/combat.js';
import { SAVE_KEY, loadSave, saveGame } from '../game/src/save.js';
import { createEffects, updateEffects, spawnSmoke, spawnSparks, muzzleFlash, tireSmoke } from '../game/src/effects.js';
import { getShotParams, stageShot, exposeGTA, markShotFrame } from '../game/src/shots.js';
import { createScene, updateCamera } from '../game/src/render.js';

let n = 0;
const failures = [];
function t(cond, msg) {
  n++;
  if (!cond) failures.push(msg);
}
function eq(a, b, msg) { t(Object.is(a, b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function approx(a, b, eps, msg) { t(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ${b} ± ${eps})`); }

// --- fake localStorage for the save tests ---
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
globalThis.localStorage = fakeStorage();
const sceneStub = { add() {}, remove() {} };

// ================= config =================
eq(CONFIG.WORLD_SIZE, 400, 'config: world 400 m');
eq(CONFIG.BLOCKS, 8, 'config: 8 blocks');
eq(CONFIG.STREET_W, 12, 'config: streets 12 m');
eq(CONFIG.PLAYER.walk, 5, 'config: walk 5 m/s');
eq(CONFIG.PLAYER.run, 8, 'config: run 8 m/s');
eq(CONFIG.PLAYER.hp, 100, 'config: player hp 100');
eq(CONFIG.CAR.accel, 12, 'config: car accel 12');
eq(CONFIG.CAR.top, 38, 'config: car top 38 m/s');
eq(CONFIG.CAR.sportsTop, 46, 'config: sports top 46 m/s');
eq(CONFIG.CAR.brake, 20, 'config: brake 20');
eq(CONFIG.CAR.reverse, 10, 'config: reverse 10');
eq(CONFIG.TRAFFIC_COUNT, 10, 'config: 10 traffic cars');
eq(CONFIG.PARKED_COUNT, 8, 'config: 8 parked cars');
eq(CONFIG.PED_COUNT, 24, 'config: 24 peds');
eq(CONFIG.POLICE.maxStars, 5, 'config: max 5 stars');
eq(CONFIG.POLICE.decayDelay, 15, 'config: decay delay 15 s');
eq(CONFIG.POLICE.decayPer, 10, 'config: decay step 10 s');
eq(CONFIG.REWARDS.M1, 300, 'config: M1 reward $300');
eq(CONFIG.REWARDS.M2, 500, 'config: M2 reward $500');
eq(CONFIG.REWARDS.M3, 800, 'config: M3 reward $800');
eq(CONFIG.SAVE_KEY, 'solmar-bay-save-v1', 'config: save key');
eq(SAVE_KEY, 'solmar-bay-save-v1', 'save: exported SAVE_KEY matches config');

// ================= random =================
{
  const a = mulberry32(7);
  const b = mulberry32(7);
  const c = mulberry32(8);
  t(a() === b(), 'rng: same seed, same first value');
  t(a() === b(), 'rng: same seed, same second value');
  t(a() !== c(), 'rng: different seed, different first value');
  const r = mulberry32(42);
  for (let i = 0; i < 50; i++) { const v = r(); t(v >= 0 && v < 1, 'rng: value in [0,1)'); }
  const rr = mulberry32(1);
  for (let i = 0; i < 20; i++) { const v = range(rr, 5, 9); t(v >= 5 && v < 9, 'rng: range in bounds'); }
  const ri = mulberry32(2);
  for (let i = 0; i < 20; i++) { const v = int(ri, 3, 7); t(Number.isInteger(v) && v >= 3 && v < 7, 'rng: int in bounds'); }
  eq(choice(mulberry32(3), ['a']), 'a', 'rng: choice of one');
  const s1 = shuffle(mulberry32(9), [1, 2, 3, 4, 5, 6, 7, 8]);
  const s2 = shuffle(mulberry32(9), [1, 2, 3, 4, 5, 6, 7, 8]);
  eq(JSON.stringify(s1), JSON.stringify(s2), 'rng: shuffle deterministic');
  eq(JSON.stringify([...s1].sort((x, y) => x - y)), JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]), 'rng: shuffle is a permutation');
}

// ================= city =================
const city = buildCity(7);
const cityAgain = buildCity(7);
const cityOther = buildCity(8);
eq(JSON.stringify(city), JSON.stringify(cityAgain), 'city: same seed, identical city');
t(JSON.stringify(city) !== JSON.stringify(cityOther), 'city: different seed, different city');
t(city.buildings.length > 40, `city: has buildings (${city.buildings.length})`);
eq(city.districts.length, 5, 'city: 5 districts');
eq(city.streets.length, 18, 'city: 18 street segments');
t(city.palms.length > 20, `city: palms present (${city.palms.length})`);
eq(city.containers.length, 12, 'city: 12 containers');
eq(city.cranes.length, 3, 'city: 3 cranes');
eq(city.stalls.length, 10, 'city: 10 market stalls');
eq(city.billboards.length, 5, 'city: 5 billboards');
eq(city.cafe.x, -20, 'city: cafe x -20');
eq(city.cafe.z, -10, 'city: cafe z -10');
eq(city.docks.x, 160, 'city: docks x 160');
eq(city.docks.z, 50, 'city: docks z 50');
eq(city.garage.x, 0, 'city: garage x 0');
eq(city.garage.z, 170, 'city: garage z 170');
eq(city.safehouse.x, -60, 'city: safehouse x -60');
eq(city.safehouse.z, 160, 'city: safehouse z 160');
eq(city.precinct.x, 100, 'city: precinct x 100');
eq(city.precinct.z, -80, 'city: precinct z -80');
eq(city.hospital.x, 120, 'city: hospital x 120');
eq(city.hospital.z, -120, 'city: hospital z -120 (south is +z, hospital is north)');
eq(city.gunshop.x, 80, 'city: gunshop x 80');
eq(city.gunshop.z, 40, 'city: gunshop z 40');
eq(city.spawn.x, 0, 'city: spawn x 0');
eq(city.spawn.z, 20, 'city: spawn z 20');
{
  const b0 = city.buildings[0];
  t(collidesWithBuildings(city, b0.x, b0.z, 1), 'city: building centre collides');
  t(!collidesWithBuildings(city, 0, 0, 1), 'city: plaza centre is clear');
  const c = clampToCity(city, 500, -500);
  eq(c.x, 198, 'city: clamp x to +198');
  eq(c.z, -198, 'city: clamp z to -198');
}

// ================= vehicle =================
{
  const car = createCar({ x: 10, z: 20, heading: 0.5, kind: 'sedan', color: '#c94a3a' });
  eq(car.hp, 100, 'car: hp 100');
  eq(car.speed, 0, 'car: starts stopped');
  eq(car.x, 10, 'car: x from options');
  eq(car.kind, 'sedan', 'car: kind from options');
  const def = createCar({});
  eq(def.kind, 'sedan', 'car: default kind sedan');
  t(CAR_COLORS.length >= 8, 'car: palette has colours');
  updateCar(car, { throttle: 1, steer: 0, handbrake: false }, 0.1, city);
  t(car.speed > 1 && car.speed < 2, `car: accelerates (${car.speed.toFixed(2)})`);
  t(car.z > 20, 'car: moves forward along heading');
  for (let i = 0; i < 50; i++) updateCar(car, { throttle: 1, steer: 0, handbrake: false }, 0.1, null);
  eq(car.speed, 38, 'car: top speed capped at 38');
  const sport = createCar({ kind: 'sports' });
  for (let i = 0; i < 60; i++) updateCar(sport, { throttle: 1, steer: 0, handbrake: false }, 0.1, null);
  eq(sport.speed, 46, 'car: sports top speed 46');
  const braker = createCar({});
  braker.speed = 20;
  updateCar(braker, { throttle: -1, steer: 0, handbrake: false }, 0.5, null);
  t(braker.speed < 20 && braker.speed > 0, `car: braking slows (${braker.speed.toFixed(1)})`);
  const reverser = createCar({});
  for (let i = 0; i < 20; i++) updateCar(reverser, { throttle: -1, steer: 0, handbrake: false }, 0.1, null);
  t(reverser.speed < 0 && reverser.speed >= -10, `car: reverses, capped at -10 (${reverser.speed.toFixed(1)})`);
  const steerer = createCar({ heading: 0 });
  steerer.speed = 10;
  updateCar(steerer, { throttle: 0, steer: 1, handbrake: false }, 0.5, null);
  t(steerer.heading > 0.05, `car: steering turns the car (${steerer.heading.toFixed(2)})`);
  const dmg = createCar({});
  damageCar(dmg, 70);
  eq(dmg.hp, 30, 'car: damage reduces hp');
  eq(dmg.smoke, true, 'car: smoke below 40 hp');
  damageCar(dmg, 40);
  eq(dmg.hp, 0, 'car: hp floors at 0');
  eq(dmg.stalled, true, 'car: stalls at 0 hp');
  eq(dmg.speed, 0, 'car: stalled car stops');
  const meshCar = createCar({ kind: 'police', x: 5, z: 5 });
  const mesh = createCarMesh(meshCar, THREE);
  t(mesh !== null && mesh !== undefined, 'car: mesh builds with stub THREE');
  t(mesh.children.length >= 8, `car: mesh has parts (${mesh.children.length})`);
  t(meshCar.mesh === mesh, 'car: mesh stored on car');
  const lightbar = mesh.children.find((c) => c.name === 'lightbar');
  t(!!lightbar, 'car: police mesh has a light bar');
}

// ================= player =================
function playerState(over = {}) {
  const S = {
    player: createPlayer({ x: 0, z: 20, heading: 0 }),
    input: { keys: {}, mouseDX: 0, mouseDY: 0, mouseDown: false },
    city,
    cars: [],
    parkedCars: [],
    camHeading: Math.PI,
    save: { stats: { carsStolen: 0 } },
    audio: {},
    combat: createCombat(),
    rng: mulberry32(7),
    time: 0,
    messages: [],
  };
  Object.assign(S, over);
  return S;
}
{
  const p = createPlayer({ x: 3, z: 4, heading: 1 });
  eq(p.hp, 100, 'player: hp 100');
  eq(p.money, 150, 'player: starts with $150');
  eq(p.onFoot, true, 'player: starts on foot');
  eq(p.x, 3, 'player: spawn x honoured');
  const pm = createPlayerMesh(p, THREE);
  t(pm && pm.children.length >= 5, 'player: mesh builds with body/head/arms');
  const S = playerState();
  updatePlayer._eHeld = false;
  S.input.keys.KeyW = true;
  updatePlayer(S, 1);
  approx(S.player.z, 15, 0.01, 'player: walks 5 m/s forward (camHeading PI = -z)');
  const S2 = playerState();
  updatePlayer._eHeld = false;
  S2.input.keys.KeyW = true;
  S2.input.keys.ShiftLeft = true;
  updatePlayer(S2, 1);
  approx(S2.player.z, 12, 0.01, 'player: runs 8 m/s with Shift');
  // Building collision: stand inside a building, try to walk out.
  const b0 = city.buildings[0];
  const S3 = playerState();
  updatePlayer._eHeld = false;
  S3.player.x = b0.x;
  S3.player.z = b0.z;
  S3.input.keys.KeyW = true;
  updatePlayer(S3, 0.5);
  eq(S3.player.x, b0.x, 'player: building blocks x movement');
  eq(S3.player.z, b0.z, 'player: building blocks z movement');
  // Enter + exit a car.
  const S4 = playerState();
  const parked = createCar({ x: 1, z: 20, heading: 0, kind: 'sedan' });
  S4.cars = [parked];
  updatePlayer._eHeld = false;
  S4.input.keys.KeyE = true;
  updatePlayer(S4, 0.016);
  eq(S4.player.onFoot, false, 'player: E enters a nearby car');
  eq(S4.player.car, parked, 'player: entered the parked car');
  eq(S4.save.stats.carsStolen, 1, 'player: entering counts as a steal');
  S4.input.keys.KeyE = false;
  updatePlayer(S4, 0.016);
  S4.input.keys.KeyW = true;
  const zBefore = S4.player.z;
  for (let i = 0; i < 10; i++) updatePlayer(S4, 0.1);
  t(S4.player.car.speed > 5, `player: driving accelerates (${S4.player.car.speed.toFixed(1)} m/s)`);
  t(Math.abs(S4.player.z - zBefore) > 2, 'player: driving moves the player');
  updatePlayer._eHeld = false;
  S4.input.keys.KeyW = false;
  S4.input.keys.KeyE = true;
  updatePlayer(S4, 0.016);
  eq(S4.player.onFoot, true, 'player: E exits the car');
  eq(S4.player.car, null, 'player: no car after exit');
}

// ================= traffic =================
{
  eq(lightState(0), 'green', 'traffic: lights green at t=0');
  eq(lightState(9), 'green', 'traffic: lights green at t=9');
  eq(lightState(10), 'red', 'traffic: lights red at t=10');
  eq(lightState(25), 'green', 'traffic: lights green again at t=25');
  const tr = createTraffic(city, mulberry32(7));
  eq(tr.cars.length, 10, 'traffic: 10 cars');
  eq(tr.peds.length, 24, 'traffic: 24 peds');
  t(tr.cars.every((c) => c.route && c.route.length === 4), 'traffic: every car has a 4-point loop');
  t(tr.cars.every((c) => c.cruise >= 7 && c.cruise <= 11), 'traffic: cruise speeds 7-11 m/s');
  createTrafficMeshes(tr, THREE);
  t(tr.cars.every((c) => !!c.mesh), 'traffic: car meshes built');
  t(tr.peds.every((p) => !!p.mesh), 'traffic: ped meshes built');
  const S = {
    trafficCars: tr.cars, peds: tr.peds, traffic: tr, city, time: 0,
    player: { x: 0, z: 0, car: null }, audio: {}, rng: mulberry32(7),
  };
  const x0 = tr.cars[0].x;
  const z0 = tr.cars[0].z;
  const px0 = tr.peds.map((p) => [p.x, p.z]);
  updateTraffic(S, 1);
  t(Math.hypot(tr.cars[0].x - x0, tr.cars[0].z - z0) > 0.5, 'traffic: cars move along their route');
  const pedMoved = tr.peds.reduce((sum, p, i) => sum + Math.hypot(p.x - px0[i][0], p.z - px0[i][1]), 0);
  t(pedMoved > 1, `traffic: peds wander (${pedMoved.toFixed(1)} m total)`);
  t(tr.cars.every((c) => c.speed <= c.cruise + 0.01), 'traffic: cars never exceed cruise speed');
}

// ================= police =================
function policeState(over = {}) {
  return {
    player: { x: 0, z: 0, heading: 0, speed: 0, car: null },
    police: createPolice(),
    scene: sceneStub,
    THREE,
    rng: mulberry32(7),
    time: 0,
    messages: [],
    hud: null,
    onBusted: null,
    effects: null,
    audio: null,
    save: { stats: {} },
    ...over,
  };
}
{
  const S = policeState();
  eq(S.police.stars, 0, 'police: starts at 0 stars');
  eq(S.police.cops.length, 0, 'police: starts with no cops');
  addHeat(S, 1);
  eq(S.police.stars, 1, 'police: +1 heat = 1 star');
  eq(S.police.heat, 1, 'police: heat tracks');
  addHeat(S, 10);
  eq(S.police.stars, 5, 'police: stars cap at 5');
  eq(S.police.heat, 11, 'police: heat keeps counting past the star cap');
  const S2 = policeState();
  S2.police.stars = 2;
  S2.police.heat = 2;
  updatePolice(S2, 0.1);
  eq(S2.police.cops.length, 2, 'police: 2 stars spawns 2 cops');
  t(S2.police.cops.every((c) => c.car.kind === 'police'), 'police: spawned cops are police cars');
  t(S2.police.cops.every((c) => !!c.mesh), 'police: spawned cops have meshes');
  t(S2.police.cops.every((c) => c.mesh.children.length >= 8), 'police: cop mesh has body/cabin/stripe/wheels/light bar');
  // Decay: 3 stars, cops far away, last seen long ago -> -1 star per 10 s.
  const S3 = policeState();
  S3.police.stars = 3;
  S3.police.heat = 3;
  S3.police.lastSeenT = -100;
  for (let i = 0; i < 3; i++) {
    const car = { x: 500, z: 500, heading: 0, speed: 0 };
    S3.police.cops.push({ car, mesh: null, x: 500, z: 500, heading: 0, speed: 0, hp: 100, disabled: false, blocker: false, bustT: 0, flashT: 0 });
  }
  for (let i = 0; i < 11; i++) { S3.time += 1; updatePolice(S3, 1); }
  eq(S3.police.stars, 2, 'police: stars decay after 15 s unseen + 10 s');
  eq(S3.police.heat, 2, 'police: heat decays with stars');
  // Busted: a cop already on top of the player for 2 s.
  let busted = false;
  const S4 = policeState({ onBusted: () => { busted = true; } });
  S4.police.stars = 1;
  const copCar = { x: 0, z: 0, heading: 0, speed: 0 };
  S4.police.cops.push({ car: copCar, mesh: null, x: 0, z: 0, heading: 0, speed: 0, hp: 100, disabled: false, blocker: false, bustT: 1.9, flashT: 0 });
  updatePolice(S4, 0.2);
  t(busted, 'police: cop within 3 m for 2 s busts the player');
}

// ================= missions =================
function missionState() {
  const parkedSpots = [
    { x: 25, z: -12 }, { x: -25, z: 12 }, { x: 75, z: -12 }, { x: -75, z: 12 },
    { x: 12, z: -75 }, { x: -12, z: 75 }, { x: -170, z: -10 }, { x: 125, z: 12 },
  ];
  const parkedCars = parkedSpots.map((s) => createCar({ x: s.x, z: s.z, heading: 0, kind: 'sedan' }));
  const S = {
    player: { x: 0, z: 20, heading: 0, hp: 100, money: 150, car: null, onFoot: true, speed: 0 },
    police: createPolice(),
    missions: null,
    save: { stats: { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 0 } },
    rng: mulberry32(7),
    time: 0,
    messages: [],
    audio: null,
    effects: null,
    parkedCars,
    cars: parkedCars,
    saveGame: null,
    objective: '',
  };
  S.missions = createMissions(city);
  return S;
}
{
  const S = missionState();
  const lm = S.missions.landmarks;
  eq(lm.cafe.x, -20, 'missions: cafe landmark is the real city cafe (-20)');
  eq(lm.cafe.z, -10, 'missions: cafe landmark z -10');
  eq(lm.docks.x, 160, 'missions: docks landmark is the real city docks (160)');
  eq(lm.docks.z, 50, 'missions: docks landmark z 50');
  eq(lm.garage.x, 0, 'missions: garage landmark is the real city garage (0)');
  eq(lm.garage.z, 170, 'missions: garage landmark z 170');
  eq(lm.safehouse.x, -60, 'missions: safehouse landmark is the real city safehouse (-60)');
  eq(lm.safehouse.z, 160, 'missions: safehouse landmark z 160');
  eq(lm.precinct.x, 100, 'missions: precinct landmark is the real city precinct (100)');
  eq(lm.precinct.z, -80, 'missions: precinct landmark z -80');
  eq(lm.hospital.x, 120, 'missions: hospital landmark is the real city hospital (120)');
  eq(lm.hospital.z, -120, 'missions: hospital landmark z -120, not the guessed +90');
  eq(lm.gunshop.x, 80, 'missions: gunshop landmark is the real city gunshop (80)');
  eq(lm.gunshop.z, 40, 'missions: gunshop landmark z 40, not the guessed -40');
  eq(lm.beachfront.x, -168, 'missions: beachfront landmark on the beach avenue (-168)');
  t(S.missions.pickups.length === 6, 'missions: 6 cash pickups placed');
  t(S.missions.pickups.every((p) => p.amount >= 25 && p.amount <= 55 && !p.taken), 'missions: pickups $25-55, untaken');
  eq(missionObjective(S), "Go to Rosa's café", 'missions: M0 objective is the café');
  // M0 -> M1: walk into the café.
  S.player.x = -20;
  S.player.z = -10;
  updateMissions(S, 0.1);
  eq(S.missions.index, 1, 'missions: reaching the café starts M1');
  eq(S.missions.step, 'pickup', 'missions: M1 step is pickup');
  eq(S.missions.marker.x, 160, 'missions: M1 marker is the docks');
  eq(missionObjective(S), 'Collect the package at the docks', 'missions: M1 pickup objective');
  // M1 pickup -> deliver: walk into the docks on foot.
  S.player.x = 160;
  S.player.z = 50;
  updateMissions(S, 0.1);
  eq(S.missions.step, 'deliver', 'missions: collecting the package starts the delivery');
  eq(S.missions.timer, 150, 'missions: delivery timer is 150 s');
  eq(S.missions.marker.x, -20, 'missions: delivery marker is back at the café');
  // M1 deliver -> M2: reach the café in time.
  S.player.x = -20;
  S.player.z = -10;
  updateMissions(S, 0.1);
  eq(S.player.money, 450, 'missions: M1 pays $300 (150 + 300)');
  eq(S.missions.index, 2, 'missions: M1 complete starts M2');
  eq(S.missions.step, 'steal', 'missions: M2 step is steal');
  t(!!S.missions.targetCar, 'missions: M2 marks a target car');
  t(Math.hypot(S.missions.targetCar.x + 168, S.missions.targetCar.z) < 15, 'missions: M2 target is the beachfront car');
  eq(missionObjective(S), 'Steal the yellow sports car at the beachfront', 'missions: M2 steal objective');
  // M2 steal -> deliver: get in the target car.
  S.player.car = S.missions.targetCar;
  S.player.onFoot = false;
  S.player.x = S.missions.targetCar.x;
  S.player.z = S.missions.targetCar.z;
  updateMissions(S, 0.1);
  eq(S.missions.step, 'deliver', 'missions: stealing the car starts the M2 delivery');
  eq(S.missions.marker.x, 0, 'missions: M2 delivery marker is the garage');
  eq(S.police.stars, 2, 'missions: stealing the target car raises 2 stars');
  // M2 deliver -> M3: bring it to the garage in the car.
  S.player.x = 0;
  S.player.z = 170;
  updateMissions(S, 0.1);
  eq(S.player.money, 950, 'missions: M2 pays $500 (450 + 500)');
  eq(S.missions.index, 3, 'missions: M2 complete starts M3');
  eq(S.missions.step, 'escape', 'missions: M3 step is escape');
  eq(S.police.stars, 3, 'missions: M3 starts with 3 stars');
  // M3 -> free roam: reach the safehouse.
  S.player.x = -60;
  S.player.z = 160;
  updateMissions(S, 0.1);
  eq(S.player.money, 1750, 'missions: M3 pays $800 (950 + 800)');
  eq(S.missions.index, 4, 'missions: M3 complete enters free roam');
  eq(S.police.stars, 0, 'missions: reaching the safehouse clears the heat');
  eq(S.missions.taxi.state, 'pickup', 'missions: free roam starts a taxi job');
  t(!!S.missions.taxi.customer, 'missions: taxi customer placed');
  // Taxi: pick up, then drop off.
  const fareBefore = S.player.money;
  S.player.x = S.missions.taxi.customer.x;
  S.player.z = S.missions.taxi.customer.z;
  updateMissions(S, 0.1);
  eq(S.missions.taxi.state, 'dropoff', 'missions: reaching the customer starts the drop-off');
  t(S.missions.taxi.fare >= 25, `missions: taxi fare set ($${S.missions.taxi.fare})`);
  const fare = S.missions.taxi.fare;
  S.player.x = S.missions.taxi.dest.x;
  S.player.z = S.missions.taxi.dest.z;
  updateMissions(S, 0.1);
  eq(S.player.money, fareBefore + fare, 'missions: taxi fare is paid on drop-off');
  eq(S.missions.taxi.state, 'pickup', 'missions: a new taxi job starts after drop-off');
  // Mission fail -> retry: M1 delivery timer runs out.
  const S2 = missionState();
  S2.missions.index = 1;
  S2.missions.step = 'deliver';
  S2.missions.timer = 0.01;
  S2.player.x = 100;
  S2.player.z = 100;
  updateMissions(S2, 0.1);
  eq(S2.missions.needsRetry, true, 'missions: expired timer flags a retry');
  updateMissions(S2, 0.1);
  eq(S2.missions.needsRetry, false, 'missions: retry restarts the mission');
  eq(S2.missions.index, 1, 'missions: retry restarts the same mission');
  // Cash pickup: walking over one banks it.
  const S3 = missionState();
  const pk = S3.missions.pickups[0];
  const before = S3.player.money;
  S3.player.x = pk.x;
  S3.player.z = pk.z;
  updateMissions(S3, 0.1);
  eq(pk.taken, true, 'missions: cash pickup is taken on contact');
  eq(S3.player.money, before + pk.amount, 'missions: cash pickup pays its amount');
}

// ================= combat =================
function combatState() {
  return {
    player: { x: 0, z: 0, heading: 0, hp: 100, money: 200, car: null, speed: 0 },
    combat: createCombat(),
    peds: [],
    police: createPolice(),
    missions: { landmarks: { gunshop: { x: 80, z: 40 }, cafe: { x: -20, z: -10 }, hospital: { x: 120, z: -120 } } },
    save: { stats: {} },
    time: 0,
    messages: [],
    audio: null,
    effects: null,
    rng: mulberry32(7),
  };
}
{
  const S = combatState();
  eq(S.combat.weapon, 'fists', 'combat: starts with fists');
  eq(S.combat.mag, 12, 'combat: pistol mag is 12');
  const ped = { x: 0, z: 1.5, heading: 0, hp: 100 };
  S.peds = [ped];
  punch(S);
  eq(ped.hp, 85, 'combat: punch deals 15 damage');
  eq(ped.fleeT, 3, 'combat: punched ped flees');
  eq(S.police.stars, 1, 'combat: punching a ped raises 1 star');
  eq(S.combat.cooldown, 0.4, 'combat: punch sets a 0.4 s cooldown');
  punch(S);
  eq(ped.hp, 85, 'combat: punch is blocked during cooldown');
  updateCombat(S, 0.5);
  eq(S.combat.cooldown, 0, 'combat: cooldown ticks down');
  switchWeapon(S, 'pistol');
  eq(S.combat.weapon, 'pistol', 'combat: switch to pistol');
  eq(S.combat.ammo, 12, 'combat: first arming grants a starter mag');
  const far = { x: 0, z: 10, heading: 0, hp: 100 };
  S.peds = [far];
  shoot(S);
  eq(S.combat.ammo, 11, 'combat: shooting spends one round');
  eq(far.hp, 75, 'combat: pistol deals 25 damage inside 30 m');
  updateCombat(S, 0.3);
  const distant = { x: 0, z: 40, heading: 0, hp: 100 };
  S.peds = [distant];
  shoot(S);
  eq(distant.hp, 88, 'combat: pistol damage falls off past 30 m (12 dmg)');
  // Reload: empty the mag, reload, wait it out.
  S.combat.ammo = 5;
  reload(S);
  eq(S.combat.reloading, true, 'combat: reload starts');
  updateCombat(S, 0.6);
  eq(S.combat.ammo, 5, 'combat: still reloading halfway');
  updateCombat(S, 0.7);
  eq(S.combat.ammo, 12, 'combat: reload refills the mag after 1.2 s');
  eq(S.combat.reloading, false, 'combat: reload finishes');
  // Shooting a cop 4 times disables it.
  const copCar = { x: 0, z: 10, heading: 0, speed: 0, hp: 100 };
  const cop = { car: copCar, x: 0, z: 10, heading: 0, speed: 0, hp: 100, disabled: false, mesh: null };
  S.police.cops = [cop];
  S.peds = [];
  for (let i = 0; i < 4; i++) { updateCombat(S, 0.3); shoot(S); }
  eq(cop.hp, 0, 'combat: 4 pistol hits drop a cop to 0 hp');
  eq(cop.disabled, true, 'combat: a cop at 0 hp is disabled');
  // Ammo shop: only at the gun shop, $50 for a full mag.
  const S2 = combatState();
  S2.combat.ammo = 0;
  eq(buyAmmo(S2), false, 'combat: cannot buy ammo away from the gun shop');
  S2.player.x = 80;
  S2.player.z = 40;
  eq(buyAmmo(S2), true, 'combat: ammo bought at the gun shop');
  eq(S2.player.money, 150, 'combat: ammo costs $50 (200 - 50)');
  eq(S2.combat.ammo, 12, 'combat: bought ammo fills the mag');
  // Healing at the hospital and the café.
  const S3 = combatState();
  S3.player.hp = 40;
  eq(healPlayer(S3), false, 'combat: no healing away from café/hospital');
  S3.player.x = 120;
  S3.player.z = -120;
  eq(healPlayer(S3), true, 'combat: healing works at the hospital');
  eq(S3.player.hp, 90, 'combat: healing restores 50 hp');
  S3.player.x = -20;
  S3.player.z = -10;
  eq(healPlayer(S3), true, 'combat: healing works at the café');
  eq(S3.player.hp, 100, 'combat: healing caps at 100 hp');
}

// ================= save =================
{
  const S = {
    player: { money: 500 },
    missions: { index: 2 },
    save: { stats: { missionsDone: 1, carsStolen: 3, busted: 0, bestCash: 400 } },
    audio: { muted: true },
  };
  eq(saveGame(S), true, 'save: saveGame writes');
  const loaded = loadSave();
  eq(loaded.money, 500, 'save: money round-trips');
  eq(loaded.missionIndex, 2, 'save: mission index round-trips');
  eq(loaded.stats.carsStolen, 3, 'save: stats round-trip');
  eq(loaded.stats.bestCash, 500, 'save: bestCash tracks the max');
  eq(loaded.muted, true, 'save: mute round-trips');
  // Corrupt primary, valid backup -> fallback.
  globalThis.localStorage.setItem(SAVE_KEY, '###not json###');
  globalThis.localStorage.setItem(`${SAVE_KEY}.bak`, JSON.stringify({ money: 77, missionIndex: 1, stats: {}, muted: false }));
  const fb = loadSave();
  eq(fb && fb.money, 77, 'save: corrupt primary falls back to .bak');
  globalThis.localStorage.setItem(`${SAVE_KEY}.bak`, '###also corrupt###');
  eq(loadSave(), null, 'save: corrupt primary and backup load as nothing');
  globalThis.localStorage = fakeStorage();
  eq(loadSave(), null, 'save: no save loads as nothing');
  const noStore = globalThis.localStorage;
  delete globalThis.localStorage;
  eq(saveGame(S), false, 'save: saveGame fails cleanly with no storage');
  globalThis.localStorage = noStore;
}

// ================= effects =================
{
  const S = { effects: createEffects(sceneStub), scene: sceneStub, rng: mulberry32(7) };
  eq(S.effects.list.length, 0, 'effects: starts empty');
  spawnSmoke(S, { x: 0, y: 1, z: 0 });
  eq(S.effects.list.length, 10, 'effects: smoke spawns 10 particles');
  spawnSparks(S, { x: 0, y: 1, z: 0 });
  eq(S.effects.list.length, 22, 'effects: sparks add 12 particles');
  muzzleFlash(S, { x: 0, y: 1.3, z: 0 }, { x: 0, y: 0, z: 1 });
  eq(S.effects.list.length, 27, 'effects: muzzle flash adds 5 particles');
  tireSmoke(S, { x: 5, z: 5 });
  eq(S.effects.list.length, 28, 'effects: tire smoke adds 1 particle');
  updateEffects(S, 2);
  eq(S.effects.list.length, 0, 'effects: all particles expire after their life');
}

// ================= shots =================
{
  globalThis.window = { location: { search: '?shot=3&seed=7' }, __GTA: undefined, __shotReady: false };
  eq(JSON.stringify(getShotParams()), JSON.stringify({ shot: 3, seed: 7 }), 'shots: ?shot=3&seed=7 parses');
  globalThis.window.location.search = '?shot=9&seed=1';
  eq(getShotParams().shot, 0, 'shots: out-of-range shot is ignored');
  globalThis.window.location.search = '';
  eq(JSON.stringify(getShotParams()), JSON.stringify({ shot: 0, seed: 7 }), 'shots: no params default to shot 0, seed 7');
  const S = {
    player: { x: 0, z: 20, heading: 0, hp: 100, money: 150, car: null, speed: 0 },
    parkedCars: [createCar({ x: 25, z: -12, heading: 0 }), createCar({ x: -25, z: 12, heading: 0 })],
    cars: [],
    trafficCars: [],
    peds: [],
    police: createPolice(),
    missions: createMissions(city),
    messages: [],
    time: 0,
    camHeading: 0,
    objective: '',
    shot: 0,
    shotFrames: 0,
    shotReady: false,
    mode: 'title',
  };
  S.cars = S.parkedCars;
  stageShot(S, 3);
  eq(S.mode, 'shot', 'shots: staging sets shot mode');
  eq(S.player.x, 0, 'shots: on-foot shot stages the player in the plaza');
  eq(S.player.z, 12, 'shots: on-foot shot stages the player at z 12');
  eq(S.player.car, null, 'shots: on-foot shot has no car');
  eq(S.missions.marker.x, -20, 'shots: on-foot shot marker is the café');
  markShotFrame(S);
  eq(S.shotReady, false, 'shots: not ready after one frame');
  markShotFrame(S);
  eq(S.shotReady, true, 'shots: ready after two frames');
  eq(globalThis.window.__shotReady, true, 'shots: window.__shotReady set');
  exposeGTA(S);
  eq(globalThis.window.__GTA.screen, 'play', 'shots: __GTA screen is play for the on-foot shot');
  eq(globalThis.window.__GTA.money, 150, 'shots: __GTA money');
  eq(globalThis.window.__GTA.mission, 0, 'shots: __GTA mission index');
  eq(globalThis.window.__GTA.z, 12, 'shots: __GTA carries the player position');
  eq(globalThis.window.__GTA.inCar, false, 'shots: __GTA inCar false on foot');
  stageShot(S, 2);
  exposeGTA(S);
  eq(globalThis.window.__GTA.screen, 'title', 'shots: __GTA screen is title for shot 2');
  stageShot(S, 4);
  eq(S.missions.marker.x, 160, 'shots: mission shot marker is the docks');
  eq(S.missions.index, 1, 'shots: mission shot stages M1');
}

// ================= camera =================
{
  const { scene, camera } = createScene();
  t(!!scene && !!camera, 'camera: createScene returns scene + camera');
  const S = { mode: 'title', time: 0, player: { x: 0, z: 0, heading: 0, car: null }, camHeading: 0 };
  const px = camera.position.x;
  updateCamera(camera, S, 0.016);
  t(camera.position.x !== px, 'camera: title orbit moves the camera');
  // Shot 4 (docks, on foot): the camera snaps to the staged over-shoulder spot.
  S.mode = 'shot';
  S.shot = 4;
  S.player = { x: 150, z: 10, heading: Math.PI / 2, car: null };
  S.camHeading = Math.PI / 2;
  updateCamera(camera, S, 0.016);
  approx(camera.position.x, 145.5, 0.01, 'camera: shot 4 snaps behind the player (x)');
  approx(camera.position.y, 3.1, 0.01, 'camera: shot 4 snaps to over-shoulder height');
  approx(camera.position.z, 10, 0.01, 'camera: shot 4 snaps behind the player (z, heading PI/2 faces +x)');
  // Shot 2 (title): orbit, snapped.
  S.shot = 2;
  S.time = 0;
  updateCamera(camera, S, 0.016);
  approx(camera.position.x, 55, 0.01, 'camera: title shot snaps to the orbit position');
  approx(camera.position.y, 26, 0.01, 'camera: title shot snaps to orbit height');
}

// ================= summary =================
if (failures.length === 0) {
  console.log(`selftest: ${n}/${n} asserts passed`);
} else {
  console.log(`selftest: ${n - failures.length}/${n} asserts passed`);
  for (const f of failures) console.log(`  FAIL: ${f}`);
  process.exit(1);
}
