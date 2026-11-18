// combat.js — Solmar Bay combat: fists, pistol, health, medkits, gun shop.
// Per DESIGN.md:
//   Fists: punch (F), range 2 m, 15 dmg, 0.4 s cooldown, knocks peds back.
//   Pistol: 12-round mag, R reload (1.2 s), 25 dmg, falloff beyond 30 m,
//           muzzle flash + noise; ammo pickups at the gun shop
//           (buy 12 for $50 - simple shop marker).
//   Police HP 100 (3-4 pistol hits). Player HP 100; medkits at the cafe +
//   hospital (walk over to heal +50). Death (HP 0) -> "WASTED" screen ->
//   respawn at hospital, lose $100. Non-gory: stagger + stars, no blood.
//
// Targets come from G.getPeds() (traffic module, duck-typed) and
// G.police.footCops / G.police.cars. The module never assumes the shape
// of a pedestrian beyond { pos:{x,z}, hp?, alive?, flee?(), stagger?() }.

export const PUNCH_RANGE = 2;
export const PUNCH_DAMAGE = 15;
export const PUNCH_COOLDOWN = 0.4;
export const PISTOL_MAG = 12;
export const PISTOL_DAMAGE = 25;
export const PISTOL_RANGE = 60;
export const PISTOL_FALLOFF = 30;
export const RELOAD_TIME = 1.2;
export const AMMO_PRICE = 50;
export const AMMO_PACK = 12;
export const MEDKIT_HEAL = 50;
export const DEATH_FINE = 100;

