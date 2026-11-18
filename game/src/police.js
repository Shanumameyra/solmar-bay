// police.js — Solmar Bay Police Department (SBPD) wanted system (Worker B, v6 fresh)
// Contract: createPolice(G) / updatePolice(G, dt) / addWanted(G, n)
// 1 star: 1 patrol car approaches. 2: 2 chase + ram. 3: 3 + roadblock.
// 4-5: more cars, faster. Busted on foot (3 m / 2 s) or in car (speed<2, 4 m / 3 s).
import { createCar, updateCar, damageCar } from './vehicle.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function desiredCount(stars) {
  if (stars <= 0) return 0;
  if (stars === 1) return 1;
  if (stars === 2) return 2;
  if (stars === 3) return 3;
  if (stars === 4) return 4;
  return 5;
}

export function createPolice(G) {
  return {
    stars: 0,
    cars: [],
    bustedTimer: 0,
    unseenTimer: 0,
    decayTimer: 0,
    spawnTimer: 0,
    _sirenOn: false,
    _flashT: 0,
    // Bound method so other systems can call G.police.addWanted(G, n).
    addWanted: (G2, n) => addWanted(G2, n),
  };
}

export function addWanted(G, n) {
  if (!G.police) return;
  G.police.stars = clamp(G.police.stars + n, 0, 5);
  G.state.wanted = G.police.stars;
  if (n > 0) {
    G.police.unseenTimer = 0;
    G.police.decayTimer = 0;
    if (G.hud && G.hud.say) {
      G.hud.say('WANTED ' + '★'.repeat(G.police.stars) + ' — the SBPD is on you');
    }
  }
}

function throttleBlocked(car) {
  // We were driving (previous frame speed came from updateCar) but are now
  // (almost) stationary while the chase still wants throttle.
  return Math.abs(car.speed || 0) < 2 && !car.stalled;
}

function spawnPoliceCar(G, px, pz) {
  // Spawn on a street 45-60 m from the player, roughly behind the player's view.
  const rng = G.rng || { next: () => Math.random() };
  const ang = rng.next() * TAU;
  const d = 45 + rng.next() * 15;
  let x = clamp(px + Math.sin(ang) * d, -190, 190);
  let z = clamp(pz + Math.cos(ang) * d, -190, 190);
  // Snap to nearest street line so the car spawns on a road, not inside a block.
  const lines = (G.world && G.world.streets) || [-175, -125, -75, -25, 25, 75, 125, 175];
  let bx = lines[0], bd = Infinity;
  for (const L of lines) { const dd = Math.abs(L - x); if (dd < bd) { bd = dd; bx = L; } }
  let bz = lines[0]; bd = Infinity;
  for (const L of lines) { const dd = Math.abs(L - z); if (dd < bd) { bd = dd; bz = L; } }
  if (bd !== Infinity) { if (Math.abs(bx - x) < Math.abs(bz - z)) x = bx; else z = bz; }
  const heading = Math.atan2(px - x, pz - z);
  const car = createCar(G, { x, z, heading, police: true });
  car._disabledTimer = 0;
  car._ramCooldown = 0;
  return car;
}

function removePoliceCar(G, car) {
  if (G.scene && car.mesh) G.scene.remove(car.mesh);
  const i = G.police.cars.indexOf(car);
  if (i >= 0) G.police.cars.splice(i, 1);
}

