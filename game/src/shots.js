// shots.js — Solmar Bay screenshot staging (?shot=1..4&seed=7).
// Per DESIGN.md the game must expose window.__GTA =
//   { shotReady, screen, wanted, money, mission, speed }
// and set window.__shotReady = true after staging each shot (paint twice
// first). Each shot is staged deterministically from a fresh world via an
// autopilot (scripted inputs, no real user), so screenshots are
// reproducible:
//   1-cover:   driving down the beachfront avenue at golden hour, traffic
//              ahead, peds on the sidewalk, HUD + minimap + objective.
//   2-onfoot:  Dario on foot in the market plaza, peds around, a parked
//              car (stealable) in frame, cafe sign "ROSA'S" visible.
//   3-chase:   3 stars, two SBPD cars behind the player's car, sirens
//              (light bars on), minimap showing blue blips, "WANTED"
//              feed message visible.
//   4-mission: at the docks, M1 package marker glowing, Rosa's dialogue
//              line on HUD, containers + crane in frame.
//
// Staging is positional (teleport + orient + set game state) plus a
// scripted-input autopilot (G.autopilot.keys, honoured by main.js) so the
// cover shot genuinely drives. Positions come from G.layout.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseShotParams(search) {
  const params = new URLSearchParams(search || '');
  const shot = parseInt(params.get('shot') || '0', 10);
  const seed = parseInt(params.get('seed') || '7', 10);
  return {
    shot: shot >= 1 && shot <= 4 ? shot : 0,
    seed: Number.isFinite(seed) ? seed : 7,
  };
}

