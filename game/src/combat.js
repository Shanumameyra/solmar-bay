// Combat — fists, pistol, reload, ammo shop, healing. No gore:
// hits stagger, push back, and raise wanted stars.
import { addHeat } from './police.js';

export function createCombat() {
  return {
    weapon: 'fists',
    ammo: 0,
    mag: 12,
    cooldown: 0,
    reloadT: 0,
    reloading: false,
  };
}

function playerPos(S) {
  const p = S.player || {};
  if (p.pos) return { x: p.pos.x, z: p.pos.z };
  if (p.position) return { x: p.position.x, z: p.position.z };
  return { x: p.x || 0, z: p.z || 0 };
}

function playerHeading(S) {
  const p = S.player || {};
  return p.heading ?? p.h ?? p.angle ?? 0;
}

function playerHp(S) {
  return typeof S.player?.hp === 'number' ? S.player.hp : 100;
}

function setPlayerHp(S, hp) {
  if (S.player) S.player.hp = Math.max(0, Math.min(100, hp));
}

// Everyone who can be hit: pedestrians plus live cops. Peds carry no hp
// field of their own (traffic.js), so an absent hp means a full 100.
function targets(S) {
  const out = [];
  for (const ped of S.peds || []) {
    if ((ped.hp ?? 100) > 0) out.push({ kind: 'ped', ref: ped, x: ped.x ?? ped.pos?.x ?? 0, z: ped.z ?? ped.pos?.z ?? 0 });
  }
  for (const cop of S.police?.cops || []) {
    if (!cop.disabled) {
      out.push({ kind: 'cop', ref: cop, x: cop.x ?? cop.car?.x ?? 0, z: cop.z ?? cop.car?.z ?? 0 });
    }
  }
  return out;
}

function nearestInFront(S, maxDist, maxAngle) {
  const pp = playerPos(S);
  const h = playerHeading(S);
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  let best = null;
  let bestD = Infinity;
  for (const t of targets(S)) {
    const dx = t.x - pp.x;
    const dz = t.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (d > maxDist || d < 0.01) continue;
    const dot = (dx / d) * fx + (dz / d) * fz;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (angle > maxAngle) continue;
    if (d < bestD) { bestD = d; best = { ...t, dist: d, dx, dz }; }
  }
  return best;
}

function hurtTarget(S, t, damage) {
  const ref = t.ref;
  if (t.kind === 'ped') {
    ref.hp = (ref.hp ?? 100) - damage;
    // Knock back and make them flee.
    const d = Math.max(0.01, t.dist);
    ref.x = (ref.x ?? 0) + (t.dx / d) * 2;
    ref.z = (ref.z ?? 0) + (t.dz / d) * 2;
    ref.fleeing = true;
    ref.fleeT = 3;
    if (ref.hp <= 0) {
      ref.hp = 0;
      ref.down = true;
    }
  } else {
    ref.hp = (ref.hp ?? 100) - damage;
    if (ref.car) ref.car.hp = ref.hp;
    if (ref.hp <= 0) {
      ref.hp = 0;
      ref.disabled = true;
      ref.speed = 0;
      if (ref.mesh) ref.mesh.visible = true;
      try { addHeat(S, 2); } catch (e) { /* police optional in shots */ }
      if (S.messages) S.messages.push({ text: 'Cop disabled! +★★', t: S.time || 0 });
      if (S.effects && typeof S.effects.spawnSmoke === 'function') {
        try { S.effects.spawnSmoke(S, { x: t.x, y: 1, z: t.z }); } catch (e) { /* ignore */ }
      }
    }
  }
}

export function punch(S) {
  const c = S.combat;
  if (!c || c.cooldown > 0 || c.reloadT > 0) return;
  c.cooldown = 0.4;
  const t = nearestInFront(S, 2, 1.1);
  if (S.audio && typeof S.audio.sfx === 'function') {
    try { S.audio.sfx(S, 'punch'); } catch (e) { /* ignore */ }
  }
  if (!t) return;
  hurtTarget(S, t, 15);
  if (t.kind === 'ped') {
    try { addHeat(S, 1); } catch (e) { /* ignore */ }
  }
}

