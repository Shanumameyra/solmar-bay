// Solmar Bay — headless self-test (Node 22, no browser).
// Run: node --import ./tests/register-three.mjs tests/selftest.mjs
// (the --import maps the bare 'three' specifier to the vendored build).
// Tests: RNG determinism, A* paths, mission data, world stepping (walk,
// enter a car), police (heat/spawn/bust/cooldown), missions (M1 flow,
// timer fail, replay), combat (punch/shoot/medkit/gun shop/death), save
// round-trip, audio/effects/hud/minimap headless, staged shots +
// determinism, dossier caps, and (when screenshots exist) the main.ts build.
// Exits non-zero on any failure; prints PASS/SKIP per check.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG, LANDMARKS } from '../game/src/config.js';
import { createRandom } from '../game/src/random.js';
import { createWorld } from '../game/src/world.js';
import { createInput } from '../game/src/input.js';
import { createPolice } from '../game/src/police.js';
import { createMissions } from '../game/src/missions.js';
import { createCombat } from '../game/src/combat.js';
import { createEffects } from '../game/src/effects.js';
import { createAudio } from '../game/src/audio.js';
import { createHud } from '../game/src/hud.js';
import { createMinimap } from '../game/src/minimap.js';
import { stageShot, mulberry32, SHOT_NAMES } from '../game/src/shots.js';
import { loadSave, saveGame, applySave, hasSave, clearSave, captureSave } from '../game/src/save.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function skip(name, reason) {
  skipped++;
  console.log(`SKIP ${name} (${reason})`);
}

function makeSystems() {
  return { police: createPolice(), missions: createMissions(), combat: createCombat() };
}

function stepN(world, input, systems, n) {
  for (let i = 0; i < n; i++) {
    world.step(1 / 60, input, systems);
    input.endFrame();
  }
}

function fakeStorage() {
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: (k) => { mem.delete(k); },
  };
}

function fakeDocument() {
  const nodes = new Map();
  function makeNode(id) {
    const node = {
      id,
      textContent: '',
      innerHTML: '',
      style: {},
      children: [],
      classList: {
        _set: new Set(),
        toggle: (c, force) => {
          if (force === undefined) {
            if (node.classList._set.has(c)) node.classList._set.delete(c);
            else node.classList._set.add(c);
          } else if (force) node.classList._set.add(c);
          else node.classList._set.delete(c);
        },
        add: (c) => node.classList._set.add(c),
        remove: (c) => node.classList._set.delete(c),
        contains: (c) => node.classList._set.has(c),
      },
      appendChild: (child) => { node.children.push(child); child.parentNode = node; return child; },
      removeChild: (child) => {
        const i = node.children.indexOf(child);
        if (i >= 0) node.children.splice(i, 1);
        child.parentNode = null;
        return child;
      },
      parentNode: null,
    };
    Object.defineProperty(node, 'firstChild', { get: () => node.children[0] || null });
    return node;
  }
  return {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, makeNode(id));
      return nodes.get(id);
    },
    createElement: () => makeNode('el-' + Math.random()),
    _nodes: nodes,
  };
}

function fakeCanvas2d() {
  const ctx = new Proxy({}, {
    get: (t, prop) => {
      if (prop in t) return t[prop];
      return () => {};
    },
    set: (t, prop, v) => { t[prop] = v; return true; },
  });
  return { width: 160, height: 160, getContext: () => ctx };
}

// ---------------------------------------------------------------------------
console.log('== RNG determinism ==');
{
  const a = createRandom(7);
  const b = createRandom(7);
  let same = true;
  for (let i = 0; i < 100; i++) if (a.next() !== b.next()) same = false;
  check('createRandom(7) repeats', same);
  const c = createRandom(8);
  check('createRandom(8) differs', c.next() !== createRandom(7).next());
  const m1 = mulberry32(7);
  const m2 = mulberry32(7);
  let msame = true;
  for (let i = 0; i < 50; i++) if (m1() !== m2()) msame = false;
  check('mulberry32(7) repeats', msame);
}

