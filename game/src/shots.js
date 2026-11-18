// Shots — deterministic staged screenshots via ?shot=1..4&seed=7.
// 1 cover: driving the beachfront avenue at golden hour, traffic ahead,
//   peds on the sidewalk.
// 2 title: the title screen over the city.
// 3 onfoot: Dario on foot in the market plaza, peds around, a parked
//   car to steal, the ROSA'S sign in frame.
// 4 mission: at the docks, M1 package marker glowing, Rosa's dialogue
//   on the HUD, containers and crane in frame.
// After two frames render, window.__GTA.shotReady and window.__shotReady
// are set to true.

export function getShotParams() {
  let shot = 0;
  let seed = 7;
  try {
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    );
    const s = parseInt(params.get('shot') || '0', 10);
    if (s >= 1 && s <= 4) shot = s;
    const sd = parseInt(params.get('seed') || '7', 10);
    if (!Number.isNaN(sd)) seed = sd;
  } catch (e) {
    shot = 0;
    seed = 7;
  }
  return { shot, seed };
}

function setPlayer(S, x, z, heading) {
  const p = S.player || {};
  if (p.pos) { p.pos.x = x; p.pos.z = z; }
  else if (p.position) { p.position.x = x; p.position.z = z; }
  else { p.x = x; p.z = z; }
  p.heading = heading;
  p.h = heading;
  if (typeof p.speed === 'number') p.speed = 0;
  // The mesh is only moved by updatePlayer in play mode; staged shots
  // never call it, so sync the mesh here or the player stays at spawn.
  if (p.mesh) {
    p.mesh.position.set(x, 0, z);
    p.mesh.rotation.y = heading;
    p.mesh.visible = true;
  }
}

function putCarNear(S, car, x, z, heading) {
  if (!car) return;
  car.x = x;
  car.z = z;
  car.heading = heading;
  if (car.pos) { car.pos.x = x; car.pos.z = z; }
  if (car.mesh) {
    car.mesh.position.set(x, 0, z);
    car.mesh.rotation.y = heading;
  }
}

function placePeds(S, spots) {
  const peds = S.peds || [];
  spots.forEach((spot, i) => {
    const ped = peds[i];
    if (!ped) return;
    ped.x = spot.x;
    ped.z = spot.z;
    if (ped.pos) { ped.pos.x = spot.x; ped.pos.z = spot.z; }
    ped.heading = spot.h ?? 0;
    ped.fleeing = false;
    if (ped.mesh) {
      ped.mesh.position.set(spot.x, 0, spot.z);
      ped.mesh.rotation.y = spot.h ?? 0;
    }
  });
}

function setPlayerCar(S, car, x, z, heading, speed) {
  if (!car) return;
  putCarNear(S, car, x, z, heading);
  car.speed = speed ?? 0;
  const p = S.player || {};
  p.car = car;
  p.inCar = true;
  p.driving = true;
  p.onFoot = false;
  if (p.mesh) p.mesh.visible = false;
  setPlayer(S, x, z, heading);
  if (p.mesh) p.mesh.visible = false;
  if (typeof p.speed === 'number') p.speed = speed ?? 0;
}

