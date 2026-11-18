// world.js — Solmar Bay: the world, as one object.
// createWorld(seed) builds everything the game simulates: the city, the
// player, the cars, the traffic and the cash pickups. updateWorld() steps
// them all for one frame. This is the module main.js (the other worker's
// file) holds and passes to render.js / hud.js / minimap.js — it is the
// single source of truth for "what is happening right now".
//
// Ownership: world.js owns state and the per-frame step. It does NOT own
// police AI, missions, combat, HUD, audio or saving — those live in their
// own modules and read/write this world object. It never touches the DOM
// or three.js, so it imports cleanly from Node tests too.

import { ECONOMY, CLOCK, WANTED, WORLD_HALF, PLAYER } from './config.js';
import { createRng } from './random.js';
import { generateCity, randomSidewalkPoint, randomRoadPoint } from './city.js';
import { createPlayer, updateOnFoot, finishEnterCar, exitCar } from './player.js';
import { createVehicle, updateVehicle, nearestParkedCar, stealCar, resetVehicleIds } from './vehicle.js';
import { createTraffic, updateTraffic } from './traffic.js';

/**
 * Build a fresh world from a seed.
 *   world = {
 *     seed, rng, city, player, vehicles: [...all cars incl. traffic/parked],
 *     traffic: {cars, parked, peds}, police: [], // filled by police.js
 *     pickups: [{x, z, amount, taken}],
 *     time: 0,           // seconds since the world started
 *     clockMinutes,      // 17:40 fixed golden hour
 *     money, wanted,     // economy + heat (police.js drives `wanted`)
 *     scaredUntil: 0,    // pedestrians flee while now < scaredUntil
 *     stats: { carsStolen, missionsDone, busted, ... },
 *     paused: false,
 *   }
 */
export function createWorld(seed = 7) {
  resetVehicleIds();
  const rng = createRng(seed);
  const city = generateCity(seed);
  const player = createPlayer(city.spots.playerSpawn);
  const traffic = createTraffic(city, rng);

  // All cars in one list so collision + rendering iterate once.
  const vehicles = [...traffic.cars, ...traffic.parked];

  // The marked yellow sports car for mission M2, parked at the beachfront.
  const m2car = createVehicle('sports', city.spots.beachCar.x, city.spots.beachCar.z,
    Math.PI / 2, { parked: true, color: 0xf1c40f });
  m2car.missionCar = 'M2';
  vehicles.push(m2car);
  traffic.parked.push(m2car);

  // Cash pickups glowing on sidewalks.
  const pickups = [];
  for (let i = 0; i < ECONOMY.cashPickupCount; i++) {
    const spot = randomSidewalkPoint(rng, city);
    pickups.push({
      x: spot.x, z: spot.z,
      amount: rng.int(ECONOMY.cashPickupMin, ECONOMY.cashPickupMax),
      taken: false,
      bobPhase: rng.range(0, Math.PI * 2),
    });
  }

  return {
    seed,
    rng,
    city,
    player,
    vehicles,
    traffic,
    police: [],
    pickups,
    time: 0,
    clockMinutes: CLOCK.startMinutes,
    money: ECONOMY.startMoney,
    wanted: 0,
    scaredUntil: 0,
    stats: { carsStolen: 0, missionsDone: 0, busted: 0, wasted: 0, pedsHit: 0 },
    paused: false,
  };
}

/**
 * Step the world one frame. `input` is the object from input.js
 * (moveX/moveY/run/lookDX + drive fields, plus edge-triggered actions).
 * `hooks` lets the other systems plug in without world.js importing them:
 *   { onEnterCar(car), onStealCar(car), onPickup(pickup),
 *     onPedHit(ped), onCarCollision(car, other, amount),
 *     policeUpdate(world, dt), missionsUpdate(world, dt) }
 * Returns nothing; mutates world.
 */
