// missions.js — Solmar Bay story missions M0->M1->M2->M3 + taxi (Worker B, v6 fresh)
// Contract: createMissions(G) / updateMissions(G, dt)
// M0 intro (cafe marker) -> M1 "The Pickup" (docks package, on foot) -> M2 "Hot Wheels"
// (steal yellow sports car) -> M3 "The Getaway" (safehouse, 3 stars) -> free roam + taxi.
//
// V6 FIX (root cause of the v5 failure): the M1 package marker (182,24) is collected
// ON FOOT from the open road. The drive stage completes at a generous staging
// radius around (172,25) — the car is NEVER required to enter the container yard,
// and the package pickup never requires driving into the docks corridor.
import * as THREE from '../vendor/three/three.module.min.js';

const CAFE = { x: 0, z: 0 };
const DOCK_STAGE = { x: 172, z: 25 };   // open-road staging point at the docks edge
const PACKAGE = { x: 182, z: 24 };      // package marker — reached ON FOOT
const SPORTS_CAR = { x: -150, z: -60 }; // yellow sports car, beachfront
const GARAGE = { x: -40, z: 150 };
const SAFEHOUSE = { x: -100, z: 150 };

function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

function say(G, text) {
  if (G.hud && G.hud.say) G.hud.say(text);
}

function toast(G, title, sub) {
  if (G.hud && G.hud.toast) G.hud.toast(title, sub || '');
}

function jingle(G) {
  if (G.audio) G.audio.sfx('jingle');
}

export function createMissions(G) {
  const idx = (G.state && typeof G.state.missionIndex === 'number') ? G.state.missionIndex : 0;

  // Mission marker: glowing pulsing cylinder + ring, moved to the active target.
  const markerGroup = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 20, 1, true), beamMat);
  beam.position.y = 4.5;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  markerGroup.add(beam); markerGroup.add(ring);
  markerGroup.visible = false;
  if (G.scene) G.scene.add(markerGroup);

  const M = {
    index: idx,            // 0=M0, 1=M1, 2=M2, 3=M3, 4=all done (free roam)
    stage: 'idle',
    timer: 0,
    timerMax: 0,
    marker: null,          // {x, z, radius, label}
    objective: '',
    message: '',
    markerMesh: markerGroup,
    _pulse: 0,
    _sportsCar: null,
    _hasPackage: false,
    _taxi: null,           // {phase, cust:{x,z}, dest:{x,z}, timer}
    _taxiCooldown: 8,
    _started: false,
    onBusted,
  };

  // The M2 sports car is created by main.js (yellow, beachfront) and tagged
  // missionCar; ensureSportsCar() below finds it via G.vehicles.

  // Start M0 on first frame (intro phone call).
  M.stage = idx >= 4 ? 'freeroam' : idx === 0 ? 'goto-cafe' : startMissionStage(G, M, idx);
  applyStage(G, M);
  return M;
}

function ensureSportsCar(G, M) {
  if (M._sportsCar) return M._sportsCar;
  // Synchronous path: main.js pre-creates it via G.vehicles if present.
  if (G.vehicles) {
    for (const c of G.vehicles) if (c.missionCar) { M._sportsCar = c; return c; }
  }
  return null;
}

function startMissionStage(G, M, idx) {
  M.index = idx;
  M._hasPackage = false;
  M.timer = 0; M.timerMax = 0;
  if (idx === 0) return 'goto-cafe';
  if (idx === 1) return 'drive-docks';
  if (idx === 2) return 'steal-car';
  if (idx === 3) return 'escape';
  return 'freeroam';
}

