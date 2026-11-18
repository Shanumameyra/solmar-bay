// combat.js — Solmar Bay fists + pistol combat (Worker B, v6 fresh)
// Contract: createCombat(G) -> {weapon:'fists', ammo:12}; updateCombat(G, dt)
// F punch (range 2 m, 15 dmg, 0.4 s cd). Click = pistol (mag 12, R reload 1.2 s,
// 25 dmg, falloff >30 m). Police HP 100, player HP 100, medkit at cafe + hospital (+50).
import { damageCar } from './vehicle.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const CAFE = { x: 0, z: 0 };
const HOSPITAL = { x: 150, z: -100 };

export function createCombat(G) {
  return {
    weapon: 'fists',
    ammo: 12,
    magSize: 12,
    reloadTimer: 0,
    punchTimer: 0,
    shootTimer: 0,
    hp: 100,
    _medkitCooldown: 0,
    _shotFired: false,
  };
}

export function damagePlayer(G, amt) {
  const C = G.combat;
  if (!C || G.state.mode !== 'playing') return;
  C.hp = Math.max(0, C.hp - amt);
  if (G.player) G.player.hp = C.hp;
  if (C.hp <= 0) {
    // WASTED: respawn at the hospital, lose $100.
    const lost = Math.min(100, G.state.money || 0);
    G.state.money = Math.max(0, (G.state.money || 0) - 100);
    if (G.audio) G.audio.sfx('busted');
    if (G.hud && G.hud.say) G.hud.say('WASTED! −$' + lost + ' — you wake up at the hospital');
    if (G.player.car) { G.player.car._driver = null; G.player.car = null; }
    G.player.pos.set(HOSPITAL.x, 0, HOSPITAL.z);
    if (G.player.mesh) G.player.mesh.position.set(HOSPITAL.x, 0, HOSPITAL.z);
    G.player.heading = 0;
    if (G.player.mesh) G.player.mesh.rotation.y = 0;
    G.player.speed = 0;
    C.hp = 100;
    if (G.player) G.player.hp = 100;
    if (G.police) { G.police.stars = 0; if (G.state) G.state.wanted = 0; }
    if (G.missions && G.missions.onBusted) G.missions.onBusted(G);
    G.state.mode = 'wasted';
    G.state.modeTimer = 2.0;
    if (G.saveGame) G.saveGame(G);
  }
}

function aimDir(G) {
  // Shooting follows the camera yaw: use the player's heading on foot,
  // the car heading when driving.
  const p = G.player;
  const h = p.car ? p.car.heading : (p.heading || 0);
  return { x: Math.sin(h), z: Math.cos(h) };
}

function nearestPoliceInCone(G, dirX, dirZ, maxDist) {
  let best = null, bestScore = Infinity;
  const px = G.player.pos.x, pz = G.player.pos.z;
  for (const car of (G.police && G.police.cars) || []) {
    if (car.stalled) continue;
    const dx = car.pos.x - px, dz = car.pos.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > maxDist) continue;
    const dot = (dx * dirX + dz * dirZ) / Math.max(d, 1e-4); // 1 = dead ahead
    if (dot < 0.86) continue; // ~30 deg cone
    const score = d - dot * 5;
    if (score < bestScore) { bestScore = score; best = car; }
  }
  return best;
}

function nearestPedInCone(G, dirX, dirZ, maxDist) {
  const peds = (G.world && G.world.peds) || [];
  let best = null, bestD = Infinity;
  const px = G.player.pos.x, pz = G.player.pos.z;
  for (const ped of peds) {
    if (!ped.pos) continue;
    const dx = ped.pos.x - px, dz = ped.pos.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > maxDist || d > bestD) continue;
    const dot = (dx * dirX + dz * dirZ) / Math.max(d, 1e-4);
    if (dot < 0.9) continue;
    bestD = d; best = ped;
  }
  return best;
}

