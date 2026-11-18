// missions.js — story missions from Mama Rosa, taxi fares, cash pickups.
//
// Owns state.mission / state.pickups / state.taxiMarker. The step INDEX is
// `stepIndex` (NOT `step` — that name is the update method; assigning
// this.step = 0 once overwrote the method and froze every mission).
// Uses Math.random (shots.js seeds it while staging, so staged missions
// are deterministic).

import { CONFIG } from './config.js';
import { createCar } from './vehicle.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function distTo(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function pushEv(state, ev) {
  if (state && Array.isArray(state.events)) {
    state.events.push({ t: state.time ?? 0, ...ev });
  }
}

function inCollider(state, x, z, pad) {
  const cs = state.colliders;
  if (!cs) return false;
  for (const c of cs) {
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) {
      return true;
    }
  }
  return false;
}

function landmark(state, key) {
  return (
    (state.landmarks && state.landmarks[key]) ||
    (CONFIG.LANDMARKS && CONFIG.LANDMARKS[key]) || { x: 0, z: 0 }
  );
}

function missionDef(i) {
  const m = (CONFIG.MISSIONS || [])[i];
  return (
    m || { id: 'M' + i, name: 'Job ' + (i + 1), reward: 0, time: 0, intro: '', steps: [] }
  );
}

function nextCarId(state) {
  let max = 0;
  let count = 0;
  for (const c of state.cars || []) {
    count++;
    if (typeof c.id === 'number' && c.id > max) max = c.id;
  }
  return Math.max(max, count) + 1;
}

