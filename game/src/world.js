// SOLMAR BAY — the world. Owns the whole game state and the fixed-step update
// order: input -> player -> vehicles -> traffic -> police -> missions -> combat
// -> HUD data. Systems (police/missions/combat) are owned by Worker B and
// passed in as `systems`; when one is missing its step is skipped gracefully
// so the world still plays on its own.
//
// SHARED CONVENTION (with Worker B, see repo/NOTES.md): a heading/angle `a`
// means forward = (sin a, cos a) in world XZ; angle 0 = +z (south),
// PI = -z (north). Cars and peds carry `angle`; the player carries `yaw`
// (camera/aim) and a smoothed `heading` (facing, same convention).
//
// INPUT: main.js passes the input object from input.js — { keys:Set,
// justPressed:Set, dx, dy, pointerLocked } — and world.step translates it
// once into the plain drive axes (moveX/moveZ/run/lookDX/lookDY/enter/honk)
// that player.js and vehicle.js consume. combat.js receives the RAW input
// object (it reads justPressed itself).
//
// EVENTS: state.events is the transient queue drained once per frame by
// main.js (sound) and hud.js (feed, which shifts them out). world.step does
// NOT clear it per step — events from several fixed steps in one frame all
// reach the drain. pushFeed caps the queue at 24, like B's pushEvent.
// No DOM, no three.js scene here — only numbers, so the node smoke test can
// run the world headless.
import { CONFIG } from './config.js';
import { createRandom } from './random.js';
import { buildCity, collideCircle } from './city.js';
import { createPlayer, stepPlayer } from './player.js';
import { createCar, stepCar, enterCar, exitCar } from './vehicle.js';
import { createTraffic, stepTraffic } from './traffic.js';

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
export function dist(ax, az, bx, bz) {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

// Translate the input.js object into the plain drive axes player/vehicle use.
export function translateInput(input) {
  const keys = (input && input.keys) || new Set();
  const jp = (input && input.justPressed) || new Set();
  const left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  const right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  const fwd = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  const back = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  return {
    moveX: right - left,
    moveZ: fwd - back,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    lookDX: (input && input.dx) || 0,
    lookDY: (input && input.dy) || 0,
    enter: jp.has('KeyE'),
    honk: jp.has('KeyH'),
  };
}

export function createWorld(seed = 7) {
  const rng = createRandom(seed);
  const city = buildCity(seed);

  const state = {
    seed,
    time: 0,
    money: CONFIG.START.MONEY,
    health: CONFIG.PLAYER.HEALTH,
    wanted: 0,
    player: null,
    cars: [],
    peds: [],
    police: [],       // kept for the contract; B's police units live in cars/peds
    mission: { index: 0, phase: 'idle', step: 0, objective: "Go to Rosa's café", marker: null, timer: 0, dialogue: "Rosa: Dario, it's Rosa. Come to the café." },
    stats: { missionsDone: 0, carsStolen: 0, busted: 0, deaths: 0, bestCash: CONFIG.START.MONEY, distanceDriven: 0, pedsHit: 0, shotsFired: 0, shotsHit: 0 },
    feed: [],         // [{ text, at }] — persistent message feed, newest last
    events: [],       // transient { type, text, t } — drained by main.js / hud.js
    screen: 'title',  // 'title' | 'play' | 'paused' | 'busted' | 'wasted'
    screenT: 0,
    systems: null,    // set by world.step each step (missions/police read it)
    pickups: [],      // cash bundles (missions.js)
    taxiMarker: null, // current taxi customer / destination (missions.js)
    policeNear: false,
    shakeTrauma: 0,
    fxBurst: null,
    landmarks: city.landmarks,
    spawnPoints: city.spawnPoints,
    colliders: city.colliders,
    navGrid: city.navGrid,
    paused: false,
    over: false,
  };

  const world = {
    state,
    city,
    rng,
    reset,
    step,
    addHeat,
    addMoney,
    damagePlayer,
    healPlayer,
    pushFeed,
    nearestCar,
    nearestPed,
    carsNear,
    teleport,
  };

  function reset() {
    state.time = 0;
    state.money = CONFIG.START.MONEY;
    state.health = CONFIG.PLAYER.HEALTH;
    state.wanted = 0;
    state.player = createPlayer(city.spawnPoints.player);
    state.cars = city.spawnPoints.parked.map((spot, i) =>
      createCar(spot.model, spot.x, spot.z, spot.angle, { id: `parked-${i}`, isParked: true }));
    const traffic = createTraffic(city, rng);
    state.cars.push(...traffic.cars);
    state.peds = traffic.peds;
    state.police = [];
    state.mission = { index: 0, phase: 'idle', step: 0, objective: "Go to Rosa's café", marker: null, timer: 0, dialogue: "Rosa: Dario, it's Rosa. Come to the café." };
    state.stats = { missionsDone: 0, carsStolen: 0, busted: 0, deaths: 0, bestCash: state.money, distanceDriven: 0, pedsHit: 0, shotsFired: 0, shotsHit: 0 };
    state.feed = [];
    state.events = [];
    state.screen = 'play';
    state.screenT = 0;
    state.pickups = [];
    state.taxiMarker = null;
    state.policeNear = false;
    state.shakeTrauma = 0;
    state.fxBurst = null;
    state.paused = false;
    state.over = false;
    pushFeed("Dario, it's Rosa. Come to the café.");
  }

  function pushFeed(text) {
    const entry = { text, at: state.time };
    state.feed.push(entry);
    if (state.feed.length > 6) state.feed.shift();
    state.events.push({ type: 'feed', text, t: state.time });
    if (state.events.length > 24) state.events.shift();
  }

  // Single choke point for wanted heat. When B's police system is present
  // it owns the wanted level (it mirrors its own count onto state.wanted
  // every step), so heat must go through police.addHeat — a direct bump of
  // state.wanted would be overwritten by the next police step. Without a
  // police system, bump state.wanted directly (headless smoke tests).
  function addHeat(n, reason) {
    const police = state.systems && state.systems.police;
    if (police && typeof police.addHeat === 'function') {
      police.addHeat(n, reason, state);
      return state.wanted;
    }
    const before = state.wanted;
    state.wanted = Math.max(0, Math.min(CONFIG.WANTED.MAX_STARS, state.wanted + n));
    if (state.wanted > before) {
      pushFeed(`WANTED ${'★'.repeat(state.wanted)} — the SBPD is on you`);
      state.events.push({ type: 'wanted', text: `WANTED ${'★'.repeat(state.wanted)} — the SBPD is on you`, t: state.time });
    }
    return state.wanted;
  }

  function addMoney(n, reason) {
    state.money += n;
    state.stats.bestCash = Math.max(state.stats.bestCash, state.money);
    pushFeed(`${n >= 0 ? '+' : ''}$${n}${reason ? ` — ${reason}` : ''}`);
    state.events.push({ type: 'money', text: `${n >= 0 ? '+' : ''}$${n}${reason ? ` — ${reason}` : ''}`, t: state.time });
    return state.money;
  }

  function damagePlayer(n) {
    const p = state.player;
    if (!p || p.invuln > 0) return state.health;
    p.hp = Math.max(0, (p.hp || 100) - n);
    state.health = p.hp;
    state.events.push({ type: 'damage', text: `-${n} HP`, t: state.time });
    if (p.hp <= 0) state.events.push({ type: 'playerDown', text: 'WASTED', t: state.time });
    return state.health;
  }

  function healPlayer(n) {
    const p = state.player;
    if (!p) return state.health;
    p.hp = Math.min(p.maxHp || CONFIG.PLAYER.HEALTH, (p.hp || 0) + n);
    state.health = p.hp;
    return state.health;
  }

  // Nearest car to (x, z) within maxDist. opts: { parkedOnly, exclude }.
  function nearestCar(x, z, maxDist, opts = {}) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const car of state.cars) {
      if (opts.exclude && car === opts.exclude) continue;
      if (opts.parkedOnly && !car.isParked) continue;
      if (opts.notParked && car.isParked) continue;
      const d = dist2(x, z, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function nearestPed(x, z, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const ped of state.peds) {
      const d = dist2(x, z, ped.x, ped.z);
      if (d < bestD) { bestD = d; best = ped; }
    }
    return best;
  }

  function carsNear(x, z, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const car of state.cars) {
      if (dist2(x, z, car.x, car.z) <= r2) out.push(car);
    }
    return out;
  }

  // Move the player (on foot) to a spot, facing `angle`. Used by shots.js
  // to stage screenshots; call render.snapCamera() after, or the camera
  // will glide from the old spot. If `car` is given, the player is placed
  // in that car instead (the car is moved too, with its speed zeroed).
  function teleport(x, z, angle, car) {
    const p = state.player;
    if (car) {
      car.x = x;
      car.z = z;
      car.angle = angle;
      car.speed = 0;
      if (p.car !== car) enterCar(p, car, world);
      p.x = x;
      p.z = z;
      p.yaw = angle;
      p.heading = angle;
      p.speed = 0;
      return car;
    }
    if (p.car) exitCar(p, world);
    const resolved = collideCircle(city, x, z, CONFIG.PLAYER.RADIUS);
    p.x = resolved.x;
    p.z = resolved.z;
    p.yaw = angle;
    p.heading = angle;
    p.speed = 0;
    return null;
  }

  // One fixed step. `input` is the input.js object
  // { keys, justPressed, dx, dy, pointerLocked } (or the title-screen dummy
  // with the same shape). `systems` is { police, missions, combat }.
  function step(dt, input, systems = {}) {
    // B's systems read state.systems (missions addHeat via state.systems.police).
    state.systems = systems;
    state.time += dt;
    const drive = translateInput(input);

    // 1. Player (on foot, or driving — the car is stepped with the player).
    stepPlayer(state, drive, dt, world, systems);
    const playerCar = state.player.car;
    if (playerCar) {
      const before = { x: playerCar.x, z: playerCar.z };
      stepCar(playerCar, drive, dt, world, true);
      state.stats.distanceDriven += dist(before.x, before.z, playerCar.x, playerCar.z);
      // HUD + police + shots read the player's speed: mirror the car's.
      state.player.speed = playerCar.speed;
    }

    // 2. Traffic + pedestrians.
    stepTraffic(state, dt, world, systems);

    // 3. Police (B). 4. Missions (B). 5. Combat (B, gets the RAW input).
    if (systems.police && typeof systems.police.step === 'function') {
      systems.police.step(dt, state);
    }
    if (systems.missions && typeof systems.missions.step === 'function') {
      systems.missions.step(dt, state);
    }
    if (systems.combat && typeof systems.combat.step === 'function') {
      systems.combat.step(dt, state, input);
    }

    // 6. HUD data is the state itself; main.js reads it directly.
    state.health = state.player.hp;
    return state.events;
  }

  reset();
  state.screen = 'title'; // fresh world starts behind the title screen
  return world;
}

// Re-export the collision helper for systems that need it.
export { collideCircle };
