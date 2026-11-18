// player.js — Solmar Bay: Dario Cruz on foot.
// The v5 fix lives here. Movement is ALWAYS speed (m/s) * dt (seconds):
//   walk 5 m/s -> 2 s of holding W covers 10 m.
// The v4 bug (0.2 m in 2 s) came from a speed/scale mismatch; this module
// reads PLAYER.walkSpeed / PLAYER.runSpeed from config.js and multiplies by
// the real frame delta, with no other scaling anywhere in the chain.
// Plain data + math only — no three.js, no DOM — so it runs in Node too
// (the smoke test in the coordinator's harness imports this directly).

import { PLAYER, WORLD_HALF } from './config.js';
import { collideCircle } from './city.js';

export const WALK_SPEED = PLAYER.walkSpeed;   // 5 m/s
export const RUN_SPEED = PLAYER.runSpeed;     // 8 m/s

/**
 * Player state. Position is a plain {x, z} in metres (y is derived by the
 * renderer from the ground height, which is 0 everywhere in Solmar Bay).
 * heading: radians, 0 = facing +z (south), turning toward +x is positive.
 */
export function createPlayer(spawn) {
  return {
    x: spawn ? spawn.x : 0,
    z: spawn ? spawn.z : 0,
    heading: spawn && spawn.heading !== undefined ? spawn.heading : Math.PI,
    speed: 0,                 // current horizontal speed, m/s
    moving: false,            // any move key held this frame
    running: false,           // Shift held while moving
    hp: PLAYER.hp,
    maxHp: PLAYER.hp,
    weapon: 'fists',          // 'fists' | 'pistol'
    ammo: 0,                  // pistol rounds in reserve (mag is separate)
    mag: PLAYER.pistolMag,
    reloading: 0,             // seconds left on reload, 0 = not reloading
    punchCooldown: 0,
    inVehicle: null,          // vehicle object when driving, else null
    entering: 0,              // seconds left on the enter-car animation
    exiting: 0,               // seconds left on the exit-car animation
    lastDamageAt: -Infinity,
    dead: false,
  };
}

/**
 * Move a circle through the city, resolving x and z separately so the
 * player SLIDES along walls instead of sticking to them.
 * Returns the resolved {x, z}.
 */
export function moveWithCollision(x, z, dx, dz, radius, city) {
  // Resolve x first, then z — each axis only sees the other axis's result,
  // which is what makes wall-sliding work.
  const afterX = collideCircle(x + dx, z, radius, city);
  const afterZ = collideCircle(afterX.x, z + dz, radius, city);
  return afterZ;
}

/**
 * Step the on-foot player for one frame.
 *   input: { moveX, moveY, run, lookDX } — moveY: +1 forward (W), -1 back;
 *          moveX: +1 right (D), -1 left. All in -1..1. run: Shift held.
 *   dt: frame delta in SECONDS (clamped by the caller to <= 0.05).
 *   city: the city object from city.js (for collision).
 * Returns nothing; mutates player.
 *
 * Movement math (the important part):
 *   speed = run ? 8 : 5            (metres per second, from config)
 *   step  = speed * dt             (metres this frame — at 60 fps, 0.083 m)
 *   pos  += direction * step
 * At 5 m/s for 2 s the player covers exactly 10 m. No other factor.
 */
export function updateOnFoot(player, input, dt, city) {
  if (player.inVehicle || player.entering > 0 || player.exiting > 0 || player.dead) {
    player.moving = false;
    player.speed = 0;
    return;
  }

  // Timers tick down even while idle.
  if (player.punchCooldown > 0) player.punchCooldown -= dt;
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      player.mag = PLAYER.pistolMag;
      player.reloading = 0;
    }
  }

  const mx = input.moveX || 0;
  const my = input.moveY || 0;
  const len = Math.hypot(mx, my);
  player.moving = len > 0.01;
  player.running = !!input.run && player.moving;

  if (!player.moving) {
    player.speed = 0;
    return;
  }

  // Mouse look turns the heading; movement is relative to the heading
  // (W = forward where Dario faces, A/D strafe). Keyboard-only play still
  // works: without mouse input the heading follows the movement direction.
  if (input.lookDX) {
    player.heading -= input.lookDX * 0.0032;
  }

  const speed = player.running ? RUN_SPEED : WALK_SPEED;
  player.speed = speed;

  // Normalised move direction in world space.
  const nx = mx / len, ny = my / len;
  const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
  // Forward is (sin, cos); right is (cos, -sin).
  const dirX = sin * ny + cos * nx;
  const dirZ = cos * ny - sin * nx;

  // THE fix: displacement = speed * dt. Nothing else multiplies it.
  const step = speed * dt;
  const next = moveWithCollision(player.x, player.z, dirX * step, dirZ * step,
    PLAYER.radius, city);
  player.x = next.x;
  player.z = next.z;

  // If no mouse look happened, face the direction of travel.
  if (!input.lookDX) {
    const target = Math.atan2(dirX, dirZ);
    let diff = target - player.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = PLAYER.turnSpeed * dt;
    player.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }
}

