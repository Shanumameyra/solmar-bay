// SOLMAR BAY — cars. Arcade physics on the ground plane (x, z, angle):
// accel/brake/reverse, speed-sensitive steering, handbrake drift, collision
// with building AABBs and other cars (circle test), damage + smoke/stall.
// Angle convention (shared with Worker B): forward = (sin angle, cos angle);
// angle 0 = +z (south), PI = -z (north). Turning right (D) DECREASES the
// angle. Six models built from boxes by render.js; this file only owns the
// numbers. enterCar / exitCar / stealCar are the player-facing verbs; stealing
// in view of a ped or the police raises wanted through world.addHeat (which
// routes through systems.police when it exists).
import { CONFIG } from './config.js';
import { collideCircle } from './city.js';

let nextId = 1;

export function createCar(model, x, z, angle, opts = {}) {
  const spec = CONFIG.CAR_MODELS[model] || CONFIG.CAR_MODELS.sedan;
  return {
    id: opts.id || `car-${nextId++}`,
    kind: model,        // B's name for the model ('sedan' | 'sports' | ...)
    model,              // same value, kept for readability
    name: spec.name,
    x, z,
    angle,              // radians; forward = (sin angle, cos angle)
    speed: 0,           // signed m/s along the forward vector
    steer: 0,           // current steering angle
    hp: CONFIG.CAR.HP,
    maxHp: CONFIG.CAR.HP,
    topSpeed: opts.topSpeed || spec.top,
    color: opts.color || spec.color,
    len: spec.len,
    wid: spec.wid,
    hgt: spec.hgt,
    isParked: !!opts.isParked,
    isTraffic: !!opts.isTraffic,
    isPolice: !!opts.isPolice,
    lightBar: !!opts.isPolice,
    driver: opts.driver || null, // 'player' | 'traffic' | 'police' | null
    route: opts.route || null,   // traffic waypoint loop [[x,z],...]
    routeIdx: opts.routeIdx || 0,
    stopped: false,     // traffic: waiting at a light / behind a car
    drift: 0,           // 0..1 handbrake drift amount (for smoke + render)
    smoke: false,       // hp low -> smoke
    stalled: false,
    damageFlash: 0,
  };
}

// One fixed step for a car the PLAYER drives. input: { moveZ (W/S: +1 accel,
// -1 brake/reverse), moveX (A/D: -1..1 steer), run (handbrake) }.
export function stepCar(car, input, dt, world, isPlayer) {
  const C = CONFIG.CAR;
  if (car.damageFlash > 0) car.damageFlash = Math.max(0, car.damageFlash - dt);
  if (car.stalled) {
    car.speed *= Math.max(0, 1 - 2 * dt);
    return;
  }
  const throttle = input ? (input.moveZ || 0) : 0;
  const steerIn = input ? (input.moveX || 0) : 0;
  const handbrake = !!(input && input.run);

  // Longitudinal: accel / brake / reverse / drag.
  if (throttle > 0) {
    car.speed += C.ACCEL * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 0.5) car.speed -= C.BRAKE * dt;      // braking
    else car.speed -= C.ACCEL * 0.6 * dt;                // reversing
  } else {
    car.speed -= car.speed * 0.6 * dt;                   // rolling drag
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }
  const top = car.topSpeed;
  if (car.speed > top) car.speed = top;
  if (car.speed < -C.REVERSE_TOP) car.speed = -C.REVERSE_TOP;

  // Steering: less angle at speed, plus handbrake drift yaw. Turning right
  // (steerIn > 0) decreases the angle under the (sin, cos) convention.
  const speedRatio = Math.min(1, Math.abs(car.speed) / top);
  const maxSteer = C.STEER_MAX + (C.STEER_SPEED - C.STEER_MAX) * speedRatio;
  const targetSteer = steerIn * maxSteer;
  car.steer += (targetSteer - car.steer) * Math.min(1, 10 * dt);
  const dir = car.speed >= 0 ? 1 : -1;
  let yawRate = (car.speed / Math.max(2.2, car.len)) * Math.tan(car.steer) * dir;
  car.drift = 0;
  if (handbrake && Math.abs(car.speed) > 6) {
    yawRate += steerIn * C.HANDBRAKE_DRIFT * 0.9;
    car.speed *= Math.max(0, 1 - 0.5 * dt);
    car.drift = Math.min(1, Math.abs(car.speed) / 20);
  }
  car.angle -= yawRate * dt;

  // Integrate, then resolve building + car collisions.
  const nx = car.x + Math.sin(car.angle) * car.speed * dt;
  const nz = car.z + Math.cos(car.angle) * car.speed * dt;
  const r = Math.max(car.len, car.wid) / 2;
  const resolved = collideCircle(world.city, nx, nz, r * 0.82);
  if (resolved.x !== nx || resolved.z !== nz) {
    // Hit a building: lose speed, take damage, bounce slightly.
    if (Math.abs(car.speed) > 4) damageCar(car, C.DAMAGE_PER_HIT, world);
    car.speed *= 0.45;
  }
  car.x = resolved.x;
  car.z = resolved.z;
  collideCars(car, world);
  if (car.hp <= C.SMOKE_HP) car.smoke = true;
  if (car.hp <= C.STALL_HP) { car.stalled = true; car.smoke = true; }
}