function applyStage(G, M) {
  const s = M.stage;
  if (s === 'goto-cafe') {
    M.marker = { x: CAFE.x, z: CAFE.z, radius: 4, label: 'cafe' };
    M.objective = "Rosa's call: come to the café";
    if (!M._started) {
      M._started = true;
      say(G, 'Rosa: "Dario, it\'s Rosa. Come to the café."');
    }
  } else if (s === 'drive-docks') {
    M.marker = { x: DOCK_STAGE.x, z: DOCK_STAGE.z, radius: 30, label: 'docks' };
    M.objective = 'M1 "The Pickup": drive to the docks';
    say(G, 'Rosa: "Package is at the port, Dario. Drive to the docks — park on the road, walk in."');
  } else if (s === 'pickup') {
    M.marker = { x: PACKAGE.x, z: PACKAGE.z, radius: 5, label: 'package' };
    M.objective = 'M1: collect the package on foot';
    say(G, 'Rosa: "Park the car and walk to the package. Don\'t drive into the yard."');
  } else if (s === 'deliver') {
    M.timer = 150; M.timerMax = 150;
    M.marker = { x: CAFE.x, z: CAFE.z, radius: 5, label: 'cafe' };
    M.objective = 'M1: bring the package back to Rosa\'s café';
    say(G, 'Rosa: "Got it? Good. Bring it back to the café — 150 seconds, don\'t dawdle."');
  } else if (s === 'steal-car') {
    M.marker = { x: SPORTS_CAR.x, z: SPORTS_CAR.z, radius: 4, label: 'sports' };
    M.objective = 'M2 "Hot Wheels": steal the yellow sports car';
    say(G, 'Rosa: "A yellow sports car is parked on the beachfront. Take it — the SBPD will notice."');
  } else if (s === 'to-garage') {
    M.marker = { x: GARAGE.x, z: GARAGE.z, radius: 6, label: 'garage' };
    M.objective = 'M2: bring the sports car to the garage';
  } else if (s === 'escape') {
    M.timer = 150; M.timerMax = 150;
    M.marker = { x: SAFEHOUSE.x, z: SAFEHOUSE.z, radius: 6, label: 'safehouse' };
    M.objective = 'M3 "The Getaway": reach the safehouse — lose the cops on the way';
    say(G, 'Rosa: "They know, Dario. Three stars on you. Get to the safehouse in the barrios — GO!"');
    if (G.police) {
      G.police.stars = 3;
      if (G.state) G.state.wanted = 3;
      if (G.hud && G.hud.say) G.hud.say('WANTED ★★★ — the SBPD is on you');
    }
  } else if (s === 'freeroam') {
    M.marker = null;
    M.objective = 'Free roam — taxi jobs pay the bills';
    say(G, 'Rosa: "You\'re free of the debt — for now. Drive a taxi if you want easy cash."');
  }
  updateMarkerMesh(G, M);
}

function updateMarkerMesh(G, M) {
  if (!M.markerMesh) return;
  if (!M.marker) { M.markerMesh.visible = false; return; }
  M.markerMesh.visible = true;
  M.markerMesh.position.set(M.marker.x, 0, M.marker.z);
}

function completeMission(G, M, reward, title) {
  G.state.money = (G.state.money || 0) + reward;
  if (G.state.stats) {
    G.state.stats.missionsDone = (G.state.stats.missionsDone || 0) + 1;
    G.state.stats.bestCash = Math.max(G.state.stats.bestCash || 0, G.state.money);
  }
  jingle(G);
  toast(G, title, '+$' + reward);
  say(G, 'Mission complete: ' + title + ' +$' + reward);
  M.index += 1;
  G.state.missionIndex = M.index;
  if (G.saveGame) G.saveGame(G);
  M.stage = startMissionStage(G, M, M.index);
  applyStage(G, M);
}

function failMission(G, M, reason) {
  say(G, 'Mission failed — ' + reason + '. Try again from the start.');
  if (G.hud && G.hud.toast) G.hud.toast('Mission failed', reason);
  // Retry from the mission start; cash earned is kept, nothing else is lost.
  M.stage = startMissionStage(G, M, M.index);
  applyStage(G, M);
}

function onBusted(G) {
  const M = G.missions;
  if (!M) return;
  if (M.index >= 1 && M.index <= 3 && M.stage !== 'freeroam') {
    failMission(G, M, 'busted by the SBPD');
  }
}

