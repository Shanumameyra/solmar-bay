// traffic.js — Solmar Bay: the city feels alive.
// Traffic cars (10) cruise street loops, stop at red lights, yield to the
// car ahead and honk when blocked. Pedestrians (26) walk the sidewalks,
// flee from danger and wave for taxis. Parked cars (8) sit stealable at
// the kerb. All movement is speed * dt in metres — same discipline as
// player.js and vehicle.js. Plain data + math only; no three.js, no DOM.

import { TRAFFIC, CAR_TYPES, WORLD_HALF } from './config.js';
import { createRng } from './random.js';
import {
  randomRoadPoint, randomSidewalkPoint,
  lightState, nearestTrafficLight, headingTo,
} from './city.js';
import { createVehicle } from './vehicle.js';

const PED_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6,
  0xe67e22, 0x1abc9c, 0xecf0f1, 0x34495e, 0xfd79a8,
];

/**
 * Build all traffic for a city.
 * Returns { cars: [...traffic cars], parked: [...parked cars],
 *           peds: [...pedestrians] }.
 * Traffic cars are vehicle objects (see vehicle.js) with driver 'traffic'
 * plus AI fields: route (waypoints), routeIndex, targetSpeed, stopped.
 * Peds are plain objects: {x, z, heading, speed, state, color, ...}.
 */
export function createTraffic(city, rng) {
  const cars = [];
  const used = new Set();
  for (let i = 0; i < TRAFFIC.carCount; i++) {
    const spot = randomRoadPoint(rng, city);
    const key = `${Math.round(spot.x / 10)},${Math.round(spot.z / 10)}`;
    if (used.has(key)) { i--; continue; }
    used.add(key);
    const type = rng.pick(['sedan', 'sedan', 'coupe', 'van', 'taxi', 'truck']);
    const car = createVehicle(type, spot.x, spot.z, spot.heading, { driver: 'traffic' });
    car.route = buildRoute(rng, city);
    car.routeIndex = 0;
    car.targetSpeed = rng.range(7, TRAFFIC.cruiseSpeed);
    car.stopped = false;
    car.waitTimer = 0;
    cars.push(car);
  }

  const parked = [];
  for (let i = 0; i < TRAFFIC.parkedCount; i++) {
    const spot = randomRoadPoint(rng, city);
    // Park at the kerb: offset to the side of the road, aligned with it.
    const vertical = Math.abs(spot.x % 50) < 25; // rough axis guess
    const px = vertical ? spot.x + 4.5 : spot.x;
    const pz = vertical ? spot.z : spot.z + 4.5;
    const type = rng.pick(['sedan', 'coupe', 'sports', 'sedan', 'van']);
    const car = createVehicle(type, px, pz, spot.heading,
      { parked: true, driver: null });
    parked.push(car);
  }

  const peds = [];
  for (let i = 0; i < TRAFFIC.pedCount; i++) {
    peds.push(createPedestrian(rng, city));
  }
  return { cars, parked, peds };
}

/** A loop of waypoints around city blocks: pick random intersections. */
export function buildRoute(rng, city) {
  const route = [];
  const n = rng.int(5, 8);
  for (let i = 0; i < n; i++) {
    const inter = rng.pick(city.intersections);
    route.push({ x: inter.x, z: inter.z });
  }
  return route;
}

/** One pedestrian: walks sidewalks, flees, waves for a taxi. */
export function createPedestrian(rng, city) {
  const spot = randomSidewalkPoint(rng, city);
  return {
    x: spot.x,
    z: spot.z,
    heading: rng.angle(),
    speed: 0,
    walkSpeed: rng.range(1.0, TRAFFIC.pedWalkSpeed),
    state: 'walk',          // 'walk' | 'flee' | 'wave' | 'down'
    color: rng.pick(PED_COLORS),
    target: randomSidewalkPoint(rng, city),
    fleeUntil: 0,
    waveUntil: 0,
    taxiFare: 0,
    bobPhase: rng.range(0, Math.PI * 2),
  };
}

/**
 * Step all traffic for a frame.
 *   ctx: { now (seconds), player: {x, z, inVehicle}, playerCar,
 *          police: [{x, z}], onHonk(car), onPedHit(ped) }
 *   dt: seconds. city: the city object.
 * Mutates traffic in place.
 */
export function updateTraffic(traffic, ctx, dt, city) {
  const now = ctx.now || 0;
  for (const car of traffic.cars) {
    updateTrafficCar(car, traffic, ctx, dt, city, now);
  }
  for (const ped of traffic.peds) {
    updatePedestrian(ped, ctx, dt, city, now);
  }
}