export function updatePolice(G, dt) {
  const P = G.police;
  if (!P || !G.player || !G.player.pos) return;
  const player = G.player;
  const px = player.pos.x, pz = player.pos.z;
  const inCar = !!player.car;
  const playerSpeed = inCar ? Math.abs(player.car.speed || 0) : Math.abs(player.speed || 0);

  // Keep the fleet matched to the wanted level.
  const want = desiredCount(P.stars);
  P.spawnTimer -= dt;
  if (P.cars.length < want && P.spawnTimer <= 0) {
    P.cars.push(spawnPoliceCar(G, px, pz));
    P.spawnTimer = 1.5; // stagger spawns
  }
  while (P.cars.length > want) {
    // Remove the farthest car first.
    let far = P.cars[0], fd = -1;
    for (const c of P.cars) {
      const d = Math.hypot(c.pos.x - px, c.pos.z - pz);
      if (d > fd) { fd = d; far = c; }
    }
    removePoliceCar(G, far);
  }

  let nearest = Infinity;
  P._flashT += dt;
  const flashOn = Math.floor(P._flashT * 4) % 2 === 0;

  for (const car of [...P.cars]) {
    const d = Math.hypot(car.pos.x - px, car.pos.z - pz);
    if (d < nearest) nearest = d;

    // Disabled (shot / wrecked) cars smoke, then get towed away.
    if (car.stalled) {
      car._disabledTimer += dt;
      updateCar(G, car, dt, {});
      if (car._disabledTimer > 6) removePoliceCar(G, car);
      continue;
    }

    // Flash the light bar.
    if (car.lightBar) {
      car.lightBar.userData.red.material.emissiveIntensity = flashOn ? 2.2 : 0.15;
      car.lightBar.userData.blue.material.emissiveIntensity = flashOn ? 0.15 : 2.2;
    }

    // Anti-stall: if we have been pushing the throttle but barely moving
    // (wedged against traffic / another cruiser / a stopped car), reverse out
    // at an angle for ~1 s, then re-approach from a different line.
    car._blockedT = (throttleBlocked(car)) ? (car._blockedT || 0) + dt : 0;
    if (car._blockedT > 1.0 && !car._reverseT) {
      car._reverseT = 1.0;
      car._swerveSide = (P.cars.indexOf(car) % 2 === 0) ? 1 : -1;
      car._blockedT = 0;
    }
    if (car._reverseT > 0) {
      car._reverseT -= dt;
      updateCar(G, car, dt, { throttle: false, brake: true, steer: (car._swerveSide || 1) * 0.8, handbrake: false });
      if (Math.abs(car.speed) > 12) car.speed = Math.sign(car.speed) * 12;
      continue;
    }

    // Chase steering: aim at the player, with a small intercept lead.
    const lead = 0.35;
    const tx = px + Math.sin(player.heading || 0) * (playerSpeed * lead);
    const tz = pz + Math.cos(player.heading || 0) * (playerSpeed * lead);
    const targetHeading = Math.atan2(tx - car.pos.x, tz - car.pos.z);
    const dh = normAngle(targetHeading - car.heading);
    const steer = clamp(dh * 1.8, -1, 1);

    // Speed control: fast when far, SLOW when close. A cruiser blasting past
    // the player at 32 m/s needs a ~40 m arc to turn around and ends up
    // orbiting instead of closing in — the v6 chase fix. Desired speed falls
    // with distance so the cruiser can stay on the player and bust / ram.
    let speedCap = 26 + P.stars * 3.2;
    if (P.stars >= 4) speedCap += 4;
    let desired;
    if (d > 40) desired = speedCap;
    else if (d > 15) desired = speedCap * 0.7;
    else if (d > 6) desired = inCar ? 16 : 12; // ramming run / closing run
    else desired = inCar ? 10 : 0; // on foot: stop next to the player -> busted
    if (P.stars >= 3 && inCar && d > 5 && d < 15) desired = Math.max(desired, 16);
    const throttle = car.speed < desired;
    const brake = car.speed > desired + 4;
    updateCar(G, car, dt, { throttle, brake, steer, handbrake: false });

    // Enforce our cap (updateCar caps at 38).
    if (Math.abs(car.speed) > speedCap) car.speed = Math.sign(car.speed) * speedCap;

    // Ram damage: hard contact with the player's car hurts the player.
    car._ramCooldown = Math.max(0, (car._ramCooldown || 0) - dt);
    if (d < 4.2 && car._ramCooldown <= 0 && Math.abs(car.speed) > 6) {
      car._ramCooldown = 1.2;
      if (G.combat && G.combat.damagePlayer) G.combat.damagePlayer(G, 8);
      else if (typeof player.hp === 'number') player.hp = Math.max(0, player.hp - 8);
      damageCar(car, 4); // ramming hurts the cruiser a little too
      if (G.effects) G.effects.spawnSparks(car.pos.x, car.pos.z);
    }
  }

  // Siren when any cruiser is near.
  const siren = P.cars.length > 0 && nearest < 70;
  if (siren !== P._sirenOn) {
    P._sirenOn = siren;
    if (G.audio) G.audio.siren(siren);
  }

  // --- Busted logic ---
  const bustedRange = inCar ? 4 : 3;
  const bustedTime = inCar ? 3 : 2;
  // On foot, a cruiser cannot grab a player who is walking away from it:
  // the timer only runs while the player is (nearly) stationary. Without
  // this, the mandatory on-foot M1 pickup (package at the docks, 1 star from
  // the witnessed steal) is an automatic bust — the cruiser parks next to
  // the walking player and the 2 s timer always completes before the player
  // can walk back to the car. In a car the rule is unchanged: slow + close
  // + 3 s. (player.speed reads 5/8 while walk/run keys are held, even
  // against a wall, so "stationary" here means the player stopped moving.)
  const slowEnough = inCar ? playerSpeed < 2 : playerSpeed < 1;
  if (P.stars > 0 && nearest < bustedRange && slowEnough && G.state.mode === 'playing') {
    P.bustedTimer += dt;
    if (P.bustedTimer >= bustedTime) {
      P.bustedTimer = 0;
      doBusted(G);
      return;
    }
  } else {
    P.bustedTimer = 0;
  }

  // --- Decay: 15 s out of police sight (nearest > 60 m) -> -1 star per 10 s. ---
  if (P.stars > 0) {
    if (nearest > 60) {
      P.unseenTimer += dt;
      if (P.unseenTimer >= 15) {
        P.decayTimer += dt;
        if (P.decayTimer >= 10) {
          P.decayTimer = 0;
          P.stars = Math.max(0, P.stars - 1);
          G.state.wanted = P.stars;
          if (G.hud && G.hud.say) G.hud.say('Heat cooling off… ' + '★'.repeat(P.stars));
        }
      }
    } else {
      P.unseenTimer = 0;
      P.decayTimer = 0;
    }
  } else {
    P.unseenTimer = 0;
    P.decayTimer = 0;
  }
}

