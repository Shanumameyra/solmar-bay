// hud.js — DOM HUD: cash, wanted stars, health, weapon/ammo, objective +
// distance + timer, clock, speed, message feed, dialogue, damage flash,
// title / pause / busted / wasted screens.
//
// Change-detected DOM writes (nothing is rewritten unless its value moved).
// Drains state.events for the feed (shifts them out); main.js plays SFX
// from the same queue BEFORE hud.update, reading a copy.

import { CONFIG } from './config.js';

// Null-object stand-in for a missing element (headless tests, partial DOM).
const NULL_EL = {
  textContent: '',
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild() {},
  removeChild() {},
  setAttribute() {},
  get children() { return []; },
  get firstChild() { return null; },
};

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

function fmtClock(state) {
  const mins = (CONFIG.START.TIME_OF_DAY ?? 17.67) * 60 + (state.time ?? 0) / 60;
  const hh = Math.floor(mins / 60) % 24;
  const mm = Math.floor(mins % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function fmtTimer(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(document) {
  const $ = (id) => (document && document.getElementById(id)) || NULL_EL;
  const els = {
    cash: $('cash'),
    stars: $('stars'),
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    weapon: $('weapon'),
    ammo: $('ammo'),
    ammoRes: $('ammo-res'),
    objective: $('objective'),
    objDist: $('obj-dist'),
    objTimer: $('obj-timer'),
    clock: $('clock'),
    speed: $('speed-num'),
    feed: $('feed'),
    dialogue: $('dialogue'),
    dialogueText: $('dialogue-text'),
    damageFlash: $('damage-flash'),
    vignette: $('vignette'),
    title: $('title-screen'),
    pause: $('pause-screen'),
    busted: $('busted-screen'),
    wasted: $('wasted-screen'),
    titleStats: $('title-stats'),
    hintBar: $('hint-bar'),
    status: $('status'),
  };

  const last = {};
  const feedItems = []; // {el, at}
  let flashT = 0;
  let lastHp = 100;
  let lastScreen = '';
  let lastNow = 0; // game time of the most recent update() — showMessage
  // stamps feed items with this, so a message shown before the first
  // update (at game time 0) is not instantly aged out once time > 6 s.

  function setText(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  function show(el, on) {
    if (!el || !el.classList) return;
    if (on) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  function addFeed(text, kind, at) {
    if (!text || !els.feed || !document) return;
    const div = document.createElement('div');
    div.className = 'feed-item' + (kind ? ' feed-' + kind : '');
    div.textContent = text;
    els.feed.appendChild(div);
    feedItems.push({ el: div, at });
    while (feedItems.length > 5) {
      const old = feedItems.shift();
      if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
      else if (els.feed.removeChild) {
        try { els.feed.removeChild(old.el); } catch (e) { /* already gone */ }
      }
    }
  }

  const api = {
    update(state, screen, dt) {
      if (!state) return;
      const p = state.player || {};
      const now = state.time ?? 0;
      lastNow = now;

      // Drain the transient event queue into the feed (and flashes).
      if (Array.isArray(state.events)) {
        while (state.events.length) {
          const ev = state.events.shift();
          if (ev.type === 'damage') {
            flashT = Math.max(flashT, 0.45);
          } else if (ev.type === 'busted' || ev.type === 'wasted') {
            flashT = Math.max(flashT, 0.8);
            if (ev.text) addFeed(ev.text, ev.type, now);
          } else if (ev.text) {
            addFeed(ev.text, ev.type, now);
          }
        }
      }
      // Age feed items out after ~6 s.
      for (let i = feedItems.length - 1; i >= 0; i--) {
        if (now - feedItems[i].at > 6) {
          const item = feedItems.splice(i, 1)[0];
          if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el);
        }
      }

      // Cash, with a thousands separator ($1,234, not $1234).
      setText(els.cash, 'cash', `$${(state.money ?? 0).toLocaleString('en-US')}`);

      // Wanted stars (flashing while police are near).
      const w = state.wanted ?? 0;
      setText(els.stars, 'stars', stars(w));
      if (els.stars.classList) {
        els.stars.classList.toggle('hot', !!state.policeNear && w > 0);
        els.stars.classList.toggle('none', w === 0);
      }

      // Health bar (red under 30).
      const hp = p.hp ?? state.health ?? 100;
      const maxHp = p.maxHp ?? 100;
      const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
      if (last.hp !== pct) {
        last.hp = pct;
        els.healthFill.style.width = `${pct}%`;
        els.healthFill.classList.toggle('low', pct < 30);
      }
      setText(els.healthNum, 'hpnum', `${Math.ceil(hp)}`);
      if (hp < lastHp) flashT = Math.max(flashT, 0.35);
      lastHp = hp;
      show(els.vignette, hp < 30 && screen === 'play');

      // Damage flash (decays in real time).
      if (flashT > 0) {
        flashT = Math.max(0, flashT - (dt ?? 0.016));
        els.damageFlash.style.opacity = String(Math.min(0.55, flashT));
      } else if (els.damageFlash.style.opacity !== '0') {
        els.damageFlash.style.opacity = '0';
      }

      // Weapon + ammo.
      const weapon = (p.weapon || 'fists').toUpperCase();
      setText(els.weapon, 'weapon', weapon);
      setText(els.ammo, 'ammo', `${p.ammo ?? 0}`);
      setText(els.ammoRes, 'ammores', `${p.reserveAmmo ?? 0}`);

      // Objective + distance + timer.
      const m = state.mission || {};
      setText(els.objective, 'obj', m.objective || 'Explore Solmar Bay');
      if (m.marker) {
        const d = Math.hypot((p.x ?? 0) - m.marker.x, (p.z ?? 0) - m.marker.z);
        setText(els.objDist, 'objdist', `${Math.round(d)} m`);
      } else {
        setText(els.objDist, 'objdist', '');
      }
      setText(els.objTimer, 'objtimer', m.timer > 0 ? fmtTimer(m.timer) : '');

      // Clock ticks with game time (17:40 + elapsed).
      setText(els.clock, 'clock', fmtClock(state));

      // Speed (km/h) — the car when driving, feet otherwise.
      const spd = p.car ? p.car.speed ?? 0 : p.speed ?? 0;
      setText(els.speed, 'speed', `${Math.round(spd * 3.6)}`);

      // Rosa's dialogue line.
      const dlg = m.dialogue || '';
      setText(els.dialogueText, 'dlg', dlg);
      show(els.dialogue, !!dlg && screen === 'play');

      // Title stats (best cash, missions done).
      if (screen === 'title' && state.stats) {
        setText(
          els.titleStats,
          'tstats',
          `Best cash $${(state.stats.bestCash ?? 0).toLocaleString('en-US')} · Missions done ${state.stats.missionsDone ?? 0}`,
        );
      }

      // Screens.
      show(els.title, screen === 'title');
      show(els.pause, screen === 'paused');
      show(els.busted, screen === 'busted');
      show(els.wasted, screen === 'wasted');
      show(els.hintBar, screen === 'play');
      if (screen !== lastScreen) {
        lastScreen = screen;
        const label = {
          title: 'Solmar Bay — title screen. Press Enter to start.',
          play: 'Playing Solmar Bay.',
          paused: 'Paused.',
          busted: 'Busted by the SBPD.',
          wasted: 'Wasted.',
        }[screen] || '';
        if (els.status) els.status.textContent = label;
      }
    },

    showMessage(text, kind) {
      addFeed(text, kind, lastNow);
    },

    // Test/externals hook: force the flash (e.g. after a big hit).
    flash() {
      flashT = 0.5;
    },
  };
  return api;
}
