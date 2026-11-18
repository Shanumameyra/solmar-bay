// police.js — the SBPD wanted system: heat, pursuit, roadblocks, busts.
//
// Police owns the wanted level (0-5). Every step it mirrors its own
// `wanted` onto state.wanted, and world.addHeat routes through
// police.addHeat whenever the police system exists, so the two never
// drift apart. Police cars live in state.cars (kind 'police', driver
// 'police', lightBar on); on-foot cops live in state.peds (isCop).
// Math.random is used for spawn jitter — shots.js seeds it while
// staging, which keeps the staged chases deterministic.

import { CONFIG } from './config.js';
import { createCar } from './vehicle.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function distTo(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function pushEv(state, ev) {
  if (state && Array.isArray(state.events)) {
    state.events.push({ t: state.time ?? 0, ...ev });
  }
}

function insideCollider(state, x, z, pad) {
  const cs = state.colliders;
  if (!cs) return false;
  for (const c of cs) {
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) {
      return true;
    }
  }
  return false;
}

function nextNumericCarId(state) {
  let max = 0;
  let count = 0;
  for (const c of state.cars || []) {
    count++;
    if (typeof c.id === 'number' && c.id > max) max = c.id;
  }
  return Math.max(max, count) + 1;
}

// Cop ids are strings: the renderer hashes ped.id with charCodeAt, so a
// numeric id throws and aborts the whole draw. A module counter keeps
// them unique across resets.
let copSeq = 0;
function nextCopId() {
  copSeq += 1;
  return `cop-${copSeq}`;
}

function policeCarsIn(state) {
  return (state.cars || []).filter((c) => c.isPolice || c.kind === 'police');
}

function copsIn(state) {
  return (state.peds || []).filter((p) => p.isCop);
}

