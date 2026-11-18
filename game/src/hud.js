// hud.js — Solmar Bay HUD (Worker B, v6 fresh)
// Contract: createHud(G) / updateHud(G)
// DOM ids (from index.html): #cash #stars #health-bar #health-fill #weapon #ammo
// #objective #distance #speed #clock #minimap #feed #title-screen #pause-screen
// #busted-screen #wasted-screen #mission-toast. Missing nodes are created
// defensively so the HUD works even if index.html is minimal.

const IDS = ['cash', 'stars', 'health-bar', 'health-fill', 'weapon', 'ammo',
  'objective', 'distance', 'speed', 'clock', 'minimap', 'feed',
  'title-screen', 'pause-screen', 'busted-screen', 'wasted-screen', 'mission-toast'];

function el(tag, id, text) {
  const n = document.createElement(tag);
  if (id) n.id = id;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function createHud(G) {
  const doc = (typeof document !== 'undefined') ? document : null;
  const els = {};
  if (doc) {
    let root = doc.getElementById('hud');
    if (!root) {
      root = el('div', 'hud');
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;font-family:system-ui,sans-serif;color:#fff;';
      doc.body.appendChild(root);
    }
    for (const id of IDS) {
      let n = doc.getElementById(id);
      if (!n) {
        if (id === 'minimap') { n = el('canvas', id); n.width = 160; n.height = 160; }
        else if (id === 'health-bar') { n = el('div', id); n.appendChild(el('div', 'health-fill')); }
        else if (id.endsWith('-screen')) { n = el('div', id); n.style.display = 'none'; }
        else n = el('div', id);
        // Sensible default placement for auto-created nodes.
        if (id === 'cash' || id === 'stars') n.style.cssText = 'position:absolute;top:12px;left:14px;font-weight:700;font-size:20px;text-shadow:0 1px 3px #000;';
        if (id === 'stars') n.style.top = '38px';
        if (id === 'health-bar') n.style.cssText = 'position:absolute;left:14px;bottom:64px;width:180px;height:14px;background:#0008;border:1px solid #fff6;border-radius:7px;overflow:hidden;';
        if (id === 'weapon' || id === 'ammo') n.style.cssText = 'position:absolute;left:14px;bottom:36px;font-weight:600;text-shadow:0 1px 3px #000;';
        if (id === 'ammo') n.style.left = '90px';
        if (id === 'objective') n.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:56px;font-weight:600;text-shadow:0 1px 3px #000;';
        if (id === 'distance') n.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:34px;text-shadow:0 1px 3px #000;';
        if (id === 'speed') n.style.cssText = 'position:absolute;right:16px;bottom:36px;font-size:26px;font-weight:800;text-shadow:0 1px 3px #000;';
        if (id === 'clock') n.style.cssText = 'position:absolute;right:16px;bottom:12px;font-weight:600;text-shadow:0 1px 3px #000;';
        if (id === 'minimap') n.style.cssText = 'position:absolute;top:12px;right:14px;border:2px solid #fff5;border-radius:8px;background:#0a1420;';
        if (id === 'feed') n.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);text-align:center;font-weight:600;text-shadow:0 1px 3px #000;';
        if (id === 'mission-toast') n.style.cssText = 'position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);text-align:center;font-size:28px;font-weight:800;text-shadow:0 2px 6px #000;display:none;';
        if (id.endsWith('-screen')) n.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:#000a;text-align:center;';
        root.appendChild(n);
      }
      els[id] = n;
    }
    // Title screen content (only fill it if it was empty).
    const ts = els['title-screen'];
    if (ts && !ts.textContent.trim()) {
      ts.innerHTML = '<h1 style="font-size:64px;margin:0;letter-spacing:4px;">SOLMAR BAY</h1>'
        + '<p>A getaway driver. A fixer named Rosa. A city that never sleeps.</p>'
        + '<p><b>Press Enter to start</b></p>'
        + '<p style="font-size:13px;opacity:.85;">WASD move / drive &nbsp;·&nbsp; Shift run / handbrake &nbsp;·&nbsp; E enter car &nbsp;·&nbsp; F punch<br>'
        + 'Click shoot &nbsp;·&nbsp; R reload &nbsp;·&nbsp; 1/2 weapons &nbsp;·&nbsp; H honk &nbsp;·&nbsp; M mute &nbsp;·&nbsp; Esc pause</p>';
    }
    const bs = els['busted-screen'];
    if (bs && !bs.textContent.trim()) bs.innerHTML = '<h1 style="font-size:56px;">BUSTED</h1><p>The SBPD let you off at the precinct.</p>';
    const ws = els['wasted-screen'];
    if (ws && !ws.textContent.trim()) ws.innerHTML = '<h1 style="font-size:56px;">WASTED</h1><p>You wake up at the hospital.</p>';
    const ps = els['pause-screen'];
    if (ps && !ps.textContent.trim()) ps.innerHTML = '<h1>PAUSED</h1><p>Esc / P to resume</p>';
  }

  const hud = {
    els,
    _feed: [],       // {text, t}
    _toastTimer: 0,
    _feedTimer: 0,
    say(text) {
      if (!text) return;
      this._feed.push({ text, t: 4.0 });
      if (this._feed.length > 4) this._feed.shift();
      this._feedTimer = 0.1;
    },
    toast(title, sub) {
      const n = this.els['mission-toast'];
      if (!n) return;
      n.innerHTML = '<div>' + title + '</div>' + (sub ? '<div style="font-size:18px;">' + sub + '</div>' : '');
      n.style.display = 'block';
      this._toastTimer = 2.5;
    },
  };
  return hud;
}

