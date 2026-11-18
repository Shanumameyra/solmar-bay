// Solmar Bay — on-foot controller (Worker A, v2 rebuild).
// WASD relative to the camera yaw, Shift to run, mouse look, E to
// enter/exit (steal when parked), H to honk. While driving, the player's
// x/z/heading sync to the car every step so the minimap, the HUD objective
// distance and the mission triggers all track the car, not the entry point.

import { CONFIG } from './config.js';
import { collideCircle } from './city.js';
import { enterCar, exitCar, stealCar } from './vehicle.js';
import { scarePeds } from './traffic.js';

export function createPlayer(spawn) {
  const angle = spawn.angle !== undefined ? spawn.angle : Math.PI;
  return {
    x: spawn.x,
    z: spawn.z,
    heading: angle,
    yaw: angle,
    pitch: 0,
    speed: 0,
    hp: CONFIG.PLAYER.HEALTH,
    maxHp: CONFIG.PLAYER.HEALTH,
    onFoot: true,
    inCar: false,
    car: null,
    carId: null,
    weapon: 'fists',
    ammo: 0,
    reserveAmmo: 0,
    invuln: 0,
    moving: false,
    enterT: 0,
  };
}

// drive = { moveX, moveZ, run, lookDX, lookDY, enter, honk } (from
// world.translateInput). Combat (punch/shoot) lives in combat.js, which
// reads the raw input; this module only moves the body.
export function stepPlayer(state, drive, dt, world, systems) {
  const p = state.player;
  if (p.invuln > 0) p.invuln -= dt;
  if (p.enterT > 0) p.enterT -= dt;

  // Driving: stay glued to the car; E steps out.
  if (!p.onFoot) {
    if (p.car) {
      p.x = p.car.x;
      p.z = p.car.z;
      p.heading = p.car.angle;
      p.speed = p.car.speed;
      p.yaw = p.car.angle;
    }
    if (drive.enter && p.enterT <= 0) {
      exitCar(state);
      p.enterT = 0.4;
    }
    return;
  }

  // Mouse look. Right turns right (yaw decreases).
  p.yaw -= (drive.lookDX || 0) * 0.0026;
  p.pitch = Math.max(-1.2, Math.min(1.2, p.pitch - (drive.lookDY || 0) * 0.0026));

  // WASD relative to yaw. Diagonals are normalised so they are not faster.
  let mx = drive.moveX || 0;
  let mz = drive.moveZ || 0;
  const mLen = Math.hypot(mx, mz);
  if (mLen > 1) {
    mx /= mLen;
    mz /= mLen;
  }
  const speed = drive.run ? CONFIG.PLAYER.RUN : CONFIG.PLAYER.WALK;
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const vx = (fx * mz + rx * mx) * speed;
  const vz = (fz * mz + rz * mx) * speed;
  p.moving = mLen > 0.1;
  p.speed = p.moving ? speed : 0;
  if (p.moving) p.heading = Math.atan2(vx, vz);

  // Integrate, then resolve against buildings (circle) and cars (oriented
  // box, so the player can walk along a long truck's door and step out
  // cleanly instead of being pushed by a fat circle).
  let nx = p.x + vx * dt;
  let nz = p.z + vz * dt;
  const res = collideCircle(world.city, nx, nz, 0.5);
  nx = res.x;
  nz = res.z;
  for (const car of state.cars) {
    const dx = nx - car.x;
    const dz = nz - car.z;
    const sin = Math.sin(car.angle);
    const cos = Math.cos(car.angle);
    const localU = dx * sin + dz * cos; // along the car's length
    const localV = dx * cos - dz * sin; // across its width
    const halfL = car.len / 2 + 0.4;
    const halfW = car.wid / 2 + 0.4;
    if (Math.abs(localU) < halfL && Math.abs(localV) < halfW) {
      const penU = halfL - Math.abs(localU);
      const penV = halfW - Math.abs(localV);
      if (penU < penV) {
        const s = localU >= 0 ? 1 : -1;
        nx += sin * s * penU;
        nz += cos * s * penU;
      } else {
        const s = localV >= 0 ? 1 : -1;
        nx += cos * s * penV;
        nz += -sin * s * penV;
      }
    }
  }
  p.x = nx;
  p.z = nz;

  // E: enter the nearest car (steal it if it is parked).
  if (drive.enter && p.enterT <= 0) {
    const car = world.nearestCar(p.x, p.z, CONFIG.PLAYER.ENTER_RANGE);
    if (car) {
      if (car.isParked) stealCar(state, car, world, systems);
      else enterCar(state, car);
      p.enterT = 0.4;
    }
  }

  // H: honk — nearby pedestrians flee.
  if (drive.honk) {
    scarePeds(state, p.x, p.z, 25);
    state.events.push({ type: 'honk', x: p.x, z: p.z });
  }
}