export function createMissions() {
  const api = {
    index: 0,
    phase: 'idle', // 'idle' | 'active' | 'done' | 'failed'
    stepIndex: 0,
    timer: 0,
    markedCarId: null,
    taxi: { phase: 'none', customerId: null, dest: null, destName: '', since: 0 },
    pickupsSpawned: false,
    _done: {},
    _nextPending: null,
    _m0Started: false,
    _taxiT: 8,

    reset() {
      api.index = 0;
      api.phase = 'idle';
      api.stepIndex = 0;
      api.timer = 0;
      api.markedCarId = null;
      api.taxi = { phase: 'none', customerId: null, dest: null, destName: '', since: 0 };
      api.pickupsSpawned = false;
      api._done = {};
      api._nextPending = null;
      api._m0Started = false;
      api._taxiT = 8;
    },

    // Load the next mission to play from a save: earlier missions count as
    // done (replayable for half reward).
    loadIndex(i) {
      api.index = clamp(i | 0, 0, 3);
      api.phase = 'idle';
      api.stepIndex = 0;
      api.timer = 0;
      api.markedCarId = null;
      api._nextPending = null;
      api._m0Started = api.index !== 0;
      api._done = {};
      for (let k = 0; k < api.index; k++) api._done[k] = true;
    },

    start(i, state) {
      const def = missionDef(i);
      api.index = i;
      api.phase = 'active';
      api.stepIndex = 0;
      api.timer = def.time || 0;
      api.markedCarId = null;
      api._nextPending = null;
      if (i === 0) api._m0Started = true;
      if (i === 2) api.markCar(state);
      if (i === 3) {
        state.systems?.police?.addHeat?.(3, 'the whole SBPD is on you', state);
        pushEv(state, { type: 'mission', text: 'Three stars — run for the safehouse!' });
      }
      pushEv(state, {
        type: 'mission',
        text: `New job: ${def.name}${def.reward ? ` — $${def.reward}` : ''}`,
      });
      api.applyStep(state);
      api._sync(state);
    },

    // Sets state.mission objective / marker / dialogue for the current
    // (index, stepIndex). Prefers CONFIG step text when it exists.
    applyStep(state) {
      const def = missionDef(api.index);
      const s = (def.steps || [])[api.stepIndex] || {};
      let objective = s.objective;
      let markerKey = s.marker;
      let dialogue = s.dialogue;
      if (api.index === 0) {
        objective = objective || "Go to Rosa's café";
        markerKey = markerKey || 'cafe';
        dialogue = dialogue || "Dario, it's Rosa. Come to the café.";
      } else if (api.index === 1) {
        if (api.stepIndex === 0) {
          objective = objective || 'Drive to the docks';
          markerKey = markerKey || 'docks';
          dialogue = dialogue || 'Pick up the package at the docks, Dario.';
        } else if (api.stepIndex === 1) {
          objective = objective || 'Collect the package';
          markerKey = markerKey || 'docks';
          dialogue = dialogue || "It's in the container yard — grab it.";
        } else {
          objective = objective || "Deliver the package to Rosa's café";
          markerKey = markerKey || 'cafe';
          dialogue = dialogue || "Bring it home, Dario. The clock's ticking.";
        }
      } else if (api.index === 2) {
        if (api.stepIndex === 0) {
          objective = objective || 'Steal the yellow sports car at the beach';
          markerKey = markerKey || 'beachCar';
          dialogue = dialogue || 'Yellow sports car, beachfront. Take it — quick.';
        } else {
          objective = objective || 'Bring the sports car to the garage';
          markerKey = markerKey || 'garage';
          dialogue = dialogue || 'Nice. Now get it to the garage in one piece.';
        }
      } else if (api.index === 3) {
        objective = objective || 'Reach the safehouse in the barrios';
        markerKey = markerKey || 'safehouse';
        dialogue =
          dialogue ||
          "Three stars on you, Dario. Get to the safehouse — you're free of the debt after this.";
      }
      const L = markerKey ? landmark(state, markerKey) : null;
      state.mission = state.mission || {};
      state.mission.objective = objective || 'Explore Solmar Bay';
      state.mission.marker = L ? { x: L.x, z: L.z } : null;
      state.mission.dialogue = dialogue || '';
      api._sync(state);
    },

    complete(state) {
      const def = missionDef(api.index);
      let reward = def.reward || 0;
      if (api._done[api.index]) reward = Math.floor(reward / 2);
      state.money = (state.money ?? 0) + reward;
      if (state.stats) {
        state.stats.missionsDone = (state.stats.missionsDone ?? 0) + 1;
        state.stats.bestCash = Math.max(state.stats.bestCash ?? 0, state.money);
      }
      api._done[api.index] = true;
      api._m0Started = true;
      api.phase = 'idle';
      api._nextPending = api.index < 3 ? api.index + 1 : null;
      api.timer = 0;
      const cafe = landmark(state, 'cafe');
      state.mission = state.mission || {};
      state.mission.marker =
        api._nextPending != null ? { x: cafe.x, z: cafe.z } : null;
      state.mission.objective =
        api._nextPending != null
          ? "Go to Rosa's café for the next job"
          : 'Free roam — taxi fares pay $45';
      state.mission.dialogue =
        api.index === 3
          ? "You're free of the debt — for now."
          : 'Good work, Dario. Come see me at the café.';
      pushEv(state, {
        type: 'missionComplete',
        text: reward > 0 ? `Mission complete +$${reward}` : 'Mission complete',
        reward,
      });
      if (state.player) {
        state.fxBurst = { type: 'glint', x: state.player.x, y: 1.6, z: state.player.z };
      }
      api._sync(state);
    },

    fail(state, why) {
      api.phase = 'idle';
      api._nextPending = api.index;
      api.timer = 0;
      const cafe = landmark(state, 'cafe');
      state.mission = state.mission || {};
      state.mission.marker = { x: cafe.x, z: cafe.z };
      state.mission.objective = "Go to Rosa's café to retry the job";
      state.mission.dialogue = "Don't worry, Dario. Come back and we'll try again.";
      pushEv(state, {
        type: 'missionFailed',
        text: `Mission failed — ${why}. Talk to Rosa to retry.`,
      });
      api._sync(state);
    },

    // The M2 target: a yellow sports car parked at the beachfront.
    // Full contract shape via createCar (see police.js spawnCar).
    markCar(state) {
      if (api.markedCarId != null) {
        const old = (state.cars || []).find((c) => c.id === api.markedCarId);
        if (old) return old;
      }
      const spot = landmark(state, 'beachCar');
      const car = createCar('sports', spot.x, spot.z, Math.PI / 2, {
        color: 0xffd21f,
        isParked: true,
        driver: null,
      });
      car.color = 0xffd21f;
      car.isParked = true;
      car.driver = null;
      if (typeof car.id !== 'number') car.id = nextCarId(state);
      (state.cars = state.cars || []).push(car);
      api.markedCarId = car.id;
      return car;
    },

    // A cash bundle on a sidewalk, outside any building collider. Retries
    // until the spot is reachable; falls back to the plaza.
    newPickup(state) {
      const spot = api._randomSpot(state);
      const pk = { x: spot.x, z: spot.z, amount: CONFIG.CASH_PICKUP ?? 25, taken: false, respawnT: 0 };
      (state.pickups = state.pickups || []).push(pk);
      return pk;
    },

    _randomSpot(state) {
      const plaza = landmark(state, 'plaza');
      for (let i = 0; i < 24; i++) {
        const tx = (Math.random() * 2 - 1) * 190;
        const tz = (Math.random() * 2 - 1) * 190;
        if (!inCollider(state, tx, tz, 2)) return { x: tx, z: tz };
      }
      return { x: plaza.x, z: plaza.z };
    },

    _pickupsStep(dt, state) {
      const p = state.player;
      for (const pk of state.pickups || []) {
        if (pk.taken) {
          pk.respawnT -= dt;
          if (pk.respawnT <= 0) {
            const spot = api._randomSpot(state);
            pk.x = spot.x;
            pk.z = spot.z;
            pk.taken = false;
          }
          continue;
        }
        if (distTo(p.x, p.z, pk.x, pk.z) < 2.2) {
          pk.taken = true;
          pk.respawnT = 25;
          state.money = (state.money ?? 0) + pk.amount;
          if (state.stats) {
            state.stats.bestCash = Math.max(state.stats.bestCash ?? 0, state.money);
          }
          pushEv(state, { type: 'pickup', text: `Cash +$${pk.amount}` });
          state.fxBurst = { type: 'glint', x: pk.x, y: 1.2, z: pk.z };
        }
      }
    },

    _clearTaxi(state) {
      const c = (state.peds || []).find((pd) => pd.id === api.taxi.customerId);
      if (c) c.isTaxiCustomer = false;
      api.taxi = { phase: 'none', customerId: null, dest: null, destName: '', since: 0 };
      state.taxiMarker = null;
    },

    // Repeatable side job, free-roam only: pick up a waving pedestrian,
    // drop them at a landmark, get paid.
    taxiStep(dt, state) {
      const p = state.player;
      if (api.phase !== 'idle') {
        if (api.taxi.phase !== 'none') api._clearTaxi(state);
        return;
      }
      const t = api.taxi;
      if (t.phase === 'none') {
        api._taxiT -= dt;
        if (api._taxiT <= 0) {
          // Only hail a customer within 80 m: a fare picked from the far
          // side of the city would instantly "give up waiting" (the 120 m
          // rule below) before the player could ever reach them.
          const cands = (state.peds || []).filter(
            (pd) =>
              !pd.isCop &&
              !pd.isTaxiCustomer &&
              (pd.hp ?? 100) > 0 &&
              pd.state !== 'down' &&
              distTo(pd.x, pd.z, p.x, p.z) < 80,
          );
          if (cands.length) {
            const c = cands[Math.floor(Math.random() * cands.length)];
            c.isTaxiCustomer = true;
            api.taxi = { phase: 'pickup', customerId: c.id, dest: null, destName: '', since: state.time ?? 0 };
            state.taxiMarker = { x: c.x, z: c.z };
            pushEv(state, { type: 'taxi', text: 'Taxi customer waving — pick them up!' });
            if (api._nextPending == null) {
              state.mission.objective = 'Taxi: pick up the waving customer';
            }
          }
          api._taxiT = 12 + Math.random() * 10;
        }
        return;
      }
      if (t.phase === 'pickup') {
        const c = (state.peds || []).find((pd) => pd.id === t.customerId);
        if (!c) {
          api._clearTaxi(state);
          return;
        }
        state.taxiMarker = { x: c.x, z: c.z };
        if (distTo(p.x, p.z, c.x, c.z) < 4) {
          state.peds.splice(state.peds.indexOf(c), 1);
          const dests = [
            ['plaza', 'the plaza'],
            ['beach', 'the beach'],
            ['downtown', 'downtown'],
            ['market', 'the market'],
            ['hospital', 'the hospital'],
            ['pier', 'the pier'],
          ];
          const [key, name] = dests[Math.floor(Math.random() * dests.length)];
          const L = landmark(state, key);
          api.taxi = { phase: 'dropoff', customerId: null, dest: { x: L.x, z: L.z }, destName: name, since: state.time ?? 0 };
          state.taxiMarker = { x: L.x, z: L.z };
          state.mission.objective = `Taxi: drop off at ${name}`;
          pushEv(state, { type: 'taxi', text: `Taxi: drop them at ${name}.` });
        } else if (distTo(p.x, p.z, c.x, c.z) > 120 && (state.time ?? 0) - (t.since ?? 0) > 30) {
          // Give up only after a 30 s grace period (and only when picked
          // far away — the 80 m hail radius above makes this rare).
          pushEv(state, { type: 'taxi', text: 'Taxi customer gave up waiting.' });
          api._clearTaxi(state);
        }
        return;
      }
      if (t.phase === 'dropoff') {
        if (distTo(p.x, p.z, t.dest.x, t.dest.z) < 8) {
          const fare = CONFIG.TAXI_FARE ?? 45;
          state.money = (state.money ?? 0) + fare;
          if (state.stats) {
            state.stats.bestCash = Math.max(state.stats.bestCash ?? 0, state.money);
          }
          pushEv(state, { type: 'taxi', text: `Taxi fare +$${fare}` });
          state.fxBurst = { type: 'glint', x: p.x, y: 1.6, z: p.z };
          api._clearTaxi(state);
          api._taxiT = 15 + Math.random() * 15;
          if (api._nextPending == null) {
            state.mission.objective = 'Free roam — taxi fares pay $45';
          }
        }
      }
    },

    _progress(state) {
      const p = state.player;
      const near = (lm, r) => {
        const L = landmark(state, lm);
        return distTo(p.x, p.z, L.x, L.z) < r;
      };
      if (api.index === 0) {
        if (near('cafe', 6)) api.complete(state);
      } else if (api.index === 1) {
        if (api.stepIndex === 0 && near('docks', 8)) {
          api.stepIndex = 1;
          api.applyStep(state);
          pushEv(state, { type: 'mission', text: 'Package is here — grab it.' });
        } else if (api.stepIndex === 1 && near('docks', 3)) {
          api.stepIndex = 2;
          api.applyStep(state);
          pushEv(state, { type: 'pickup', text: 'Package collected — get it to Rosa!' });
        } else if (api.stepIndex === 2 && near('cafe', 6)) {
          api.complete(state);
        }
      } else if (api.index === 2) {
        if (api.stepIndex === 0 && p.carId != null && p.carId === api.markedCarId) {
          api.stepIndex = 1;
          api.applyStep(state);
          state.systems?.police?.addHeat?.(2, 'stole the marked car', state);
          pushEv(state, { type: 'mission', text: "That's the one — now get it to the garage!" });
        } else if (api.stepIndex === 1 && p.carId === api.markedCarId && near('garage', 8)) {
          api.complete(state);
        }
      } else if (api.index === 3) {
        if (near('safehouse', 8)) api.complete(state);
      }
    },

    step(dt, state) {
      if (!state || state.screen === 'title' || state.screen === 'paused') return;
      const p = state.player;
      if (!p) return;
      if (!api.pickupsSpawned) {
        api.pickupsSpawned = true;
        state.pickups = state.pickups || [];
        while (state.pickups.length < 5) api.newPickup(state);
      }
      api._pickupsStep(dt, state);
      api.taxiStep(dt, state);
      // Auto-start the intro mission on a fresh game.
      if (api.phase === 'idle' && api.index === 0 && !api._m0Started && api._nextPending == null) {
        api.start(0, state);
        return;
      }
      if (api.phase === 'active') {
        if (api.timer > 0) {
          api.timer -= dt;
          if (api.timer <= 0) {
            api.timer = 0;
            api.fail(state, 'time ran out');
            api._sync(state);
            return;
          }
        }
        api._progress(state);
      } else if (api.phase === 'idle' && api._nextPending != null) {
        // Café trigger: works for the next job after ANY mission, not just M0.
        const cafe = landmark(state, 'cafe');
        if (distTo(p.x, p.z, cafe.x, cafe.z) < 6) api.start(api._nextPending, state);
      }
      api._sync(state);
    },

    _sync(state) {
      state.mission = state.mission || {};
      state.mission.index = api.index;
      state.mission.phase = api.phase;
      state.mission.step = api.stepIndex;
      state.mission.timer = Math.max(0, api.timer);
    },

    objectiveText(state) {
      return (state.mission && state.mission.objective) || 'Explore Solmar Bay';
    },
  };
  return api;
}
