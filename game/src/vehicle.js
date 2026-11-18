// Solmar Bay — arcade car physics + enter/steal (Worker A, v3 rebuild).
// Arcade, not simulation: instant-feeling accel, speed-sensitive steering,
// handbrake drift, forgiving collisions. Heading convention: forward =
// (sin(angle), 0, cos(angle)); angle 0 = +z (south), PI = -z (north).

import { CONFIG } from './config.js';
import { collideCircle } from './city.js';

let carSeq = 0;

// Full contract car shape (see NOTES.md). `opts` overrides fields:
// { id, color, isParked, isTraffic, isPolice, driver, route, routeIdx }.
export function createCar(model, x, z, angle, opts = {}) {
  const def = CONFIG.CAR_MODELS[model] || CONFIG.CAR_MODELS.sedan;
  const car = {
    id: opts.id || `car${carSeq++}`,
    kind: model,
    model,
    name: def.name,
    x,
    z,
    angle,
    speed: 0,
    steer: 0,
    hp: CONFIG.CAR.HP,
    maxHp: CONFIG.CAR.HP,
    topSpeed: opts.topSpeed || def.topSpeed,
    color: opts.color !== undefined ? opts.color : def.colors[0],
    len: def.len,
    wid: def.wid,
    hgt: def.hgt,
    isParked: !!opts.isParked,
    isTraffic: !!opts.isTraffic,
    isPolice: model === 'police' || !!opts.isPolice,
    lightBar: model === 'police' || !!opts.isPolice,
    driver: opts.driver || null, // 'player' | 'traffic' | 'police' | null
    route: opts.route || null,
    routeIdx: opts.routeIdx || 0,
    stopped: false,
    drift: 0,
    smoke: false,
    stalled: false,
    damageFlash: 0,
  };
  return car;
}

// Drive the player's car one fixed step.
// drive = { moveX (-1..1 steer), moveZ (-1..1: +1 accel, -1 brake/reverse),
//           run (handbrake), honk }.
export function stepCar(state, car, dt, drive, world, systems) {
  if (car.stalled || car.hp <= 0) {
    car.speed *= Math.max(0, 1 - 2.5 * dt);
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
    car.smoke = true;
  } else {
    const top = car.topSpeed;
    const speedAbs = Math.abs(car.speed);
    // Steering: full lock at low speed, easing off as speed rises.
    const maxSteer = 0.55 / (1 + speedAbs * 0.045);
    const targetSteer = (drive.moveX || 0) * maxSteer;
    car.steer += (targetSteer - car.steer) * Math.min(1, dt * 8);
    // Throttle / brake / reverse.
    if (drive.moveZ > 0) {
      car.speed += CONFIG.CAR.ACCEL * dt * (car.speed < 0 ? 1.6 : 1);
    } else if (drive.moveZ < 0) {
      if (car.speed > 0.5) car.speed -= CONFIG.CAR.BRAKE * dt;
      else car.speed -= CONFIG.CAR.REVERSE * dt;
    } else {
      // Rolling drag.
      car.speed -= car.speed * 0.6 * dt;
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
    }
    if (car.speed > top) car.speed = top;
    if (car.speed < -CONFIG.CAR.REVERSE) car.speed = -CONFIG.CAR.REVERSE;
    // Handbrake drift: loose rear, faster yaw, speed bleed, tire smoke flag.
    if (drive.run && speedAbs > 5) {
      car.drift = Math.min(1, car.drift + dt * 2.5);
      car.speed *= Math.max(0, 1 - 0.35 * dt);
    } else {
      car.drift = Math.max(0, car.drift - dt * 3);
    }
    car.smoke = car.hp < 35;
  }
  if (car.damageFlash > 0) car.damageFlash = Math.max(0, car.damageFlash - dt * 2);

  // Yaw: bicycle-ish turn rate, sharper while drifting, reversed in reverse.
  const turnRate = car.steer * (car.speed / (car.len * 0.9)) * (car.drift > 0.3 ? 1.6 : 1);
  car.angle += turnRate * dt * (car.speed >= 0 ? 1 : -1);

  // Integrate + collide with buildings / sea / bounds.
  const nx = car.x + Math.sin(car.angle) * car.speed * dt;
  const nz = car.z + Math.cos(car.angle) * car.speed * dt;
  const res = collideCircle(world.city, nx, nz, car.len * 0.42);
  if (res.hit && Math.abs(car.speed) > 1) {
    const impact = Math.abs(car.speed);
    if (impact > 8) damageCar(state, car, impact * 0.8, world);
    car.speed *= impact > 8 ? -0.25 : 0.4;
  }
  car.x = res.x;
  car.z = res.z;

  // Collide with other cars.
  collideCars(state, car, world);

  // Mirror onto the player when this is the player's car.
  if (car.driver === 'player') {
    const p = state.player;
    p.speed = car.speed;
    p.x = car.x;
    p.z = car.z;
    p.heading = car.angle;
    state.stats.distanceDriven += Math.abs(car.speed) * dt;
  }
}

