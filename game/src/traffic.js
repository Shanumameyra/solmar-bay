// Solmar Bay — traffic cars + pedestrians (Worker A, v3 rebuild).
// 10 traffic cars follow rectangular street loops and stop at red lights;
// 18 pedestrians walk sidewalk loops around blocks and flee (A* path away)
// from honks, gunfire and near misses. AI layers (game-ai skill):
// perceive (a scare / a hit sets flee) -> decide (walk / flee / down) ->
// path (cached A* route for fleeing) -> steer (follow next waypoint).
// Stuck guards: a fleeing ped whose path is exhausted falls back to
// walking its loop; a downed civilian gets back up after downT (cops stay
// down). Hitting a pedestrian with the player's car at speed > 3 raises
// heat (+1) — that check lives here, in stepTraffic.

import { CONFIG } from './config.js';
import { createCar, collideCars } from './vehicle.js';
import { collideCircle } from './city.js';

// Traffic-light phase: 12 s cycle, 6 s per direction. Intersections
// alternate by parity so neighbouring lights are out of phase.
export function nsGreen(time, sx, sz) {
  const phase = Math.floor(time / 6) % 2;
  const parity = ((((sx + sz) / 48) % 2) + 2) % 2;
  return phase === parity;
}

function angleTo(x0, z0, x1, z1) {
  return Math.atan2(x1 - x0, z1 - z0);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const PED_COLORS = [
  0xe85a7a, 0x3a9ad8, 0x3aa84a, 0xd8a23a, 0x8a5ad8,
  0xe87a3a, 0x4ad8c8, 0xd84a9a, 0x7a8a9a, 0xf2e6a8,
];

export function createTraffic(city, rng) {
  const streets = CONFIG.CITY.STREETS;
  const cars = [];
  for (let i = 0; i < CONFIG.TRAFFIC.COUNT; i++) {
    // A rectangular loop on street centrelines: two x-streets, two z-streets.
    const xs = rng.shuffle(streets.slice()).slice(0, 2).sort((a, b) => a - b);
    const zs = rng.shuffle(streets.slice()).slice(0, 2).sort((a, b) => a - b);
    const route = [
      [xs[0], zs[0]],
      [xs[1], zs[0]],
      [xs[1], zs[1]],
      [xs[0], zs[1]],
    ];
    const model = rng.pick(['sedan', 'sedan', 'sedan', 'taxi', 'van', 'truck']);
    const car = createCar(model, route[0][0], route[0][1], 0, {
      id: `tr${i}`,
      isTraffic: true,
      driver: 'traffic',
      route,
      routeIdx: 1,
      color: rng.pick((CONFIG.CAR_MODELS[model] || CONFIG.CAR_MODELS.sedan).colors),
    });
    car.angle = angleTo(route[0][0], route[0][1], route[1][0], route[1][1]);
    cars.push(car);
  }

  const peds = [];
  for (let i = 0; i < CONFIG.PEDS.COUNT; i++) {
    // Sidewalk loop around a random block: 19.5 m from the block centre,
    // i.e. just off the curb, clear of building faces.
    const bcx = rng.pick(CONFIG.CITY.CENTRES);
    const bcz = rng.pick(CONFIG.CITY.CENTRES);
    const o = 19.5;
    const loop = [
      [bcx - o, bcz - o],
      [bcx + o, bcz - o],
      [bcx + o, bcz + o],
      [bcx - o, bcz + o],
    ];
    peds.push({
      id: `ped${i}`,
      x: loop[0][0],
      z: loop[0][1],
      angle: 0,
      speed: CONFIG.PEDS.WALK,
      hp: 100,
      isCop: false,
      isTaxiCustomer: false,
      state: 'walk',
      color: rng.pick(PED_COLORS),
      loop,
      loopIdx: 1,
      path: null,
      pathIdx: 0,
      flee: false,
      fleeT: 0,
      fleeFrom: null,
      bobPhase: rng.range(0, Math.PI * 2),
      downT: 0,
    });
  }
  return { cars, peds };
}

// Make every pedestrian within `radius` of (x, z) flee from that point.
export function scarePeds(state, x, z, radius) {
  for (const ped of state.peds) {
    if (ped.state === 'idle' && ped.downT > 0) continue; // already down
    const d = Math.hypot(ped.x - x, ped.z - z);
    if (d < radius) startFlee(state, ped, { x, z });
  }
}

// Start a flee: pick a point ~30 m away from the threat, A* there, and run.
export function startFlee(state, ped, from) {
  ped.flee = true;
  ped.fleeT = 6;
  ped.fleeFrom = { x: from.x, z: from.z };
  ped.state = 'flee';
  ped.speed = CONFIG.PEDS.FLEE;
  const dx = ped.x - from.x;
  const dz = ped.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  // Deterministic sideways jitter from the ped id (no Math.random: seeded
  // worlds must stay reproducible).
  const digit = ped.id.charCodeAt(3) || 0;
  const jitter = ((digit * 7) % 11) - 5;
  const tx = ped.x + (dx / d) * 30 + (-dz / d) * jitter;
  const tz = ped.z + (dz / d) * 30 + (dx / d) * jitter;
  const path = state.navGrid ? state.navGrid.findPath(ped.x, ped.z, tx, tz) : null;
  ped.path = path;
  ped.pathIdx = 0;
}

export function stepTraffic(state, dt, world, systems) {
  stepTrafficCars(state, dt, world);
  stepPeds(state, dt, world, systems);
}

function stepTrafficCars(state, dt, world) {
  for (const car of state.cars) {
    if (!car.isTraffic) continue;
    if (car.stalled || car.hp <= 0) {
      car.speed *= Math.max(0, 1 - 2.5 * dt);
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
      continue;
    }
    if (car.damageFlash > 0) car.damageFlash = Math.max(0, car.damageFlash - dt * 2);
    const route = car.route;
    if (!route || route.length === 0) continue;
    let target = route[car.routeIdx % route.length];
    let dx = target[0] - car.x;
    let dz = target[1] - car.z;
    let dist = Math.hypot(dx, dz);
    if (dist < 4) {
      car.routeIdx = (car.routeIdx + 1) % route.length;
      target = route[car.routeIdx % route.length];
      dx = target[0] - car.x;
      dz = target[1] - car.z;
      dist = Math.hypot(dx, dz);
    }
    // Steer toward the next waypoint (capped turn rate, no orbiting).
    const desired = angleTo(car.x, car.z, target[0], target[1]);
    const turn = wrapAngle(desired - car.angle);
    car.angle += Math.max(-1.6 * dt, Math.min(1.6 * dt, turn));

    // Stop at a red light when the next corner is an intersection ahead.
    // Moving along z = north/south bound (needs nsGreen); along x = east/west.
    let stopped = false;
    const alongZ = Math.abs(dz) > Math.abs(dx);
    if (dist < 14) {
      const green = nsGreen(state.time, target[0], target[1]);
      if ((alongZ && !green) || (!alongZ && green)) stopped = true;
    }
    // Yield to any car directly ahead (player included).
    if (!stopped) {
      const fx = Math.sin(car.angle);
      const fz = Math.cos(car.angle);
      for (const other of state.cars) {
        if (other === car) continue;
        const ox = other.x - car.x;
        const oz = other.z - car.z;
        const od = Math.hypot(ox, oz);
        if (od < 7 && od > 0.01 && (ox * fx + oz * fz) / od > 0.8) {
          stopped = true;
          break;
        }
      }
    }
    car.stopped = stopped;
    if (stopped) {
      car.speed = Math.max(0, car.speed - 12 * dt);
    } else if (car.speed < CONFIG.TRAFFIC.CRUISE) {
      car.speed = Math.min(CONFIG.TRAFFIC.CRUISE, car.speed + 6 * dt);
    } else {
      car.speed = Math.max(CONFIG.TRAFFIC.CRUISE, car.speed - 4 * dt);
    }
    const nx = car.x + Math.sin(car.angle) * car.speed * dt;
    const nz = car.z + Math.cos(car.angle) * car.speed * dt;
    const res = collideCircle(world.city, nx, nz, car.len * 0.4);
    car.x = res.x;
    car.z = res.z;
    collideCars(state, car, world);
  }
}

function stepPeds(state, dt, world, systems) {
  const player = state.player;
  const playerCar = !player.onFoot && player.car ? player.car : null;
  for (const ped of state.peds) {
    // Downed: lie still, then get back up (cops stay down).
    if (ped.state === 'idle' && ped.downT > 0) {
      ped.downT -= dt;
      ped.speed = 0;
      if (ped.downT <= 0 && !ped.isCop) {
        ped.state = 'walk';
        ped.speed = CONFIG.PEDS.WALK;
        ped.flee = false;
      }
      continue;
    }
    // Fleeing: follow the cached A* path, or run straight away.
    if (ped.flee) {
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) {
        ped.flee = false;
        ped.state = 'walk';
        ped.speed = CONFIG.PEDS.WALK;
        ped.path = null;
        ped.loopIdx = nearestLoopIdx(ped);
      } else {
        let tx;
        let tz;
        if (ped.path && ped.pathIdx < ped.path.length) {
          [tx, tz] = ped.path[ped.pathIdx];
          if (Math.hypot(tx - ped.x, tz - ped.z) < 1.5) {
            ped.pathIdx++;
            if (ped.pathIdx < ped.path.length) [tx, tz] = ped.path[ped.pathIdx];
          }
        }
        if (tx === undefined) {
          // No path (or finished): run straight away from the threat.
          const from = ped.fleeFrom || { x: player.x, z: player.z };
          const dx = ped.x - from.x;
          const dz = ped.z - from.z;
          const d = Math.hypot(dx, dz) || 1;
          tx = ped.x + (dx / d) * 5;
          tz = ped.z + (dz / d) * 5;
        }
        movePed(state, ped, tx, tz, CONFIG.PEDS.FLEE, dt, world);
        continue;
      }
    }
    // Walking the loop.
    const target = ped.loop[ped.loopIdx % ped.loop.length];
    if (Math.hypot(target[0] - ped.x, target[1] - ped.z) < 1.2) {
      ped.loopIdx = (ped.loopIdx + 1) % ped.loop.length;
    }
    const [tx, tz] = ped.loop[ped.loopIdx % ped.loop.length];
    movePed(state, ped, tx, tz, CONFIG.PEDS.WALK, dt, world);

    // Hit by the player's car at speed: knocked down, +1 heat.
    if (playerCar && Math.abs(playerCar.speed) > 3) {
      const d = Math.hypot(ped.x - playerCar.x, ped.z - playerCar.z);
      if (d < 2.5) {
        ped.hp = Math.max(0, ped.hp - 60);
        ped.state = 'idle';
        ped.downT = 3;
        ped.speed = 0;
        state.stats.pedsHit++;
        world.addHeat(CONFIG.WANTED.HEAT.HIT_PED, 'hit pedestrian');
        world.pushFeed('You hit a pedestrian!');
        state.events.push({ type: 'pedHit', x: ped.x, z: ped.z });
        // When they get up, they run.
        ped.flee = true;
        ped.fleeT = 6;
        ped.fleeFrom = { x: playerCar.x, z: playerCar.z };
        ped.path = null;
        ped.pathIdx = 0;
      }
    }
  }
}

function nearestLoopIdx(ped) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ped.loop.length; i++) {
    const d = Math.hypot(ped.loop[i][0] - ped.x, ped.loop[i][1] - ped.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function movePed(state, ped, tx, tz, speed, dt, world) {
  const dx = tx - ped.x;
  const dz = tz - ped.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  ped.angle = Math.atan2(dx, dz);
  ped.speed = speed;
  ped.bobPhase += dt * speed * 4;
  const nx = ped.x + (dx / d) * speed * dt;
  const nz = ped.z + (dz / d) * speed * dt;
  const res = collideCircle(world.city, nx, nz, 0.4);
  ped.x = res.x;
  ped.z = res.z;
}
