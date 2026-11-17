// Solmar Bay — combat (Worker B). Fists + pistol, cop retaliation, medkits,
// ammo shop, death -> WASTED -> hospital respawn. No gore: hit reactions are
// stagger + stars, never blood.
// Input contract: input.justPressed holds KeyboardEvent.code edges plus
// 'Mouse0' on left click (see NOTES.md input contract). world.step passes
// the RAW input object to combat.step; player.js never touches combat keys.

import { CONFIG } from './config.js';

const PUNCH_RANGE = CONFIG.PLAYER.PUNCH_RANGE; // 2.0
const PUNCH_DMG = CONFIG.PLAYER.PUNCH_DAMAGE; // 15
const PUNCH_CD = CONFIG.PLAYER.PUNCH_COOLDOWN; // 0.4
const PISTOL_DMG = CONFIG.COMBAT.PISTOL_DAMAGE; // 25
const PISTOL_MAG = CONFIG.COMBAT.PISTOL_MAG; // 12
const PISTOL_RANGE = CONFIG.COMBAT.PISTOL_RANGE; // 40
const PISTOL_FULL_RANGE = CONFIG.COMBAT.PISTOL_FALLOFF; // 30
const RELOAD_TIME = CONFIG.COMBAT.RELOAD_TIME; // 1.2
const AMMO_PRICE = CONFIG.COMBAT.AMMO_PRICE; // 50
const AMMO_PACK = CONFIG.COMBAT.AMMO_PER_BUY; // 12