// Resolve overlap between `car` and every other car in state.cars.
// A parked (braked) car is never shoved — the moving car takes the full
// push. Hard impacts damage both cars.
export function collideCars(state, car, world) {
  let hitAny = false;
  for (const other of state.cars) {
    if (other === car) continue;
    const dx = car.x - other.x;
    const dz = car.z - other.z;
    const minD = (car.len + other.len) * 0.5 * 0.82;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const push = minD - d;
    const nx = dx / d;
    const nz = dz / d;
    if (other.isParked) {
      car.x += nx * push;
      car.z += nz * push;
    } else {
      car.x += nx * push * 0.5;
      car.z += nz * push * 0.5;
      other.x -= nx * push * 0.5;
      other.z -= nz * push * 0.5;
    }
    const relSpeed = Math.abs(car.speed - (other.speed || 0));
    if (relSpeed > 6) {
      damageCar(state, car, relSpeed * 1.2, world);
      if (!other.isParked) damageCar(state, other, relSpeed * 0.8, world);
      car.speed *= 0.6;
    }
    hitAny = true;
  }
  return hitAny;
}

// Damage a car. Pushes {type:'carDamage'} when the driver is the player.
export function damageCar(state, car, amount, world) {
  if (!car || car.hp <= 0) return;
  car.hp = Math.max(0, car.hp - amount);
  car.damageFlash = 0.3;
  if (car.hp <= 0) {
    car.stalled = true;
    car.smoke = true;
  }
  if (car.driver === 'player') {
    state.events.push({ type: 'carDamage', amount });
    state.shakeTrauma = Math.min(1, (state.shakeTrauma || 0) + 0.2);
  }
}

// Put the player in the driver's seat. The car stops being parked/traffic.
export function enterCar(state, car) {
  const p = state.player;
  p.onFoot = false;
  p.inCar = true;
  p.car = car;
  p.carId = car.id;
  car.driver = 'player';
  car.isParked = false;
  car.isTraffic = false;
  car.stopped = false;
  p.x = car.x;
  p.z = car.z;
  p.heading = car.angle;
  p.speed = car.speed;
}

// Step out beside the car (driver's side, collision-resolved).
export function exitCar(state) {
  const p = state.player;
  const car = p.car;
  if (!car) {
    p.onFoot = true;
    p.inCar = false;
    return;
  }
  // Step out to the car's right side.
  const rx = Math.cos(car.angle);
  const rz = -Math.sin(car.angle);
  const px = car.x + rx * (car.wid / 2 + 0.7);
  const pz = car.z + rz * (car.wid / 2 + 0.7);
  const res = collideCircle({ colliders: state.colliders }, px, pz, 0.5);
  p.x = res.x;
  p.z = res.z;
  p.heading = car.angle;
  p.yaw = car.angle;
  p.speed = 0;
  p.onFoot = true;
  p.inCar = false;
  p.car = null;
  p.carId = null;
  car.driver = null;
  car.isParked = true;
  state.events.push({ type: 'exitCar', carId: car.id });
}

// Steal a parked car. Heat rises only if someone sees it: a police car
// within 60 m is +2, otherwise a pedestrian within 25 m is +1.
export function stealCar(state, car, world, systems) {
  state.stats.carsStolen++;
  let heat = 0;
  let reason = '';
  const policeNear = state.cars.some(
    (c) => c.isPolice && Math.hypot(c.x - car.x, c.z - car.z) < 60,
  );
  if (policeNear) {
    heat = CONFIG.WANTED.HEAT.STEAL_POLICE;
    reason = 'steal seen by police';
  } else {
    const pedNear = state.peds.some(
      (pd) => Math.hypot(pd.x - car.x, pd.z - car.z) < 25,
    );
    if (pedNear) {
      heat = CONFIG.WANTED.HEAT.STEAL_WITNESSED;
      reason = 'steal witnessed';
    }
  }
  if (heat > 0) world.addHeat(heat, reason);
  world.pushFeed('Car stolen!');
  state.events.push({ type: 'steal', carId: car.id, heat });
  enterCar(state, car);
}
