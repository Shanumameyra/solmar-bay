// SOLMAR BAY — traffic and pedestrians. Traffic cars follow rectangular
// loops around city blocks on the street centrelines, stop at red lights and
// yield to the car ahead; pedestrians walk sidewalk loops around their home
// block and flee from gunfire, wanted heat and honks. Peds navigate with the
// city's A* nav grid when they flee; traffic never needs the grid.
// Angle convention (shared with Worker B): forward = (sin angle, cos angle);
// angle = atan2(dx, dz).
// Light rule (shared with render.js): at any intersection the north-south
// streets are green while (time + phase) is in the first half of the cycle.
import { CONFIG } from './config.js';
import { createCar } from './vehicle.js';
import { collideCircle } from './city.js';

// Green for north-south traffic when this is true, else east-west is green.
export function nsGreen(time, sx, sz) {
  const phase = (Math.floor(sx / 48) + Math.floor(sz / 48)) % 2;
  const t = (time + phase * CONFIG.TRAFFIC.LIGHT_CYCLE * 0.5) % (CONFIG.TRAFFIC.LIGHT_CYCLE * 2);
  return t < CONFIG.TRAFFIC.LIGHT_CYCLE;
}

// A rectangular loop around one block: waypoints at the four corners,
// inset onto the street centrelines that border the block.
function blockLoop(bx, bz, rng) {
  const half = CONFIG.CITY.PITCH / 2; // 24 m from block centre to street centre
  const pts = [
    [bx - half, bz - half], [bx + half, bz - half],
    [bx + half, bz + half], [bx - half, bz + half],
  ];
  // Random starting corner + direction so loops do not sync up.
  const start = rng.int(4);
  const dir = rng.chance(0.5) ? 1 : -1;
  const ordered = [];
  for (let i = 0; i < 4; i += 1) {
    ordered.push(pts[(start + dir * i + 8) % 4]);
  }
  return ordered;
}

// A sidewalk loop around one block (peds walk the pavement, 8 m from centre).
function sidewalkLoop(bx, bz, rng) {
  const off = CONFIG.CITY.BLOCK / 2 + 1.5;
  const pts = [
    [bx - off, bz - off], [bx + off, bz - off],
    [bx + off, bz + off], [bx - off, bz + off],
  ];
  const start = rng.int(4);
  const dir = rng.chance(0.5) ? 1 : -1;
  const ordered = [];
  for (let i = 0; i < 4; i += 1) {
    ordered.push(pts[(start + dir * i + 8) % 4]);
  }
  return ordered;
}

export function createTraffic(city, rng) {
  const cars = [];
  const models = ['sedan', 'sedan', 'taxi', 'van', 'sedan', 'truck', 'sedan', 'van', 'taxi', 'sedan'];
  for (let i = 0; i < CONFIG.TRAFFIC.COUNT; i += 1) {
    // Pick a random block that is not the plaza / beach / port.
    let bx, bz;
    for (;;) {
      bx = rng.pick(CONFIG.CITY.CENTRES);
      bz = rng.pick(CONFIG.CITY.CENTRES);
      const d = city.districtAt(bx, bz);
      if (d !== 'plaza' && d !== 'beach' && d !== 'port') break;
    }
    const route = blockLoop(bx, bz, rng);
    const start = route[0];
    const next = route[1];
    const car = createCar(models[i % models.length], start[0], start[1],
      Math.atan2(next[0] - start[0], next[1] - start[1]),
      { id: `traffic-${i}`, isTraffic: true, driver: 'traffic', route, routeIdx: 1 });
    car.speed = CONFIG.TRAFFIC.CRUISE_SPEED * rng.range(0.8, 1.1);
    cars.push(car);
  }

  const peds = [];
  const pedColors = [0xd84a4a, 0x4a7ad8, 0x4ad87a, 0xd8b84a, 0x9a4ad8, 0xd88a4a, 0x4ad8d8, 0xe8e8e8];
  for (let i = 0; i < CONFIG.PEDS.COUNT; i += 1) {
    let bx, bz;
    for (;;) {
      bx = rng.pick(CONFIG.CITY.CENTRES);
      bz = rng.pick(CONFIG.CITY.CENTRES);
      const d = city.districtAt(bx, bz);
      if (d !== 'port') break;
    }
    const loop = sidewalkLoop(bx, bz, rng);
    const start = loop[0];
    peds.push({
      id: `ped-${i}`,
      x: start[0], z: start[1],
      angle: Math.atan2(loop[1][0] - start[0], loop[1][1] - start[1]),
      speed: CONFIG.PEDS.WALK_SPEED * rng.range(0.8, 1.2),
      hp: 100,
      isCop: false,
      state: 'walk',
      loop,
      loopIdx: 1,
      path: null,       // A* path while fleeing
      pathIdx: 0,
      flee: 0,          // seconds of fleeing left
      fleeT: 0,
      fleeFrom: null,
      color: pedColors[i % pedColors.length],
      bobPhase: rng.next() * Math.PI * 2,
    });
  }
  return { cars, peds };
}

