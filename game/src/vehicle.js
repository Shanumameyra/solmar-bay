// vehicle.js — Solmar Bay: cars and arcade driving physics.
// One car = a plain state object; updateVehicle() steps it with the same
// speed * dt discipline as the player (1 unit = 1 metre, dt in seconds).
// Arcade model: a forward speed plus a heading, steering that weakens with
// speed, lateral grip that bleeds off in a handbrake drift, and damage that
// smokes then stalls the car. No three.js here — render.js draws cars from
// this state. No DOM — safe to import from Node tests.

import { CAR, CAR_TYPES, WORLD_HALF } from './config.js';
import { collideCircle } from './city.js';

export const CAR_LENGTH = CAR.length;   // 4.4 m
export const CAR_WIDTH = CAR.width;     // 2.0 m

let nextCarId = 1;

/**
 * Create a car.
 *   type: key of CAR_TYPES ('sedan' | 'coupe' | 'sports' | 'taxi' |
 *         'van' | 'truck' | 'police')
 *   x, z: position in metres; heading: radians, 0 = facing +z.
 *   opts: { stolen, parked, color, driver }
 */
export function createVehicle(type, x, z, heading = 0, opts = {}) {
  const def = CAR_TYPES[type] || CAR_TYPES.sedan;
  return {
    id: nextCarId++,
    type,
    label: def.label,
    color: opts.color !== undefined ? opts.color : def.color,
    x, z,
    heading,
    speed: 0,            // forward speed, m/s (negative = reversing)
    steer: 0,            // current steering angle, radians
    topSpeed: def.topSpeed,
    accel: def.accel,
    hp: CAR.hp,
    maxHp: CAR.hp,
    smoking: false,      // hp < 40
    stalled: false,      // hp <= 0
    parked: !!opts.parked,
    stolen: !!opts.stolen,
    driver: opts.driver || null, // 'player' | 'traffic' | 'police' | null
    honkUntil: 0,        // world time until which the horn sounds
    brakeLight: false,
    drift: 0,            // 0..1 how much the car is sliding sideways
    spin: 0,             // lateral slide velocity, m/s
  };
}

/** Reset the car id counter (used when a fresh world is built). */
export function resetVehicleIds() { nextCarId = 1; }

/**
 * Step one car for a frame.
 *   input: { throttle: -1..1 (W = +1 accel, S = -1 brake/reverse),
 *            steer: -1..1 (A = -1 left, D = +1 right),
 *            handbrake: bool (Shift) }
 *   dt: seconds. city: for building collision. others: other cars to
 *   collide with (each {x, z} plus optional radius) — may be [].
 *   onCollision: optional fn(car, other, impactSpeed) for damage / sfx.
 * Returns nothing; mutates car.
 */
export function updateVehicle(car, input, dt, city, others = [], onCollision = null) {
  if (car.stalled) {
    // A stalled car just rolls to a stop.
    car.speed = approach(car.speed, 0, CAR.rollDrag * 4 * dt);
    moveCar(car, dt, city, others, onCollision);
    return;
  }

  const throttle = clamp(input.throttle || 0, -1, 1);
  const steerInput = clamp(input.steer || 0, -1, 1);
  const handbrake = !!input.handbrake;

  // ---- longitudinal: accel / brake / reverse ------------------------------
  if (throttle > 0) {
    if (car.speed < 0) {
      // still rolling backwards: throttle brakes first
      car.speed += CAR.brake * throttle * dt;
    } else {
      car.speed += car.accel * throttle * dt;
    }
  } else if (throttle < 0) {
    if (car.speed > 0.5) {
      car.speed += CAR.brake * throttle * dt; // braking (throttle is negative)
    } else {
      car.speed += CAR.reverseAccel * throttle * dt; // reversing
    }
  }

  // Drag + rolling resistance, then clamp to the car's limits.
  const drag = CAR.drag * 0.003 * car.speed * Math.abs(car.speed)
    + CAR.rollDrag * Math.sign(car.speed);
  car.speed -= drag * dt;
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
  car.speed = clamp(car.speed, -CAR.reverseTopSpeed, car.topSpeed);

  // ---- steering: weaker at speed, smoothed ---------------------------------
  const speedFactor = 1 - Math.min(1, Math.abs(car.speed) / car.topSpeed) * 0.78;
  const targetSteer = steerInput * (CAR.maxSteer * speedFactor +
    CAR.steerAtSpeed * (1 - speedFactor));
  car.steer += (targetSteer - car.steer) * Math.min(1, 10 * dt);
  car.heading += (car.speed / CAR_LENGTH) * Math.tan(car.steer) * dt;

  // ---- drift: handbrake cuts grip, builds lateral slide --------------------
  const grip = handbrake ? CAR.handbrakeGrip : CAR.grip;
  const targetDrift = handbrake && Math.abs(car.speed) > 6 ? 1 : 0;
  car.drift += (targetDrift - car.drift) * Math.min(1, 4 * dt);
  car.spin += ((steerInput * Math.abs(car.speed) * 0.35 * car.drift) - car.spin)
    * Math.min(1, grip * dt);
  car.brakeLight = throttle < 0 || handbrake;

  moveCar(car, dt, city, others, onCollision);
}