export function stageShot(S, n) {
  S.shot = n;
  S.shotFrames = 0;
  S.shotReady = false;
  S.mode = 'shot';
  const m = S.missions;
  const lm = m?.landmarks || {};

  if (n === 1) {
    // Cover: driving down the beachfront avenue, golden hour.
    const car = (S.parkedCars && S.parkedCars[0]) || (S.cars && S.cars[0]) || null;
    setPlayerCar(S, car, -170, 20, Math.PI, 18);
    S.camHeading = Math.PI;
    // Traffic ahead on the same avenue.
    const ahead = S.trafficCars || [];
    if (ahead[0]) putCarNear(S, ahead[0], -170, 55, Math.PI);
    if (ahead[1]) putCarNear(S, ahead[1], -158, 80, Math.PI);
    if (ahead[2]) putCarNear(S, ahead[2], -182, 100, 0);
    placePeds(S, [
      { x: -160, z: 5, h: 0 },
      { x: -160, z: 35, h: Math.PI },
      { x: -180, z: 60, h: Math.PI / 2 },
      { x: -160, z: 90, h: 0 },
    ]);
    if (S.police) { S.police.stars = 0; S.police.heat = 0; }
    if (m) {
      m.index = 1;
      m.step = 'pickup';
      m.marker = { ...(lm.docks || { x: 170, z: 10 }) };
      m.dialogue = "Rosa: Package is waiting at the docks. Don't keep me waiting.";
    }
    S.objective = 'Collect the package at the docks';
    toast(S, 'Welcome to Solmar Bay');
  } else if (n === 2) {
    // Title: title screen over the city, camera high over the plaza.
    setPlayer(S, 0, 60, Math.PI);
    S.camHeading = Math.PI;
    S.shotScreen = 'title';
    if (S.hud && typeof S.hud.showScreen === 'function') {
      // showScreen is imported by main; the hud object itself holds refs.
    }
    if (m) {
      m.index = 0;
      m.step = 'call';
      m.marker = { ...(lm.cafe || { x: 0, z: 0 }) };
      m.dialogue = "Dario, it's Rosa. Come to the café.";
    }
    S.objective = "Go to Rosa's café";
  } else if (n === 3) {
    // On foot in the market plaza: peds, a stealable parked car, the
    // ROSA'S neon (downtown tower at 84,-166; heading 2.70 aims at it).
    setPlayer(S, 0, 12, 2.7);
    const p = S.player || {};
    p.car = null;
    p.inCar = false;
    p.driving = false;
    p.onFoot = true;
    S.camHeading = 2.7;
    const parked = S.parkedCars || [];
    if (parked[0]) putCarNear(S, parked[0], 12, 4, Math.PI / 2);
    if (parked[1]) putCarNear(S, parked[1], -14, -6, -Math.PI / 2);
    placePeds(S, [
      { x: -6, z: 4, h: 0.5 },
      { x: 8, z: 20, h: Math.PI },
      { x: -10, z: 22, h: -0.6 },
      { x: 4, z: -8, h: 2.4 },
      { x: 16, z: 14, h: Math.PI / 2 },
    ]);
    if (S.police) { S.police.stars = 0; S.police.heat = 0; }
    if (m) {
      m.index = 0;
      m.step = 'call';
      m.marker = { ...(lm.cafe || { x: 0, z: 0 }) };
      m.dialogue = "Dario, it's Rosa. Come to the café.";
    }
    S.objective = "Go to Rosa's café";
  } else if (n === 4) {
    // Mission: at the docks, M1 package marker glowing, Rosa on the HUD.
    // Staged just south of the container field, facing the marker at
    // (160,50), so containers + crane read in frame and the marker beam
    // is visible beyond them.
    setPlayer(S, 155, 0, 0.1);
    S.camHeading = 0.1;
    const car = (S.parkedCars && S.parkedCars[1]) || (S.cars && S.cars[0]) || null;
    if (car) putCarNear(S, car, 148, -2, 0.3);
    placePeds(S, [
      { x: 158, z: -4, h: 0 },
      { x: 168, z: 18, h: Math.PI },
      { x: 145, z: 28, h: 1.2 },
    ]);
    if (S.police) { S.police.stars = 0; S.police.heat = 0; }
    if (m) {
      m.index = 1;
      m.step = 'pickup';
      m.marker = { ...(lm.docks || { x: 170, z: 10 }) };
      m.dialogue = "Rosa: Package is waiting at the docks. Don't keep me waiting.";
      m.active = true;
    }
    S.objective = 'Collect the package at the docks';
    toast(S, 'New job from Rosa');
  }

  // Keep the HUD honest for the shot.
  if (S.player && typeof S.player.money !== 'number') S.player.money = 150;
  exposeGTA(S);
}

function toast(S, text) {
  if (S.messages) S.messages.push({ text, t: S.time || 0 });
}

// Call once per rendered frame (from the main loop, after render).
// After two frames, the shot is declared ready for capture.
export function markShotFrame(S) {
  if (S.mode !== 'shot' || typeof S.shotFrames !== 'number') return;
  S.shotFrames += 1;
  if (S.shotFrames >= 2) {
    S.shotReady = true;
    if (typeof window !== 'undefined') {
      window.__shotReady = true;
      if (window.__GTA) window.__GTA.shotReady = true;
    }
  }
}

function speedOf(S) {
  const p = S.player || {};
  if (p.car && typeof p.car.speed === 'number') return Math.abs(p.car.speed);
  return Math.abs(p.speed ?? 0);
}

export function exposeGTA(S) {
  if (typeof window === 'undefined') return;
  const screen = S.mode === 'shot'
    ? (S.shot === 2 ? 'title' : (S.shotScreen || 'play'))
    : S.mode;
  window.__GTA = {
    shotReady: !!S.shotReady,
    screen,
    wanted: S.police?.stars || 0,
    money: typeof S.player?.money === 'number' ? S.player.money : (S.money || 0),
    mission: S.missions?.index ?? 0,
    step: S.missions?.step ?? '',
    speed: Math.round(speedOf(S) * 3.6),
    // Position + driving state, for the automated playtest to steer by.
    x: Math.round((S.player?.x ?? 0) * 10) / 10,
    z: Math.round((S.player?.z ?? 0) * 10) / 10,
    heading: Math.round((S.player?.heading ?? 0) * 100) / 100,
    inCar: !!(S.player && S.player.car),
  };
  if (S.shotReady) window.__shotReady = true;
}