export function createCombat() {
  const combat = {
    weapon: 'fists',
    ammo: 0,
    reserveAmmo: 0,
    punchCd: 0,
    reloadT: 0,
    copHitT: 0,
    healCd: { cafe: 0, hospital: 0 },
    shopCd: 0,
    muzzleT: 0,

    reset() {
      this.weapon = 'fists';
      this.ammo = 0;
      this.reserveAmmo = 0;
      this.punchCd = 0;
      this.reloadT = 0;
      this.copHitT = 0;
      this.healCd = { cafe: 0, hospital: 0 };
      this.shopCd = 0;
      this.muzzleT = 0;
    },

    step(dt, state, input) {
      if (!state || !state.player) return;
      const player = state.player;
      if (this.punchCd > 0) this.punchCd -= dt;
      if (this.muzzleT > 0) this.muzzleT -= dt;
      if (this.shopCd > 0) this.shopCd -= dt;
      for (const k of Object.keys(this.healCd)) {
        if (this.healCd[k] > 0) this.healCd[k] -= dt;
      }
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          const need = PISTOL_MAG - this.ammo;
          const take = Math.min(need, this.reserveAmmo);
          this.ammo += take;
          this.reserveAmmo -= take;
          pushEvent(state, 'info', take > 0 ? 'Reloaded' : 'No reserve ammo — buy more at the gun shop');
        }
      }
      // Mirror weapon state onto the player for HUD/render (even with no input).
      player.weapon = this.weapon;
      player.ammo = this.ammo;
      player.reserveAmmo = this.reserveAmmo;
      // Death: any path that zeroes the player's HP (world.damagePlayer,
      // cop attacks) triggers the WASTED flow once. die() restores HP to
      // full and sets screen 'wasted', so this cannot re-fire.
      if (player.hp <= 0 && state.screen !== 'wasted') {
        this.die(state);
        return;
      }
      if (!input) return;
      const jp = input.justPressed || new Set();
      if (jp.has('Digit1')) { this.weapon = 'fists'; pushEvent(state, 'info', 'Fists'); }
      if (jp.has('Digit2')) {
        if (this.ammo > 0 || this.reserveAmmo > 0) { this.weapon = 'pistol'; pushEvent(state, 'info', 'Pistol'); }
        else pushEvent(state, 'info', 'No pistol yet — buy one at the gun shop ($50)');
      }
      if (jp.has('KeyF')) this.punch(state);
      if (jp.has('KeyR')) this.reload(state);
      if (jp.has('Mouse0') && this.weapon === 'pistol') this.shoot(state);
      this.copAttack(dt, state);
      this.medkitCheck(dt, state);
      this.ammoShopCheck(dt, state);
    },

    punch(state) {
      if (this.punchCd > 0 || this.reloadT > 0) return;
      const player = state.player;
      this.punchCd = PUNCH_CD;
      const target = this.nearestInCone(state, PUNCH_RANGE, 1.1);
      pushEvent(state, 'sfx', 'punch');
      state.fxBurst = { type: 'stars', x: player.x + Math.sin(player.yaw) * 1.5, y: 1.4, z: player.z + Math.cos(player.yaw) * 1.5 };
      if (!target) return;
      this.damagePed(state, target, PUNCH_DMG, 'punch');
      // Knockback: shove the ped away from the player.
      const dx = target.x - player.x;
      const dz = target.z - player.z;
      const d = Math.hypot(dx, dz) || 0.001;
      target.x += (dx / d) * 2;
      target.z += (dz / d) * 2;
      target.state = 'flee';
      target.fleeT = 3;
      state.shakeTrauma = Math.min(1, (state.shakeTrauma || 0) + 0.12);
    },

    shoot(state) {
      if (this.reloadT > 0) return;
      const player = state.player;
      if (this.ammo <= 0) {
        pushEvent(state, 'sfx', 'click');
        pushEvent(state, 'info', 'Empty — press R to reload');
        this.reload(state);
        return;
      }
      this.ammo -= 1;
      state.stats.shotsFired = (state.stats.shotsFired || 0) + 1;
      this.muzzleT = 0.08;
      pushEvent(state, 'sfx', 'gunshot');
      const fx = Math.sin(player.yaw);
      const fz = Math.cos(player.yaw);
      state.fxBurst = { type: 'flash', x: player.x + fx * 1.2, y: 1.5, z: player.z + fz * 1.2 };
      const target = this.nearestInCone(state, PISTOL_RANGE, 0.14);
      if (target) {
        const dist = Math.hypot(target.x - player.x, target.z - player.z);
        const falloff = dist <= PISTOL_FULL_RANGE
          ? 1 : Math.max(0.5, 1 - (dist - PISTOL_FULL_RANGE) / (PISTOL_RANGE - PISTOL_FULL_RANGE) * 0.5);
        state.stats.shotsHit = (state.stats.shotsHit || 0) + 1;
        this.damagePed(state, target, Math.round(PISTOL_DMG * falloff), 'shot');
      }
      // Gunfire near police draws heat.
      const police = state.systems && state.systems.police;
      if (police) {
        const near = (state.cars || []).some((c) => c.isPolice
          && Math.hypot(c.x - player.x, c.z - player.z) < 40)
          || (state.peds || []).some((p) => p.isCop
            && Math.hypot(p.x - player.x, p.z - player.z) < 40);
        if (near) police.addHeat(CONFIG.WANTED.HEAT.SHOT_NEAR_POLICE, 'shot', state);
      }
    },

    reload(state) {
      if (this.reloadT > 0 || this.ammo >= PISTOL_MAG) return;
      if (this.reserveAmmo <= 0) {
        pushEvent(state, 'info', 'No reserve ammo — buy more at the gun shop ($50)');
        return;
      }
      this.reloadT = RELOAD_TIME;
      pushEvent(state, 'info', 'Reloading…');
    },

    damagePed(state, ped, dmg, kind) {
      // ?? not ||: hp 0 is a real value (down), and (0 || 100) would
      // resurrect a downed ped to ~100 HP on a second hit.
      ped.hp = (ped.hp ?? 100) - dmg;
      state.fxBurst = { type: 'stars', x: ped.x, y: 1.4, z: ped.z };
      if (ped.isCop) {
        // Hitting a cop is a crime.
        const police = state.systems && state.systems.police;
        if (police && kind === 'punch') police.addHeat(1, 'assault', state);
      } else if (kind === 'punch' || kind === 'shot') {
        // Hitting a pedestrian draws heat too.
        const police = state.systems && state.systems.police;
        if (police) police.addHeat(CONFIG.WANTED.HEAT.HIT_PED, 'ped', state);
      }
      if (ped.hp <= 0) {
        if (ped.isCop) {
          // Cop down: he stays down, heat rises.
          ped.state = 'down';
          ped.hp = 0;
          const police = state.systems && state.systems.police;
          if (police) police.addHeat(CONFIG.WANTED.HEAT.KILL_COP, 'cop down', state);
          pushEvent(state, 'info', 'Cop down — the SBPD will not forget this');
        } else {
          ped.state = 'down';
          ped.hp = 0;
          pushEvent(state, 'info', 'Pedestrian down — witnesses called it in');
        }
        ped.downT = 20;
      } else {
        ped.state = 'flee';
        ped.fleeT = 3;
      }
    },

    copAttack(dt, state) {
      const player = state.player;
      this.copHitT -= dt;
      if (this.copHitT > 0) return;
      const peds = state.peds || [];
      for (const p of peds) {
        if (!p.isCop || p.state === 'down') continue;
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        if (d < 2.0 && !player.inCar) {
          this.copHitT = 1.0;
          this.damagePlayer(state, 8, 'cop');
          return;
        }
      }
    },

    damagePlayer(state, dmg, source) {
      const player = state.player;
      // ?? not ||: hp 0 is a real value, and (0 || 100) would resurrect a
      // dead player to ~100 HP on a second hit in the same frame.
      player.hp = Math.max(0, (player.hp ?? 100) - dmg);
      state.health = player.hp;
      state.shakeTrauma = Math.min(1, (state.shakeTrauma || 0) + 0.25);
      pushEvent(state, 'sfx', 'punch');
      if (player.hp <= 0) this.die(state);
    },

    die(state) {
      const player = state.player;
      const lost = Math.min(state.money || 0, CONFIG.COMBAT.DEATH_FINE);
      state.money = Math.max(0, (state.money || 0) - CONFIG.COMBAT.DEATH_FINE);
      state.stats.deaths = (state.stats.deaths || 0) + 1;
      // Clear the heat: the cops stop chasing a dead man.
      const police = state.systems && state.systems.police;
      if (police) police.reset();
      state.wanted = 0;
      // A wasted mission fails (missions.js re-arms at the café).
      if (state.systems && state.systems.missions && state.systems.missions.phase === 'active') {
        state.systems.missions.fail(state, 'Wasted — the job fell through');
      }
      const hospital = (state.landmarks && state.landmarks.hospital)
        || (state.spawnPoints && state.spawnPoints.hospital)
        || { x: 0, z: 0 };
      const pcar = player.carId != null
        ? (state.cars || []).find((c) => c.id === player.carId) : null;
      if (pcar) pcar.driver = null;
      // Fully get out of the car (see police.js bust): otherwise stepPlayer
      // syncs the player back to the wrecked car's position next step.
      player.car = null;
      player.carId = null;
      player.inCar = false;
      player.onFoot = true;
      player.x = hospital.x;
      player.z = hospital.z;
      player.hp = player.maxHp || 100;
      state.health = player.hp;
      player.speed = 0;
      this.ammo = PISTOL_MAG;
      state.screen = 'wasted';
      state.screenT = 2.5;
      pushEvent(state, 'wasted', `WASTED — you lost $${lost}`);
      pushEvent(state, 'sfx', 'wasted');
    },

    medkitCheck(dt, state) {
      const player = state.player;
      if ((player.hp || 100) >= (player.maxHp || 100)) return;
      for (const spot of ['cafe', 'hospital']) {
        const lm = (state.landmarks && state.landmarks[spot])
          || (state.spawnPoints && state.spawnPoints[spot]);
        if (!lm) continue;
        if (this.healCd[spot] > 0) continue;
        if (Math.hypot(player.x - lm.x, player.z - lm.z) < 5) {
          this.healCd[spot] = 10;
          player.hp = Math.min(player.maxHp || 100, (player.hp || 0) + CONFIG.COMBAT.MEDKIT_HEAL);
          state.health = player.hp;
          pushEvent(state, 'heal', `Patched up +${CONFIG.COMBAT.MEDKIT_HEAL} HP (${spot === 'cafe' ? "Rosa's" : 'hospital'})`);
          pushEvent(state, 'sfx', 'heal');
        }
      }
    },

    ammoShopCheck(dt, state) {
      const player = state.player;
      if (this.shopCd > 0) return;
      if (this.reserveAmmo >= 36) return;
      if ((state.money || 0) < AMMO_PRICE) return;
      const shop = (state.landmarks && state.landmarks.gunshop)
        || (state.spawnPoints && state.spawnPoints.gunshop);
      if (!shop) return;
      if (Math.hypot(player.x - shop.x, player.z - shop.z) < 5) {
        this.shopCd = 5;
        state.money -= AMMO_PRICE;
        this.reserveAmmo += AMMO_PACK;
        pushEvent(state, 'cash', `Bought ${AMMO_PACK} rounds -$${AMMO_PRICE}`);
        pushEvent(state, 'sfx', 'cash');
      }
    },

    nearestInCone(state, range, halfAngle) {
      const player = state.player;
      const peds = state.peds || [];
      let best = null;
      let bestD = range;
      for (const p of peds) {
        if (p.state === 'down') continue;
        const dx = p.x - player.x;
        const dz = p.z - player.z;
        const d = Math.hypot(dx, dz);
        if (d > range || d < 0.01) continue;
        const ang = Math.atan2(dx, dz);
        let diff = ang - (player.yaw || 0);
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > halfAngle) continue;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    },
  };
  return combat;
}

function pushEvent(state, type, text) {
  if (!state.events) state.events = [];
  if (state.events.length > 24) state.events.shift();
  state.events.push({ type, text, t: state.time || 0 });
}