// ---------------------------------------------------------------------------
console.log('== A* paths ==');
{
  const world = createWorld(7);
  const nav = world.city.navGrid;
  const p1 = nav.findPath(0, 24, 144, 48);
  check('A* market->docks finds a path', Array.isArray(p1) && p1.length > 3, p1 ? p1.length + ' pts' : 'null');
  if (p1) {
    const last = p1[p1.length - 1];
    check('A* path ends at the target', Math.abs(last[0] - 144) < 2 && Math.abs(last[1] - 48) < 2, JSON.stringify(last));
  }
  const p2 = nav.findPath(8, 30, 0, -36);
  check('A* spawn->café finds a path', Array.isArray(p2) && p2.length > 1);
  const p3 = nav.findPath(0, 0, 144, 48);
  check('A* from a blocked cell (fountain) returns null', p3 === null);
}

// ---------------------------------------------------------------------------
console.log('== Mission data ==');
{
  check('M1 reward 300 / 150 s', CONFIG.MISSIONS[1].reward === 300 && CONFIG.MISSIONS[1].time === 150);
  check('M2 reward 500', CONFIG.MISSIONS[2].reward === 500);
  check('M3 reward 800 / 150 s', CONFIG.MISSIONS[3].reward === 800 && CONFIG.MISSIONS[3].time === 150);
  check('Taxi fare 45, cash pickup 25', CONFIG.TAXI_FARE === 45 && CONFIG.CASH_PICKUP === 25);
  check('Landmarks present', !!(LANDMARKS.cafe && LANDMARKS.docks && LANDMARKS.garage && LANDMARKS.safehouse && LANDMARKS.hospital && LANDMARKS.precinct && LANDMARKS.gunshop && LANDMARKS.beachCar));
}

// ---------------------------------------------------------------------------
console.log('== World stepping: walk + enter a car ==');
{
  const world = createWorld(7);
  const systems = makeSystems();
  const input = createInput(null);
  const startX = world.state.player.x;
  const startZ = world.state.player.z;
  input.keys.add('KeyW');
  stepN(world, input, systems, 120);
  const moved = Math.hypot(world.state.player.x - startX, world.state.player.z - startZ);
  check('WASD walks the player (2 s)', moved > 8, moved.toFixed(1) + ' m');
  check('Walk speed approaches 5 m/s', world.state.player.speed > 4, world.state.player.speed.toFixed(2));
  // Enter a parked car: teleport next to one, press E.
  const car = world.nearestCar(world.state.player.x, world.state.player.z, 200, { parkedOnly: true });
  check('A parked car exists', !!car);
  if (car) {
    world.teleport(car.x + 2, car.z, Math.PI, null);
    input.justPressed.add('KeyE');
    world.step(1 / 60, input, systems);
    input.endFrame();
    check('E enters the car', world.state.player.inCar === true && world.state.player.carId === car.id,
      `inCar=${world.state.player.inCar} carId=${world.state.player.carId}`);
  }
}

// Driving on a clear street (fresh world): the nearest parked car may face
// a building (city.js placement), so drive a sedan down the beachfront
// street (x=-144, south) instead — that is the cover-shot staging too.
{
  const world = createWorld(7);
  const systems = makeSystems();
  const input = createInput(null);
  world.state.systems = systems;
  const sedan = world.state.cars.find((c) => c.kind === 'sedan' && !c.isPolice);
  check('A sedan exists for the driving test', !!sedan);
  if (sedan) {
    world.teleport(-144, -60, 0, sedan);
    check('Teleport puts the player in the sedan', world.state.player.inCar === true);
    input.keys.add('KeyW');
    const bx = sedan.x, bz = sedan.z;
    stepN(world, input, systems, 180);
    const driven = Math.hypot(sedan.x - bx, sedan.z - bz);
    check('Driving moves the car (3 s)', driven > 20, driven.toFixed(1) + ' m, speed ' + Math.abs(sedan.speed).toFixed(1));
    check('distanceDriven accumulates', world.state.stats.distanceDriven > 20, world.state.stats.distanceDriven.toFixed(1));
    check('No NaN in car or player position', Number.isFinite(sedan.x) && Number.isFinite(sedan.z)
      && Number.isFinite(world.state.player.x) && Number.isFinite(world.state.player.z));
  }
}

