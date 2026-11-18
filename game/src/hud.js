// hud.js — Solmar Bay HUD + menus (DOM overlay).
// Per DESIGN.md:
//   Top-left: cash ($), wanted stars (lit = active, flashing when police near)
//   Top-right: minimap (160x160 canvas, owned by minimap.js, mounted here)
//   Bottom-left: health bar + weapon + ammo
//   Bottom-center: objective line + distance to marker (+ Rosa dialogue)
//   Bottom-right: speed (km/h) + clock 17:40
//   Message feed (top-center, fades)
//   Title screen: SOLMAR BAY logo, "Press Enter", controls, Continue (if a
//   save exists), story blurb, best stats
//   Pause (Esc): resume / restart / mute / save + quit to title
//   Busted/Wasted screens: 2 s, then respawn (main.js drives the timer)
//
// The module builds its own DOM (no HTML dependency beyond a <div id="hud">)
// and is a safe no-op stub when there is no document (Node tests).
// Buttons call back into main.js through G.startGame / G.continueGame /
// G.resumeGame / G.restartGame / G.quitToTitle / G.toggleMute.

function stubHUD() {
  return {
    toast() {},
    setObjective() {},
    setDialogue() {},
    setWeapon() {},
    showTitle() {},
    hideTitle() {},
    showPause() {},
    hidePause() {},
    showBusted() {},
    showWasted() {},
    hideOverlays() {},
    update() {},
    minimapWrap: null,
  };
}

