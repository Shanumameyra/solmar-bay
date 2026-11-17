// SOLMAR BAY — the player on foot. Consumes the NORMALIZED drive input
// from world.step: { moveX, moveZ, run, lookDX, lookDY, enter, honk }.
// WASD moves relative to the camera yaw, Shift runs, mouse look turns the
// camera (pointer lock), E enters/exits the nearest car, H honks.
// Angle convention (shared with Worker B): forward = (sin a, cos a);
// angle 0 = +z (south), PI = -z (north). The player's `yaw` is the camera /
// aim direction; `heading` is the smoothed facing used by the renderer.
// Combat (punch / shoot / reload / weapon switch) belongs to combat.js,
// which reads the raw input's justPressed set itself — this file never
// touches it, so a shot is never counted twice.
// Collision with building AABBs and cars is resolved here.
import { CONFIG } from './config.js';
import { collideCircle } from './city.js';
import { enterCar, exitCar, stealCar } from './vehicle.js';

export function createPlayer(spawn) {
  const angle = spawn.angle !== undefined ? spawn.angle : (spawn.heading || 0);
  return {
    x: spawn.x,
    z: spawn.z,
    heading: angle,     // smoothed facing (same convention as yaw)
    yaw: angle,         // camera / aim direction
    pitch: -0.08,
    speed: 0,
    hp: CONFIG.PLAYER.HEALTH,
    maxHp: CONFIG.PLAYER.HEALTH,
    onFoot: true,
    inCar: false,       // B's flag (mirror of !onFoot)
    car: null,          // car object (A's reference)
    carId: null,        // B's reference (missions/police/combat read this)
    weapon: 'fists',    // mirrored by combat.js each step
    ammo: 0,
    reserveAmmo: 0,
    invuln: 0,
    moving: false,
    enterT: 0,          // door-open beat timer
  };
}

// One fixed step for the player. When the player is in a car, the car's own
// step (vehicle.js, called from world.js) owns movement; this only handles
// the E-to-exit edge here.
export function stepPlayer(state, input, dt, world, systems = {}) {
  const p = state.player;
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

  // Mouse look always applies (on foot and in the car). Mouse right turns
  // right, so yaw decreases (forward = (sin yaw, cos yaw): turning right
  // from south (+z) faces west (-x), i.e. yaw 0 -> -PI/2).
  if (input.lookDX || input.lookDY) {
    p.yaw -= (input.lookDX || 0) * 0.0026;
    p.pitch = Math.max(-1.2, Math.min(0.6, p.pitch - (input.lookDY || 0) * 0.0026));
  }

  if (!p.onFoot) {
    // Driving: the player's map position IS the car's. Without this sync,
    // player.x/z stays at the entry point while the car drives away, so the
    // minimap arrow, the HUD objective distance and the mission marker
    // distances all freeze (and the café trigger could never fire from a
    // car). Heading follows the car too, so exiting faces the car's way.
    if (p.car) {
      p.x = p.car.x;
      p.z = p.car.z;
      p.heading = p.car.angle;
    }
    // E exits the car (with a short door beat so it cannot spam).
    if (input.enter && p.enterT === 0) {
      p.enterT = CONFIG.CAR.ENTER_TIME;
      exitCar(p, world);
    }
    if (p.enterT > 0) p.enterT = Math.max(0, p.enterT - dt);
    return;
  }

  // ---- On foot: WASD relative to camera yaw ----
  const mx = input.moveX || 0;
  const mz = input.moveZ || 0;
  const running = !!input.run;
  const targetSpeed = (mx !== 0 || mz !== 0)
    ? (running ? CONFIG.PLAYER.RUN_SPEED : CONFIG.PLAYER.WALK_SPEED)
    : 0;
  // Accelerate toward the target speed (snappy, arcade feel).
  p.speed += (targetSpeed - p.speed) * Math.min(1, 12 * dt);
  p.moving = p.speed > 0.3;

  if (p.speed > 0.01) {
    // Forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw).
    // moveZ: +1 = forward (W), moveX: +1 = right (D). W alone walks exactly
    // along the camera yaw, so heading == yaw when walking forward.
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fx = sin * mz - cos * mx;
    const fz = cos * mz + sin * mx;
    const len = Math.hypot(fx, fz) || 1;
    const nx = p.x + (fx / len) * p.speed * dt;
    const nz = p.z + (fz / len) * p.speed * dt;
    const resolved = collideCircle(world.city, nx, nz, CONFIG.PLAYER.RADIUS);
    // Soft car collision: slide around parked/traffic cars.
    let rx = resolved.x, rz = resolved.z;
    for (const car of state.cars) {
      const dx = rx - car.x, dz = rz - car.z;
      const minD = (car.len / 2) + CONFIG.PLAYER.RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        rx = car.x + (dx / d) * minD;
        rz = car.z + (dz / d) * minD;
      }
    }
    p.x = rx;
    p.z = rz;
    // Face the movement direction (smooth turn). Angle = atan2(dx, dz).
    const wantHeading = Math.atan2(fx, fz);
    let diff = wantHeading - p.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.heading += diff * Math.min(1, 14 * dt);
  }

  // ---- E: enter / steal the nearest car ----
  if (input.enter && p.enterT === 0) {
    const car = world.nearestCar(p.x, p.z, CONFIG.PLAYER.ENTER_RANGE);
    if (car) {
      p.enterT = CONFIG.CAR.ENTER_TIME;
      if (car.isParked) stealCar(p, car, world);
      else enterCar(p, car, world);
    }
  }
  if (p.enterT > 0) p.enterT = Math.max(0, p.enterT - dt);

  // ---- H: honk (scares nearby peds) ----
  if (input.honk) {
    for (const ped of state.peds) {
      const dx = ped.x - p.x, dz = ped.z - p.z;
      if (dx * dx + dz * dz < 12 * 12) {
        ped.flee = 2;
        ped.fleeFrom = { x: p.x, z: p.z };
        ped.state = 'flee';
        ped.fleeT = 2;
      }
    }
    state.events.push({ type: 'sfx', text: 'honk', t: state.time });
  }
}