// ---------------------------------------------------------------------------
console.log('== Police: heat, spawn, bust, cooldown ==');
{
  const world = createWorld(7);
  const systems = makeSystems();
  const input = createInput(null);
  world.state.systems = systems;
  systems.police.addHeat(3, 'test', world.state);
  check('addHeat(3) -> wanted 3', world.state.wanted === 3, 'wanted=' + world.state.wanted);
  stepN(world, input, systems, 180);
  const policeCars = world.state.cars.filter((c) => c.isPolice);
  check('Police cars spawn at 3 stars', policeCars.length >= 2, policeCars.length + ' cars');
  check('state.policeNear is set', world.state.policeNear === true || world.state.policeNear === false);
  // Bust: put a cop next to the player on foot, wait.
  const p = world.state.player;
  if (p.car) world.teleport(p.x, p.z, Math.PI, null);
  systems.police.spawnCop(world.state, p);
  const cop = world.state.peds.find((x) => x.isCop);
  if (cop) {
    cop.x = p.x + 1;
    cop.z = p.z;
    const moneyBefore = world.state.money;
    stepN(world, input, systems, 180);
    check('Bust triggers on foot (cop 1 m, 3 s)', world.state.screen === 'busted', 'screen=' + world.state.screen);
    check('Bust fines $200', world.state.money === Math.max(0, moneyBefore - 200), `money ${moneyBefore} -> ${world.state.money}`);
    check('Bust clears wanted', world.state.wanted === 0);
    check('Bust respawns at the precinct', Math.hypot(p.x - LANDMARKS.precinct.x, p.z - LANDMARKS.precinct.z) < 2,
      `(${p.x.toFixed(0)},${p.z.toFixed(0)}) vs precinct (${LANDMARKS.precinct.x},${LANDMARKS.precinct.z})`);
  } else {
    check('Bust triggers on foot (cop spawned)', false, 'no cop spawned');
  }
  // Cooldown: wanted 2, no police near, 15 s + 10 s per star. Suppress
  // spawning (spawnT) and backdate lastSeenAt so the decay can run.
  const world2 = createWorld(7);
  const sys2 = makeSystems();
  const input2 = createInput(null);
  world2.state.systems = sys2;
  sys2.police.addHeat(2, 'test', world2.state);
  sys2.police.spawnT = 1e9; // no new units during the test
  sys2.police.lastSeenAt = world2.state.time - 20; // unseen for 20 s
  stepN(world2, input2, sys2, 60 * 12);
  check('Cooldown drops wanted after ~30 s unseen', world2.state.wanted < 2, 'wanted=' + world2.state.wanted);
}