export function createHUD(G) {
  if (typeof document === 'undefined') return stubHUD();

  const root = document.getElementById('hud') || document.body;
  const el = (tag, id, cls, parent) => {
    const n = document.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    (parent || root).appendChild(n);
    return n;
  };

  // --- top-left: cash + stars ---
  const topLeft = el('div', 'hud-topleft', 'hud-corner');
  const cashEl = el('div', 'hud-cash', 'hud-cash', topLeft);
  const starsEl = el('div', 'hud-stars', 'hud-stars', topLeft);

  // --- top-right: minimap mount point ---
  const minimapWrap = el('div', 'minimap-wrap', 'hud-minimap');

  // --- bottom-left: health + weapon ---
  const bottomLeft = el('div', 'hud-bottomleft', 'hud-corner');
  const healthWrap = el('div', 'hud-health-wrap', '', bottomLeft);
  const healthBar = el('div', 'hud-health-bar', '', healthWrap);
  const healthText = el('div', 'hud-health-text', '', bottomLeft);
  const weaponEl = el('div', 'hud-weapon', '', bottomLeft);

  // --- bottom-center: dialogue + objective ---
  const bottomCenter = el('div', 'hud-bottomcenter', 'hud-corner');
  const dialogueEl = el('div', 'hud-dialogue', '', bottomCenter);
  const objectiveEl = el('div', 'hud-objective', '', bottomCenter);
  const distanceEl = el('div', 'hud-distance', '', bottomCenter);

  // --- bottom-right: speed + clock ---
  const bottomRight = el('div', 'hud-bottomright', 'hud-corner');
  const speedEl = el('div', 'hud-speed', '', bottomRight);
  const clockEl = el('div', 'hud-clock', '', bottomRight);

  // --- top-center: message feed ---
  const feedEl = el('div', 'hud-feed', '', root);

  // --- overlays ---
  const titleEl = el('div', 'title-screen', 'overlay');
  const titleInner = el('div', 'title-inner', '', titleEl);
  const logoEl = el('div', 'title-logo', '', titleInner);
  logoEl.textContent = 'SOLMAR BAY';
  const tagEl = el('div', 'title-tag', '', titleInner);
  tagEl.textContent = 'Steal cars. Dodge the cops. Run jobs for Mama Rosa.';
  const pressEl = el('div', 'title-press', '', titleInner);
  pressEl.textContent = '— Press Enter —';
  const startBtn = el('button', 'title-start', 'title-btn', titleInner);
  startBtn.textContent = '▶ Start Game';
  const continueBtn = el('button', 'title-continue', 'title-btn', titleInner);
  continueBtn.textContent = '↻ Continue';
  const controlsEl = el('div', 'title-controls', '', titleInner);
  controlsEl.innerHTML =
    'WASD drive / walk &nbsp;·&nbsp; Shift run / handbrake<br>' +
    'E enter / steal car &nbsp;·&nbsp; F punch &nbsp;·&nbsp; Click shoot<br>' +
    'R reload &nbsp;·&nbsp; 1 fists / 2 pistol &nbsp;·&nbsp; H honk<br>' +
    'M mute &nbsp;·&nbsp; Esc / P pause';
  const blurbEl = el('div', 'title-blurb', '', titleInner);
  blurbEl.textContent =
    'Dario "D" Cruz owes money to the wrong people. One fixer, one city, ' +
    'one last shot at getting out clean.';
  const statsEl = el('div', 'title-stats', '', titleInner);

  const pauseEl = el('div', 'pause-screen', 'overlay hidden');
  const pauseInner = el('div', 'pause-inner', '', pauseEl);
  const pauseTitle = el('div', 'pause-title', '', pauseInner);
  pauseTitle.textContent = 'PAUSED';
  const resumeBtn = el('button', 'pause-resume', 'title-btn', pauseInner);
  resumeBtn.textContent = '▶ Resume';
  const restartBtn = el('button', 'pause-restart', 'title-btn', pauseInner);
  restartBtn.textContent = '↻ Restart Mission';
  const muteBtn = el('button', 'pause-mute', 'title-btn', pauseInner);
  muteBtn.textContent = '♪ Mute / Unmute (M)';
  const saveQuitBtn = el('button', 'pause-savequit', 'title-btn', pauseInner);
  saveQuitBtn.textContent = '■ Save & Quit to Title';

  const bustedEl = el('div', 'busted-screen', 'overlay hidden');
  const bustedText = el('div', 'busted-text', '', bustedEl);
  bustedText.textContent = 'BUSTED';
  const bustedSub = el('div', 'busted-sub', '', bustedEl);

  const wastedEl = el('div', 'wasted-screen', 'overlay hidden');
  const wastedText = el('div', 'wasted-text', '', wastedEl);
  wastedText.textContent = 'WASTED';
  const wastedSub = el('div', 'wasted-sub', '', wastedEl);

  // --- button wiring (callbacks live on G, owned by main.js) ---
  function call(name) {
    if (G && typeof G[name] === 'function') {
      try {
        G[name]();
      } catch (_err) { /* main.js owns the error surface */ }
    }
  }
  startBtn.addEventListener('click', () => call('startGame'));
  continueBtn.addEventListener('click', () => call('continueGame'));
  resumeBtn.addEventListener('click', () => call('resumeGame'));
  restartBtn.addEventListener('click', () => call('restartMission'));
  muteBtn.addEventListener('click', () => call('toggleMute'));
  saveQuitBtn.addEventListener('click', () => call('quitToTitle'));

  // --- state caches (avoid DOM writes when nothing changed) ---
  let lastCash = null;
  let lastStars = null;
  let lastHealth = null;
  let lastWeapon = null;
  let lastSpeed = null;
  let lastObjective = null;
  let lastDistance = null;
  let lastDialogue = null;
  let lastClock = null;
  let dialogueTimer = 0;
  let clockMinutes = 17 * 60 + 40; // fixed golden hour 17:40, drifts slowly

  function starString(wanted) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= wanted ? '★' : '☆';
    return s;
  }

  const api = {
    minimapWrap,

    toast(msg, kind) {
      if (!msg) return;
      const item = document.createElement('div');
      item.className = `feed-item feed-${kind || 'info'}`;
      item.textContent = msg;
      feedEl.appendChild(item);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.firstChild);
      setTimeout(() => {
        item.classList.add('feed-fade');
        setTimeout(() => {
          if (item.parentNode === feedEl) feedEl.removeChild(item);
        }, 800);
      }, 3600);
    },

    setObjective(text, distance, secondsLeft) {
      const t = text || '';
      const d = typeof distance === 'number' ? `${Math.round(distance)} m` : '';
      const timer = typeof secondsLeft === 'number' ? `  ·  ${Math.ceil(secondsLeft)}s` : '';
      if (t !== lastObjective) {
        objectiveEl.textContent = t;
        lastObjective = t;
      }
      const distText = d + timer;
      if (distText !== lastDistance) {
        distanceEl.textContent = distText;
        lastDistance = distText;
      }
    },

    setDialogue(line) {
      if (!line) return;
      if (line !== lastDialogue) {
        dialogueEl.textContent = `Rosa: "${line}"`;
        dialogueEl.classList.add('show');
        lastDialogue = line;
      }
      dialogueTimer = 6; // seconds on screen
    },

    setWeapon(weapon) {
      if (G) G.weapon = weapon;
      lastWeapon = null; // force refresh
    },

    showTitle() {
      titleEl.classList.remove('hidden');
      pauseEl.classList.add('hidden');
      bustedEl.classList.add('hidden');
      wastedEl.classList.add('hidden');
      const has = G && G.save ? G.save.hasSave() : false;
      continueBtn.style.display = has ? '' : 'none';
      const data = G && G.save ? G.save.peek() : null;
      if (data) {
        statsEl.textContent =
          `Best cash $${data.stats.bestCash}  ·  Missions done ${data.stats.missionsDone}  ·  ` +
          `Cars stolen ${data.stats.carsStolen}  ·  Busted ${data.stats.busted}`;
      } else {
        statsEl.textContent = 'No save yet — a fresh start in Solmar Bay.';
      }
      pressEl.classList.add('blink');
    },

    hideTitle() {
      titleEl.classList.add('hidden');
    },

    showPause() {
      pauseEl.classList.remove('hidden');
      muteBtn.textContent = G && G.muted ? '♪ Unmute (M)' : '♪ Mute (M)';
    },

    hidePause() {
      pauseEl.classList.add('hidden');
    },

    showBusted(lost) {
      bustedEl.classList.remove('hidden');
      bustedSub.textContent = lost > 0 ? `You lost $${lost} — respawning at the precinct…` : 'Respawning at the precinct…';
    },

    showWasted(lost) {
      wastedEl.classList.remove('hidden');
      wastedSub.textContent = lost > 0 ? `You lost $${lost} — respawning at the hospital…` : 'Respawning at the hospital…';
    },

    hideOverlays() {
      bustedEl.classList.add('hidden');
      wastedEl.classList.add('hidden');
      pauseEl.classList.add('hidden');
    },

    update(dt) {
      const step = dt || 0.016;
      if (!G) return;
      const money = Math.floor(G.money || 0);
      if (money !== lastCash) {
        cashEl.textContent = `$${money.toLocaleString('en-US')}`;
        lastCash = money;
      }
      const wanted = G.wanted || 0;
      if (wanted !== lastStars) {
        starsEl.textContent = starString(wanted);
        starsEl.className = `hud-stars stars-${wanted}`;
        lastStars = wanted;
      }
      // Flash the stars when police are close.
      if (G.police && typeof G.police.nearestDist === 'function') {
        const near = G.police.nearestDist();
        starsEl.classList.toggle('flashing', wanted > 0 && near < 25);
      }
      const health = Math.max(0, Math.round(G.health || 0));
      if (health !== lastHealth) {
        healthBar.style.width = `${health}%`;
        healthBar.className = `hud-health-bar ${health < 30 ? 'low' : health < 60 ? 'mid' : ''}`;
        healthText.textContent = `HP ${health}`;
        lastHealth = health;
      }
      const weapon = G.weapon || 'fists';
      const ammo = weapon === 'pistol'
        ? `${G.ammo || 0} / ${G.reserveAmmo || 0}`
        : '—';
      const weaponText = weapon === 'pistol' ? `Pistol  ${ammo}` : 'Fists';
      if (weaponText !== lastWeapon) {
        weaponEl.textContent = weaponText;
        lastWeapon = weaponText;
      }
      const speed = Math.round((typeof G.getPlayerSpeed === 'function' ? G.getPlayerSpeed() : 0) * 3.6);
      if (speed !== lastSpeed) {
        speedEl.textContent = `${speed} km/h`;
        lastSpeed = speed;
      }
      // Clock drifts 1 game-minute per ~5 real seconds from 17:40.
      if (G.state === 'playing') clockMinutes += step / 5;
      const hh = Math.floor(clockMinutes / 60) % 24;
      const mm = Math.floor(clockMinutes % 60);
      const clockText = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (clockText !== lastClock) {
        clockEl.textContent = clockText;
        lastClock = clockText;
      }
      if (dialogueTimer > 0) {
        dialogueTimer -= step;
        if (dialogueTimer <= 0) dialogueEl.classList.remove('show');
      }
    },
  };

  return api;
}