/** One traffic car: follow its route, obey lights, yield, honk. */
function updateTrafficCar(car, traffic, ctx, dt, city, now) {
  if (car.stalled) { car.speed = 0; return; }

  const target = car.route[car.routeIndex];
  const dx = target.x - car.x, dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 4) {
    car.routeIndex = (car.routeIndex + 1) % car.route.length;
  }
  const wantHeading = headingTo(car.x, car.z, target.x, target.z);
  let diff = wantHeading - car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, diff));

  // ---- should we stop? red light ahead / car ahead / player car ahead ----
  let stop = false;
  const light = nearestTrafficLight(car.x, car.z, city, 16);
  if (light && lightState(light, now) === 'red') {
    // Only stop if the light is roughly ahead of us.
    const lx = light.x - car.x, lz = light.z - car.z;
    const ahead = lx * Math.sin(car.heading) + lz * Math.cos(car.heading);
    if (ahead > 0 && ahead < 16) stop = true;
  }
  const blocker = nearestCarAhead(car, traffic.cars, ctx.playerCar, ctx.police);
  if (blocker && blocker.dist < TRAFFIC.stopDistance) stop = true;

  // ---- speed control -------------------------------------------------------
  if (stop) {
    car.speed = Math.max(0, car.speed - 14 * dt);
    car.waitTimer += dt;
    // Honk after waiting a while behind a blockage.
    if (car.waitTimer > 3 && blocker) {
      car.honkUntil = now + 0.4;
      car.waitTimer = 0;
      if (ctx.onHonk) ctx.onHonk(car);
    }
  } else {
    car.waitTimer = 0;
    const target = Math.min(car.targetSpeed, TRAFFIC.maxSpeed);
    if (car.speed < target) car.speed += 5 * dt;
    else car.speed = Math.max(target, car.speed - 8 * dt);
  }

  // ---- integrate (forward only — traffic never reverses) -------------------
  car.speed = Math.max(0, Math.min(car.speed, TRAFFIC.maxSpeed));
  const step = car.speed * dt;
  car.x += Math.sin(car.heading) * step;
  car.z += Math.cos(car.heading) * step;
  car.x = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, car.x));
  car.z = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, car.z));
}

/** Nearest car in front of `car` within its lane cone, or null. */
function nearestCarAhead(car, trafficCars, playerCar, policeCars) {
  let best = null, bestD = Infinity;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const consider = (other) => {
    if (!other || other === car) return;
    const dx = other.x - car.x, dz = other.z - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead > 20) return;
    const side = Math.abs(dx * fz - dz * fx);
    if (side > 3) return;
    if (ahead < bestD) { bestD = ahead; best = other; }
  };
  for (const c of trafficCars) consider(c);
  if (playerCar) consider(playerCar);
  if (policeCars) for (const p of policeCars) consider(p);
  return best ? { car: best, dist: bestD } : null;
}

/** One pedestrian: walk to its target, flee danger, wave for taxis. */
function updatePedestrian(ped, ctx, dt, city, now) {
  if (ped.state === 'down') return;

  // Flee: player car speeding nearby, gunfire, or a recent scare.
  const px = ctx.player ? ctx.player.x : 0;
  const pz = ctx.player ? ctx.player.z : 0;
  const dPlayer = Math.hypot(ped.x - px, ped.z - pz);
  const danger = (ctx.playerCar && dPlayer < 8 && Math.abs(ctx.playerCar.speed) > 8)
    || (ctx.scaredUntil && now < ctx.scaredUntil && dPlayer < 25);
  if (danger) {
    ped.state = 'flee';
    ped.fleeUntil = now + 2;
  } else if (ped.state === 'flee' && now > ped.fleeUntil) {
    ped.state = 'walk';
  }

  if (ped.state === 'flee') {
    // Run directly away from the player.
    const away = headingTo(px, pz, ped.x, ped.z);
    ped.heading = away;
    ped.speed = TRAFFIC.pedRunSpeed;
  } else if (ped.state === 'wave') {
    ped.speed = 0; // standing at the kerb, waving
    if (now > ped.waveUntil) ped.state = 'walk';
  } else {
    // Walk toward the current sidewalk target; pick a new one on arrival.
    const dx = ped.target.x - ped.x, dz = ped.target.z - ped.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5) {
      ped.target = randomSidewalkPoint(createRng(Math.floor(now * 1000) + ped.x * 7), city);
    } else {
      ped.heading = headingTo(ped.x, ped.z, ped.target.x, ped.target.z);
    }
    ped.speed = ped.walkSpeed;
  }

  const step = ped.speed * dt;
  ped.x += Math.sin(ped.heading) * step;
  ped.z += Math.cos(ped.heading) * step;
  ped.bobPhase += dt * ped.speed * 4;
  ped.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, ped.x));
  ped.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, ped.z));
}

/**
 * Make a nearby pedestrian wave for a taxi (called by the missions/taxi
 * system). Returns the ped, or null when none is close enough.
 */
export function hailTaxi(traffic, x, z, rng) {
  let best = null, bestD = 30;
  for (const ped of traffic.peds) {
    if (ped.state !== 'walk') continue;
    const d = Math.hypot(ped.x - x, ped.z - z);
    if (d < bestD) { best = ped; bestD = d; }
  }
  if (!best) return null;
  best.state = 'wave';
  best.waveUntil = (rng ? rng.range(20, 40) : 30) + performanceSeconds();
  best.taxiFare = rng ? rng.int(25, 60) : 30;
  return best;
}

/** Knock a ped down (hit by a car / punched). They get up after a while. */
export function knockPed(ped, now) {
  ped.state = 'down';
  ped.downUntil = now + 4;
  ped.speed = 0;
}

/** Peds that are 'down' stand back up once their timer expires. */
export function revivePeds(traffic, now) {
  for (const ped of traffic.peds) {
    if (ped.state === 'down' && now > (ped.downUntil || 0)) {
      ped.state = 'walk';
    }
  }
}

/** Count how many peds are currently fleeing (for HUD / wanted flavour). */
export function fleeingCount(traffic) {
  let n = 0;
  for (const ped of traffic.peds) if (ped.state === 'flee') n++;
  return n;
}

function performanceSeconds() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now() / 1000;
  return Date.now() / 1000;
}

export default createTraffic;