// ---------------------------------------------------------------------------
console.log('== Missions: M1 flow, timer fail ==');
{
  const world = createWorld(7);
  const systems = makeSystems();
  const input = createInput(null);
  world.state.systems = systems;
  const m = systems.missions;
  // Walk into the café to start M1.
  world.teleport(LANDMARKS.cafe.x, LANDMARKS.cafe.z, Math.PI, null);
  stepN(world, input, systems, 5);
  check('Café starts M1', m.index === 1 && m.phase === 'active', `index=${m.index} phase=${m.phase}`);
  check('M1 objective is the docks step', (world.state.mission.objective || '').length > 0, world.state.mission.objective);
  check('M1 marker is the docks', !!world.state.mission.marker && Math.hypot(world.state.mission.marker.x - LANDMARKS.docks.x, world.state.mission.marker.z - LANDMARKS.docks.z) < 2);
  // Go to the docks -> advance to step 1 (deliver to café).
  world.teleport(LANDMARKS.docks.x, LANDMARKS.docks.z, 0, null);
  stepN(world, input, systems, 5);
  check('Docks advances M1 to step 1', m.stepIndex === 1, 'stepIndex=' + m.stepIndex);
  // Deliver to the café -> complete, +$300. Step one at a time and stop
  // the moment it completes: the very next step at the café would
  // auto-start M2 (idle branch, within 8 m of the café).
  const moneyBefore = world.state.money;
  world.teleport(LANDMARKS.cafe.x, LANDMARKS.cafe.z, Math.PI, null);
  for (let i = 0; i < 10 && world.state.stats.missionsDone === 0; i++) {
    world.step(1 / 60, input, systems);
    input.endFrame();
  }
  check('M1 completes at the café', world.state.stats.missionsDone === 1, 'done=' + world.state.stats.missionsDone);
  check('M1 pays $300', world.state.money === moneyBefore + 300, `money ${moneyBefore} -> ${world.state.money}`);
  // Move away from the café (to the plaza) BEFORE the next step, so the
  // pending mission does not auto-start; then confirm it is pending.
  world.teleport(LANDMARKS.plaza.x, LANDMARKS.plaza.z, 0, null);
  stepN(world, input, systems, 2);
  check('Next mission pending (index 2, idle)', m.index === 2 && m.phase === 'idle', `index=${m.index} phase=${m.phase}`);
  // Timer fail: start M1 again, shrink the timer. The player is at the
  // plaza, so the fail sticks (no café auto-restart).
  m.start(1, world.state);
  m.timer = 0.5;
  stepN(world, input, systems, 60);
  check('Timer expiry fails the mission', m.phase === 'idle' && m.index === 1, `phase=${m.phase} index=${m.index}`);
}

// ---------------------------------------------------------------------------
console.log('== Combat: punch, shoot, medkit, gun shop, death ==');
{
  const world = createWorld(7);
  const systems = makeSystems();
  const input = createInput(null);
  world.state.systems = systems;
  const combat = systems.combat;
  const p = world.state.player;
  // Punch: put a ped in front of the player, press F.
  const ped = world.state.peds[0];
  ped.x = p.x + Math.sin(p.yaw) * 1.5;
  ped.z = p.z + Math.cos(p.yaw) * 1.5;
  ped.hp = 100;
  const hpBefore = ped.hp;
  input.justPressed.add('KeyF');
  world.step(1 / 60, input, systems);
  input.endFrame();
  check('Punch damages the ped in front', ped.hp < hpBefore, `hp ${hpBefore} -> ${ped.hp}`);
  // Shoot: give the pistol + ammo, put a cop in front, click.
  combat.weapon = 'pistol';
  combat.ammo = 12;
  combat.reserveAmmo = 12;
  const cop = world.state.peds.find((x) => !x.isCop) || world.state.peds[0];
  cop.isCop = true;
  cop.hp = 100;
  cop.x = p.x + Math.sin(p.yaw) * 10;
  cop.z = p.z + Math.cos(p.yaw) * 10;
  const copHpBefore = cop.hp;
  input.justPressed.add('Mouse0');
  world.step(1 / 60, input, systems);
  input.endFrame();
  check('Pistol shot damages the cop', cop.hp < copHpBefore, `hp ${copHpBefore} -> ${cop.hp}`);
  check('Shot spends one round', combat.ammo === 11, 'ammo=' + combat.ammo);
  // Medkit: low HP at the hospital.
  p.hp = 40;
  world.state.health = 40;
  world.teleport(LANDMARKS.hospital.x, LANDMARKS.hospital.z, 0, null);
  stepN(world, input, systems, 5);
  check('Medkit heals at the hospital', p.hp > 40, 'hp=' + p.hp);
  // Gun shop: no reserve ammo, enough money, at the shop.
  combat.reserveAmmo = 0;
  world.state.money = 150;
  world.teleport(LANDMARKS.gunshop.x, LANDMARKS.gunshop.z, 0, null);
  stepN(world, input, systems, 5);
  check('Gun shop sells 12 rounds for $50', combat.reserveAmmo === 12 && world.state.money === 100,
    `reserve=${combat.reserveAmmo} money=${world.state.money}`);
  // Death: 1 HP, take 10 damage -> wasted, respawn at the hospital.
  p.hp = 1;
  world.state.health = 1;
  world.damagePlayer(10);
  stepN(world, input, systems, 5);
  check('Death sets screen wasted', world.state.screen === 'wasted', 'screen=' + world.state.screen);
  check('Death respawns at the hospital with full HP', p.hp === 100 && Math.hypot(p.x - LANDMARKS.hospital.x, p.z - LANDMARKS.hospital.z) < 2,
    `hp=${p.hp} at (${p.x.toFixed(0)},${p.z.toFixed(0)})`);
  check('Death fines $100', world.state.money === 0, 'money=' + world.state.money);
}

