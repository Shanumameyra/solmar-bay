// Missions — Mama Rosa's job chain (M0 intro, M1 pickup, M2 hot wheels,
// M3 getaway), then free roam with repeatable taxi jobs and mission replays.
import { addHeat } from './police.js';

// District landmarks — read straight from the city buildCity() returns
// (city.js, top-level keys). Actual coordinates from the city module:
// cafe (-20,-10) at the market plaza, docks (160,50), beachfront (-168,0)
// on the beach avenue, garage (0,170) south, safehouse (-60,160) in the
// barrios, precinct (100,-80), hospital (120,-120), gunshop (80,40).
// The table below is only a last-resort fallback if the city lacks a key.
const FALLBACK_LANDMARKS = {
  cafe: { x: -20, z: -10 },
  plaza: { x: 0, z: 0 },
  docks: { x: 160, z: 50 },
  beachfront: { x: -168, z: 0 },
  garage: { x: 0, z: 170 },
  safehouse: { x: -60, z: 160 },
  precinct: { x: 100, z: -80 },
  hospital: { x: 120, z: -120 },
  gunshop: { x: 80, z: 40 },
};

function landmark(city, key) {
  if (city) {
    // city.js puts every landmark on the city object itself.
    if (city[key] && typeof city[key].x === 'number' && typeof city[key].z === 'number') {
      return { x: city[key].x, z: city[key].z };
    }
    if (key === 'beachfront' && city.beach) {
      return { x: city.beach.x0 + 32, z: 0 };
    }
    if (key === 'plaza' && city.plaza) {
      return { x: city.plaza.x, z: city.plaza.z };
    }
    const pools = [city.landmarks, city.locations, city.places, city.spots];
    for (const pool of pools) {
      if (pool && pool[key]) {
        const p = pool[key];
        if (typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, z: p.z };
        if (p.pos) return { x: p.pos.x, z: p.pos.z };
      }
    }
  }
  return { ...FALLBACK_LANDMARKS[key] };
}

export function createMissions(city) {
  const lm = {};
  for (const key of Object.keys(FALLBACK_LANDMARKS)) lm[key] = landmark(city, key);
  const pickups = [];
  const spots = [
    { x: 25, z: -25 }, { x: -50, z: 25 }, { x: 75, z: 25 },
    { x: -100, z: -75 }, { x: 125, z: -75 }, { x: -25, z: 100 },
  ];
  for (const s of spots) {
    pickups.push({ x: s.x, z: s.z, amount: 25 + Math.floor(Math.random() * 4) * 10, taken: false });
  }
  return {
    index: 0,
    step: 'call',
    marker: { ...lm.cafe },
    timer: 0,
    active: false,
    done: [],
    taxi: { customer: null, dest: null, state: 'idle', fare: 0 },
    pickups,
    dialogue: "Dario, it's Rosa. Come to the café.",
    landmarks: lm,
    targetCar: null,
    needsRetry: false,
    replay: false,
  };
}

function playerPos(S) {
  const p = S.player || {};
  if (p.pos) return { x: p.pos.x, z: p.pos.z };
  if (p.position) return { x: p.position.x, z: p.position.z };
  return { x: p.x || 0, z: p.z || 0 };
}

function playerHeading(S) {
  const p = S.player || {};
  return p.heading ?? p.h ?? p.angle ?? 0;
}