export function createCombat(G) {
  let punchCooldown = 0;
  let reloading = 0; // seconds left, 0 = not reloading
  let medkitCooldown = 0;
  let shopCooldown = 0;
  let shootCooldown = 0;

  function playerPos() {
    if (G && typeof G.getPlayerPos === 'function') {
      const p = G.getPlayerPos();
      if (p) return p;
    }
    if (G && G.player && G.player.pos) return G.player.pos;
    return { x: 0, y: 0, z: 0 };
  }

  function playerHeading() {
    if (G && G.player && typeof G.player.heading === 'number') return G.player.heading;
    return 0;
  }

  function peds() {
    if (G && typeof G.getPeds === 'function') {
      try {
        const list = G.getPeds();
        if (Array.isArray(list)) return list;
      } catch (_err) { /* ignore */ }
    }
    if (G && Array.isArray(G.peds)) return G.peds;
    if (G && G.traffic && Array.isArray(G.traffic.peds)) return G.traffic.peds;
    return [];
  }

  function toast(msg, kind) {
    if (G && G.hud && typeof G.hud.toast === 'function') G.hud.toast(msg, kind || 'info');
  }

  function damageTo(target, amount) {
    if (!target || target.alive === false) return false;
    if (typeof target.hp === 'number') {
      target.hp -= amount;
      if (typeof target.stagger === 'function') {
        try {
          target.stagger();
        } catch (_err) { /* ignore */ }
      }
      if (target.hp <= 0) {
        target.alive = false;
        if (typeof target.die === 'function') {
          try {
            target.die();
          } catch (_err) { /* ignore */ }
        }
      }
      return true;
    }
    // Target without HP (e.g. a plain marker): count as hit, no kill.
    if (typeof target.stagger === 'function') {
      try {
        target.stagger();
      } catch (_err) { /* ignore */ }
    }
    return true;
  }

  // Nearest damageable target in front of the player within range and a
  // ~35-degree aim cone. Police foot cops count; police cars do not
  // (shooting a car is a noise/heat event, not a kill).
  function findAimTarget(maxRange) {
    const p = playerPos();
    const heading = playerHeading();
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let best = null;
    let bestScore = Infinity;
    const consider = (t, px, pz) => {
      if (!t || t.alive === false) return;
      const dx = px - p.x;
      const dz = pz - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > maxRange || d < 0.01) return;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.82) return; // ~35 deg cone
      const score = d + (1 - dot) * 10;
      if (score < bestScore) {
        bestScore = score;
        best = { target: t, dist: d };
      }
    };
    for (const ped of peds()) {
      if (ped && ped.pos) consider(ped, ped.pos.x, ped.pos.z);
    }
    if (G && G.police && Array.isArray(G.police.footCops)) {
      for (const cop of G.police.footCops) {
        if (cop && cop.pos) consider(cop, cop.pos.x, cop.pos.z);
      }
    }
    return best;
  }

  function nearestPed(maxRange) {
    const p = playerPos();
    let best = null;
    let bestD = maxRange;
    for (const ped of peds()) {
      if (!ped || !ped.pos || ped.alive === false) continue;
      const dx = ped.pos.x - p.x;
      const dz = ped.pos.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) {
        bestD = d;
        best = { target: ped, dist: d };
      }
    }
    return best;
  }

  const api = {
    get reloading() {
      return reloading > 0;
    },
    get punchReady() {
      return punchCooldown <= 0;
    },

    // --- weapons ---
    switchWeapon(slot) {
      if (!G) return;
      if (slot === 1) {
        G.weapon = 'fists';
      } else if (slot === 2) {
        G.weapon = 'pistol';
      }
      if (G.hud && typeof G.hud.setWeapon === 'function') G.hud.setWeapon(G.weapon);
    },

    punch() {
      if (!G || punchCooldown > 0 || (G.state !== 'playing' && G.state !== undefined)) return false;
      punchCooldown = PUNCH_COOLDOWN;
      const hit = nearestPed(PUNCH_RANGE + 0.5);
      if (G.audio) G.audio.sfx('punch');
      if (hit) {
        damageTo(hit.target, PUNCH_DAMAGE);
        // Knock the ped back away from the player.
        const p = playerPos();
        const dx = hit.target.pos.x - p.x;
        const dz = hit.target.pos.z - p.z;
        const d = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));
        if (typeof hit.target.knockback === 'function') {
          try {
            hit.target.knockback((dx / d) * 4, (dz / d) * 4);
          } catch (_err) { /* ignore */ }
        } else if (typeof hit.target.flee === 'function') {
          try {
            hit.target.flee();
          } catch (_err) { /* ignore */ }
        }
        if (G.effects) G.effects.hitPuff(hit.target.pos.x, 1.2, hit.target.pos.z);
        return true;
      }
      return false;
    },

    shoot() {
      if (!G || reloading > 0 || shootCooldown > 0) return false;
      if (G.weapon !== 'pistol') return false;
      if ((G.ammo || 0) <= 0) {
        if (G.audio) G.audio.sfx('click');
        toast('Out of ammo — press R to reload', 'info');
        api.reload();
        return false;
      }
      shootCooldown = 0.18; // fire rate
      G.ammo -= 1;
      const p = playerPos();
      const heading = playerHeading();
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      if (G.effects) {
        G.effects.muzzle(p.x + fx * 1.2, 1.35, p.z + fz * 1.2, fx, fz);
      }
      if (G.audio) G.audio.sfx('gunshot');
      const hit = findAimTarget(PISTOL_RANGE);
      if (hit) {
        const falloff = hit.dist > PISTOL_FALLOFF
          ? Math.max(0.4, 1 - (hit.dist - PISTOL_FALLOFF) / PISTOL_RANGE)
          : 1;
        damageTo(hit.target, Math.round(PISTOL_DAMAGE * falloff));
        if (G.effects) G.effects.hitPuff(hit.target.pos.x, 1.2, hit.target.pos.z);
      }
      // Noise: shooting near police raises heat.
      if (G.police) {
        const near = G.police.nearestDist ? G.police.nearestDist() : Infinity;
        if (near < 45) G.police.addHeat(1, 'gunshot');
      }
      return true;
    },

    reload() {
      if (!G || reloading > 0) return false;
      if ((G.ammo || 0) >= PISTOL_MAG) return false;
      if ((G.reserveAmmo || 0) <= 0) {
        toast('No reserve ammo — buy more at the gun shop ($50)', 'info');
        return false;
      }
      reloading = RELOAD_TIME;
      if (G.audio) G.audio.sfx('reload');
      return true;
    },

    // Buy 12 rounds for $50 at the gun shop marker (walk into it).
    buyAmmo() {
      if (!G) return false;
      if ((G.money || 0) < AMMO_PRICE) {
        toast('Not enough cash for ammo ($50)', 'info');
        return false;
      }
      G.money -= AMMO_PRICE;
      G.reserveAmmo = (G.reserveAmmo || 0) + AMMO_PACK;
      toast(`Bought ${AMMO_PACK} rounds — $${AMMO_PRICE}`, 'shop');
      if (G.audio) G.audio.sfx('cash');
      if (G.save) G.save.save();
      return true;
    },

    // --- health ---
    damagePlayer(amount, source) {
      if (!G || (G.state !== 'playing' && G.state !== undefined)) return 0;
      if (amount <= 0) return G.health || 0;
      G.health = Math.max(0, (G.health || 0) - amount);
      if (G.effects) G.effects.shake(0.25);
      if (G.health <= 0 && typeof G.wasted === 'function') {
        G.wasted(source || 'damage');
      }
      return G.health;
    },

    heal(amount) {
      if (!G) return 0;
      G.health = Math.min(100, (G.health || 0) + (amount || 0));
      return G.health;
    },

    // --- per-frame ---
    update(dt) {
      const step = Math.min(dt || 0.016, 0.05);
      punchCooldown = Math.max(0, punchCooldown - step);
      shootCooldown = Math.max(0, shootCooldown - step);
      medkitCooldown = Math.max(0, medkitCooldown - step);
      shopCooldown = Math.max(0, shopCooldown - step);
      if (reloading > 0) {
        reloading -= step;
        if (reloading <= 0) {
          reloading = 0;
          if (G) {
            const need = PISTOL_MAG - (G.ammo || 0);
            const take = Math.min(need, G.reserveAmmo || 0);
            G.ammo = (G.ammo || 0) + take;
            G.reserveAmmo = (G.reserveAmmo || 0) - take;
          }
        }
      }
      if (!G || G.state !== 'playing') return;

      // Medkits at the cafe + hospital: walk over to heal +50.
      if (medkitCooldown <= 0 && (G.health || 0) < 100 && G.layout) {
        const p = playerPos();
        const spots = [G.layout.cafe, G.layout.hospital].filter(Boolean);
        for (const s of spots) {
          const dx = p.x - s.x;
          const dz = p.z - s.z;
          if (Math.sqrt(dx * dx + dz * dz) <= 4) {
            medkitCooldown = 5;
            api.heal(MEDKIT_HEAL);
            toast(`Medkit +${MEDKIT_HEAL} HP`, 'heal');
            if (G.audio) G.audio.sfx('heal');
            if (G.effects) G.effects.healPuff(p.x, 1.2, p.z);
            break;
          }
        }
      }

      // Gun shop: walk into the marker to buy ammo (with cooldown).
      if (shopCooldown <= 0 && G.layout && G.layout.gunshop) {
        const p = playerPos();
        const s = G.layout.gunshop;
        const dx = p.x - s.x;
        const dz = p.z - s.z;
        if (Math.sqrt(dx * dx + dz * dz) <= 4) {
          shopCooldown = 3;
          api.buyAmmo();
        }
      }
    },
  };

  return api;
}
