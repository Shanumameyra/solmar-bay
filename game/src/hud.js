// Solmar Bay — HUD (Worker B). DOM overlay: mission panel + police response
// (top-left), cash/stars/clock/IN SIGHT/weapon slots (top-right), round
// minimap + health/rep + location (bottom-left), Mama Rosa dialogue card
// (bottom-centre), big speed + car + condition + radio (bottom-right),
// message feed, title / pause / busted / wasted screens, low-HP vignette,
// damage flash. Reference layout: the #1 entry's HUD.
// Change detection: the DOM is written only when a value actually changes,
// so the HUD never reflows every frame. All element lookups are null-guarded.
// The message feed drains state.events (main.js plays the sfx from the same
// queue BEFORE calling update, so sounds fire once and the feed shows once).
import { CONFIG } from './config.js';

const POLICE_CALLSIGNS = ['MARLIN-11', 'SNAPPER-25', 'TARPON-18', 'REEF-7', 'BARRACUDA-9'];
const REP_LEVELS = ['STREET RAT', 'HUSTLER', 'BAY HUSTLER', 'KINGPIN'];
const DISTRICT_NAMES = {
  beach: 'CORAL SHORE', plaza: 'MARKET PLAZA', downtown: 'DOWNTOWN',
  port: 'THE DOCKS', barrios: 'BARRIOS', market: 'MARKET ROW', mixed: 'SOLMAR BAY',
};
const STREET_NAMES = [
  'Ocean Drive', 'Paloma Boulevard', 'Coral Way', 'Sunset Blvd', 'Rosa Avenue',
  'Luna Street', 'Harbor Road', 'Downtown Ave', 'Port Road',
];

// District + nearest street, mirroring city.js districtOf (same CONFIG).
function districtNameAt(x, z) {
  const D = CONFIG.DISTRICTS;
  const CENTRES = CONFIG.CITY.CENTRES;
  const bx = CENTRES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const bz = CENTRES.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
  let d;
  if (Math.abs(bx) <= D.PLAZA_R && Math.abs(bz) <= D.PLAZA_R) d = 'plaza';
  else if (bx <= D.BEACH_X) d = 'beach';
  else if (bx >= D.PORT_X) d = 'port';
  else if (bz >= D.BARRIOS_Z) d = 'barrios';
  else if (bx >= D.DOWNTOWN_X && bz <= D.DOWNTOWN_Z) d = 'downtown';
  else if (Math.abs(bx) <= 96 && Math.abs(bz) <= 96) d = 'market';
  else d = 'mixed';
  return DISTRICT_NAMES[d] || 'SOLMAR BAY';
}

function streetNameAt(x, z) {
  const STREETS = CONFIG.CITY.STREETS;
  let best = 0, bestD = 1e9;
  for (let i = 0; i < STREETS.length; i += 1) {
    const d = Math.min(Math.abs(x - STREETS[i]), Math.abs(z - STREETS[i]));
    if (d < bestD) { bestD = d; best = i; }
  }
  return STREET_NAMES[best] || 'Rosa Avenue';
}