function stepTrafficCar(car, dt, state, world) {
  const route = car.route;
  if (!route || route.length < 2) return;
  const target = route[car.routeIdx];
  const dx = target[0] - car.x, dz = target[1] - car.z;
  const d = Math.hypot(dx, dz);
  const wantAngle = Math.atan2(dx, dz);
  let diff = wantAngle - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.angle += diff * Math.min(1, 6 * dt);

  // Red light: stop before the next intersection when our axis is red.
  let wantStop = false;
  if (d < 14) {
    // Approaching a corner: the corner sits on an intersection.
    const onNsStreet = Math.abs(car.x - target[0]) < 1.5; // moving along z
    const green = nsGreen(state.time, target[0], target[1]);
    if ((onNsStreet && !green) || (!onNsStreet && green)) wantStop = true;
  }
  // Yield: stop behind the car ahead (player car included). Forward is
  // (sin angle, cos angle); right is (-cos angle, sin angle).
  for (const other of state.cars) {
    if (other === car) continue;
    const ox = other.x - car.x, oz = other.z - car.z;
    const ahead = ox * Math.sin(car.angle) + oz * Math.cos(car.angle);
    const side = Math.abs(-ox * Math.cos(car.angle) + oz * Math.sin(car.angle));
    if (ahead > 0 && ahead < CONFIG.TRAFFIC.STOP_DIST && side < 2.2) {
      wantStop = true;
      break;
    }
  }
  car.stopped = wantStop;
  const cruise = CONFIG.TRAFFIC.CRUISE_SPEED;
  const targetSpeed = wantStop ? 0 : cruise;
  car.speed += (targetSpeed - car.speed) * Math.min(1, 2.5 * dt);
  car.x += Math.sin(car.angle) * car.speed * dt;
  car.z += Math.cos(car.angle) * car.speed * dt;
  if (d < 2.5) car.routeIdx = (car.routeIdx + 1) % route.length;
}

function stepPed(ped, dt, state, world) {
  const city = world.city;
  if (ped.flee > 0) {
    ped.flee -= dt;
    ped.fleeT = Math.max(0, ped.flee);
    ped.state = 'flee';
    // Flee: A* away from the threat to a point 40 m off, repath rarely.
    if (!ped.path || ped.pathIdx >= ped.path.length) {
      const away = Math.atan2(ped.x - ped.fleeFrom.x, ped.z - ped.fleeFrom.z);
      const tx = ped.x + Math.sin(away) * 40;
      const tz = ped.z + Math.cos(away) * 40;
      const clamped = collideCircle(city, tx, tz, 1);
      ped.path = city.navGrid.findPath(ped.x, ped.z, clamped.x, clamped.z);
      ped.pathIdx = 0;
      if (!ped.path) { ped.flee = 0; }
    }
    if (ped.path && ped.pathIdx < ped.path.length) {
      const [tx, tz] = ped.path[ped.pathIdx];
      const dx = tx - ped.x, dz = tz - ped.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) { ped.pathIdx += 1; return; }
      ped.angle = Math.atan2(dx, dz);
      ped.speed = CONFIG.PEDS.FLEE_SPEED;
      ped.x += Math.sin(ped.angle) * ped.speed * dt;
      ped.z += Math.cos(ped.angle) * ped.speed * dt;
    }
    return;
  }
  // Downed peds: cops stay down (the story beat), civilians get back up
  // after downT — the field was set by combat.js but never read, so every
  // downed ped lay there forever.
  if (ped.state === 'down') {
    if (ped.isCop) return;
    ped.downT = (ped.downT ?? 20) - dt;
    if (ped.downT <= 0) {
      ped.state = 'walk';
      ped.hp = 50;
      ped.path = null;
      ped.flee = 0;
    }
    return;
  }
  ped.state = 'walk';
  // Flee trigger: gunfire nearby (a shot event) or wanted heat close by.
  const px = state.player.x, pz = state.player.z;
  const dp2 = (ped.x - px) * (ped.x - px) + (ped.z - pz) * (ped.z - pz);
  if (state.wanted > 0 && dp2 < CONFIG.PEDS.FLEE_RADIUS * CONFIG.PEDS.FLEE_RADIUS) {
    ped.flee = 3;
    ped.fleeT = 3;
    ped.fleeFrom = { x: px, z: pz };
    ped.path = null;
    return;
  }
  // Normal walk: follow the sidewalk loop.
  const target = ped.loop[ped.loopIdx];
  const dx = target[0] - ped.x, dz = target[1] - ped.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.5) {
    ped.loopIdx = (ped.loopIdx + 1) % ped.loop.length;
    return;
  }
  ped.angle = Math.atan2(dx, dz);
  ped.speed = CONFIG.PEDS.WALK_SPEED;
  ped.x += Math.sin(ped.angle) * ped.speed * dt;
  ped.z += Math.cos(ped.angle) * ped.speed * dt;
  ped.bobPhase += dt * 6;
}

export function stepTraffic(state, dt, world, systems = {}) {
  for (const car of state.cars) {
    // A traffic car the player is driving is owned by vehicle.js this step,
    // not by the traffic AI (its route resumes when the player gets out).
    if (car.isTraffic && car.driver !== 'player') stepTrafficCar(car, dt, state, world);
  }
  for (const ped of state.peds) stepPed(ped, dt, state, world);
  // Player car hitting a ped at speed: heat + the ped flees (no gore, just a shove).
  const pc = state.player.car;
  if (pc && Math.abs(pc.speed) > 3) {
    for (const ped of state.peds) {
      const dx = ped.x - pc.x, dz = ped.z - pc.z;
      if (dx * dx + dz * dz < 2.5 * 2.5) {
        ped.flee = 4;
        ped.fleeFrom = { x: pc.x, z: pc.z };
        if (state.wanted < CONFIG.WANTED.MAX_STARS) {
          world.addHeat(CONFIG.WANTED.HEAT.HIT_PED, 'hit a pedestrian');
          state.stats.pedsHit += 1;
        }
        // Shove the ped aside so it is not hit again next step.
        ped.x += (dx / (Math.hypot(dx, dz) || 1)) * 3;
        ped.z += (dz / (Math.hypot(dx, dz) || 1)) * 3;
      }
    }
  }
}