export function updateWorld(world, input, dt, hooks = {}) {
  if (world.paused || world.player.dead) return;
  world.time += dt;
  const now = world.time;
  const player = world.player;

  // ---- entering / exiting a car --------------------------------------------
  if (player.entering > 0) {
    player.entering -= dt;
    if (player.entering <= 0) {
      const car = finishEnterCar(player);
      if (car && hooks.onEnterCar) hooks.onEnterCar(car);
    }
  } else if (player.exiting > 0) {
    player.exiting -= dt;
  }

  if (player.inVehicle) {
    const car = player.inVehicle;
    const drive = {
      throttle: input.moveY || 0,
      steer: input.moveX || 0,
      handbrake: !!input.run,
    };
    updateVehicle(car, drive, dt, world.city, world.vehicles,
      (c, other, amount) => { if (hooks.onCarCollision) hooks.onCarCollision(c, other, amount); });
    player.x = car.x;
    player.z = car.z;
    player.heading = car.heading;
    player.speed = Math.abs(car.speed);
    if (input.actionExit) {
      exitCar(player, world.city);
      if (hooks.onExitCar) hooks.onExitCar(car);
    }
    if (input.actionHonk) car.honkUntil = now + 0.5;
  } else {
    updateOnFoot(player, input, dt, world.city);
    if (input.actionEnter) {
      // Enter the nearest car the player is allowed to take: a parked car
      // (stealing it), or the player's own stolen car (getting back in
      // after stepping out). Moving traffic is never enterable.
      const car = nearestEnterableCar(player, world.vehicles, 4);
      if (car) {
        const wasParked = car.parked;
        stealCar(car);
        if (wasParked) world.stats.carsStolen += 1;
        player.entering = PLAYER.enterCarTime;
        player.enterTarget = car;
        if (hooks.onStealCar) hooks.onStealCar(car, wasParked);
      }
    }
  }

  // ---- traffic + pedestrians ------------------------------------------------
  updateTraffic(world.traffic, {
    now,
    player,
    playerCar: player.inVehicle,
    police: world.police,
    scaredUntil: world.scaredUntil,
    onHonk: (car) => { if (hooks.onHonk) hooks.onHonk(car); },
  }, dt, world.city);

  // ---- cash pickups ----------------------------------------------------------
  for (const p of world.pickups) {
    if (p.taken) continue;
    if (Math.hypot(player.x - p.x, player.z - p.z) < 1.6) {
      p.taken = true;
      world.money += p.amount;
      if (hooks.onPickup) hooks.onPickup(p);
    }
  }

  // ---- player car vs pedestrian hits (on foot: punch handles it) -------------
  if (player.inVehicle) {
    const car = player.inVehicle;
    for (const ped of world.traffic.peds) {
      if (ped.state === 'down') continue;
      if (Math.hypot(ped.x - car.x, ped.z - car.z) < 2.2 && Math.abs(car.speed) > 3) {
        ped.state = 'down';
        ped.downUntil = now + 4;
        ped.speed = 0;
        world.stats.pedsHit += 1;
        world.scaredUntil = now + 3;
        if (hooks.onPedHit) hooks.onPedHit(ped);
      }
    }
  }

  // ---- plug-in systems (police, missions) run after the core step -----------
  if (hooks.policeUpdate) hooks.policeUpdate(world, dt);
  if (hooks.missionsUpdate) hooks.missionsUpdate(world, dt);
}

// ------------------------------------------------------------------ spawns --
/** Nearest car the player may enter: parked (driver null) or the player's
 *  own stolen car (driver 'player'). Traffic and police cars are excluded.
 *  Returns null when nothing enterable is within maxDist. */
export function nearestEnterableCar(player, vehicles, maxDist = 4) {
  let best = null;
  let bestD = maxDist;
  for (const v of vehicles) {
    if (v.driver !== null && v.driver !== 'player') continue;
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

/** Spawn a fresh traffic car at a random road point and add it to the world. */
export function spawnTrafficCar(world) {
  const spot = randomRoadPoint(world.rng, world.city);
  const type = world.rng.pick(['sedan', 'sedan', 'coupe', 'van', 'taxi']);
  const car = createVehicle(type, spot.x, spot.z, spot.heading, { driver: 'traffic' });
  car.route = [];
  car.routeIndex = 0;
  car.targetSpeed = world.rng.range(7, 9);
  car.stopped = false;
  car.waitTimer = 0;
  world.traffic.cars.push(car);
  world.vehicles.push(car);
  return car;
}

/** Spawn a parked car at a random kerb and add it to the world. */
export function spawnParkedCar(world) {
  const spot = randomRoadPoint(world.rng, world.city);
  const car = createVehicle(world.rng.pick(['sedan', 'coupe', 'sports', 'van']),
    spot.x + 4.5, spot.z, spot.heading, { parked: true, driver: null });
  world.traffic.parked.push(car);
  world.vehicles.push(car);
  return car;
}

/** Respawn a fresh cash pickup somewhere on a sidewalk. */
export function spawnCashPickup(world) {
  const spot = randomSidewalkPoint(world.rng, world.city);
  const p = {
    x: spot.x, z: spot.z,
    amount: world.rng.int(ECONOMY.cashPickupMin, ECONOMY.cashPickupMax),
    taken: false, bobPhase: world.rng.range(0, Math.PI * 2),
  };
  world.pickups.push(p);
  return p;
}

/** All cars currently in the world (traffic + parked + police). */
export function allCars(world) {
  return world.vehicles.concat(world.police);
}

/** Distance between the player and a world point. */
export function playerDistanceTo(world, x, z) {
  return Math.hypot(world.player.x - x, world.player.z - z);
}

/** Clamp the player back inside the world bounds. */
export function clampWorld(world) {
  const p = world.player;
  p.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, p.x));
  p.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, p.z));
}

/** Wanted stars, clamped 0..5. police.js owns the rules; this is the setter. */
export function setWanted(world, stars) {
  world.wanted = Math.max(0, Math.min(WANTED.maxStars, Math.round(stars)));
}
export function addWanted(world, stars) {
  setWanted(world, world.wanted + stars);
}

export default createWorld;