export function createHud(doc) {
  const $ = (id) => (doc ? doc.getElementById(id) : null);
  const el = {
    cash: $('cash'),
    stars: $('stars'),
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    repLabel: $('rep-label'),
    repFill: $('rep-fill'),
    repNum: $('rep-num'),
    armourRow: $('armour-row'),
    armourFill: $('armour-fill'),
    armourNum: $('armour-num'),
    objective: $('objective'),
    objectiveDist: $('objective-dist'),
    missionTimer: $('mission-timer'),
    missionTitle: $('mission-title'),
    stageLabel: $('stage-label'),
    stageFill: $('stage-fill'),
    missionNext: $('mission-next'),
    policePanel: $('police-panel'),
    policeTitle: $('police-title'),
    policeList: $('police-list'),
    insightBadge: $('insight-badge'),
    weaponSlots: $('weapon-slots'),
    locName: $('loc-name'),
    locStreet: $('loc-street'),
    speed: $('speed'),
    clock: $('clock'),
    carName: $('car-name'),
    condRow: $('cond-row'),
    condFill: $('cond-fill'),
    condNum: $('cond-num'),
    gear: $('gear'),
    radioName: $('radio-name'),
    dialogue: $('dialogue'),
    dialogueText: $('dialogue-text'),
    dlgName: $('dlg-name'),
    dlgRole: $('dlg-role'),
    dlgPortrait: $('dlg-portrait'),
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
      // Hero-shot override (shots.js stages state.heroHud): the #1-entry
      // HUD values (CH 5 PAPER MOON, $38,420, 4+1 stars, 151 KM/H, Juno
      // Reyes card) are display-only — gameplay state underneath is
      // untouched.
      const hero = state.heroHud || null;

      // Cash.
      this.set('cash', hero && hero.cash ? hero.cash : '$' + Math.floor(state.money || 0).toLocaleString('en-US'));
      // Wanted stars: lit = active, flashing when police are near.
      if (hero && hero.starsHtml) {
        this.setHtml('stars', hero.starsHtml);
        this.toggle('stars', true);
        if (el.stars) el.stars.classList.remove('flashing');
      } else {
        let stars = '';
        for (let i = 0; i < 5; i++) stars += i < wanted ? '★' : '☆';
        this.set('stars', stars);
        this.toggle('stars', wanted > 0);
        if (el.stars) {
          const flashing = state.policeNear && wanted > 0;
          el.stars.classList.toggle('flashing', !!flashing);
        }
      }
      // Health.
      const hp = hero && hero.hp != null ? hero.hp : Math.max(0, Math.round(p.hp || 0));
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
      // Weapon slots (top-right): FISTS + PISTOL with ammo, active one lit
      // — or the hero shot's WASP SMG (orange highlight).
      const weapon = (p.weapon || 'fists').toUpperCase();
      const isPistol = weapon === 'PISTOL';
      if (hero && hero.weaponsHtml) this.setHtml('weaponSlots', hero.weaponsHtml);
      else this.setHtml('weaponSlots',
        '<span class="wslot' + (isPistol ? '' : ' active') + '">✊ FISTS</span>'
        + '<span class="wslot' + (isPistol ? ' active' : '') + '">🔫 PISTOL <span class="ammo">'
        + (p.ammo ?? 12) + '/' + (p.reserveAmmo ?? 0) + '</span></span>');
      // Mission panel (top-left): title, objective + distance + timer,
      // STAGE bar, NEXT step.
      const m = state.mission || {};
      const def = CONFIG.MISSIONS[m.index] || CONFIG.MISSIONS[0];
      const steps = def.steps || [];
      const stepIdx = m.step || 0;
      const active = m.phase === 'active';
      if (hero && hero.missionTitle) this.setHtml('missionTitle', hero.missionTitle);
      else this.setHtml('missionTitle',
        m.index > 0
          ? '<span class="m-id">MISSION ' + m.index + '/3</span>' + def.name.toUpperCase()
          : '<span class="m-id">CALL</span>' + def.name.toUpperCase());
      this.set('objective', hero && hero.objective ? hero.objective : (m.objective || ''));
      const marker = m.marker || state.taxiMarker || null;
      const dist = marker ? Math.round(Math.hypot(p.x - marker.x, p.z - marker.z)) : null;
      this.set('objectiveDist', hero && hero.objectiveDist != null ? hero.objectiveDist : (dist != null ? ' · ' + dist + ' m' : ''));
      const timer = m.timer || 0;
      this.set('missionTimer', hero && hero.timer ? ' · ' + hero.timer : (timer > 0 ? ' · ' + fmtTimer(timer) : ''));
      this.set('stageLabel', hero && hero.stageLabel ? hero.stageLabel : (active ? 'STAGE ' + (stepIdx + 1) + '/' + steps.length : 'STAGE —'));
      this.setStyle('stageFill', 'width', hero && hero.stagePct != null
        ? hero.stagePct + '%'
        : (active && steps.length ? Math.round(((stepIdx + 1) / steps.length) * 100) + '%' : '0%'));
      const next = (hero && hero.next) ? hero.next
        : (active
          ? (steps[stepIdx + 1] || 'Finish the job')
          : (steps[0] || 'Go to Rosa’s café'));
      this.setHtml('missionNext', 'NEXT&nbsp; <b>' + next + '</b>');
      // Police response panel (below the mission panel): the heli at 3+
      // stars, then the pursuing cruisers with distance + status, plus the
      // tank when it is out — or the hero shot's static panel (HKPD
      // RESPONSE — 7 UNITS CODE 4, with the 5 staged distances).
      this.toggle('policePanel', wanted > 0);
      if (hero && hero.policeTitle) this.set('policeTitle', hero.policeTitle);
      if (wanted > 0) {
        if (hero && hero.policeRows) {
          this.setHtml('policeList', hero.policeRows.map((r) =>
            '<div class="police-row"><span>' + r.name + '</span><span class="police-dist">' + r.dist + '</span><span class="police-status">' + r.status + '</span></div>').join(''));
        } else {
        const rows = [];
        if (wanted >= 3) {
          rows.push('<div class="police-row"><span>GULL-1</span><span class="police-dist">—</span><span class="police-status spot">SPOTLIGHT ON YOU</span></div>');
        }
        const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
        cops.slice(0, 5).forEach((c, i) => {
          const d = Math.round(Math.hypot(c.x - p.x, c.z - p.z));
          const status = d < 20 ? 'RAMMING' : 'PURSUIT';
          rows.push('<div class="police-row"><span>' + POLICE_CALLSIGNS[i % POLICE_CALLSIGNS.length] + '</span><span class="police-dist">' + d + ' m</span><span class="police-status">' + status + '</span></div>');
        });
        const tank = (state.cars || []).find((c) => c.kind === 'tank');
        if (tank) {
          const d = Math.round(Math.hypot(tank.x - p.x, tank.z - p.z));
          rows.push('<div class="police-row"><span>ARMOR-1</span><span class="police-dist">' + d + ' m</span><span class="police-status">RAMMING</span></div>');
        }
        this.setHtml('policeList', rows.join(''));
        }
      }
      // IN SIGHT badge (top-right): the police can see the player.
      this.set('insightBadge', hero && hero.insight ? hero.insight : 'IN SIGHT');
      this.toggle('insightBadge', !!((state.policeNear && wanted > 0) || (hero && hero.insight)));
      // Location (bottom-left): district + street — or the hero shot's
      // CORAL STRAND.
      this.set('locName', hero && hero.locName ? hero.locName : districtNameAt(p.x, p.z));
      this.set('locStreet', hero && hero.locStreet ? hero.locStreet : streetNameAt(p.x, p.z));
      // REP (bottom-left): missions done / 3 — or the hero shot's RESPECT 4.
      if (hero && hero.rep) {
        this.set('repLabel', hero.rep.label);
        this.set('repNum', hero.rep.num);
        this.setStyle('repFill', 'width', hero.rep.pct + '%');
      } else {
        const done = (state.stats && state.stats.missionsDone) || 0;
        this.setStyle('repFill', 'width', Math.round((done / 3) * 100) + '%');
        this.set('repNum', REP_LEVELS[Math.min(3, done)]);
      }
      // Armour bar (bottom-left, blue): the #1 entry shows health + armor;
      // in normal gameplay there is no armor, so the row stays hidden.
      this.toggle('armourRow', !!(hero && hero.armour != null));
      if (hero && hero.armour != null) {
        this.setStyle('armourFill', 'width', hero.armour + '%');
        this.set('armourNum', String(hero.armour));
      }
      // Speed (km/h) + car name + condition (bottom-right): the #1 entry
      // shows VESPERA GT CONDITION 100% / 151 KM/H / GEAR 04.
      const kmh = (hero && hero.speedKmh) || Math.round(Math.abs(p.speed || 0) * 3.6);
      this.set('speed', String(kmh));
      this.set('carName', hero && hero.carName ? hero.carName : (p.car ? (p.car.name || 'CAR').toUpperCase() : 'ON FOOT'));
      this.toggle('condRow', !!p.car);
      if (p.car) {
        const chp = Math.max(0, p.car.hp || 0);
        const cmax = p.car.maxHp || 100;
        this.setStyle('condFill', 'width', hero && hero.condPct ? hero.condPct : Math.round((chp / cmax) * 100) + '%');
        this.setStyle('condFill', 'background', chp <= 35 ? '#ff4444' : chp <= 60 ? '#ffb020' : '#39ff88');
        this.set('condNum', hero && hero.condPct ? hero.condPct : Math.round((chp / cmax) * 100) + '%');
      }
      this.set('gear', hero && hero.gear ? 'GEAR ' + hero.gear : '');
      this.toggle('gear', !!(hero && hero.gear));
      if (hero && hero.radio) this.set('radioName', hero.radio);
      // The clock ticks with game time (17:40 + elapsed), instead of a
      // hardcoded '17:40' that never moved — or the hero shot's DAY 1 18:52.
      this.set('clock', hero && hero.clock ? hero.clock : fmtClock(state.time || 0));
      // Dialogue card (bottom-centre): Mama Rosa's line, without the
      // "Rosa: " prefix (the card already names her) — or the hero shot's
      // Juno Reyes card (pink portrait, staged contact).
      if (hero && hero.dialogue) {
        this.set('dlgName', hero.dialogue.name);
        this.set('dlgRole', hero.dialogue.role || '');
        this.toggle('dlgRole', !!hero.dialogue.role);
        this.set('dlgPortrait', hero.dialogue.initials);
        this.setStyle('dlgPortrait', 'background', 'linear-gradient(135deg,#ff5aa8,#ff2d78)');
        this.set('dialogueText', hero.dialogue.text);
        this.toggle('dialogue', screen === 'play');
      } else {
        const dlg = (m.dialogue || '').replace(/^Rosa:\s*/, '');
        this.set('dialogueText', dlg);
        this.toggle('dlgRole', false);
        this.toggle('dialogue', !!(m.dialogue && screen === 'play'));
      }
      // First-run controls hint: show for the first 8 s of play.
      if (screen === 'play') {
        this.hintT += dt || 0;
        this.toggle('hint', this.hintT < 8 && !hero);
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

// Game clock: the world starts at 17:40 (CONFIG.START.TIME_OF_DAY 17.67);
// one game minute passes per 60 s of play.
function fmtClock(t) {
  const mins = 17 * 60 + 40 + Math.floor(t / 60);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return h + ':' + String(m).padStart(2, '0');
}