/** Integrate position + resolve building / car collisions. */
function moveCar(car, dt, city, others, onCollision) {
  const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
  // Forward motion plus lateral slide (drift).
  const fwdX = sin * car.speed * dt;
  const fwdZ = cos * car.speed * dt;
  const latX = cos * car.spin * dt;
  const latZ = -sin * car.spin * dt;
  const nx = car.x + fwdX + latX;
  const nz = car.z + fwdZ + latZ;

  // Buildings: slide along them (resolve per axis like the player).
  const afterX = collideCircle(nx, car.z, CAR.radius, city);
  const afterZ = collideCircle(afterX.x, nz, CAR.radius, city);
  const hitWall = Math.abs(afterZ.x - nx) > 0.01 || Math.abs(afterZ.z - nz) > 0.01;
  if (hitWall) {
    const impact = Math.abs(car.speed);
    if (impact > 6) damageCar(car, (impact - 6) * 1.5, onCollision, null);
    car.speed *= 0.55; // scrub speed on a wall hit
    car.spin *= 0.4;
  }
  car.x = afterX.x;
  car.z = afterZ.z;

  // Car-vs-car: soft push-apart + damage on hard hits.
  for (const other of others) {
    if (other === car || other.id === car.id) continue;
    const dx = car.x - other.x, dz = car.z - other.z;
    const min = CAR.radius * 2;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const ux = dx / d, uz = dz / d;
      car.x += ux * push;
      car.z += uz * push;
      if (other.speed !== undefined) {
        other.x -= ux * push;
        other.z -= uz * push;
      }
      const impact = Math.abs(car.speed - (other.speed || 0));
      if (impact > 5) {
        damageCar(car, (impact - 5) * 1.2, onCollision, other);
        if (other.hp !== undefined) damageCar(other, (impact - 5) * 1.2, onCollision, car);
        car.speed *= 0.7;
      }
    }
  }

  // Stay inside the world.
  car.x = clamp(car.x, -WORLD_HALF + 2, WORLD_HALF - 2);
  car.z = clamp(car.z, -WORLD_HALF + 2, WORLD_HALF - 2);
}

/**
 * Damage a car. At hp <= 40 it smokes; at 0 it stalls. Returns true when
 * the car just stalled. onCollision(car, source, amount) is called for sfx.
 */
export function damageCar(car, amount, onCollision = null, source = null) {
  if (car.stalled || amount <= 0) return false;
  car.hp = Math.max(0, car.hp - amount);
  if (car.hp <= 40) car.smoking = true;
  if (onCollision) onCollision(car, source, amount);
  if (car.hp <= 0) {
    car.stalled = true;
    car.speed = 0;
    return true;
  }
  return false;
}

/** Repair a car (garage / respawn). */
export function repairCar(car) {
  car.hp = car.maxHp;
  car.smoking = false;
  car.stalled = false;
}

/** Speed in km/h for the HUD. */
export function carSpeedKmh(car) {
  return Math.abs(car.speed) * 3.6;
}

/** The driver's-side door position (where the player stands to enter). */
export function doorPosition(car) {
  const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
  return { x: car.x - cos * 1.6, z: car.z + sin * 1.6 };
}

/** Nearest car to (x, z) within maxDist, or null. */
export function nearestVehicle(x, z, vehicles, maxDist = 4) {
  let best = null, bestD = maxDist;
  for (const v of vehicles) {
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

/** Nearest PARKED (stealable) car to (x, z) within maxDist, or null. */
export function nearestParkedCar(x, z, vehicles, maxDist = 4) {
  let best = null, bestD = maxDist;
  for (const v of vehicles) {
    if (!v.parked) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

/** Mark a car stolen: it stops being parked and belongs to the player. */
export function stealCar(car) {
  car.parked = false;
  car.stolen = true;
  car.driver = 'player';
  return car;
}

/** Honk: sets honkUntil so the renderer / audio can show it. */
export function honk(car, now, duration = 0.5) {
  car.honkUntil = now + duration;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

export default createVehicle;
