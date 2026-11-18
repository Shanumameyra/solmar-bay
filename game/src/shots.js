// shots.js — Solmar Bay deterministic screenshot staging (Worker B, v6 fresh)
// Contract: setupShots(G)
// Reads ?shot=1..4&seed=7, stages the scene from a fresh world via scripted
// placement (no real user input), paints twice, then sets window.__shotReady
// and window.__GTA = {shotReady, screen, wanted, money, mission, speed}.
// 1-cover: driving beachfront avenue, traffic ahead, peds on sidewalk.
// 2-onfoot: Dario on foot in the market plaza, parked car, "ROSA'S" sign.
// 3-chase: 3 stars, 2 SBPD cars behind, sirens, "WANTED" feed message.
// 4-mission: at the docks, M1 package marker glowing, Rosa dialogue, containers+crane.
import { createCar } from './vehicle.js';

function params() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (e) {
    return new URLSearchParams('');
  }
}

function putPlayerOnFoot(G, x, z, heading) {
  const p = G.player;
  if (p.car) { p.car._driver = null; p.car = null; }
  p.pos.set(x, 0, z);
  if (p.mesh) p.mesh.position.set(x, 0, z);
  p.heading = heading;
  if (p.mesh) p.mesh.rotation.y = heading;
  p.speed = 0;
}

function putPlayerInCar(G, car, speed) {
  const p = G.player;
  p.car = car;
  car._driver = 'player';
  p.pos.set(car.pos.x, 0, car.pos.z);
  p.heading = car.heading;
  p.speed = speed || 0;
  car.speed = speed || 0;
}

function ensurePlayerCar(G, x, z, heading, sports) {
  // Reuse the player's current car if it exists, else spawn one.
  let car = G.player && G.player.car;
  if (!car) {
    car = createCar(G, { x, z, heading, sports: !!sports, color: sports ? 0xf7d117 : 0x2e86c1 });
    G.vehicles.push(car);
  } else {
    car.pos.set(x, 0, z);
    car.mesh.position.set(x, 0, z);
    car.heading = heading;
    car.mesh.rotation.y = heading;
    car.speed = 0;
    car.stalled = false;
    car.hp = 100;
  }
  return car;
}

function placeTrafficAhead(G, x, z, heading, count) {
  // Line up a few traffic cars ahead of the player on the same avenue.
  const cars = (G.traffic && G.traffic.cars) || [];
  const fx = Math.sin(heading), fz = Math.cos(heading);
  for (let i = 0; i < Math.min(count, cars.length); i++) {
    const c = cars[i];
    const d = 14 + i * 12;
    c.pos.set(x + fx * d + (i % 2 === 0 ? 2.5 : -2.5), 0, z + fz * d);
    c.mesh.position.set(c.pos.x, 0, c.pos.z);
    c.heading = heading;
    c.mesh.rotation.y = heading;
    c.speed = 8;
    c._stopTimer = 0;
  }
}

function placePedsNear(G, cx, cz, count) {
  const peds = (G.world && G.world.peds) || [];
  for (let i = 0; i < Math.min(count, peds.length); i++) {
    const p = peds[i];
    const ang = (i / Math.max(count, 1)) * Math.PI * 2;
    const d = 4 + (i % 3) * 3;
    if (p.pos) p.pos.set(cx + Math.sin(ang) * d, 0, cz + Math.cos(ang) * d);
    if (p.mesh) p.mesh.position.set(cx + Math.sin(ang) * d, 0, cz + Math.cos(ang) * d);
  }
}

function stageShot1(G) {
  // Cover: driving down the beachfront avenue at golden hour.
  const car = ensurePlayerCar(G, -150, -20, Math.PI, false); // heading north (-z)
  putPlayerInCar(G, car, 14);
  placeTrafficAhead(G, -150, -20, Math.PI, 3);
  placePedsNear(G, -144, -30, 4);
  G.cameraOverride = {
    pos: { x: -150, y: 5.5, z: -2 },
    lookAt: { x: -150, y: 1.2, z: -45 },
  };
  if (G.missions) {
    G.missions.objective = "Rosa's call: come to the café";
  }
  if (G.hud && G.hud.say) G.hud.say("Rosa: \"Dario, it's Rosa. Come to the café.\"");
}