export function updateMissions(G, dt) {
  const M = G.missions;
  if (!M || !G.player || !G.player.pos) return;
  if (G.state.mode !== 'playing') return;

  // Pulse the marker.
  M._pulse += dt;
  if (M.markerMesh && M.markerMesh.visible) {
    const s = 1 + Math.sin(M._pulse * 4) * 0.12;
    M.markerMesh.scale.set(s, 1, s);
    M.markerMesh.children.forEach((c) => {
      if (c.material) c.material.opacity = c.geometry && c.geometry.type === 'RingGeometry'
        ? 0.6 + Math.sin(M._pulse * 4) * 0.3 : 0.3 + Math.sin(M._pulse * 4) * 0.1;
    });
  }

  const px = G.player.pos.x, pz = G.player.pos.z;
  const inCar = !!G.player.car;

  // Countdown timers.
  if (M.timer > 0) {
    M.timer -= dt;
    if (M.timer <= 0) {
      M.timer = 0;
      failMission(G, M, 'time ran out');
      return;
    }
  }

  const at = (m) => (m ? dist(px, pz, m.x, m.z) <= (m.radius || 5) : false);

  switch (M.stage) {
    case 'goto-cafe': {
      if (at(M.marker)) {
        M.index = 1;
        G.state.missionIndex = 1;
        M.stage = 'drive-docks';
        applyStage(G, M);
      }
      break;
    }
    case 'drive-docks': {
      // Generous staging radius: arriving anywhere near the docks road counts.
      // Also accept walking straight to the package (player parked early / on foot).
      if (at(M.marker) || dist(px, pz, PACKAGE.x, PACKAGE.z) <= 12) {
        M.stage = 'pickup';
        applyStage(G, M);
      }
      break;
    }
    case 'pickup': {
      if (!inCar && at(M.marker)) {
        M._hasPackage = true;
        if (G.audio) G.audio.sfx('pickup');
        M.stage = 'deliver';
        applyStage(G, M);
      } else if (inCar && at(M.marker)) {
        // Hint, throttled: the package must be collected on foot.
        if (!M._hintT || M._pulse - M._hintT > 4) {
          M._hintT = M._pulse;
          say(G, 'Park the car and walk to the glowing package.');
        }
      }
      break;
    }
    case 'deliver': {
      if (at(M.marker)) {
        M._hasPackage = false;
        completeMission(G, M, 300, 'M1 "The Pickup" complete');
      }
      break;
    }
    case 'steal-car': {
      const sc = ensureSportsCar(G, M);
      if (sc && G.player.car === sc) {
        // Stealing it is hot: 2 stars immediately.
        if (G.police) {
          G.police.stars = 2;
          if (G.state) G.state.wanted = 2;
        }
        if (G.state.stats) G.state.stats.carsStolen = (G.state.stats.carsStolen || 0) + 1;
        say(G, 'WANTED ★★ — you stole the sports car!');
        M.stage = 'to-garage';
        applyStage(G, M);
      }
      break;
    }
    case 'to-garage': {
      const sc = ensureSportsCar(G, M);
      if (sc && G.player.car === sc && at(M.marker)) {
        completeMission(G, M, 500, 'M2 "Hot Wheels" complete');
      } else if (sc && G.player.car !== sc && M.stage === 'to-garage') {
        // Player left the car: point them back at it.
        M.marker = { x: sc.pos.x, z: sc.pos.z, radius: 4, label: 'sports' };
        M.objective = 'M2: get back in the yellow sports car';
        updateMarkerMesh(G, M);
      }
      break;
    }
    case 'escape': {
      if (at(M.marker)) {
        if (G.police) { G.police.stars = 0; if (G.state) G.state.wanted = 0; }
        completeMission(G, M, 800, 'M3 "The Getaway" complete');
      }
      break;
    }
    case 'freeroam': {
      updateTaxi(G, M, dt);
      break;
    }
    default:
      break;
  }
}

function updateTaxi(G, M, dt) {
  const rng = G.rng || { next: () => Math.random() };
  const px = G.player.pos.x, pz = G.player.pos.z;
  const inCar = !!G.player.car;

  if (!M._taxi) {
    M._taxiCooldown -= dt;
    if (M._taxiCooldown <= 0 && inCar) {
      // A waving pedestrian nearby wants a ride.
      const ang = rng.next() * Math.PI * 2;
      const d = 25 + rng.next() * 45;
      const cx = Math.max(-190, Math.min(190, px + Math.sin(ang) * d));
      const cz = Math.max(-190, Math.min(190, pz + Math.cos(ang) * d));
      M._taxi = { phase: 'pickup', cust: { x: cx, z: cz }, dest: null, fare: 40 + Math.floor(rng.next() * 30) };
      M.marker = { x: cx, z: cz, radius: 5, label: 'taxi' };
      M.objective = 'Taxi: pick up the waving customer';
      say(G, 'Taxi customer is waving nearby — pick them up.');
      updateMarkerMesh(G, M);
    }
    return;
  }

  const T = M._taxi;
  if (T.phase === 'pickup') {
    if (inCar && dist(px, pz, T.cust.x, T.cust.z) <= 5 && Math.abs(G.player.car.speed || 0) < 3) {
      const ang = rng.next() * Math.PI * 2;
      const d = 60 + rng.next() * 70;
      const dx = Math.max(-190, Math.min(190, px + Math.sin(ang) * d));
      const dz = Math.max(-190, Math.min(190, pz + Math.cos(ang) * d));
      T.phase = 'dropoff';
      T.dest = { x: dx, z: dz };
      M.marker = { x: dx, z: dz, radius: 6, label: 'taxi' };
      M.objective = 'Taxi: drop the customer off';
      say(G, 'Customer: "Take me over there, quick!"');
      updateMarkerMesh(G, M);
    }
  } else if (T.phase === 'dropoff') {
    if (inCar && dist(px, pz, T.dest.x, T.dest.z) <= 6) {
      G.state.money = (G.state.money || 0) + T.fare;
      if (G.audio) G.audio.sfx('pickup');
      toast(G, 'Taxi fare', '+$' + T.fare);
      say(G, 'Taxi fare +$' + T.fare);
      M._taxi = null;
      M._taxiCooldown = 10;
      M.marker = null;
      M.objective = 'Free roam — taxi jobs pay the bills';
      updateMarkerMesh(G, M);
    }
  }
}