/** Current speed in km/h, for the HUD speedometer. */
export function playerSpeedKmh(player) {
  return player.inVehicle ? 0 : player.speed * 3.6;
}

/** Straight-line distance from the player to a point. */
export function distanceTo(player, x, z) {
  return Math.hypot(player.x - x, player.z - z);
}

/** True when the player is close enough to interact with a point. */
export function nearPoint(player, x, z, radius = 2.5) {
  return distanceTo(player, x, z) <= radius;
}

// ------------------------------------------------------------ enter / exit --
/** Begin the enter-car animation. Returns false when it cannot start. */
export function startEnterCar(player, car) {
  if (player.inVehicle || player.entering > 0 || player.dead) return false;
  player.entering = PLAYER.enterCarTime;
  player.enterTarget = car;
  return true;
}

/** Finish the enter-car animation: the player is now driving `car`. */
export function finishEnterCar(player) {
  const car = player.enterTarget;
  player.entering = 0;
  player.enterTarget = null;
  if (!car) return null;
  player.inVehicle = car;
  player.x = car.x;
  player.z = car.z;
  player.speed = 0;
  return car;
}

/** Step the player out of the car to the driver's side. Returns the spot. */
export function exitCar(player, city) {
  const car = player.inVehicle;
  if (!car) return null;
  player.inVehicle = null;
  player.exiting = 0.25;
  // Driver's door is on the left of the car's heading.
  const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
  const sideX = car.x + cos * -2.2;
  const sideZ = car.z + sin * 2.2;
  const spot = collideCircle(sideX, sideZ, PLAYER.radius, city);
  player.x = spot.x;
  player.z = spot.z;
  player.heading = car.heading;
  return { x: spot.x, z: spot.z };
}

// ----------------------------------------------------------------- combat --
/** Start a punch. Returns true if a punch actually fired. */
export function tryPunch(player) {
  if (player.inVehicle || player.punchCooldown > 0 || player.dead) return false;
  player.punchCooldown = PLAYER.punchCooldown;
  return true;
}

/** Start a reload. Returns true if a reload actually started. */
export function tryReload(player) {
  if (player.weapon !== 'pistol' || player.reloading > 0) return false;
  if (player.mag >= PLAYER.pistolMag || player.ammo <= 0) return false;
  player.reloading = PLAYER.pistolReload;
  return true;
}

/** Fire one pistol round. Returns 'shot' | 'empty' | 'no'. */
export function tryShoot(player) {
  if (player.weapon !== 'pistol' || player.reloading > 0 || player.dead) return 'no';
  if (player.mag <= 0) return 'empty';
  player.mag -= 1;
  return 'shot';
}

/** Apply damage to the player. Returns true if the player just died. */
export function damagePlayer(player, amount) {
  if (player.dead) return false;
  player.hp = Math.max(0, player.hp - amount);
  player.lastDamageAt = performanceNow();
  if (player.hp <= 0) {
    player.dead = true;
    return true;
  }
  return false;
}

/** Heal the player, capped at max HP. Returns the amount actually healed. */
export function healPlayer(player, amount) {
  if (player.dead) return 0;
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + amount);
  return player.hp - before;
}

/** Respawn the player at a spot with full HP (after busted / wasted). */
export function respawnPlayer(player, spot) {
  player.x = spot.x;
  player.z = spot.z;
  player.heading = spot.heading !== undefined ? spot.heading : Math.PI;
  player.hp = player.maxHp;
  player.dead = false;
  player.inVehicle = null;
  player.entering = 0;
  player.exiting = 0;
  player.speed = 0;
  player.reloading = 0;
  player.punchCooldown = 0;
}

// Small indirection so tests can run without a DOM performance object.
function performanceNow() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now() / 1000;
  return Date.now() / 1000;
}

/** Clamp a player inside the world (used by spawn / teleport helpers). */
export function clampPlayer(player) {
  player.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.x));
  player.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.z));
}

export default createPlayer;