function stageShot2(G) {
  // On foot in the market plaza, parked car in frame, "ROSA'S" sign visible.
  putPlayerOnFoot(G, 6, 7, Math.PI * 0.85);
  placePedsNear(G, 0, 0, 6);
  // A parked car should already be near the plaza; nudge one into frame if present.
  const parked = (G.traffic && G.traffic.parked) || [];
  if (parked[0]) {
    parked[0].pos.set(12, 0, -2);
    parked[0].mesh.position.set(12, 0, -2);
    parked[0].heading = Math.PI / 2;
    parked[0].mesh.rotation.y = Math.PI / 2;
  }
  G.cameraOverride = {
    pos: { x: 13, y: 3.2, z: 15 },
    lookAt: { x: -2, y: 2.2, z: -2 },
  };
  if (G.missions) G.missions.objective = "Rosa's call: come to the café";
}

function stageShot3(G) {
  // Chase: 3 stars, two SBPD cars right behind the player's car.
  const car = ensurePlayerCar(G, 0, -80, Math.PI, true);
  putPlayerInCar(G, car, 22);
  if (G.police) {
    G.police.stars = 3;
    if (G.state) G.state.wanted = 3;
    // Clear existing cruisers, place two directly behind.
    for (const c of [...G.police.cars]) {
      if (G.scene && c.mesh) G.scene.remove(c.mesh);
    }
    G.police.cars.length = 0;
    for (const [dz, lane] of [[-13, -2.5], [-20, 2.5]]) {
      const pc = createCar(G, { x: lane, z: -80 + dz, heading: Math.PI, police: true });
      pc.speed = 20;
      G.police.cars.push(pc);
    }
    if (G.audio) G.audio.siren(true);
  }
  placeTrafficAhead(G, 0, -80, Math.PI, 1);
  G.cameraOverride = {
    pos: { x: 0, y: 5, z: -58 },
    lookAt: { x: 0, y: 1.2, z: -85 },
  };
  if (G.hud && G.hud.say) G.hud.say('WANTED ★★★ — the SBPD is on you');
}

function stageShot4(G) {
  // Mission: at the docks, M1 package marker glowing, Rosa dialogue on HUD.
  if (G.missions) {
    const M = G.missions;
    M.index = 1;
    if (G.state) G.state.missionIndex = 1;
    M.stage = 'pickup';
    M.marker = { x: 182, z: 24, radius: 5, label: 'package' };
    M.objective = 'M1: collect the package on foot';
    if (M.markerMesh) {
      M.markerMesh.visible = true;
      M.markerMesh.position.set(182, 0, 24);
    }
  }
  putPlayerOnFoot(G, 174, 26, Math.PI / 2 - 0.4);
  G.cameraOverride = {
    pos: { x: 168, y: 4.5, z: 34 },
    lookAt: { x: 184, y: 2.5, z: 22 },
  };
  if (G.hud && G.hud.say) G.hud.say('Rosa: "Package is at the port, Dario. Walk in and grab it."');
}

export function setupShots(G) {
  const q = params();
  const shot = parseInt(q.get('shot') || '0', 10);
  const seed = parseInt(q.get('seed') || '7', 10);
  G.shotSeed = seed;
  if (!shot || shot < 1 || shot > 4) return;

  G.state.mode = 'playing';
  if (G.audio) { try { G.audio.unlock(); } catch (e) { /* ignore */ } }

  if (shot === 1) stageShot1(G);
  else if (shot === 2) stageShot2(G);
  else if (shot === 3) stageShot3(G);
  else if (shot === 4) stageShot4(G);

  // Let the world settle one frame, then paint twice before signalling ready.
  const render = () => { if (G.renderFrame) G.renderFrame(); };
  const finish = () => {
    const gta = window.__GTA || {};
    gta.shotReady = true;
    gta.screen = 'game';
    gta.wanted = (G.police && G.police.stars) || G.state.wanted || 0;
    gta.money = G.state.money || 0;
    gta.mission = (G.missions && G.missions.index) || 0;
    gta.speed = G.player && G.player.car ? Math.abs(G.player.car.speed || 0) : Math.abs((G.player && G.player.speed) || 0);
    window.__GTA = gta;
    window.__shotReady = true;
    if (G.shots) G.shots.staged = shot;
  };
  const raf = (typeof requestAnimationFrame !== 'undefined')
    ? requestAnimationFrame.bind(window)
    : (fn) => setTimeout(fn, 16);
  raf(() => {
    render();
    raf(() => {
      render();
      finish();
    });
  });
}