// ---------------------------------------------------------------------------
console.log('== Save round-trip ==');
{
  const store = fakeStorage();
  const world = createWorld(7);
  world.state.money = 777;
  world.state.stats.missionsDone = 2;
  const res = saveGame(world.state, store);
  check('saveGame writes', res.ok === true);
  check('hasSave is true', hasSave(store) === true);
  const loaded = loadSave(store);
  check('loadSave reads', loaded.ok === true && loaded.data.money === 777 && loaded.data.missionIndex === 0);
  const world2 = createWorld(7);
  applySave(world2.state, loaded.data);
  check('applySave restores money + missionsDone', world2.state.money === 777 && world2.state.stats.missionsDone === 2);
  const bad = loadSave(fakeStorage());
  check('Empty storage loads as empty', bad.ok === false && bad.empty === true);
  clearSave(store);
  check('clearSave removes the save', hasSave(store) === false);
  // Corrupt JSON falls back to .bak.
  const store2 = fakeStorage();
  saveGame(world.state, store2);
  store2.setItem('solmar-bay-save-v1', '{not json');
  const loaded2 = loadSave(store2);
  check('Corrupt save falls back (no crash)', loaded2.ok === false || loaded2.data.money === 777);
}

// ---------------------------------------------------------------------------
console.log('== Audio / effects / HUD / minimap (headless) ==');
{
  const audio = createAudio();
  let audioOk = true;
  try {
    audio.sfx('gunshot');
    audio.update(0.016, { player: { car: null, speed: 0 }, policeNear: false }, true, { keys: new Set() });
    audio.setMuted(true);
    audio.setMuted(false);
    audio.stopAll();
  } catch (e) { audioOk = false; console.log('  audio error:', e.message); }
  check('Audio is a safe no-op without AudioContext', audioOk);

  const effects = createEffects(null, null);
  let fxOk = true;
  try {
    effects.burst('sparks', 0, 1, 0);
    effects.burst('pickup', 1, 1, 1);
    effects.addTrauma(0.5);
    effects.feedback('hit', 0, 1, 0);
    effects.update(0.5);
    const off = effects.applyCamera({ position: { x: 0, y: 0, z: 0 }, rotation: { z: 0 } }, 0.016);
    if (typeof off.x !== 'number') fxOk = false;
  } catch (e) { fxOk = false; console.log('  effects error:', e.message); }
  check('Effects burst/update/trauma/applyCamera run headless', fxOk && effects.trauma < 0.5, 'trauma=' + effects.trauma.toFixed(2));

  const doc = fakeDocument();
  const hud = createHud(doc);
  const world = createWorld(7);
  world.state.money = 1234;
  world.state.wanted = 2;
  world.state.player.hp = 55;
  world.state.mission.objective = 'Test objective';
  world.state.mission.marker = { x: 10, z: 10 };
  world.state.mission.timer = 90;
  world.state.events.push({ type: 'cash', text: 'Cash pickup +$25', t: 0 });
  let hudOk = true;
  try {
    hud.update(world.state, 'play', 0.016);
    hud.showMessage('hello', 'good');
  } catch (e) { hudOk = false; console.log('  hud error:', e.message); }
  check('HUD updates headless', hudOk);
  check('HUD writes cash', doc._nodes.get('cash').textContent === '$1,234', doc._nodes.get('cash').textContent);
  check('HUD writes stars', doc._nodes.get('stars').textContent === '★★☆☆☆', doc._nodes.get('stars').textContent);
  check('HUD writes health', doc._nodes.get('health-num').textContent === '55', doc._nodes.get('health-num').textContent);

  const minimap = createMinimap(fakeCanvas2d());
  let mmOk = true;
  try {
    minimap.draw(world.state);
  } catch (e) { mmOk = false; console.log('  minimap error:', e.message); }
  check('Minimap draws headless', mmOk);
}

