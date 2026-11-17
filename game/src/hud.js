// Solmar Bay — HUD (Worker B). DOM overlay: cash, wanted stars, health,
// weapon + ammo, objective + distance, speed, clock, dialogue, message feed,
// title / pause / busted / wasted screens, low-HP vignette, damage flash.
// Change detection: the DOM is written only when a value actually changes,
// so the HUD never reflows every frame. All element lookups are null-guarded.
// The message feed drains state.events (main.js plays the sfx from the same
// queue BEFORE calling update, so sounds fire once and the feed shows once).

export function createHud(doc) {
  const $ = (id) => (doc ? doc.getElementById(id) : null);
  const el = {
    cash: $('cash'),
    stars: $('stars'),
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    weaponName: $('weapon-name'),
    ammoMag: $('ammo-mag'),
    ammoRes: $('ammo-res'),
    objective: $('objective'),
    objectiveDist: $('objective-dist'),
    missionTimer: $('mission-timer'),
    speed: $('speed'),
    clock: $('clock'),
    dialogue: $('dialogue'),
    feed: $('feed'),
    vignette: $('vignette'),
    flash: $('flash'),
    hint: $('hint'),
    title: $('title-screen'),
    pause: $('pause-screen'),
    busted: $('busted-screen'),
    wasted: $('wasted-screen'),
    hud: $('hud'),
    bustedText: $('busted-text'),
    wastedText: $('wasted-text'),
    titleStats: $('title-stats'),
    pauseStats: $('pause-stats'),
  };

  const hud = {
    last: {},
    lastHp: 100,
    feedItems: [],
    hintT: 0,

    set(id, value) {
      if (this.last[id] === value) return;
      this.last[id] = value;
      const node = el[id];
      if (node) node.textContent = value;
    },

    setHtml(id, value) {
      if (this.last[id] === value) return;
      this.last[id] = value;
      const node = el[id];
      if (node) node.innerHTML = value;
    },

    setStyle(id, prop, value) {
      const key = id + '.' + prop;
      if (this.last[key] === value) return;
      this.last[key] = value;
      const node = el[id];
      if (node) node.style[prop] = value;
    },

    toggle(id, show) {
      const key = id + '.show';
      if (this.last[key] === show) return;
      this.last[key] = show;
      const node = el[id];
      if (node) node.classList.toggle('hidden', !show);
    },

    showMessage(text, kind) {
      if (!el.feed || !text) return;
      const div = doc.createElement('div');
      div.className = 'feed-msg' + (kind ? ' feed-' + kind : '');
      div.textContent = text;
      el.feed.appendChild(div);
      this.feedItems.push({ node: div, t: 0 });
      while (this.feedItems.length > 5) {
        const old = this.feedItems.shift();
        if (old.node.parentNode) old.node.parentNode.removeChild(old.node);
      }
      // Fade out after 4.5 s (handled in update via opacity).
      setTimeout(() => { div.classList.add('feed-fade'); }, 4200);
      setTimeout(() => {
        if (div.parentNode) div.parentNode.removeChild(div);
        this.feedItems = this.feedItems.filter((f) => f.node !== div);
      }, 5000);
    },

    drainEvents(state) {
      // NOTE: main.js plays {type:'sfx'} events BEFORE calling update(), so
      // by the time we drain here the sound has already fired; we just
      // consume them without a feed line.
      if (!state || !state.events) return;
      while (state.events.length) {
        const e = state.events.shift();
        if (e.type === 'sfx') continue;
        if (e.type === 'mission-complete') this.showMessage(e.text, 'good');
        else if (e.type === 'wanted') this.showMessage(e.text, 'bad');
        else if (e.type === 'busted' || e.type === 'wasted') this.showMessage(e.text, 'bad');
        else if (e.type === 'mission-failed') this.showMessage(e.text, 'bad');
        else if (e.type === 'cash' || e.type === 'heal') this.showMessage(e.text, 'good');
        else this.showMessage(e.text, '');
      }
    },

    update(state, screen, dt) {
      if (!state || !state.player) return;
      const p = state.player;
      const wanted = state.wanted || 0;

      // Cash.
      this.set('cash', '$' + Math.floor(state.money || 0).toLocaleString('en-US'));
      // Wanted stars: lit = active, flashing when police are near.
      let stars = '';
      for (let i = 0; i < 5; i++) stars += i < wanted ? '★' : '☆';
      this.set('stars', stars);
      this.toggle('stars', wanted > 0);
      if (el.stars) {
        const flashing = state.policeNear && wanted > 0;
        el.stars.classList.toggle('flashing', !!flashing);
      }
      // Health.
      const hp = Math.max(0, Math.round(p.hp || 0));
      const maxHp = p.maxHp || 100;
      this.set('healthNum', String(hp));
      this.setStyle('healthFill', 'width', Math.round((hp / maxHp) * 100) + '%');
      this.setStyle('healthFill', 'background', hp <= 30 ? '#ff4444' : hp <= 60 ? '#ffb020' : '#39ff88');
      // Damage flash when HP drops.
      if (hp < this.lastHp && el.flash) {
        el.flash.style.opacity = '0.45';
        setTimeout(() => { if (el.flash) el.flash.style.opacity = '0'; }, 120);
      }
      this.lastHp = hp;
      // Low-HP vignette.
      this.toggle('vignette', hp <= 30 && screen === 'play');
      // Weapon + ammo.
      const weapon = (p.weapon || 'fists').toUpperCase();
      this.set('weaponName', weapon === 'PISTOL' ? 'PISTOL' : 'FISTS');
      this.set('ammoMag', weapon === 'PISTOL' ? String(p.ammo ?? 12) : '—');
      this.set('ammoRes', weapon === 'PISTOL' ? String(p.reserveAmmo ?? 0) : '');
      // Objective + distance + mission timer.
      const m = state.mission || {};
      this.set('objective', m.objective || '');
      const marker = m.marker || state.taxiMarker || null;
      const dist = marker ? Math.round(Math.hypot(p.x - marker.x, p.z - marker.z)) : null;
      this.set('objectiveDist', dist != null ? dist + ' m' : '');
      const timer = m.timer || 0;
      this.set('missionTimer', timer > 0 ? fmtTimer(timer) : '');
      // Speed (km/h).
      const kmh = Math.round(Math.abs(p.speed || 0) * 3.6);
      this.set('speed', String(kmh));
      this.set('clock', '17:40');
      // Dialogue line.
      this.set('dialogue', m.dialogue || '');
      this.toggle('dialogue', !!(m.dialogue && screen === 'play'));
      // First-run controls hint: show for the first 8 s of play.
      if (screen === 'play') {
        this.hintT += dt || 0;
        this.toggle('hint', this.hintT < 8);
      } else {
        this.toggle('hint', false);
      }
      // Screens.
      this.toggle('title', screen === 'title');
      this.toggle('pause', screen === 'paused');
      this.toggle('busted', screen === 'busted');
      this.toggle('wasted', screen === 'wasted');
      this.toggle('hud', screen === 'play');
      if (screen === 'title' && el.titleStats) {
        const s = state.stats || {};
        const best = Math.max(s.bestCash || 0, state.money || 0);
        this.set('titleStats', best > 0 ? `Best cash: $${best} · Missions done: ${s.missionsDone || 0}` : '');
      }
      if (screen === 'paused' && el.pauseStats) {
        const s = state.stats || {};
        this.set('pauseStats', `Cash $${Math.floor(state.money || 0)} · Missions ${s.missionsDone || 0} · Cars stolen ${s.carsStolen || 0} · Busted ${s.busted || 0}`);
      }
      this.drainEvents(state);
    },
  };
  return hud;
}

function fmtTimer(t) {
  const s = Math.max(0, Math.ceil(t));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}