// Circle-vs-circle push between this car and every other car.
export function collideCars(car, world) {
  for (const other of world.state.cars) {
    if (other === car) continue;
    const dx = car.x - other.x;
    const dz = car.z - other.z;
    const minD = (car.len + other.len) / 2 * 0.78;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const push = (minD - d) / 2;
    const ux = dx / d, uz = dz / d;
    car.x += ux * push;
    car.z += uz * push;
    other.x -= ux * push;
    other.z -= uz * push;
    const impact = Math.abs(car.speed - other.speed);
    if (impact > 3) {
      damageCar(car, CONFIG.CAR.DAMAGE_PER_HIT * 0.5, world);
      damageCar(other, CONFIG.CAR.DAMAGE_PER_HIT * 0.5, world);
      car.speed *= 0.6;
      other.speed *= 0.6;
    }
  }
}

export function damageCar(car, amount, world) {
  if (car.hp <= 0) return;
  car.hp = Math.max(0, car.hp - amount);
  car.damageFlash = 0.25;
  if (world && car.driver === 'player') {
    world.state.events.push({ type: 'carDamage', text: `Car HP ${car.hp}`, t: world.state.time });
  }
}

// Player walks to the driver's door and gets in. Returns the car or null.
// A moving traffic car keeps its speed — the player takes over mid-roll.
export function enterCar(player, car, world) {
  if (!car || player.car) return null;
  player.car = car;
  player.carId = car.id;
  player.inCar = true;
  player.onFoot = false;
  car.driver = 'player';
  car.isParked = false;
  // Snap the player into the seat (render hides the on-foot mesh); aim the
  // camera with the car.
  player.x = car.x;
  player.z = car.z;
  player.yaw = car.angle;
  player.heading = car.angle;
  return car;
}

// Player gets out next to the car.
export function exitCar(player, world) {
  const car = player.car;
  if (!car) return null;
  player.car = null;
  player.carId = null;
  player.inCar = false;
  player.onFoot = true;
  car.driver = null;
  car.speed = 0;
  // Step out to the driver's side (left of the forward vector).
  const side = car.angle + Math.PI / 2;
  const px = car.x + Math.sin(side) * 1.6;
  const pz = car.z + Math.cos(side) * 1.6;
  const resolved = collideCircle(world.city, px, pz, CONFIG.PLAYER.RADIUS);
  player.x = resolved.x;
  player.z = resolved.z;
  player.yaw = car.angle;
  player.heading = car.angle;
  player.speed = 0;
  return car;
}

// Steal a parked car: get in, and raise wanted when someone sees it.
// Police cars live in state.cars (isPolice); peds in state.peds.
export function stealCar(player, car, world) {
  if (!car || !car.isParked) return null;
  const entered = enterCar(player, car, world);
  if (!entered) return null;
  world.state.stats.carsStolen += 1;
  // Witnesses: a police car nearby, or a pedestrian in view.
  const policeNear = world.state.cars.some((c) => {
    if (!c.isPolice || c === car) return false;
    const dx = c.x - car.x, dz = c.z - car.z;
    return dx * dx + dz * dz < 60 * 60;
  });
  const pedNear = world.state.peds.some((p) => {
    const dx = p.x - car.x, dz = p.z - car.z;
    return dx * dx + dz * dz < 25 * 25;
  });
  if (policeNear) {
    world.addHeat(CONFIG.WANTED.HEAT.STEAL_POLICE, 'steal seen by police');
  } else if (pedNear) {
    world.addHeat(CONFIG.WANTED.HEAT.STEAL_WITNESSED, 'steal witnessed');
  }
  world.pushFeed(`Stole a ${car.name}.`);
  return entered;
}
