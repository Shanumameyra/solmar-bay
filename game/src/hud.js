// HUD — cash, wanted stars, health, weapon/ammo, objective + distance,
// speed, clock, message feed, dialogue, and the title/pause/busted/wasted screens.
import { missionObjective } from './missions.js';

const SCREEN_IDS = ['title', 'pause', 'busted', 'wasted'];

export function createHud() {
  const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  return {
    cash: byId('cash'),
    stars: byId('stars'),
    minimap: byId('minimap'),
    hpbar: byId('hpbar'),
    hpfill: byId('hpfill'),
    weapon: byId('weapon'),
    ammo: byId('ammo'),
    objective: byId('objective'),
    distance: byId('distance'),
    messages: byId('messages'),
    speed: byId('speed'),
    clock: byId('clock'),
    dialogue: byId('dialogue'),
    title: byId('title'),
    pause: byId('pause'),
    busted: byId('busted'),
    wasted: byId('wasted'),
    _lastMsgCount: -1,
  };
}

function playerPos(S) {
  const p = S.player || {};
  if (p.pos) return { x: p.pos.x, z: p.pos.z };
  if (p.position) return { x: p.position.x, z: p.position.z };
  return { x: p.x || 0, z: p.z || 0 };
}

function playerSpeed(S) {
  const p = S.player || {};
  if (p.car && typeof p.car.speed === 'number') return Math.abs(p.car.speed);
  return Math.abs(p.speed ?? 0);
}

function moneyOf(S) {
  if (typeof S.player?.money === 'number') return S.player.money;
  if (typeof S.money === 'number') return S.money;
  return 0;
}

function markerDist(S) {
  const marker = S.missions?.marker;
  if (!marker) return null;
  const pp = playerPos(S);
  return Math.round(Math.hypot(marker.x - pp.x, marker.z - pp.z));
}

export function toast(S, text) {
  if (!S.messages) S.messages = [];
  S.messages.push({ text, t: S.time || 0 });
}

export function showScreen(hud, name) {
  if (!hud) return;
  for (const id of SCREEN_IDS) {
    const el = hud[id];
    if (el) el.style.display = id === name ? 'flex' : 'none';
  }
}

export function updateHud(S, dt) {
  const hud = S.hud;
  if (!hud) return;
  const t = S.time || 0;

  // Cash.
  if (hud.cash) hud.cash.textContent = `$${moneyOf(S)}`;

  // Wanted stars: five stars, lit = active, flashing when police are near.
  if (hud.stars) {
    const stars = S.police?.stars || 0;
    let near = false;
    const pp = playerPos(S);
    for (const cop of S.police?.cops || []) {
      if (cop.disabled) continue;
      if (Math.hypot((cop.x ?? 0) - pp.x, (cop.z ?? 0) - pp.z) < 30) { near = true; break; }
    }
    const flash = near && Math.floor(t * 3) % 2 === 0;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const lit = i <= stars;
      const cls = lit ? (flash ? 'star lit flash' : 'star lit') : 'star';
      html += `<span class="${cls}">★</span>`;
    }
    if (hud.stars.innerHTML !== html) hud.stars.innerHTML = html;
  }

  // Health bar.
  const hp = typeof S.player?.hp === 'number' ? S.player.hp : 100;
  if (hud.hpfill) {
    hud.hpfill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    hud.hpfill.style.background = hp > 50 ? '#37d67a' : hp > 25 ? '#f5a623' : '#e5484d';
  }

  // Weapon + ammo.
  if (hud.weapon) hud.weapon.textContent = S.combat?.weapon === 'pistol' ? 'PISTOL' : 'FISTS';
  if (hud.ammo) {
    hud.ammo.textContent = S.combat?.weapon === 'pistol'
      ? `${S.combat.ammo ?? 0} / ${S.combat.mag ?? 12}${S.combat.reloading ? ' …' : ''}`
      : '—';
  }

  // Objective + distance to marker.
  let objective = S.objective;
  try { objective = missionObjective(S) || objective; } catch (e) { /* keep S.objective */ }
  if (hud.objective && objective) hud.objective.textContent = objective;
  const d = markerDist(S);
  if (hud.distance) hud.distance.textContent = d === null ? '' : `${d} m`;

  // Speed (km/h) and the fixed golden-hour clock.
  if (hud.speed) hud.speed.textContent = `${Math.round(playerSpeed(S) * 3.6)} km/h`;
  if (hud.clock) hud.clock.textContent = '17:40';

  // Dialogue line.
  if (hud.dialogue) {
    const line = S.missions?.dialogue || '';
    if (hud.dialogue.textContent !== line) hud.dialogue.textContent = line;
  }

  // Message feed: keep the last 5 s, fade the oldest.
  if (hud.messages) {
    const fresh = (S.messages || []).filter((m) => t - (m.t || 0) < 5);
    S.messages = (S.messages || []).filter((m) => t - (m.t || 0) < 8);
    if (fresh.length !== hud._lastMsgCount || fresh.length > 0) {
      hud._lastMsgCount = fresh.length;
      hud.messages.innerHTML = fresh
        .map((m) => `<div class="msg">${escapeHtml(m.text)}</div>`)
        .join('');
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