export function createShots(G) {
  let staged = 0;
  let paints = 0;
  let waitingPaints = false;

  function layout() {
    return Object.assign(
      {
        cafe: { x: 0, z: 22 },
        docks: { x: 182, z: 24 },
        sportsCar: { x: -182, z: -60 },
        garage: { x: 28, z: 172 },
        safehouse: { x: -100, z: 172 },
        spawn: { x: 0, z: 26 },
      },
      (G && G.layout) || {},
    );
  }

  function toast(msg, kind) {
    if (G && G.hud && typeof G.hud.toast === 'function') G.hud.toast(msg, kind || 'info');
  }

  function setCamera(pos, lookAt) {
    // main.js honours G.shotCamera in its camera update while staging.
    if (G) G.shotCamera = { pos: { ...pos }, lookAt: { ...lookAt } };
  }

  function clearCamera() {
    if (G) G.shotCamera = null;
  }

  function exposeGTA(screen) {
    if (typeof window === 'undefined' || !G) return;
    window.__GTA = {
      shotReady: staged > 0,
      screen: screen || staged,
      wanted: G.wanted || 0,
      money: G.money || 0,
      mission: (G.missions && G.missions.current && G.missions.current())
        ? G.missions.current().id
        : null,
      speed: typeof G.getPlayerSpeed === 'function' ? G.getPlayerSpeed() : 0,
    };
  }

  // Two rAF paints, then the shot is ready for capture.
  function markReady(screen) {
    if (typeof window === 'undefined') return;
    paints = 0;
    waitingPaints = true;
    const tick = () => {
      paints += 1;
      if (paints >= 2) {
        waitingPaints = false;
        exposeGTA(screen);
        window.__shotReady = true;
        if (window.__GTA) window.__GTA.shotReady = true;
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  function ensurePlaying() {
    if (G && G.state === 'title' && typeof G.startGame === 'function') {
      G.startGame();
    }
    if (G) G.state = 'playing';
    if (G && G.hud) G.hud.hideTitle();
  }

  function putPlayerInCarAt(x, z, heading, sports) {
    // Preferred path: the vehicle adapter owned by main.js.
    if (G && typeof G.spawnVehicle === 'function') {
      try {
        const veh = G.spawnVehicle({ x, z, heading, sports: !!sports, color: sports ? 0xffd21f : 0xcc2222 });
        if (veh && typeof G.enterVehicle === 'function') G.enterVehicle(veh);
        return veh;
      } catch (_err) { /* fall through to the on-foot fallback */ }
    }
    if (G && typeof G.teleportPlayer === 'function') G.teleportPlayer(x, z, heading);
    return null;
  }

  function stageCover(rng) {
    const L = layout();
    // Beachfront avenue (x = -175 street), heading north (-z), golden hour.
    putPlayerInCarAt(-175, 40, Math.PI, false);
    if (G) {
      G.autopilot = { keys: ['KeyW'], steer: 0 };
      G.money = 1250;
    }
    // Traffic ahead of the player on the same avenue.
    if (G && typeof G.spawnTrafficAt === 'function') {
      G.spawnTrafficAt(-175, 0, Math.PI);
      G.spawnTrafficAt(-169, -40, Math.PI);
    }
    setCamera(
      { x: -168, y: 7, z: 62 },
      { x: -175, y: 1.5, z: -20 },
    );
    toast('M1 — The Pickup: drive to the docks', 'mission');
    if (G && G.hud) G.hud.setObjective('Drive to the docks and collect the package', 214);
    if (G && G.missions && typeof G.missions.start === 'function') {
      G.money = G.money || 0;
      G.missionIndex = 1;
      G.missions.start(1);
      // Keep the player at the beachfront (start() does not teleport).
      if (typeof G.teleportPlayer === 'function') G.teleportPlayer(-175, 40, Math.PI);
      putPlayerInCarAt(-175, 40, Math.PI, false);
      if (G) G.autopilot = { keys: ['KeyW'], steer: 0 };
    }
    void rng;
  }

  function stageOnFoot(rng) {
    const L = layout();
    if (G && typeof G.teleportPlayer === 'function') {
      // On foot on the z=25 street, facing the cafe (ROSA'S sign). The
      // player stands clear of the plaza palm at (0, 26) so no trunk
      // blocks the camera's view of him.
      G.teleportPlayer(18, 28, -1.89);
    }
    if (G) {
      G.autopilot = null;
      G.money = 430;
    }
    // A stealable parked car in frame, just west of the player.
    if (G && typeof G.spawnVehicle === 'function') {
      try {
        G.spawnVehicle({ x: 14, z: 24, heading: Math.PI / 2, parked: true, color: 0x2266cc });
      } catch (_err) { /* ignore */ }
    }
    // Camera on the same street, east of the plaza: the sightline runs
    // down the open street to the cafe, so no plaza block stands in the
    // way. (Cameras south of the forecourt look straight through the
    // (10, 41) block.)
    setCamera(
      { x: 40, y: 5, z: 25 },
      { x: 0, y: 1.5, z: 24 },
    );
    toast("Rosa: \"Dario, it's Rosa. Come to the cafe.\"", 'mission');
    if (G && G.hud) {
      G.hud.setDialogue("Dario, it's Rosa. Come to the cafe. We need to talk.");
      G.hud.setObjective("Go to Rosa's cafe in the Market Plaza", 19);
    }
    if (G && G.missions && typeof G.missions.start === 'function') {
      G.missionIndex = 0;
      G.missions.start(0);
    }
    void rng;
  }

  function stageChase(rng) {
    const L = layout();
    putPlayerInCarAt(-25, 60, Math.PI, false);
    if (G) {
      G.autopilot = { keys: ['KeyW'], steer: 0 };
      G.money = 890;
    }
    if (G && G.police) {
      G.police.setWanted(3, 'shot');
      // Two SBPD cars right behind the player.
      G.police.spawnCarAt(-27, 78, 'chase');
      G.police.spawnCarAt(-22, 84, 'chase');
    }
    setCamera(
      { x: -18, y: 8, z: 82 },
      { x: -25, y: 1.5, z: 40 },
    );
    toast('WANTED ★★★ — the SBPD is on you', 'wanted');
    if (G && G.hud) G.hud.setObjective('Reach the safehouse in the barrios — lose the cops!', 132, 118);
    if (G && G.missions && typeof G.missions.start === 'function') {
      G.missionIndex = 3;
      G.missions.start(3);
      if (typeof G.teleportPlayer === 'function') G.teleportPlayer(-25, 60, Math.PI);
      putPlayerInCarAt(-25, 60, Math.PI, false);
      if (G) G.autopilot = { keys: ['KeyW'], steer: 0 };
    }
    void rng;
    void L;
  }

  function stageMission(rng) {
    const L = layout();
    // At the docks, on foot next to the glowing package marker.
    if (G && typeof G.teleportPlayer === 'function') {
      G.teleportPlayer(168, 34, Math.PI / 2);
    }
    if (G) {
      G.autopilot = null;
      G.money = 150;
    }
    // Camera south-west of the yard, looking north-east: the player and
    // the package marker sit centre-frame, the new container cluster and
    // the dock crane behind them.
    setCamera(
      { x: 158, y: 7, z: 48 },
      { x: 185, y: 1.5, z: 12 },
    );
    if (G && G.missions && typeof G.missions.start === 'function') {
      G.missionIndex = 1;
      G.missions.start(1);
    }
    if (G && G.hud) {
      G.hud.setDialogue('A package is waiting at the docks. Pick it up, bring it back here.');
      G.hud.setObjective('Drive to the docks and collect the package', 16);
    }
    void rng;
    void L;
  }

  const stages = { 1: stageCover, 2: stageOnFoot, 3: stageChase, 4: stageMission };

  const api = {
    get staged() {
      return staged;
    },
    get waitingPaints() {
      return waitingPaints;
    },

    // Stage shot n (1-4). Returns false for an unknown number.
    stage(n, seed) {
      const fn = stages[n];
      if (!fn || !G) return false;
      const rng = mulberry32(Number.isFinite(seed) ? seed : 7);
      if (typeof window !== 'undefined') window.__shotReady = false;
      ensurePlaying();
      if (G.police) G.police.clear();
      if (G.police) G.police.clearWanted();
      fn(rng);
      staged = n;
      exposeGTA(n);
      markReady(n);
      return true;
    },

    // Read ?shot= / ?seed= from the URL and stage it. Called once by
    // main.js after the world is built. Returns the shot number or 0.
    stageFromURL() {
      if (typeof window === 'undefined' || !window.location) return 0;
      const { shot, seed } = parseShotParams(window.location.search);
      if (!shot) return 0;
      return api.stage(shot, seed) ? shot : 0;
    },

    clear() {
      staged = 0;
      waitingPaints = false;
      clearCamera();
      if (G) G.autopilot = null;
      if (typeof window !== 'undefined') window.__shotReady = false;
    },

    update(_dt) {
      // Keep __GTA live while a shot is staged.
      if (staged > 0) exposeGTA(staged);
    },
  };

  return api;
}