function inCar(S) {
  const p = S.player || {};
  return !!(p.inCar || p.car || p.driving);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function say(S, text) {
  S.missions.dialogue = text;
  if (S.messages) S.messages.push({ text, t: S.time || 0 });
}

function toast(S, text) {
  if (S.messages) S.messages.push({ text, t: S.time || 0 });
}

function giveCash(S, amount) {
  const p = S.player || {};
  if (typeof p.money === 'number') p.money += amount;
  else if (typeof S.money === 'number') S.money += amount;
  else p.money = amount;
  if (S.save && S.save.stats) S.save.stats.bestCash = Math.max(S.save.stats.bestCash || 0, p.money || 0);
}

function completeMission(S, reward, name) {
  const m = S.missions;
  const pay = m.replay ? Math.floor(reward / 2) : reward;
  giveCash(S, pay);
  m.done.push(name);
  if (S.save && S.save.stats) S.save.stats.missionsDone = (S.save.stats.missionsDone || 0) + 1;
  toast(S, `Mission complete +$${pay}`);
  if (S.audio && typeof S.audio.sfx === 'function') {
    try { S.audio.sfx(S, 'jingle'); } catch (e) { /* audio optional */ }
  }
  if (typeof S.saveGame === 'function') {
    try { S.saveGame(S); } catch (e) { /* save optional */ }
  }
  m.index += 1;
  m.replay = false;
}

function startMission(S, index) {
  const m = S.missions;
  const lm = m.landmarks;
  m.index = index;
  m.timer = 0;
  m.active = true;
  m.needsRetry = false;
  if (index === 0) {
    m.step = 'call';
    m.marker = { ...lm.cafe };
    m.dialogue = "Dario, it's Rosa. Come to the café.";
  } else if (index === 1) {
    m.step = 'pickup';
    m.marker = { ...lm.docks };
    say(S, "Rosa: Package is waiting at the docks. Don't keep me waiting.");
  } else if (index === 2) {
    m.step = 'steal';
    m.marker = { ...lm.beachfront };
    // Target car: the parked car nearest the beachfront marker.
    let best = null;
    let bestD = Infinity;
    for (const car of S.parkedCars || []) {
      const d = dist({ x: car.x ?? 0, z: car.z ?? 0 }, lm.beachfront);
      if (d < bestD) { bestD = d; best = car; }
    }
    m.targetCar = best;
    if (best) {
      best.marked = true;
      best.color = 0xf7d117; // yellow sports car
      m.marker = { x: best.x ?? lm.beachfront.x, z: best.z ?? lm.beachfront.z };
    }
    say(S, "Rosa: I need that yellow sports car on the beachfront. Bring it to the garage.");
  } else if (index === 3) {
    m.step = 'escape';
    m.marker = { ...lm.safehouse };
    m.timer = 150;
    if (S.police) {
      S.police.stars = 3;
      S.police.heat = Math.max(S.police.heat || 0, 3);
      S.police.lastSeenT = S.time || 0;
    }
    say(S, "Rosa: Cops are on you, Dario. Reach the safehouse in the barrios — 150 seconds!");
  } else {
    // Free roam.
    m.step = 'freeroam';
    m.marker = null;
    m.active = false;
    m.dialogue = "Rosa: You're free of the debt — for now. Drive a taxi if you need cash.";
    startTaxi(S);
  }
}

function randomStreetPoint(S, minDist) {
  const pp = playerPos(S);
  const rng = S.rng || Math.random;
  for (let tries = 0; tries < 20; tries++) {
    const x = Math.round((rng() * 8 - 4)) * 50;
    const z = Math.round((rng() * 8 - 4)) * 50;
    if (Math.hypot(x - pp.x, z - pp.z) >= minDist) return { x, z };
  }
  return { x: pp.x + 100, z: pp.z };
}

function startTaxi(S) {
  const m = S.missions;
  const spot = randomStreetPoint(S, 40);
  m.taxi = { customer: spot, dest: null, state: 'pickup', fare: 0 };
  m.marker = { ...spot };
  m.dialogue = 'Taxi: someone is waving you down. Pick them up.';
}

export function missionObjective(S) {
  const m = S.missions;
  if (!m) return 'Roam Solmar Bay.';
  if (m.index === 0) return "Go to Rosa's café";
  if (m.index === 1) {
    if (m.step === 'pickup') return 'Collect the package at the docks';
    return 'Deliver the package to Rosa\'s café';
  }
  if (m.index === 2) {
    if (m.step === 'steal') return 'Steal the yellow sports car at the beachfront';
    return 'Bring the sports car to the garage';
  }
  if (m.index === 3) return 'Reach the safehouse in the barrios';
  if (m.taxi && m.taxi.state === 'pickup') return 'Taxi: pick up the waving customer';
  if (m.taxi && m.taxi.state === 'dropoff') return 'Taxi: drop the customer off';
  return 'Free roam — taxi jobs pay cash';
}

export function updateMissions(S, dt) {
  const m = S.missions;
  if (!m) return;
  const pp = playerPos(S);
  const lm = m.landmarks;

  // --- cash pickups (always live) ---
  for (const pk of m.pickups) {
    if (!pk.taken && dist(pp, pk) < 2.5) {
      pk.taken = true;
      giveCash(S, pk.amount);
      toast(S, `Cash pickup +$${pk.amount}`);
      if (S.audio && typeof S.audio.sfx === 'function') {
        try { S.audio.sfx(S, 'pickup'); } catch (e) { /* ignore */ }
      }
      if (S.effects && typeof S.effects.spawnSparks === 'function') {
        try { S.effects.spawnSparks(S, { x: pk.x, y: 1, z: pk.z }); } catch (e) { /* ignore */ }
      }
    }
  }

  // --- retry after a failed mission (timer out or busted) ---
  if (m.needsRetry) {
    const idx = Math.min(m.index, 3);
    toast(S, 'Job failed — Rosa calls again. Try it from the start.');
    startMission(S, idx);
    return;
  }

  // --- taxi jobs run in free roam ---
  if (m.index > 3 || m.step === 'freeroam') {
    const tx = m.taxi;
    if (tx && tx.state === 'pickup' && tx.customer && dist(pp, tx.customer) < 6) {
      tx.dest = randomStreetPoint(S, 80);
      tx.fare = 25 + Math.round(dist(tx.customer, tx.dest) / 10) * 5;
      tx.state = 'dropoff';
      m.marker = { ...tx.dest };
      m.dialogue = `Taxi: take them to the marked spot. Fare $${tx.fare}.`;
    } else if (tx && tx.state === 'dropoff' && tx.dest && dist(pp, tx.dest) < 8) {
      giveCash(S, tx.fare);
      toast(S, `Taxi fare +$${tx.fare}`);
      if (S.audio && typeof S.audio.sfx === 'function') {
        try { S.audio.sfx(S, 'pickup'); } catch (e) { /* ignore */ }
      }
      startTaxi(S);
    }
    S.objective = missionObjective(S);
    return;
  }

  // --- story missions M0-M3 ---
  if (m.index === 0) {
    m.step = 'call';
    m.marker = { ...lm.cafe };
    if (dist(pp, lm.cafe) < 8) {
      toast(S, "Rosa: Good, you're here. A package is waiting at the docks.");
      startMission(S, 1);
    }
  } else if (m.index === 1) {
    if (m.step === 'pickup') {
      m.marker = { ...lm.docks };
      if (dist(pp, lm.docks) < 6 && !inCar(S)) {
        m.step = 'deliver';
        m.timer = 150;
        m.marker = { ...lm.cafe };
        say(S, "Rosa: Got it. Now bring it back to the café — 150 seconds, Dario.");
      }
    } else if (m.step === 'deliver') {
      m.timer -= dt;
      m.marker = { ...lm.cafe };
      if (dist(pp, lm.cafe) < 8) {
        completeMission(S, 300, 'M1 The Pickup');
        startMission(S, 2);
      } else if (m.timer <= 0) {
        m.needsRetry = true;
      }
    }
  } else if (m.index === 2) {
    if (m.step === 'steal') {
      const target = m.targetCar;
      const spot = target
        ? { x: target.x ?? lm.beachfront.x, z: target.z ?? lm.beachfront.z }
        : lm.beachfront;
      m.marker = { ...spot };
      const stolen = target && inCar(S) && S.player.car === target;
      const nearAndDriving = target && inCar(S) && dist(pp, spot) < 8;
      if (stolen || nearAndDriving) {
        m.step = 'deliver';
        m.marker = { ...lm.garage };
        if (S.save && S.save.stats) S.save.stats.carsStolen = (S.save.stats.carsStolen || 0) + 1;
        try { addHeat(S, 2); } catch (e) { if (S.police) S.police.stars = 2; }
        say(S, 'Rosa: Beautiful. Now lose the heat and bring it to the garage, south side.');
      }
    } else if (m.step === 'deliver') {
      m.marker = { ...lm.garage };
      if (dist(pp, lm.garage) < 10 && inCar(S)) {
        completeMission(S, 500, 'M2 Hot Wheels');
        startMission(S, 3);
      }
    }
  } else if (m.index === 3) {
    m.timer -= dt;
    m.marker = { ...lm.safehouse };
    // Keep the heat on for the whole escape.
    if (S.police && S.police.stars < 3) S.police.stars = 3;
    if (dist(pp, lm.safehouse) < 10) {
      if (S.police) { S.police.stars = 0; S.police.heat = 0; }
      completeMission(S, 800, 'M3 The Getaway');
      say(S, "Rosa: You're free of the debt — for now.");
      startMission(S, 4);
    } else if (m.timer <= 0) {
      m.needsRetry = true;
    }
  }

  S.objective = missionObjective(S);
}
