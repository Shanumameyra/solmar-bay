// combat.js — fists, pistol, cop attacks, medkits and the gun shop.
//
// Owns weapon/ammo/reserveAmmo and mirrors them onto the player each step.
// Reload draws from reserveAmmo (bought at the gun shop) — it is NOT free.
// HP math uses ?? (never ||): a dead player at 0 HP must stay dead, not
// resurrect to 100 on the next hit.

import { CONFIG } from './config.js';

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

function pushEvent(state, ev) {
  if (state && Array.isArray(state.events)) {
    state.events.push({ t: state.time ?? 0, ...ev });
  }
}

function landmark(state, key) {
  return (
    (state.landmarks && state.landmarks[key]) ||
    (CONFIG.LANDMARKS && CONFIG.LANDMARKS[key]) || { x: 0, z: 0 }
  );
}

export function createCombat() {
  const C = CONFIG.COMBAT;
  const api = {
    weapon: 'fists', // 'fists' | 'pistol'
    ammo: 0, // rounds in the mag (pistol starts empty — buy ammo first)
    reserveAmmo: 0,
    punchCd: 0,
    reloadT: 0,
    copHitT: 0,
    healCd: 0,
    shopCd: 0,
    muzzleT: 0,

    reset() {
      api.weapon = 'fists';
      api.ammo = 0;
      api.reserveAmmo = 0;
      api.punchCd = 0;
      api.reloadT = 0;
      api.copHitT = 0;
      api.healCd = 0;
      api.shopCd = 0;
      api.muzzleT = 0;
    },

    // Nearest living ped inside a forward cone (range, half-angle).
    nearestInCone(state, range, halfAngle) {
      const p = state.player;
      if (!p) return null;
      const facing = p.onFoot ? p.yaw : p.car ? p.car.angle : p.yaw;
      let best = null;
      let bestD = Infinity;
      for (const ped of state.peds || []) {
        if ((ped.hp ?? 100) <= 0 || ped.state === 'down') continue;
        const dx = ped.x - p.x;
        const dz = ped.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        if (Math.abs(angDiff(Math.atan2(dx, dz), facing)) > halfAngle) continue;
        if (d < bestD) {
          bestD = d;
          best = ped;
        }
      }
      return best;
    },

    // Nearest police car inside a forward cone (for pistol shots at cars).
    nearestCarInCone(state, range, halfAngle) {
      const p = state.player;
      if (!p) return null;
      const facing = p.onFoot ? p.yaw : p.car ? p.car.angle : p.yaw;
      let best = null;
      let bestD = Infinity;
      for (const car of state.cars || []) {
        if (!car.isPolice || (car.hp ?? 100) <= 0) continue;
        if (p.car && car.id === p.car.id) continue;
        const dx = car.x - p.x;
        const dz = car.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        if (Math.abs(angDiff(Math.atan2(dx, dz), facing)) > halfAngle) continue;
        if (d < bestD) {
          bestD = d;
          best = car;
        }
      }
      return best;
    },

    damagePed(ped, dmg, state) {
      ped.hp = (ped.hp ?? 100) - dmg;
      if (ped.hp <= 0) {
        ped.hp = 0;
        ped.state = 'down';
        // Civilians get back up after downT; cops stay down.
        ped.downT = ped.isCop ? 1e9 : 8;
        if (ped.isCop) {
          state.systems?.police?.addHeat?.(2, 'cop down', state);
          pushEvent(state, { type: 'feed', text: 'Cop down! +2 stars' });
        }
      }
    },

    damagePlayer(n, state) {
      const p = state.player;
      if (!p) return;
      p.hp = (p.hp ?? 100) - n;
      if (p.hp < 0) p.hp = 0;
      state.health = p.hp;
      pushEvent(state, { type: 'damage' });
      if (p.hp <= 0 && state.screen !== 'wasted' && state.screen !== 'busted') {
        api.die(state);
      }
    },

    // WASTED: respawn at the hospital, lose $100. Clears player.car AND
    // sets onFoot — otherwise stepPlayer syncs the position back to the
    // wrecked car and the respawn never happens.
    die(state) {
      if (state.screen === 'wasted') return;
      const fine = Math.min(state.money ?? 0, C.DEATH_FINE ?? 100);
      state.money = (state.money ?? 0) - fine;
      if (state.stats) state.stats.deaths = (state.stats.deaths ?? 0) + 1;
      const hosp =
        state.landmarks?.hospital || CONFIG.LANDMARKS?.hospital || { x: 144, z: -72 };
      const p = state.player;
      if (p.car) p.car.driver = null;
      p.car = null;
      p.carId = null;
      p.inCar = false;
      p.onFoot = true;
      p.x = hosp.x;
      p.z = hosp.z;
      p.heading = Math.PI;
      p.yaw = Math.PI;
      p.speed = 0;
      p.hp = p.maxHp ?? 100;
      state.health = p.hp;
      p.invuln = 3;
      state.screen = 'wasted';
      state.screenT = 2.5;
      pushEvent(state, { type: 'wasted', text: `WASTED — -$${fine}` });
      pushEvent(state, { type: 'sfx', name: 'busted' });
      state.fxBurst = { type: 'smoke', x: p.x, y: 1.5, z: p.z };
    },

    punch(state) {
      if (api.punchCd > 0) return false;
      api.punchCd = CONFIG.PLAYER.PUNCH_COOLDOWN ?? 0.4;
      pushEvent(state, { type: 'sfx', name: 'punch' });
      const p = state.player;
      const target = api.nearestInCone(state, CONFIG.PLAYER.PUNCH_RANGE ?? 2.0, 1.1);
      if (!target) return true;
      api.damagePed(target, CONFIG.PLAYER.PUNCH_DAMAGE ?? 15, state);
      // Knockback: shove the ped away from the player; they flee.
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 0.001;
      target.x += (dx / d) * 2.5;
      target.z += (dz / d) * 2.5;
      target.state = 'flee';
      target.flee = true;
      target.fleeT = 2;
      target.fleeFrom = { x: p.x, z: p.z };
      state.fxBurst = { type: 'sparks', x: target.x, y: 1.4, z: target.z };
      state.shakeTrauma = Math.min(1, (state.shakeTrauma ?? 0) + 0.15);
      return true;
    },

    shoot(state) {
      if (api.weapon !== 'pistol') return false;
      if (api.reloadT > 0) return false;
      if (api.ammo <= 0) {
        pushEvent(state, { type: 'sfx', name: 'click' });
        api.reload(state);
        return false;
      }
      api.ammo--;
      api.muzzleT = 0.08;
      if (state.stats) state.stats.shotsFired = (state.stats.shotsFired ?? 0) + 1;
      const p = state.player;
      const facing = p.onFoot ? p.yaw : p.car ? p.car.angle : p.yaw;
      const mx = p.x + Math.sin(facing) * 1.2;
      const mz = p.z + Math.cos(facing) * 1.2;
      state.fxBurst = { type: 'muzzle', x: mx, y: 1.4, z: mz };
      pushEvent(state, { type: 'sfx', name: 'gunshot' });
      state.shakeTrauma = Math.min(1, (state.shakeTrauma ?? 0) + 0.12);
      // Noise: a shot near police raises heat.
      const policeNear = (state.cars || []).some(
        (c) => c.isPolice && distTo(c.x, c.z, p.x, p.z) < 60,
      );
      if (policeNear) state.systems?.police?.addHeat?.(1, 'gunshot heard', state);
      // Nearby peds flee the gunfire.
      for (const ped of state.peds || []) {
        if (!ped.isCop && distTo(ped.x, ped.z, p.x, p.z) < 18) {
          ped.state = 'flee';
          ped.flee = true;
          ped.fleeT = 3;
          ped.fleeFrom = { x: p.x, z: p.z };
        }
      }
      // Hit: nearest ped or police car in the cone, damage falls off past 30 m.
      const range = C.PISTOL_RANGE ?? 40;
      const ped = api.nearestInCone(state, range, 0.35);
      const car = api.nearestCarInCone(state, range, 0.35);
      const pd = ped ? distTo(ped.x, ped.z, p.x, p.z) : Infinity;
      const cd = car ? distTo(car.x, car.z, p.x, p.z) : Infinity;
      const d = Math.min(pd, cd);
      if (d === Infinity) return true;
      const dmg =
        d <= (C.PISTOL_FALLOFF ?? 30)
          ? C.PISTOL_DAMAGE ?? 25
          : Math.max(10, Math.round((C.PISTOL_DAMAGE ?? 25) - (d - (C.PISTOL_FALLOFF ?? 30)) * 0.8));
      if (state.stats) state.stats.shotsHit = (state.stats.shotsHit ?? 0) + 1;
      if (pd <= cd) {
        api.damagePed(ped, dmg, state);
      } else {
        car.hp = Math.max(0, (car.hp ?? 100) - dmg);
        if (car.hp <= 0) {
          car.stalled = true;
          car.speed = 0;
          pushEvent(state, { type: 'feed', text: 'Police car disabled!' });
        }
      }
      return true;
    },

    reload(state) {
      if (api.reloadT > 0) return false;
      if (api.ammo >= (C.PISTOL_MAG ?? 12)) return false;
      if (api.reserveAmmo <= 0) {
        pushEvent(state, {
          type: 'feed',
          text: 'No reserve ammo — buy more at the gun shop',
        });
        return false;
      }
      api.reloadT = C.RELOAD_TIME ?? 1.2;
      return true;
    },

    copAttack(dt, state) {
      const p = state.player;
      if (!p || (p.hp ?? 100) <= 0) return;
      api.copHitT -= dt;
      if (api.copHitT > 0) return;
      const near = (state.peds || []).some(
        (c) => c.isCop && c.state !== 'down' && distTo(c.x, c.z, p.x, p.z) < 1.9,
      );
      if (!near) return;
      api.copHitT = 0.9;
      api.damagePlayer(8, state);
    },

    // Walk over the café or hospital to heal +50 (throttled).
    medkitCheck(state) {
      const p = state.player;
      if (!p || (p.hp ?? 100) >= (p.maxHp ?? 100)) return;
      api.healCd -= 1 / 60;
      if (api.healCd > 0) return;
      const cafe = landmark(state, 'cafe');
      const hosp = landmark(state, 'hospital');
      const near =
        distTo(p.x, p.z, cafe.x, cafe.z) < 5 || distTo(p.x, p.z, hosp.x, hosp.z) < 5;
      if (!near) return;
      p.hp = Math.min(p.maxHp ?? 100, p.hp + (C.MEDKIT_HEAL ?? 50));
      state.health = p.hp;
      api.healCd = 5;
      pushEvent(state, { type: 'heal', text: `Patched up +${C.MEDKIT_HEAL ?? 50} HP` });
      state.fxBurst = { type: 'glint', x: p.x, y: 1.6, z: p.z };
    },

    // Walk over the gun shop to buy 12 reserve rounds for $50 (throttled).
    ammoShopCheck(state) {
      api.shopCd -= 1 / 60;
      if (api.shopCd > 0) return;
      if ((state.money ?? 0) < (C.AMMO_PRICE ?? 50)) return;
      if (api.reserveAmmo >= (C.AMMO_PER_BUY ?? 12) * 2) return;
      const p = state.player;
      if (!p) return;
      const shop = landmark(state, 'gunshop');
      if (distTo(p.x, p.z, shop.x, shop.z) >= 5) return;
      state.money -= C.AMMO_PRICE ?? 50;
      api.reserveAmmo += C.AMMO_PER_BUY ?? 12;
      api.shopCd = 10;
      pushEvent(state, {
        type: 'ammo',
        text: `Bought ${C.AMMO_PER_BUY ?? 12} rounds — $${C.AMMO_PRICE ?? 50}`,
      });
    },

    step(dt, state, input) {
      api.punchCd = Math.max(0, api.punchCd - dt);
      api.muzzleT = Math.max(0, api.muzzleT - dt);
      if (api.reloadT > 0) {
        api.reloadT -= dt;
        if (api.reloadT <= 0) {
          api.reloadT = 0;
          const want = (C.PISTOL_MAG ?? 12) - api.ammo;
          const take = Math.min(want, api.reserveAmmo);
          api.ammo += take;
          api.reserveAmmo -= take;
          pushEvent(state, { type: 'sfx', name: 'reload' });
        }
      }
      const p = state.player;
      if (p) {
        p.weapon = api.weapon;
        p.ammo = api.ammo;
        p.reserveAmmo = api.reserveAmmo;
      }
      const jp = input && input.justPressed;
      if (jp) {
        if (jp.has('Digit1')) api.weapon = 'fists';
        if (jp.has('Digit2')) api.weapon = 'pistol';
        if (jp.has('KeyF')) api.punch(state);
        if (jp.has('Mouse0')) api.shoot(state);
        if (jp.has('KeyR')) api.reload(state);
      }
      api.copAttack(dt, state);
      api.medkitCheck(state);
      api.ammoShopCheck(state);
      // Death check: ANY path that zeroes HP triggers WASTED.
      if (p && (p.hp ?? 100) <= 0 && state.screen !== 'wasted' && state.screen !== 'busted') {
        api.die(state);
      }
    },
  };
  return api;
}
