// selftest.mjs — Solmar Bay logic self-test (Node, no browser).
// Written fresh for the v5 rebuild. Run from the repo root:
//
//   node tests/selftest.mjs
//
// Every check is a small, named assertion over the game's own pure modules
// (world / player / vehicle / traffic / city / missions / police / combat /
// save / shots / main). Exit 0 when all checks pass, exit 1 otherwise.
// Nothing here opens a browser: the browser half of QA is tests/shots.py
// and tests/playtest.py.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYER, CAR, MISSIONS } from '../game/src/config.js';
import { createWorld, updateWorld } from '../game/src/world.js';
import { pointInSolid } from '../game/src/city.js';
import { createVehicle } from '../game/src/vehicle.js';
import { createMissions } from '../game/src/missions.js';
import { createPolice } from '../game/src/police.js';
import {
  createSave, parseSave, defaultSaveData, SAVE_KEY,
} from '../game/src/save.js';
import { parseShotParams } from '../game/src/shots.js';
import {
  createGameContext, startGame, handleTitleKey,
  applyBusted, applyWasted, gridBlocked,
} from '../game/src/main.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = join(ROOT, 'game');
const SRC = join(GAME, 'src');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(a, b, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

// A neutral input snapshot (input.js shape); override fields per step.
function snap(over = {}) {
  return {
    moveX: 0, moveY: 0, run: false, lookDX: 0, lookDY: 0,
    mouseDown: false, pointerLocked: false,
    actionEnter: false, actionExit: false, actionPunch: false,
    actionShoot: false, actionReload: false, actionHonk: false,
    actionMute: false, actionPause: false, actionConfirm: false,
    weapon1: false, weapon2: false, buyAmmo: false,
    ...over,
  };
}

function stepWorld(world, input, n, hooks = {}) {
  for (let i = 0; i < n; i++) updateWorld(world, input, 1 / 60, hooks);
}

console.log('== config ==');
check('walk speed is 5 m/s (DESIGN.md)', PLAYER.walkSpeed === 5);
check('run speed is 8 m/s (DESIGN.md)', PLAYER.runSpeed === 8);
check('car top speed 38, sports 46', CAR.topSpeed === 38 && CAR.sportsTopSpeed === 46);
check('M1 reward $300, timer 150 s', MISSIONS.rewardM1 === 300 && MISSIONS.timeLimitM1 === 150);

console.log('== world build ==');
const world = createWorld(7);
check('10 traffic cars', world.traffic.cars.length === 10);
check('9 parked cars (8 + M2 sports car)', world.traffic.parked.length === 9);
check('26 pedestrians', world.traffic.peds.length === 26);
check('6 cash pickups', world.pickups.length === 6);
check('player spawns at the plaza (0, 26)',
  near(world.player.x, 0) && near(world.player.z, 26));
check('world is deterministic (same seed, same parked cars)', (() => {
  const again = createWorld(7);
  return JSON.stringify(again.traffic.parked.map((c) => [c.x, c.z]))
    === JSON.stringify(world.traffic.parked.map((c) => [c.x, c.z]));
})());

console.log('== on-foot movement (the v4 bug: 0.2 m in 2 s) ==');
{
  const w = createWorld(7);
  const x0 = w.player.x;
  const z0 = w.player.z;
  stepWorld(w, snap({ moveY: 1 }), 120);
  const d = Math.hypot(w.player.x - x0, w.player.z - z0);
  check(`walk 2 s covers ~10 m (got ${d.toFixed(2)} m)`, d >= 9.9 && d <= 10.2);
}
{
  const w = createWorld(7);
  const x0 = w.player.x;
  const z0 = w.player.z;
  stepWorld(w, snap({ moveY: 1, run: true }), 120);
  const d = Math.hypot(w.player.x - x0, w.player.z - z0);
  check(`run 2 s covers ~16 m (got ${d.toFixed(2)} m)`, d >= 15.9 && d <= 16.2);
}
{
  const w = createWorld(7);
  stepWorld(w, snap({ moveY: 1 }), 60);
  check('world time advances 1 s per 60 steps', near(w.time, 1, 0.02));
}

console.log('== collision ==');
{
  const w = createWorld(7);
  const b = w.city.buildings[0];
  // Stand just south of the first building's south face, walk north.
  w.player.x = b.x;
  w.player.z = b.z + b.d / 2 + 1.5;
  w.player.heading = Math.PI;
  stepWorld(w, snap({ moveY: 1 }), 60);
  const face = b.z + b.d / 2;
  check('player cannot walk through a building',
    w.player.z >= face + 0.4 && pointInSolid(b.x, b.z, 0.45, w.city));
}

console.log('== steal + drive + exit ==');
{
  const w = createWorld(7);
  // A fresh car on an open street (x = 25), facing north, so the drive
  // test never depends on where the random parked cars landed.
  const car = createVehicle('sedan', 25, 0, Math.PI, { parked: true });
  w.vehicles.push(car);
  w.traffic.parked.push(car);
  w.player.x = 25;
  w.player.z = 3;
  w.player.heading = Math.PI;
  stepWorld(w, snap({ actionEnter: true }), 1);
  stepWorld(w, snap(), 30); // 0.4 s enter-car animation + margin
  check('E near a parked car puts the player in it', w.player.inVehicle === car);
  check('stealing counts one car stolen', w.stats.carsStolen === 1);
  const cx0 = car.x;
  const cz0 = car.z;
  stepWorld(w, snap({ moveY: 1 }), 180); // 3 s of throttle
  const moved = Math.hypot(car.x - cx0, car.z - cz0);
  check(`driving 3 s reaches speed (got ${car.speed.toFixed(1)} m/s)`, car.speed > 15);
  check(`driving 3 s covers ground (got ${moved.toFixed(1)} m)`, moved > 20);
  stepWorld(w, snap({ actionExit: true }), 1);
  stepWorld(w, snap(), 5);
  check('E while driving steps the player out', w.player.inVehicle === null);
  stepWorld(w, snap({ actionEnter: true }), 1);
  stepWorld(w, snap(), 30);
  check('E by the stolen car lets the player back in', w.player.inVehicle === car);
  check('re-entering the same car does not count a second theft',
    w.stats.carsStolen === 1);
}

console.log('== cash pickup ==');
{
  const w = createWorld(7);
  const pk = w.pickups[0];
  const before = w.money;
  w.player.x = pk.x;
  w.player.z = pk.z;
  stepWorld(w, snap(), 1);
  check('walking over a pickup collects it', pk.taken && w.money === before + pk.amount);
}

console.log('== missions M0 -> M1 -> paid ==');
{
  const player = { x: 0, z: 26 };
  const G = {
    layout: {
      cafe: { x: 0, z: 22 }, docks: { x: 182, z: 24 },
      sportsCar: { x: -182, z: -60 }, garage: { x: 28, z: 172 },
      safehouse: { x: -100, z: 172 },
    },
    money: 150, missionIndex: 0,
    stats: { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 150 },
    time: 0, state: 'playing',
    getPlayerPos: () => ({ x: player.x, y: 0, z: player.z }),
    isInCar: () => false,
    getCurrentVehicle: () => null,
    hud: { toast() {}, setObjective() {}, setDialogue() {} },
    audio: { sfx() {}, jingle() {}, phoneRing() {}, sting() {} },
    save: { save() {} },
    effects: { sparkle() {} },
    emit() {},
  };
  const missions = createMissions(G);
  missions.startCurrent();
  check('M0 starts at the cafe', missions.current().id === 'M0');
  missions.update(0.016); // player already inside the M0 radius
  check('reaching the cafe completes M0 and starts M1',
    G.missionIndex === 1 && missions.current().id === 'M1');
  player.x = 182;
  player.z = 24;
  missions.update(0.016); // collect the package at the docks
  check('collecting the package advances M1 to the delivery step',
    missions.stepIndex === 1);
  player.x = 0;
  player.z = 22;
  missions.update(0.016); // deliver to Rosa's cafe
  check('delivering pays $300 (money 150 -> 450)',
    G.money === 450 && G.missionIndex === 2);
  check('M0 + M1 count as two missions done', G.stats.missionsDone === 2);
}

console.log('== police ==');
{
  const G = {
    wanted: 0, time: 0,
    getPlayerPos: () => ({ x: 0, y: 0, z: 0 }),
    getPlayerSpeed: () => 0,
    isInCar: () => false,
    worldBlocked: () => false,
    hud: { toast() {} },
    audio: { sfx() {} },
    emit() {},
  };
  const police = createPolice(G);
  police.addHeat(2, 'test');
  check('2 stars spawns 2 police cars', G.wanted === 2 && police.cars.length === 2);
  police.addHeat(3, 'test');
  check('heat caps at 5 stars', G.wanted === 5 && police.cars.length === 5);
  police.clearWanted();
  check('clearing heat removes the fleet', G.wanted === 0 && police.cars.length === 0);
}

console.log('== save ==');
{
  const data = defaultSaveData();
  check('save round-trips through parseSave',
    parseSave(JSON.stringify(data)) !== null
    && parseSave(JSON.stringify(data)).money === data.money);
  check('parseSave rejects garbage', parseSave('not json') === null);
  const G = {
    money: 450, missionIndex: 2,
    stats: { missionsDone: 1, carsStolen: 1, busted: 0, bestCash: 450 },
    muted: false,
  };
  const save = createSave(G);
  save.save();
  G.money = 0;
  G.missionIndex = 0;
  const loaded = save.load();
  check('save/load restores money + mission',
    loaded !== null && G.money === 450 && G.missionIndex === 2);
}

console.log('== shots params ==');
check('?shot=2&seed=7 parses', (() => {
  const p = parseShotParams('?shot=2&seed=7');
  return p.shot === 2 && p.seed === 7;
})());
check('?shot=9 is invalid (0)', parseShotParams('?shot=9').shot === 0);
check('no query defaults to shot 0, seed 7', (() => {
  const p = parseShotParams('');
  return p.shot === 0 && p.seed === 7;
})());

console.log('== main.js pure logic ==');
{
  const G = createGameContext();
  check('fresh context starts at the title with $150',
    G.state === 'title' && G.money === 150);
  check('Enter on an unbooted title queues the start',
    startGame(G) === 'queued' && G.queuedStart === true);
  check('handleTitleKey(Enter) starts the game', handleTitleKey(G, 'Enter') === true);
  const Gb = createGameContext();
  Gb.money = 500;
  Gb.wanted = 3;
  const fine = applyBusted(Gb);
  check('busted loses $200 and clears wanted',
    fine === 200 && Gb.money === 300 && Gb.wanted === 0 && Gb.stats.busted === 1);
  const Gw = createGameContext();
  Gw.money = 500;
  const wf = applyWasted(Gw);
  check('wasted loses $100 and restores health',
    wf === 100 && Gw.money === 400 && Gw.health === 100);
  check('gridBlocked: plaza centre is open', gridBlocked(0, 0) === false);
  check('gridBlocked: street line is open', gridBlocked(25, 100) === false);
  check('gridBlocked: block interior is solid', gridBlocked(100, 100) === true);
}

console.log('== entry files ==');
check('LICENSE exists and opens with the SPDX line', (() => {
  const text = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  return text.split('\n')[0].trim() === 'SPDX-License-Identifier: MIT';
})());
check('shots.json parses and names 4 shots', (() => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'shots.json'), 'utf8'));
  return Array.isArray(cfg.shots) && cfg.shots.length === 4;
})());
check('game/index.html exists with an import map for three', (() => {
  const html = readFileSync(join(GAME, 'index.html'), 'utf8');
  return html.includes('type="importmap"') && html.includes('three.module.min.js');
})());
check('vendored three.js exists',
  existsSync(join(GAME, 'vendor', 'three', 'three.module.min.js')));
check('all 20 source modules exist', (() => {
  const files = readdirSync(SRC);
  const need = ['audio.js', 'city.js', 'combat.js', 'config.js', 'effects.js',
    'hud.js', 'input.js', 'main.js', 'minimap.js', 'missions.js', 'player.js',
    'police.js', 'random.js', 'render.js', 'save.js', 'shots.js',
    'traffic.js', 'vehicle.js', 'world.js'];
  return need.every((f) => files.includes(f));
})());
check('no absolute http(s) imports in game sources', (() => {
  const bad = [];
  const scan = (path, text) => {
    for (const m of text.matchAll(/(from\s+['"]|import\(\s*['"]|src=["']|href=["'])https?:\/\//g)) {
      bad.push(`${path}: ${m[0]}`);
    }
  };
  scan('index.html', readFileSync(join(GAME, 'index.html'), 'utf8'));
  for (const f of readdirSync(SRC)) {
    if (f.endsWith('.js')) scan(`src/${f}`, readFileSync(join(SRC, f), 'utf8'));
  }
  if (bad.length) console.log(`    offending refs: ${bad.join(' | ')}`);
  return bad.length === 0;
})());

console.log(`\nselftest: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log(`failures: ${failures.join(', ')}`);
  process.exit(1);
}