export function updateCombat(G, dt) {
  const C = G.combat;
  if (!C || !G.player || !G.player.pos) return;
  if (G.state.mode !== 'playing') return;
  const input = G.input || {};
  const pressed = (code) => input.pressed && input.pressed.has(code);

  C.punchTimer = Math.max(0, C.punchTimer - dt);
  C.shootTimer = Math.max(0, C.shootTimer - dt);
  C._medkitCooldown = Math.max(0, (C._medkitCooldown || 0) - dt);
  if (C.reloadTimer > 0) {
    C.reloadTimer -= dt;
    if (C.reloadTimer <= 0) {
      C.ammo = C.magSize;
      if (G.hud && G.hud.say) G.hud.say('Reloaded — 12 rounds ready');
    }
  }

  // Weapon switch: 1 fists, 2 pistol.
  if (pressed('Digit1')) { C.weapon = 'fists'; if (G.hud && G.hud.say) G.hud.say('Fists'); }
  if (pressed('Digit2')) { C.weapon = 'pistol'; if (G.hud && G.hud.say) G.hud.say('Pistol — 12 rounds'); }

  const dir = aimDir(G);
  const px = G.player.pos.x, pz = G.player.pos.z;

  // Punch (F): range 2 m, 15 dmg, 0.4 s cooldown. Knocks peds back (they flee).
  if (pressed('KeyF') && C.punchTimer <= 0) {
    C.punchTimer = 0.4;
    if (G.audio) G.audio.sfx('punch');
    const target = nearestPoliceInCone(G, dir.x, dir.z, 2.2) || nearestPedInCone(G, dir.x, dir.z, 2.2);
    if (target) {
      if (target.hp !== undefined) {
        damageCar(target, 15);
      } else if (target.flee) {
        target.flee = true;
      }
      if (G.effects) G.effects.spawnSparks(px + dir.x * 1.5, pz + dir.z * 1.5);
      if (target.police && G.police) {
        // Hitting a cop is hot.
        if (G.police.addWanted) G.police.addWanted(G, 1);
      }
    }
    // Punch swing animation hook: nudge the player mesh.
    if (G.player.mesh) G.player.mesh.rotation.y = G.player.heading || 0;
  }

  // Shoot (left click): pistol only, mag 12, R reload 1.2 s, 25 dmg, falloff >30 m.
  const wantShoot = (input.mousePressed || (input.mouseDown && C.shootTimer <= 0 && !C._shotFired));
  if (C.weapon === 'pistol' && wantShoot && C.reloadTimer <= 0 && C.shootTimer <= 0) {
    C.shootTimer = 0.22;
    C._shotFired = true;
    if (C.ammo <= 0) {
      if (G.audio) G.audio.sfx('click');
      C.reloadTimer = 1.2;
    } else {
      C.ammo -= 1;
      const mx = px + dir.x * 2.2, mz = pz + dir.z * 2.2;
      if (G.effects) G.effects.muzzle(mx, mz, Math.atan2(dir.x, dir.z));
      if (G.audio) G.audio.sfx('gunshot');
      const cop = nearestPoliceInCone(G, dir.x, dir.z, 40);
      if (cop) {
        const d = Math.hypot(cop.pos.x - px, cop.pos.z - pz);
        const dmg = d > 30 ? 15 : 25; // falloff beyond 30 m
        damageCar(cop, dmg);
        if (G.effects) G.effects.spawnSparks(cop.pos.x, cop.pos.z);
        if (cop.hp <= 0 && G.police) {
          // Cop down: +2 stars, and the cruiser is out of the chase.
          if (G.police.addWanted) G.police.addWanted(G, 2);
          if (G.hud && G.hud.say) G.hud.say('You took down a cruiser — the SBPD will remember that');
        }
      } else {
        const ped = nearestPedInCone(G, dir.x, dir.z, 40);
        if (ped) {
          if (ped.flee !== undefined) ped.flee = true;
          if (G.police) G.police.addWanted(G, 1); // hitting a ped is +1
        }
      }
      // Firing near police draws heat.
      let policeNear = false;
      for (const car of (G.police && G.police.cars) || []) {
        if (Math.hypot(car.pos.x - px, car.pos.z - pz) < 50) { policeNear = true; break; }
      }
      if (policeNear && G.police) G.police.addWanted(G, 1);
    }
  }
  if (!input.mouseDown) C._shotFired = false;

  // Reload (R): 1.2 s.
  if (pressed('KeyR') && C.weapon === 'pistol' && C.reloadTimer <= 0 && C.ammo < C.magSize) {
    C.reloadTimer = 1.2;
    if (G.audio) G.audio.sfx('reload');
  }

  // Medkits: walk over the cafe or the hospital to heal +50 (10 s cooldown each spot).
  if (C._medkitCooldown <= 0 && C.hp < 100) {
    const nearCafe = Math.hypot(px - CAFE.x, pz - CAFE.z) < 6;
    const nearHosp = Math.hypot(px - HOSPITAL.x, pz - HOSPITAL.z) < 6;
    if (nearCafe || nearHosp) {
      C.hp = Math.min(100, C.hp + 50);
      if (G.player) G.player.hp = C.hp;
      C._medkitCooldown = 10;
      if (G.audio) G.audio.sfx('pickup');
      if (G.hud && G.hud.say) G.hud.say('Patched up +50 HP');
    }
  }

  // Keep player.hp in sync (player.js may own the field).
  if (G.player) G.player.hp = C.hp;
}