function starsText(n) {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

export function createPolice() {
  const api = {
    wanted: 0,
    heat: 0,
    lastSeenAt: 0,
    nextDecayAt: 0,
    bustT: 0,
    roadblockT: 20,
    spawnT: 0,
    _state: null,

    reset() {
      api.wanted = 0;
      api.heat = 0;
      api.lastSeenAt = 0;
      api.nextDecayAt = 0;
      api.bustT = 0;
      api.roadblockT = 20;
      api.spawnT = 0;
      api._state = null;
    },

    // How many SBPD units the current wanted level calls for (CONFIG).
    desiredUnits() {
      const tiers = CONFIG.WANTED.TIERS;
      const t = tiers[clamp(api.wanted, 0, tiers.length - 1)] || { cars: 0, foot: 0, speedMul: 1 };
      return { cars: t.cars ?? 0, foot: t.foot ?? 0, speedMul: t.speedMul ?? 1 };
    },

    addHeat(n, reason, state) {
      const st = state || api._state;
      const before = api.wanted;
      api.wanted = clamp(api.wanted + n, 0, CONFIG.WANTED.MAX_STARS ?? 5);
      api.heat = api.wanted;
      // Mirror onto state.wanted synchronously, not only on the next
      // step: callers that read wanted right after adding heat — the
      // HUD, the bust check, the staged shots — must see the new value.
      if (st) st.wanted = api.wanted;
      if (st) api.lastSeenAt = st.time ?? 0;
      api.nextDecayAt = 0;
      if (st && n > 0 && api.wanted !== before) {
        pushEv(st, {
          type: 'wanted',
          text: `WANTED ${starsText(api.wanted)}${reason ? ' — ' + reason : ''}`,
        });
      }
    },

    // Full contract shape, built through vehicle.js createCar: the car
    // carries len/wid/hgt/topSpeed/steer like every other car. A
    // hand-built object without len/wid once poisoned collideCars with
    // NaN positions (minD = NaN) and wrecked any car it touched.
    spawnCar(state, x, z, angle, opts = {}) {
      const st = state || api._state;
      if (!st) return null;
      const car = createCar('police', x, z, angle ?? 0, {
        driver: 'police',
        isPolice: true,
        lightBar: true,
        ...(opts || {}),
      });
      car.kind = 'police';
      car.isPolice = true;
      car.lightBar = true;
      car.driver = 'police';
      if (typeof car.id !== 'number') car.id = nextNumericCarId(st);
      (st.cars = st.cars || []).push(car);
      return car;
    },

    // Full ped shape (loop/path/flee/bobPhase included): stepPed reads
    // ped.loop[ped.loopIdx] every step, so a cop with a null loop
    // crashes the world.
    spawnCop(state, x, z, opts = {}) {
      const st = state || api._state;
      if (!st) return null;
      const cop = {
        id: nextCopId(),
        x,
        z,
        angle: 0,
        speed: 0,
        hp: CONFIG.COMBAT.POLICE_HP ?? 100,
        isCop: true,
        isTaxiCustomer: false,
        state: 'walk',
        color: 0x2a4d8f,
        loop: [
          [x, z],
          [x + 8, z],
        ],
        loopIdx: 0,
        path: null,
        pathIdx: 0,
        flee: false,
        fleeT: 0,
        fleeFrom: null,
        bobPhase: Math.random() * Math.PI * 2,
        ...(opts || {}),
      };
      (st.peds = st.peds || []).push(cop);
      return cop;
    },

    // Kinematic chase: steer toward the player, accelerate to the tier's
    // chase speed, ram the player's car on contact. A roadblock cruiser
    // (_rbT set by the roadblock spawn) sits still until its timer ends.
    // Steering follows an A* path when a nav grid exists: a straight-line
    // chase through a grid city parks the cruiser nose-first into the
    // first building on the way, and no turn rate fixes that (the
    // steer-toward-player pull beats the turn-away push). Direct steering
    // is the fallback when there is no path.
    pursueCar(dt, state, car) {
      const p = state.player;
      if (!p) return;
      if (car._rbT && state.time < car._rbT) {
        car.speed = 0;
        return;
      }
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const d = Math.hypot(dx, dz) || 0.001;
      let tx = p.x;
      let tz = p.z;
      if (state.navGrid && typeof state.navGrid.findPath === 'function') {
        car._pathT = (car._pathT ?? 0) - dt;
        if (car._pathT <= 0 || !car.path || car.pathIdx >= (car.path?.length ?? 0)) {
          car._pathT = 1.5;
          const path = state.navGrid.findPath(car.x, car.z, p.x, p.z);
          if (path && path.length) {
            car.path = path;
            car.pathIdx = 0;
          }
        }
        if (car.path && car.pathIdx < car.path.length) {
          const wp = car.path[car.pathIdx];
          tx = wp[0];
          tz = wp[1];
          if (Math.hypot(tx - car.x, tz - car.z) < 4) car.pathIdx++;
        }
      }
      const want = Math.atan2(tx - car.x, tz - car.z);
      if (car._unstickT && state.time < car._unstickT) {
        // Still escaping a wall: keep turning away, don't steer back into it.
        car.angle += 3.0 * dt;
      } else {
        car.angle += clamp(angDiff(want, car.angle), -2.4 * dt, 2.4 * dt);
      }
      const tier = api.desiredUnits();
      const chaseTop = (car.topSpeed || CONFIG.CAR.TOP) * (tier.speedMul ?? 1);
      // Smooth approach: fast from afar, easing off as it closes, and a
      // full stop once it pulls up next to the player — otherwise the
      // cruiser blasts past at 40+ m/s and the bust timer never runs.
      // Stop inside 4 m: at 6 m/s the 2.4 rad/s turn rate only manages a
      // 2.5 m turning circle, so a cruiser that keeps driving at close
      // range falls into a stable orbit around the player instead of
      // pulling up next to them. Hard brake (22 m/s^2) makes the stop real.
      const target = d < 4 ? 0 : Math.min(chaseTop, Math.max(6, d * 1.0));
      if ((car.speed ?? 0) < target) {
        car.speed = Math.min(target, (car.speed ?? 0) + 14 * dt);
      } else {
        car.speed = Math.max(target, (car.speed ?? 0) - 22 * dt);
      }
      const nx = car.x + Math.sin(car.angle) * car.speed * dt;
      const nz = car.z + Math.cos(car.angle) * car.speed * dt;
      if (insideCollider(state, nx, nz, 2.5)) {
        // Turn away HARD (3.0 rad/s beats the 2.4 rad/s steer-toward-player,
        // which otherwise wins the tug-of-war and parks the cruiser
        // nose-first into the wall forever) and keep turning for 0.7 s
        // after the block.
        car.angle += 3.0 * dt;
        car.speed = Math.max(0, car.speed - 12 * dt);
        car._unstickT = state.time + 0.7;
      } else {
        car.x = clamp(nx, -198, 198);
        car.z = clamp(nz, -198, 198);
      }
      car.steer = clamp(angDiff(want, car.angle), -0.6, 0.6);
      // Ram the player's car on contact.
      if (p.car && d < 4.5) {
        car._ramCd = (car._ramCd ?? 0) - dt;
        if (car._ramCd <= 0) {
          car._ramCd = 0.6;
          p.car.hp = Math.max(0, (p.car.hp ?? 100) - 6);
          pushEv(state, { type: 'carDamage', text: 'Police rammed your car!' });
          state.shakeTrauma = Math.min(1, (state.shakeTrauma ?? 0) + 0.25);
        }
      }
      // Run over an on-foot player.
      if (p.onFoot && d < 2.2) {
        car._runCd = (car._runCd ?? 0) - dt;
        if (car._runCd <= 0) {
          car._runCd = 1.0;
          state.systems?.combat?.damagePlayer?.(10, state);
        }
      }
    },

    // On-foot cop: A* toward the player when a nav grid exists, direct
    // steering with wall sliding otherwise. Stops inside arm's reach;
    // combat.js lands the actual hit.
    pursueCop(dt, state, cop) {
      const p = state.player;
      if (!p) return;
      // Pin the cop's sidewalk loop to its own position (in place, no
      // allocation): traffic steps the loop BEFORE pursuit each step, and
      // a walking loop would drag an arrived cop away from the player
      // faster than the bust timer runs. Pursuit owns the cop's movement.
      if (cop.loop && cop.loop.length >= 2) {
        cop.loop[0][0] = cop.x;
        cop.loop[0][1] = cop.z;
        cop.loop[1][0] = cop.x;
        cop.loop[1][1] = cop.z;
        cop.loopIdx = 0;
      }
      const d = distTo(cop.x, cop.z, p.x, p.z);
      if (d < 1.6) {
        cop.speed = 0;
        return;
      }
      cop._pathT = (cop._pathT ?? 0) - dt;
      let tx = p.x;
      let tz = p.z;
      if (state.navGrid && typeof state.navGrid.findPath === 'function') {
        if (cop._pathT <= 0 || !cop.path || cop.pathIdx >= (cop.path?.length ?? 0)) {
          cop._pathT = 1.5;
          const path = state.navGrid.findPath(cop.x, cop.z, p.x, p.z);
          if (path && path.length) {
            cop.path = path;
            cop.pathIdx = 0;
          }
        }
        if (cop.path && cop.pathIdx < cop.path.length) {
          const wp = cop.path[cop.pathIdx];
          tx = wp[0];
          tz = wp[1];
          if (distTo(cop.x, cop.z, tx, tz) < 1.5) cop.pathIdx++;
        }
      }
      const dx = tx - cop.x;
      const dz = tz - cop.z;
      const want = Math.atan2(dx, dz);
      cop.angle += clamp(angDiff(want, cop.angle), -3 * dt, 3 * dt);
      const spd = 5.2;
      const nx = cop.x + Math.sin(cop.angle) * spd * dt;
      const nz = cop.z + Math.cos(cop.angle) * spd * dt;
      if (!insideCollider(state, nx, nz, 0.6)) {
        cop.x = nx;
        cop.z = nz;
      } else if (!insideCollider(state, nx, cop.z, 0.6)) {
        cop.x = nx;
      } else if (!insideCollider(state, cop.x, nz, 0.6)) {
        cop.z = nz;
      }
      cop.speed = spd;
      cop.bobPhase = (cop.bobPhase ?? 0) + dt * 9;
    },

    // Caught: lose the fine (or all cash if less), respawn at the
    // precinct, wanted back to 0. Clears player.car AND sets onFoot —
    // otherwise the next stepPlayer syncs the position back to the
    // busted car and the respawn never happens.
    bust(state) {
      const fine = Math.min(state.money ?? 0, CONFIG.WANTED.BUST_FINE ?? 200);
      state.money = (state.money ?? 0) - fine;
      if (state.stats) state.stats.busted = (state.stats.busted ?? 0) + 1;
      const prec =
        state.landmarks?.precinct ||
        CONFIG.LANDMARKS?.precinct ||
        { x: 72, z: 144 };
      const p = state.player;
      if (p.car) p.car.driver = null;
      p.car = null;
      p.carId = null;
      p.inCar = false;
      p.onFoot = true;
      p.x = prec.x;
      p.z = prec.z;
      p.heading = Math.PI;
      p.yaw = Math.PI;
      p.speed = 0;
      p.hp = p.maxHp ?? 100;
      state.health = p.hp;
      p.invuln = 3;
      api.wanted = 0;
      api.heat = 0;
      api.bustT = 0;
      api.nextDecayAt = 0;
      state.wanted = 0;
      state.screen = 'busted';
      state.screenT = 2.5;
      pushEv(state, { type: 'busted', text: `Busted! The SBPD got you — $${fine}` });
      pushEv(state, { type: 'sfx', name: 'busted' });
    },

    // A spawn spot 42-60 m from the player, clear of buildings.
    _pickSpot(state, minD, maxD) {
      const p = state.player;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = minD + Math.random() * (maxD - minD);
        const x = clamp(p.x + Math.sin(a) * d, -195, 195);
        const z = clamp(p.z + Math.cos(a) * d, -195, 195);
        if (!insideCollider(state, x, z, 3)) return { x, z };
      }
      // Last resort: the mirrored spot on the other side of the player.
      // Only return a spot that might sit inside a building if every
      // random try failed — the caller would rather have a cruiser in a
      // wall for one step than no cruiser at all.
      const bx = clamp(p.x - 45, -195, 195);
      if (!insideCollider(state, bx, p.z, 3)) return { x: bx, z: clamp(p.z, -195, 195) };
      return { x: clamp(p.x + 45, -195, 195), z: clamp(p.z, -195, 195) };
    },

    step(dt, state) {
      api._state = state;
      state.wanted = api.wanted;
      const p = state.player;
      if (!p) return;
      const W = CONFIG.WANTED;
      const want = api.desiredUnits();
      const cars = policeCarsIn(state);
      const foot = copsIn(state);

      // Spawn up to the desired strength, one unit per spawn tick.
      api.spawnT -= dt;
      if ((cars.length < want.cars || foot.length < want.foot) && api.spawnT <= 0) {
        api.spawnT = 1.2;
        const spot = api._pickSpot(state, 42, 60);
        if (cars.length < want.cars) {
          api.spawnCar(
            state,
            spot.x,
            spot.z,
            Math.atan2(p.x - spot.x, p.z - spot.z),
          );
        } else {
          api.spawnCop(state, spot.x, spot.z);
        }
      }

      // Trim excess units (furthest first), one per step.
      if (cars.length > want.cars) {
        const far = [...cars].sort(
          (a, b) => distTo(b.x, b.z, p.x, p.z) - distTo(a.x, a.z, p.x, p.z),
        )[0];
        state.cars.splice(state.cars.indexOf(far), 1);
      } else if (foot.length > want.foot) {
        const far = [...foot].sort(
          (a, b) => distTo(b.x, b.z, p.x, p.z) - distTo(a.x, a.z, p.x, p.z),
        )[0];
        state.peds.splice(state.peds.indexOf(far), 1);
      }

      // Pursuit.
      for (const car of policeCarsIn(state)) api.pursueCar(dt, state, car);
      for (const cop of copsIn(state)) api.pursueCop(dt, state, cop);

      // Sight + decay: 15 s out of police sight, then -1 star per 10 s.
      const near =
        policeCarsIn(state).some((c) => distTo(c.x, c.z, p.x, p.z) < 60) ||
        copsIn(state).some((c) => distTo(c.x, c.z, p.x, p.z) < 60);
      state.policeNear = near;
      if (near) {
        api.lastSeenAt = state.time;
        api.nextDecayAt = 0;
      } else if (api.wanted > 0 && state.time - api.lastSeenAt > (W.DECAY_SIGHT_LOST ?? 15)) {
        if (!api.nextDecayAt) api.nextDecayAt = state.time + (W.DECAY_PER_STAR ?? 10);
        if (state.time >= api.nextDecayAt) {
          api.wanted = Math.max(0, api.wanted - 1);
          api.heat = api.wanted;
          api.nextDecayAt = state.time + (W.DECAY_PER_STAR ?? 10);
          pushEv(state, {
            type: 'wanted',
            text:
              api.wanted > 0
                ? `Heat cooling off — ${starsText(api.wanted)}`
                : 'You lost the cops. Heat is off.',
          });
          state.wanted = api.wanted;
        }
      }

      // Roadblock at 3+ stars: two cruisers parked across the road ahead.
      if (api.wanted >= 3) {
        api.roadblockT -= dt;
        if (api.roadblockT <= 0) {
          api.roadblockT = 25 + Math.random() * 10;
          const hd = p.heading ?? 0;
          const fx = Math.sin(hd);
          const fz = Math.cos(hd);
          const px = -fz;
          const pz = fx;
          for (const s of [-1, 1]) {
            const car = api.spawnCar(
              state,
              p.x + fx * 26 + px * 4 * s,
              p.z + fz * 26 + pz * 4 * s,
              hd + Math.PI / 2,
            );
            if (car) {
              car._rbT = state.time + 6;
              car.speed = 0;
            }
          }
          pushEv(state, { type: 'roadblock', text: 'Roadblock ahead!' });
        }
      } else {
        api.roadblockT = Math.min(api.roadblockT, 20);
      }

      // Bust check: on foot, a cop within 3 m for 2 s; in a car, speed
      // < 2 with a police car within 4 m for 3 s.
      if (api.wanted > 0) {
        let caught = false;
        if (p.onFoot) {
          caught = copsIn(state).some(
            (c) => distTo(c.x, c.z, p.x, p.z) < (W.BUST_FOOT_RANGE ?? 3),
          );
          api.bustT = caught ? api.bustT + dt : 0;
          if (api.bustT >= (W.BUST_FOOT_TIME ?? 2)) api.bust(state);
        } else if (p.car) {
          const slow = (p.car.speed ?? 0) < (W.BUST_CAR_SPEED ?? 2);
          caught =
            slow &&
            policeCarsIn(state).some(
              (c) => distTo(c.x, c.z, p.x, p.z) < (W.BUST_CAR_RANGE ?? 4),
            );
          api.bustT = caught ? api.bustT + dt : 0;
          if (api.bustT >= (W.BUST_CAR_TIME ?? 3)) api.bust(state);
        } else {
          api.bustT = 0;
        }
      } else {
        api.bustT = 0;
      }
    },
  };
  return api;
}