export function shoot(S) {
  const c = S.combat;
  if (!c || c.weapon !== 'pistol') return;
  if (c.cooldown > 0 || c.reloadT > 0) return;
  if (c.ammo <= 0) {
    if (S.audio && typeof S.audio.sfx === 'function') {
      try { S.audio.sfx(S, 'click'); } catch (e) { /* ignore */ }
    }
    if (S.messages) S.messages.push({ text: 'Out of ammo — press R to reload', t: S.time || 0 });
    return;
  }
  c.cooldown = 0.25;
  c.ammo -= 1;
  const pp = playerPos(S);
  const h = playerHeading(S);
  const muzzle = { x: pp.x + Math.sin(h) * 1.2, y: 1.3, z: pp.z + Math.cos(h) * 1.2 };
  const dir = { x: Math.sin(h), y: 0, z: Math.cos(h) };
  if (S.effects && typeof S.effects.muzzleFlash === 'function') {
    try { S.effects.muzzleFlash(S, muzzle, dir); } catch (e) { /* ignore */ }
  }
  if (S.audio && typeof S.audio.sfx === 'function') {
    try { S.audio.sfx(S, 'gunshot'); } catch (e) { /* ignore */ }
  }
  const t = nearestInFront(S, 45, 0.35);
  if (t) {
    const damage = t.dist <= 30 ? 25 : 12; // falloff beyond 30 m
    hurtTarget(S, t, damage);
    if (S.effects && typeof S.effects.spawnSparks === 'function') {
      try { S.effects.spawnSparks(S, { x: t.x, y: 1.2, z: t.z }); } catch (e) { /* ignore */ }
    }
  }
  // Noise draws the law if a cop is close.
  if (S.police) {
    let near = false;
    for (const cop of S.police.cops || []) {
      if (cop.disabled) continue;
      const d = Math.hypot((cop.x ?? 0) - pp.x, (cop.z ?? 0) - pp.z);
      if (d < 40) { near = true; break; }
    }
    if (near) {
      try { addHeat(S, 1); } catch (e) { /* ignore */ }
    }
  }
}

export function reload(S) {
  const c = S.combat;
  if (!c || c.weapon !== 'pistol') return;
  if (c.reloading || c.ammo >= c.mag) return;
  c.reloading = true;
  c.reloadT = 1.2;
}

export function switchWeapon(S, w) {
  const c = S.combat;
  if (!c) return;
  if (w !== 'fists' && w !== 'pistol') return;
  c.weapon = w;
  c.reloadT = 0;
  c.reloading = false;
  if (w === 'pistol' && c.ammo <= 0) {
    // First time arming the pistol, grant a starter mag if the player owns none.
    if (!c.everArmed) { c.ammo = c.mag; c.everArmed = true; }
  }
}

export function buyAmmo(S) {
  const c = S.combat;
  if (!c) return false;
  const shop = S.missions?.landmarks?.gunshop || { x: 60, z: -40 };
  const pp = playerPos(S);
  if (Math.hypot(pp.x - shop.x, pp.z - shop.z) > 8) {
    if (S.messages) S.messages.push({ text: 'Ammo is sold at the gun shop', t: S.time || 0 });
    return false;
  }
  const p = S.player || {};
  if ((p.money ?? S.money ?? 0) < 50) {
    if (S.messages) S.messages.push({ text: 'Not enough cash for ammo ($50)', t: S.time || 0 });
    return false;
  }
  if (typeof p.money === 'number') p.money -= 50;
  else if (typeof S.money === 'number') S.money -= 50;
  c.ammo = c.mag;
  if (S.audio && typeof S.audio.sfx === 'function') {
    try { S.audio.sfx(S, 'pickup'); } catch (e) { /* ignore */ }
  }
  if (S.messages) S.messages.push({ text: 'Bought 12 rounds — $50', t: S.time || 0 });
  return true;
}

export function healPlayer(S) {
  const cafe = S.missions?.landmarks?.cafe || { x: 0, z: 0 };
  const hospital = S.missions?.landmarks?.hospital || { x: 100, z: 90 };
  const pp = playerPos(S);
  const nearCafe = Math.hypot(pp.x - cafe.x, pp.z - cafe.z) < 8;
  const nearHospital = Math.hypot(pp.x - hospital.x, pp.z - hospital.z) < 8;
  if (!nearCafe && !nearHospital) return false;
  if (playerHp(S) >= 100) return false;
  setPlayerHp(S, playerHp(S) + 50);
  if (S.messages) S.messages.push({ text: 'Patched up +50 HP', t: S.time || 0 });
  return true;
}

// Cooldown / reload tick, called from the main loop.
export function updateCombat(S, dt) {
  const c = S.combat;
  if (!c) return;
  if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);
  if (c.reloadT > 0) {
    c.reloadT -= dt;
    if (c.reloadT <= 0) {
      c.reloadT = 0;
      c.reloading = false;
      c.ammo = c.mag;
      if (S.messages) S.messages.push({ text: 'Reloaded', t: S.time || 0 });
    }
  }
}