// ---------------------------------------------------------------------------
console.log('== Staged shots + determinism ==');
{
  for (const name of SHOT_NAMES) {
    const world = createWorld(7);
    const systems = makeSystems();
    world.state.systems = systems;
    const info = stageShot(name, world, systems);
    check(`stageShot(${name}) ok`, info.ok === true && info.screen === 'play', JSON.stringify(info));
  }
  // Determinism: same seed -> same staged state.
  function stageOnce(name) {
    const world = createWorld(7);
    const systems = makeSystems();
    world.state.systems = systems;
    const info = stageShot(name, world, systems);
    return { wanted: info.wanted, money: info.money, police: info.policeCars, peds: info.peds, inCar: info.inCar };
  }
  const a = stageOnce('hero');
  const b = stageOnce('hero');
  check('stageShot(hero) is deterministic', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));
}

// ---------------------------------------------------------------------------
console.log('== Finisher polish (18 Nov) ==');
{
  // Parked cars sit on a street centreline and face along it, so stealing
  // one and driving straight never stalls against a wall.
  const world = createWorld(7);
  const parked = world.state.cars.filter((c) => c.isParked);
  check('8 parked cars', parked.length === 8, parked.length + ' parked');
  let parkedOk = true;
  for (const car of parked) {
    const onNs = CONFIG.CITY.STREETS.includes(car.x);
    const onEw = CONFIG.CITY.STREETS.includes(car.z);
    const alongNs = Math.abs(Math.sin(car.angle)) < 0.01; // faces north/south
    const alongEw = Math.abs(Math.cos(car.angle)) < 0.01; // faces east/west
    // On a north-south street (x is a street line) the car must face
    // north/south; on an east-west street (z is a street line) east/west.
    // The beach car (x=-176) sits on open sand, facing south along it.
    const ok = car.x === -176
      ? (Math.abs(car.angle) < 0.01)
      : (onNs && alongNs) || (onEw && alongEw);
    if (!ok) { parkedOk = false; console.log(`  parked ${car.kind} at (${car.x},${car.z}) angle ${car.angle.toFixed(2)} is off-street / crosswise`); }
  }
  check('Parked cars face along their street', parkedOk);
  // Driving straight out of every parked spot for 3 s covers ground
  // (no wall within ~9 m ahead).
  let driveOk = true;
  for (const spot of world.city.spawnPoints.parked) {
    const w2 = createWorld(7);
    const sys2 = makeSystems();
    const inp2 = createInput(null);
    w2.state.systems = sys2;
    const car = w2.state.cars.find((c) => c.isParked && c.x === spot.x && c.z === spot.z);
    if (!car) { driveOk = false; console.log(`  no parked car at (${spot.x},${spot.z})`); continue; }
    w2.teleport(car.x, car.z, car.angle, car);
    inp2.keys.add('KeyW');
    const bx = car.x, bz = car.z;
    stepN(w2, inp2, sys2, 180);
    const d = Math.hypot(car.x - bx, car.z - bz);
    if (d < 20) { driveOk = false; console.log(`  parked ${car.kind} at (${spot.x},${spot.z}) only drove ${d.toFixed(1)} m in 3 s`); }
  }
  check('Every parked car drives clear for 3 s', driveOk);

  // Bright golden hour palette.
  check('Sun is bright (intensity >= 3)', CONFIG.PALETTE.SUN_INTENSITY >= 3, String(CONFIG.PALETTE.SUN_INTENSITY));
  check('Hemisphere light is bright (>= 1)', CONFIG.PALETTE.HEMI_INTENSITY >= 1, String(CONFIG.PALETTE.HEMI_INTENSITY));
  check('Fog is far (near >= 200)', CONFIG.RENDER.FOG_NEAR >= 200, String(CONFIG.RENDER.FOG_NEAR));

  // Bust while driving: on foot at the precinct, and stepping the world
  // must NOT snap the player back into the car.
  {
    const w3 = createWorld(7);
    const sys3 = makeSystems();
    const inp3 = createInput(null);
    w3.state.systems = sys3;
    const sedan = w3.state.cars.find((c) => c.kind === 'sedan');
    w3.teleport(-144, -60, 0, sedan);
    sys3.police.addHeat(2, 'test', w3.state);
    sys3.police.bust(w3.state);
    const p3 = w3.state.player;
    check('Bust in a car puts the player on foot', p3.onFoot === true && p3.car === null && p3.inCar === false,
      `onFoot=${p3.onFoot} car=${p3.car ? 'set' : 'null'} inCar=${p3.inCar}`);
    stepN(w3, inp3, sys3, 60);
    check('Bust in a car stays at the precinct after stepping',
      Math.hypot(p3.x - LANDMARKS.precinct.x, p3.z - LANDMARKS.precinct.z) < 2,
      `(${p3.x.toFixed(0)},${p3.z.toFixed(0)}) vs precinct (${LANDMARKS.precinct.x},${LANDMARKS.precinct.z})`);
  }

  // Death while driving: on foot at the hospital, no snap-back.
  {
    const w4 = createWorld(7);
    const sys4 = makeSystems();
    const inp4 = createInput(null);
    w4.state.systems = sys4;
    const sedan = w4.state.cars.find((c) => c.kind === 'sedan');
    w4.teleport(-144, -60, 0, sedan);
    w4.state.player.hp = 1;
    w4.damagePlayer(10);
    stepN(w4, inp4, sys4, 5);
    const p4 = w4.state.player;
    check('Death in a car respawns on foot at the hospital',
      p4.onFoot === true && p4.car === null && p4.hp === 100
      && Math.hypot(p4.x - LANDMARKS.hospital.x, p4.z - LANDMARKS.hospital.z) < 2,
      `onFoot=${p4.onFoot} hp=${p4.hp} at (${p4.x.toFixed(0)},${p4.z.toFixed(0)})`);
  }

  // Cash pickups never spawn inside a building collider.
  {
    const w5 = createWorld(7);
    const sys5 = makeSystems();
    let pickupsOk = true;
    for (let i = 0; i < 50; i += 1) {
      const pk = sys5.missions.newPickup(w5.state);
      if (w5.city && w5.city.colliders) {
        const inside = w5.city.colliders.some((c) => pk.x > c.minX && pk.x < c.maxX && pk.z > c.minZ && pk.z < c.maxZ);
        if (inside) { pickupsOk = false; console.log(`  pickup at (${pk.x.toFixed(0)},${pk.z.toFixed(0)}) inside a building`); break; }
      }
    }
    check('Cash pickups spawn outside buildings (50 samples)', pickupsOk);
  }

  // Save: a newer primary must not block the .bak fallback.
  {
    const store = fakeStorage();
    const w6 = createWorld(7);
    w6.state.money = 555;
    saveGame(w6.state, store);
    w6.state.money = 777;
    saveGame(w6.state, store); // the 555 save is now the .bak
    store.setItem('solmar-bay-save-v1', JSON.stringify({ version: 99, money: 1 }));
    const loaded = loadSave(store);
    check('Newer primary falls back to .bak', loaded.ok === true && loaded.data.money === 555 && loaded.fromBak === true,
      loaded.ok ? `money=${loaded.data.money} fromBak=${loaded.fromBak}` : 'no fallback');
  }

  // Hero staging: the red GT drives the beach boulevard at 3 stars, with
  // five cruisers + the tank on its tail, pedestrians in frame, and the
  // hero HUD (MISSION 7/7 THE TIDE JOB, $18,450, 151 KM/H, Lucía card).
  {
    const w7 = createWorld(7);
    const sys7 = makeSystems();
    w7.state.systems = sys7;
    const info = stageShot('hero', w7, sys7);
    const car = w7.state.player.car;
    check('Hero car drives on the beach (x < -168)', !!car && car.x < -168, car ? `x=${car.x.toFixed(0)}` : 'no car');
    const nearPeds = (w7.state.peds || []).filter((p) => car && Math.hypot(p.x - car.x, p.z - car.z) < 40).length;
    check('Hero has pedestrians near the frame', nearPeds >= 2, nearPeds + ' peds within 40 m');
    check('Hero runs at 3 stars', info.wanted === 3, 'wanted=' + info.wanted);
    check('Hero has 5 cruisers + tank', info.policeCars >= 6, info.policeCars + ' police cars');
    check('Hero HUD override is staged', !!w7.state.heroHud && w7.state.heroHud.carName === 'VESPERA GT',
      w7.state.heroHud ? w7.state.heroHud.carName : 'no heroHud');
    check('Hero camera is staged', w7.state.heroCam === true);
  }
}