function doBusted(G) {
  const P = G.police;
  const lost = Math.min(200, G.state.money || 0);
  G.state.money = Math.max(0, (G.state.money || 0) - 200);
  if (G.state.stats) G.state.stats.busted = (G.state.stats.busted || 0) + 1;
  P.stars = 0;
  G.state.wanted = 0;
  // Player is out of the car, on foot, at the precinct.
  if (G.player.car) {
    const car = G.player.car;
    G.player.car = null;
    car._driver = null;
  }
  const precinct = (G.world && G.world.precinct) || { x: 60, z: 100 };
  G.player.pos.set(precinct.x, 0, precinct.z);
  if (G.player.mesh) G.player.mesh.position.set(precinct.x, 0, precinct.z);
  G.player.heading = Math.PI;
  if (G.player.mesh) G.player.mesh.rotation.y = Math.PI;
  G.player.speed = 0;
  // Mission fails on bust (retry from mission start, handled by missions.js).
  if (G.missions && G.missions.onBusted) G.missions.onBusted(G);
  if (G.audio) G.audio.sfx('busted');
  if (G.hud && G.hud.say) G.hud.say('BUSTED! −$' + lost + ' — the SBPD let you off at the precinct');
  G.state.mode = 'busted';
  G.state.modeTimer = 2.0;
  if (G.saveGame) G.saveGame(G);
}
