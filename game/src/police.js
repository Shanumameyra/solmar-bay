// Solmar Bay — police / wanted system (Worker B).
// Wanted 0-5. The police OWNS the wanted level: world.addHeat routes through
// police.addHeat, and police mirrors its own count onto state.wanted every
// step (a direct bump of state.wanted would be overwritten). Heat sources
// call addHeat(); pursuit spawns SBPD cars (and on-foot cops at 3+ stars,
// per CONFIG.WANTED.TIERS), chases, rams, and sets roadblocks at 3+ stars.
// Busted: on foot, a cop within 3 m for 2 s; in a car, speed < 2 m/s with a
// police car within 4 m for 3 s. Cooldown: 15 s out of sight, then -1 star
// per 10 s. Police cars live in state.cars (kind 'police', driver 'police');
// on-foot cops live in state.peds (isCop). All movement is kinematic here;
// rendering stays in render.js.
//
// Heading convention (shared with Worker A): a car's forward vector is
// (sin(angle), 0, cos(angle)) in world space, rotation.y = -angle.

import { CONFIG } from './config.js';
import { createCar } from './vehicle.js';

let nextId = 10000;

export function createPolice() {
  const police = {
    wanted: 0,
    heat: 0,
    lastSeenAt: -1e9,
    nextDecayAt: 0,
    bustT: 0,
    roadblockT: 0,
    spawnT: 0,

    reset() {
      this.wanted = 0;
      this.heat = 0;
      this.lastSeenAt = -1e9;
      this.nextDecayAt = 0;
      this.bustT = 0;
      this.roadblockT = 0;
      this.spawnT = 0;
    },

    addHeat(n, reason, state) {
      if (!state) return;
      const before = this.wanted;
      this.wanted = Math.max(0, Math.min(CONFIG.WANTED.MAX_STARS, this.wanted + n));
      this.heat += n;
      this.lastSeenAt = state.time || 0;
      this.nextDecayAt = 0;
      if (this.wanted > before) {
        pushEvent(state, 'wanted', `WANTED ${'★'.repeat(this.wanted)} — the SBPD is on you`);
      }
      if (state) state.wanted = this.wanted;
    },

    desiredUnits() {
      const tier = CONFIG.WANTED.TIERS[Math.max(0, Math.min(5, this.wanted))] || CONFIG.WANTED.TIERS[0];
      return { cars: tier.cars, cops: tier.foot, speedMul: tier.speedMul };
    },

    step(dt, state) {
      if (!state || !state.player) return;
      const t = state.time || 0;
      state.wanted = this.wanted;
      const player = state.player;
      const cars = state.cars || [];
      const peds = state.peds || [];
      const W = CONFIG.WANTED;

      // --- sight: any police unit within 55 m counts as "seen" ---
      let seen = false;
      let nearest = 1e9;
      let policeNear = false;
      for (const c of cars) {
        if (!c.isPolice) continue;
        const d = dist2d(c.x, c.z, player.x, player.z);
        if (d < nearest) nearest = d;
        if (d < 55) seen = true;
        if (d < 30) policeNear = true;
      }
      for (const p of peds) {
        if (!p.isCop) continue;
        const d = dist2d(p.x, p.z, player.x, player.z);
        if (d < nearest) nearest = d;
        if (d < 40) seen = true;
        if (d < 25) policeNear = true;
      }
      state.policeNear = policeNear;
      if (seen) this.lastSeenAt = t;

      // --- spawn / despawn to match the wanted level ---
      this.spawnT -= dt;
      const want = this.desiredUnits();
      const policeCars = cars.filter((c) => c.isPolice);
      const cops = peds.filter((p) => p.isCop);
      if (this.wanted > 0 && this.spawnT <= 0) {
        this.spawnT = 1.0;
        if (policeCars.length < want.cars) {
          this.spawnCar(state, player);
        }
        // Military tank at 4+ stars (spawnTank guards against duplicates).
        if (this.wanted >= 4) {
          this.spawnTank(state, player);
        }
        if (cops.length < want.cops && !player.inCar) {
          this.spawnCop(state, player);
        }
        // Despawn units that fell far behind.
        for (let i = cars.length - 1; i >= 0; i--) {
          const c = cars[i];
          if (c.isPolice && dist2d(c.x, c.z, player.x, player.z) > 140) {
            cars.splice(i, 1);
          }
        }
      }
      if (this.wanted === 0) {
        // Wanted cleared: police give up and drive off.
        for (let i = cars.length - 1; i >= 0; i--) {
          if (cars[i].isPolice) cars.splice(i, 1);
        }
        for (let i = peds.length - 1; i >= 0; i--) {
          if (peds[i].isCop) peds.splice(i, 1);
        }
        this.bustT = 0;
      }

      // --- pursuit ---
      const topSpeed = (24 + this.wanted * 2.2) * (want.speedMul || 1);
      for (const c of cars) {
        if (!c.isPolice) continue;
        this.pursueCar(dt, state, c, player, topSpeed);
      }
      for (const p of peds) {
        if (!p.isCop) continue;
        this.pursueCop(dt, state, p, player);
      }

      // --- roadblock at 3+ stars: one car parks ahead of the player's path ---
      this.roadblockT -= dt;
      if (this.wanted >= 3 && this.roadblockT <= 0 && player.inCar) {
        this.roadblockT = 14;
        const ahead = policeCars.find((c) => !c.roadblock);
        if (ahead) {
          const fx = Math.sin(player.yaw || 0);
          const fz = Math.cos(player.yaw || 0);
          ahead.x = clamp(player.x + fx * 42, -190, 190);
          ahead.z = clamp(player.z + fz * 42, -190, 190);
          ahead.angle = Math.atan2(-fx, -fz);
          ahead.speed = 0;
          ahead.roadblock = true;
          ahead.roadblockT = 8;
          pushEvent(state, 'info', 'Roadblock ahead — SBPD is setting up');
        }
      }
      for (const c of cars) {
        if (c.isPolice && c.roadblock) {
          c.roadblockT -= dt;
          if (c.roadblockT <= 0) c.roadblock = false;
        }
      }

      // --- bust check ---
      if (this.wanted > 0) {
        const onFoot = !player.inCar;
        const speed = Math.abs(player.speed || 0);
        const bustRange = onFoot ? W.BUST_FOOT_RANGE : W.BUST_CAR_RANGE;
        const bustTime = onFoot ? W.BUST_FOOT_TIME : W.BUST_CAR_TIME;
        const closeEnough = nearest < bustRange && (onFoot || speed < W.BUST_CAR_SPEED);
        if (closeEnough) {
          this.bustT += dt;
          if (this.bustT >= bustTime) this.bust(state);
        } else {
          this.bustT = 0;
        }
      }

      // --- cooldown: 15 s out of sight, then -1 star per 10 s ---
      if (this.wanted > 0 && t - this.lastSeenAt > W.DECAY_SIGHT_LOST) {
        if (this.nextDecayAt === 0) this.nextDecayAt = t + W.DECAY_PER_STAR;
        if (t >= this.nextDecayAt) {
          this.wanted -= 1;
          state.wanted = this.wanted;
          this.nextDecayAt = t + W.DECAY_PER_STAR;
          if (this.wanted === 0) {
            pushEvent(state, 'info', 'You lost them — heat is off');
          } else {
            pushEvent(state, 'info', `Heat dropping — ${'★'.repeat(this.wanted)}`);
          }
        }
      } else {
        this.nextDecayAt = 0;
      }
    },

    pursueCar(dt, state, car, player, topSpeed) {
      if (car.roadblock) return; // parked across the road
      const dx = player.x - car.x;
      const dz = player.z - car.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const targetAngle = Math.atan2(dx, dz);
      car.angle = turnToward(car.angle, targetAngle, 2.4 * dt);
      // Ram: close in, then shove the player's car.
      const wantSpeed = dist > 6 ? topSpeed : topSpeed * 0.55;
      car.speed += clamp(wantSpeed - car.speed, -14 * dt, 10 * dt);
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      pushOutOfBuildings(state, car, 2.2);
      car.x = clamp(car.x, -195, 195);
      car.z = clamp(car.z, -195, 195);
      if (dist < 3.4 && player.inCar) {
        // Ram impact: damage the player's car, shake, sparks.
        const pcar = (state.cars || []).find((c) => c.id === player.carId);
        if (pcar && !car._ramCd) {
          car._ramCd = 1.2;
          pcar.hp = Math.max(0, (pcar.hp || 100) - 6);
          pcar.speed *= 0.82;
          pushEvent(state, 'hit', 'SBPD rammed your car!');
          state.shakeTrauma = Math.min(1, (state.shakeTrauma || 0) + 0.35);
          state.fxBurst = { type: 'sparks', x: player.x, y: 1.2, z: player.z };
        }
      }
      if (car._ramCd) car._ramCd -= dt;
      car.lightBar = this.wanted >= 1;
    },

    pursueCop(dt, state, cop, player) {
      const dx = player.x - cop.x;
      const dz = player.z - cop.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      cop.angle = Math.atan2(dx, dz);
      const speed = 6.5;
      cop.x += Math.sin(cop.angle) * speed * dt;
      cop.z += Math.cos(cop.angle) * speed * dt;
      pushOutOfBuildings(state, cop, 1.0);
      cop.x = clamp(cop.x, -195, 195);
      cop.z = clamp(cop.z, -195, 195);
      cop.state = dist < 12 ? 'chase' : 'walk';
    },

    spawnCar(state, player) {
      const cars = state.cars || (state.cars = []);
      const a = Math.random() * Math.PI * 2;
      const d = 32 + Math.random() * 14;
      const x = clamp(player.x + Math.sin(a) * d, -190, 190);
      const z = clamp(player.z + Math.cos(a) * d, -190, 190);
      // Use vehicle.js createCar so the unit has the full car shape
      // (len/wid/hgt/topSpeed/steer/...) — a hand-built object without
      // len/wid poisons collideCars with NaN and breaks the renderer.
      const car = createCar('police', x, z, Math.atan2(player.x - x, player.z - z),
        { id: nextId++, isPolice: true, driver: 'police' });
      car.speed = 8;
      car.lightBar = true;
      car.roadblock = false;
      car.roadblockT = 0;
      pushOutOfBuildings(state, car, 2.2);
      cars.push(car);
    },

    // Military tank (wanted 4+): a slow, heavy police unit that rams. It
    // is a kind==='tank' car, so render.js draws its own armoured group
    // instead of the box-car instancing; pursuit/ramming reuse pursueCar.
    spawnTank(state, player) {
      const cars = state.cars || (state.cars = []);
      if (cars.some((c) => c.kind === 'tank')) return null;
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 10;
      const x = clamp(player.x + Math.sin(a) * d, -190, 190);
      const z = clamp(player.z + Math.cos(a) * d, -190, 190);
      const tank = createCar('tank', x, z, Math.atan2(player.x - x, player.z - z),
        { id: nextId++, isPolice: true, driver: 'police' });
      tank.speed = 6;
      tank.lightBar = false;
      tank.roadblock = false;
      tank.roadblockT = 0;
      pushOutOfBuildings(state, tank, 2.6);
      cars.push(tank);
      return tank;
    },

    spawnCop(state, player) {
      const peds = state.peds || (state.peds = []);
      const a = Math.random() * Math.PI * 2;
      const d = 22 + Math.random() * 10;
      const x = clamp(player.x + Math.sin(a) * d, -190, 190);
      const z = clamp(player.z + Math.cos(a) * d, -190, 190);
      // Full ped shape (traffic.js contract): stepPed resets state to
      // 'walk' every step and reads ped.loop[ped.loopIdx], so a cop
      // without a loop crashes the world. The 2-point loop is a short
      // patrol beat; pursueCop overrides the position toward the player.
      const cop = {
        id: nextId++,
        x, z,
        angle: 0,
        speed: 0,
        hp: CONFIG.COMBAT.POLICE_HP,
        isCop: true,
        isTaxiCustomer: false,
        state: 'chase',
        loop: [[x - 2, z], [x + 2, z]],
        loopIdx: 1,
        path: null,
        pathIdx: 0,
        flee: 0,
        fleeT: 0,
        fleeFrom: null,
        color: 0x1e3a8a,
        bobPhase: Math.random() * Math.PI * 2,
      };
      pushOutOfBuildings(state, cop, 1.0);
      peds.push(cop);
    },

    bust(state) {
      const player = state.player;
      const lost = Math.min(state.money || 0, CONFIG.WANTED.BUST_FINE);
      state.money = Math.max(0, (state.money || 0) - CONFIG.WANTED.BUST_FINE);
      state.stats.busted = (state.stats.busted || 0) + 1;
      this.wanted = 0;
      state.wanted = 0;
      this.bustT = 0;
      this.lastSeenAt = -1e9;
      // Clear all police units.
      if (state.cars) {
        for (let i = state.cars.length - 1; i >= 0; i--) {
          if (state.cars[i].isPolice) state.cars.splice(i, 1);
        }
      }
      if (state.peds) {
        for (let i = state.peds.length - 1; i >= 0; i--) {
          if (state.peds[i].isCop) state.peds.splice(i, 1);
        }
      }
      // A busted mission fails (missions.js re-arms at the café).
      if (state.systems && state.systems.missions && state.systems.missions.phase === 'active') {
        state.systems.missions.fail(state, 'Busted by the SBPD');
      }
      // Respawn at the precinct, on foot. The car stays where it was busted.
      const precinct = (state.landmarks && state.landmarks.precinct)
        || (state.spawnPoints && state.spawnPoints.precinct)
        || { x: 0, z: 0 };
      const pcar = player.carId != null
        ? (state.cars || []).find((c) => c.id === player.carId) : null;
      if (pcar) pcar.driver = null;
      // Fully get out of the car: leaving player.car set (or onFoot false)
      // makes stepPlayer sync the player back to the busted car's position
      // on the next step, undoing the precinct respawn.
      player.car = null;
      player.carId = null;
      player.inCar = false;
      player.onFoot = true;
      player.x = precinct.x;
      player.z = precinct.z;
      player.hp = player.maxHp || 100;
      player.speed = 0;
      state.screen = 'busted';
      state.screenT = 2.5;
      pushEvent(state, 'busted', `BUSTED! You lost $${lost}`);
    },
  };
  return police;
}

function dist2d(x1, z1, x2, z2) {
  return Math.hypot(x1 - x2, z1 - z2);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function turnToward(angle, target, maxStep) {
  let diff = target - angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return angle + clamp(diff, -maxStep, maxStep);
}

function pushOutOfBuildings(state, obj, radius) {
  const colliders = state.colliders;
  if (!colliders || !colliders.length) return;
  for (const b of colliders) {
    if (obj.x > b.minX - radius && obj.x < b.maxX + radius
      && obj.z > b.minZ - radius && obj.z < b.maxZ + radius) {
      const dxl = obj.x - (b.minX - radius);
      const dxr = (b.maxX + radius) - obj.x;
      const dzl = obj.z - (b.minZ - radius);
      const dzr = (b.maxZ + radius) - obj.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) obj.x = b.minX - radius;
      else if (m === dxr) obj.x = b.maxX + radius;
      else if (m === dzl) obj.z = b.minZ - radius;
      else obj.z = b.maxZ + radius;
    }
  }
}

function pushEvent(state, type, text) {
  if (!state.events) state.events = [];
  if (state.events.length > 24) state.events.shift();
  state.events.push({ type, text, t: state.time || 0 });
}