function setVisible(node, on, flex) {
  if (!node) return;
  node.style.display = on ? (flex ? 'flex' : 'block') : 'none';
}

export function updateHud(G) {
  const hud = G.hud;
  if (!hud || !hud.els) return;
  const els = hud.els;
  const dt = 1 / 60;

  const money = G.state.money || 0;
  if (els.cash) els.cash.textContent = '$' + money;
  const stars = (G.police && G.police.stars) || G.state.wanted || 0;
  if (els.stars) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < stars ? '★' : '☆';
    els.stars.textContent = s;
    els.stars.style.color = stars > 0 ? '#ffd21f' : '#ffffff88';
  }
  const hp = (G.combat && typeof G.combat.hp === 'number') ? G.combat.hp
    : (G.player && typeof G.player.hp === 'number' ? G.player.hp : 100);
  if (els['health-fill']) {
    els['health-fill'].style.width = Math.max(0, Math.min(100, hp)) + '%';
    els['health-fill'].style.height = '100%';
    els['health-fill'].style.background = hp > 50 ? '#37c978' : hp > 25 ? '#f5a623' : '#e5484d';
  }
  if (els.weapon) els.weapon.textContent = (G.combat && G.combat.weapon === 'pistol') ? 'Pistol' : 'Fists';
  if (els.ammo) els.ammo.textContent = (G.combat && G.combat.weapon === 'pistol') ? ('◉ ' + G.combat.ammo + ' / ' + G.combat.magSize) : '';
  if (els.clock) els.clock.textContent = '17:40'; // fixed golden hour

  // Speed: car speed or on-foot speed, km/h.
  let spd = 0;
  if (G.player) {
    spd = G.player.car ? Math.abs(G.player.car.speed || 0) : Math.abs(G.player.speed || 0);
  }
  if (els.speed) els.speed.textContent = Math.round(spd * 3.6) + ' km/h';

  // Objective + distance to the mission marker.
  const M = G.missions;
  if (els.objective) els.objective.textContent = (M && M.objective) || '';
  if (els.distance) {
    if (M && M.marker && G.player && G.player.pos) {
      const d = Math.hypot(G.player.pos.x - M.marker.x, G.player.pos.z - M.marker.z);
      els.distance.textContent = Math.round(d) + ' m';
    } else els.distance.textContent = '';
  }

  // Message feed (fades after ~4 s).
  if (els.feed) {
    let html = '';
    for (const m of hud._feed) {
      m.t -= dt;
      const op = Math.max(0, Math.min(1, m.t));
      html += '<div style="opacity:' + op.toFixed(2) + '">' + m.text + '</div>';
    }
    hud._feed = hud._feed.filter((m) => m.t > 0);
    if (html !== els.feed._lastHtml) { els.feed.innerHTML = html; els.feed._lastHtml = html; }
  }

  // Mission toast auto-hide.
  if (hud._toastTimer > 0) {
    hud._toastTimer -= dt;
    if (hud._toastTimer <= 0 && els['mission-toast']) els['mission-toast'].style.display = 'none';
  }

  // Screens by mode.
  const mode = G.state.mode || 'title';
  setVisible(els['title-screen'], mode === 'title', true);
  setVisible(els['pause-screen'], mode === 'paused', true);
  setVisible(els['busted-screen'], mode === 'busted', true);
  setVisible(els['wasted-screen'], mode === 'wasted', true);
}