// ---------------------------------------------------------------------------
console.log('== Dossier caps (game/ + screenshots/) ==');
{
  const gameDir = join(ROOT, 'game');
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else { files++; bytes += st.size; }
    }
  };
  walk(gameDir);
  check('game/ file count <= 993', files <= 993, files + ' files');
  check('game/ bytes <= 48 MiB', bytes <= 50331648, (bytes / 1048576).toFixed(2) + ' MiB');
  const shotsDir = join(ROOT, 'screenshots');
  // The 1 staged hero shot only — collage.jpg is a derived 2x2 composite, not
  // a staged shot, so it is excluded from the count and the size cap.
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith('collage')) : [];
  check('1 screenshot present', shots.length === 1, shots.length + ' found: ' + shots.join(', '));
  let shotsOk = shots.length === 1;
  for (const f of shots) {
    const sz = statSync(join(shotsDir, f)).size;
    if (sz > 262144) { shotsOk = false; console.log(`  ${f} is ${sz} bytes (> 256 KiB)`); }
  }
  if (shots.length === 1) check('Each screenshot <= 256 KiB', shotsOk);
}

// ---------------------------------------------------------------------------
console.log('== main.ts build ==');
{
  const shotsDir = join(ROOT, 'screenshots');
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith('collage')) : [];
  if (shots.length === 0) {
    skip('main.ts run (no screenshots yet)', 'run tests/shots.py first');
  } else {
    const outDir = join(ROOT, 'out-test');
    try {
      execFileSync('node', ['main.ts'], {
        cwd: ROOT,
        env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
        stdio: 'pipe',
      });
      const hasGame = existsSync(join(outDir, 'game', 'index.html'));
      const hasShots = existsSync(join(outDir, 'screenshots', shots[0]));
      const hasDossier = existsSync(join(outDir, 'dossier.json'));
      check('main.ts writes out/game/', hasGame);
      check('main.ts writes out/screenshots/', hasShots);
      check('main.ts writes out/dossier.json', hasDossier);
    } catch (e) {
      check('main.ts runs', false, String(e.message).slice(0, 200));
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
