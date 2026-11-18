// Solmar Bay — missions (Worker B). Three story missions from Mama Rosa,
// sequential, plus repeatable taxi jobs and cash pickups.
// Data (names, rewards, times, intros, step text) lives in CONFIG.MISSIONS;
// this file implements the step machine. Markers are state.mission.marker
// {x,z} so the HUD, minimap and renderer beacon can draw them. The taxi
// customer and cash pickups live in state.peds / state.pickups.
// State machine: idle -> active -> done / failed. Fail (timer out or busted)
// retries from the café; cash earned is kept. After M3 the loop replays at
// half reward.

import { CONFIG } from './config.js';
import { createCar } from './vehicle.js';
import { hitsCollider } from './city.js';

const MISSIONS = CONFIG.MISSIONS;
const TAXI_FARE = CONFIG.TAXI_FARE;
const TAXI_TIME = 90;
const CASH_AMOUNT = CONFIG.CASH_PICKUP;
const CASH_COUNT = 3;

// Step machine per mission (targets are landmark names; radius in metres).
// M1: docks (7 m) -> café (7 m), whole-mission timer 150 s.
// M2: steal the red sports car -> garage (9 m).
// M3: safehouse (9 m, +3 stars on start) -> lose the heat (wanted 0).
const STEPS = {
  1: [
    { type: 'goto', target: 'docks', radius: 7 },
    { type: 'goto', target: 'cafe', radius: 7 },
  ],
  2: [
    { type: 'steal', target: 'beach', radius: 10 },
    { type: 'deliverCar', target: 'garage', radius: 9 },
  ],
  3: [
    { type: 'goto', target: 'safehouse', radius: 9, heat: 3 },
    { type: 'escape', target: 'safehouse', radius: 9 },
  ],
};

export function createMissions() {
  const missions = {
    index: 0,          // 0 = intro (go to the café), 1..3 = story missions
    phase: 'idle',     // idle | active
    stepIndex: 0,
    timer: 0,
    timerMax: 0,
    markedCarId: null,
    taxi: { active: false, phase: 'wait', customer: null, dest: null, timer: 0, nextIn: 8 },
    pickupsSpawned: false,

    reset() {
      this.index = 0;
      this.phase = 'idle';
      this.stepIndex = 0;
      this.timer = 0;
      this.timerMax = 0;
      this.markedCarId = null;
      this.taxi = { active: false, phase: 'wait', customer: null, dest: null, timer: 0, nextIn: 8 };
      this.pickupsSpawned = false;
    },

    loadIndex(i) {
      this.index = Math.max(0, Math.min(3, i | 0));
      this.phase = 'idle';
      this.stepIndex = 0;
      this.timer = 0;
      this.markedCarId = null;
    },

    start(i, state) {
      const def = MISSIONS[i];
      if (!def) return;
      this.index = i;
      this.phase = 'active';
      this.stepIndex = 0;
      this.markedCarId = null;
      this.timer = def.time || 0;
      this.timerMax = def.time || 0;
      this.applyStep(state);
      pushEvent(state, 'mission', `${def.name} — ${def.intro}`);
      if (state.mission) {
        state.mission.index = i;
        state.mission.phase = 'active';
        state.mission.dialogue = def.intro;
      }
    },

    applyStep(state) {
      const def = MISSIONS[this.index];
      if (!def) return;
      const step = (STEPS[this.index] || [])[this.stepIndex];
      if (!step) return;
      if (step.heat && state.systems && state.systems.police) {
        state.systems.police.addHeat(step.heat, 'mission', state);
      }
      if (step.type === 'steal') this.markCar(state);
      const target = landmark(state, step.target);
      if (state.mission) {
        state.mission.step = this.stepIndex;
        state.mission.objective = def.steps[this.stepIndex] || def.intro;
        state.mission.marker = target ? { x: target.x, z: target.z } : null;
        state.mission.timer = this.timer;
        state.mission.dialogue = def.intro;
      }
    },

    markCar(state) {
      const cars = state.cars || [];
      const beach = landmark(state, 'beach') || { x: -150, z: 0 };
      let car = cars.find((c) => c.kind === 'sports' && c.isParked);
      if (!car) {
        // Use vehicle.js createCar for the full car shape (len/wid/hgt/
        // topSpeed/steer/...); a hand-built object without len/wid
        // poisons collideCars with NaN and breaks the renderer.
        car = createCar('sports', beach.x + 6, beach.z + 4, 0,
          { id: 90000 + Math.floor(Math.random() * 1000), isParked: true });
        cars.push(car);
      }
      car.color = CONFIG.CAR_MODELS.sports.color; // the red Vespera GT
      car.missionMarked = true;
      this.markedCarId = car.id;
    },

    step(dt, state) {
      if (!state || !state.player) return;
      const player = state.player;
      const mission = state.mission || (state.mission = {});
      // Keep the shared mission object in sync.
      mission.index = this.index;
      mission.phase = this.phase;

      // Cash pickups: spawn once, collect on proximity, respawn later.
      if (!this.pickupsSpawned) {
        this.pickupsSpawned = true;
        state.pickups = [];
        for (let i = 0; i < CASH_COUNT; i++) state.pickups.push(this.newPickup(state));
      }
      if (state.pickups) {
        for (const pk of state.pickups) {
          if (pk.taken) {
            pk.respawnT -= dt;
            if (pk.respawnT <= 0) Object.assign(pk, this.newPickup(state), { taken: false });
            continue;
          }
          if (Math.hypot(player.x - pk.x, player.z - pk.z) < 2.5) {
            pk.taken = true;
            pk.respawnT = 45;
            state.money = (state.money || 0) + CASH_AMOUNT;
            state.stats.bestCash = Math.max(state.stats.bestCash || 0, state.money);
            pushEvent(state, 'cash', `Cash pickup +$${CASH_AMOUNT}`);
            state.fxBurst = { type: 'pickup', x: pk.x, y: 1.2, z: pk.z };
          }
        }
      }

      // Idle: walk/drive into the café marker to start the pending mission.
      // index 0 = intro (first job is M1); after a mission completes the
      // index already points at the next one (1..3, replay wraps to 1).
      if (this.phase === 'idle') {
        const cafe = landmark(state, 'cafe');
        const next = this.index === 0 ? 1 : this.index;
        mission.objective = "Go to Rosa's café — Mama Rosa is calling";
        mission.marker = cafe ? { x: cafe.x, z: cafe.z } : null;
        mission.dialogue = "Rosa: Dario, it's Rosa. Come to the café.";
        mission.timer = 0;
        if (cafe && Math.hypot(player.x - cafe.x, player.z - cafe.z) < 8) {
          this.start(next, state);
        }
        this.taxiStep(dt, state);
        return;
      }

      const def = MISSIONS[this.index];
      if (!def) { this.phase = 'idle'; return; }
      const steps = STEPS[this.index] || [];
      const step = steps[this.stepIndex];
      if (!step) { this.complete(state); return; }

      // Whole-mission timer.
      if (this.timer > 0) {
        this.timer -= dt;
        mission.timer = Math.max(0, this.timer);
        if (this.timer <= 0) {
          this.fail(state, "Time's up — the job fell through");
          return;
        }
      }

      const target = landmark(state, step.target);
      const dist = target ? Math.hypot(player.x - target.x, player.z - target.z) : 1e9;
      let advanced = false;
      if (step.type === 'goto') {
        if (dist < step.radius) advanced = true;
      } else if (step.type === 'escape') {
        // Reach the safehouse AND lose the heat.
        if (dist < step.radius && (state.wanted || 0) === 0) advanced = true;
      } else if (step.type === 'steal') {
        if (player.inCar && player.carId === this.markedCarId) {
          advanced = true;
          if (state.systems && state.systems.police) {
            state.systems.police.addHeat(2, 'steal', state);
          }
          pushEvent(state, 'info', 'You stole the sports car — 2 stars!');
        }
      } else if (step.type === 'deliverCar') {
        if (player.inCar && player.carId === this.markedCarId && dist < step.radius) {
          advanced = true;
        }
      }
      if (advanced) {
        this.stepIndex += 1;
        if (this.stepIndex >= steps.length) {
          this.complete(state);
        } else {
          this.applyStep(state);
          pushEvent(state, 'mission', def.steps[this.stepIndex] || '');
        }
      }
      this.taxiStep(dt, state);
    },

    complete(state) {
      const def = MISSIONS[this.index];
      if (!def) return;
      const replay = (state.stats.missionsDone || 0) >= 3;
      const reward = replay ? Math.floor(def.reward / 2) : def.reward;
      state.money = (state.money || 0) + reward;
      state.stats.missionsDone = (state.stats.missionsDone || 0) + 1;
      state.stats.bestCash = Math.max(state.stats.bestCash || 0, state.money);
      pushEvent(state, 'mission-complete', `Mission complete +$${reward} — ${def.name}`);
      state.fxBurst = { type: 'pickup', x: state.player.x, y: 1.5, z: state.player.z };
      // Next mission starts when the player returns to the café.
      this.index += 1;
      if (this.index > 3) this.index = 1; // replay loop at half reward
      this.stepIndex = 0;
      this.markedCarId = null;
      this.phase = 'idle';
      if (state.mission) {
        state.mission.index = this.index;
        state.mission.phase = 'idle';
        state.mission.objective = 'Job done — see Rosa for the next one';
        state.mission.marker = landmark(state, 'cafe');
        state.mission.dialogue = 'Rosa: Beautiful work, Dario. Come by the café when you want more.';
      }
    },

    fail(state, reason) {
      pushEvent(state, 'mission-failed', reason + ' — try again at the café');
      this.phase = 'idle';
      this.stepIndex = 0;
      this.timer = 0;
      this.markedCarId = null;
      if (state.mission) {
        state.mission.phase = 'idle';
        state.mission.objective = "Go to Rosa's café — Mama Rosa is calling";
        state.mission.marker = landmark(state, 'cafe');
        state.mission.dialogue = 'Rosa: Come back to the café. We try again.';
      }
    },

    newPickup(state) {
      // A pickup inside a building collider can never be collected (the
      // player cannot walk through walls), so retry until the spot is
      // reachable. Without colliders (a bare test state) take the first.
      for (let i = 0; i < 12; i += 1) {
        const x = (Math.random() * 2 - 1) * 170;
        const z = (Math.random() * 2 - 1) * 170;
        if (!state.colliders || !hitsCollider(state, x, z, 1)) {
          return { x, z, amount: CASH_AMOUNT, taken: false, respawnT: 0 };
        }
      }
      // Fallback: the market plaza is open ground, always reachable.
      return { x: 0, z: 24, amount: CASH_AMOUNT, taken: false, respawnT: 0 };
    },

    taxiStep(dt, state) {
      const taxi = this.taxi;
      const player = state.player;
      // Taxi jobs only once the intro is done.
      if (this.index === 0) return;
      if (!taxi.active) {
        taxi.nextIn -= dt;
        if (taxi.nextIn > 0) return;
        taxi.nextIn = 20;
        // Spawn a customer at a random landmark curb.
        const spots = ['plaza', 'cafe', 'beach', 'docks'];
        const spot = landmark(state, spots[Math.floor(Math.random() * spots.length)]);
        if (!spot) return;
        taxi.customer = { x: spot.x + 4, z: spot.z + 4 };
        taxi.phase = 'wait';
        taxi.active = true;
        const peds = state.peds || (state.peds = []);
        // Full ped shape (traffic.js contract): stepPed resets state to
        // 'walk' every step and reads ped.loop[ped.loopIdx], so a
        // customer without a loop crashes the world. The 2-point loop
        // is a short pace at the curb while they wait.
        peds.push({
          id: 80000 + Math.floor(Math.random() * 1000),
          x: taxi.customer.x, z: taxi.customer.z, angle: 0, speed: 0, hp: 100,
          isCop: false, isTaxiCustomer: true, state: 'idle',
          loop: [[taxi.customer.x - 2, taxi.customer.z], [taxi.customer.x + 2, taxi.customer.z]],
          loopIdx: 1,
          path: null,
          pathIdx: 0,
          flee: 0,
          fleeT: 0,
          fleeFrom: null,
          color: 0x22c55e,
          bobPhase: Math.random() * Math.PI * 2,
        });
        pushEvent(state, 'info', 'Taxi fare waiting — pick them up');
      } else if (taxi.phase === 'wait') {
        if (player.inCar && taxi.customer
          && Math.hypot(player.x - taxi.customer.x, player.z - taxi.customer.z) < 5) {
          // Customer gets in.
          const peds = state.peds || [];
          for (let i = peds.length - 1; i >= 0; i--) {
            if (peds[i].isTaxiCustomer) peds.splice(i, 1);
          }
          const dests = ['garage', 'hospital', 'docks', 'plaza'];
          const dest = landmark(state, dests[Math.floor(Math.random() * dests.length)]);
          taxi.dest = dest;
          taxi.phase = 'ride';
          taxi.timer = TAXI_TIME;
          pushEvent(state, 'info', 'Taxi: drop them off at the marker');
        }
      } else if (taxi.phase === 'ride') {
        taxi.timer -= dt;
        if (taxi.timer <= 0) {
          taxi.active = false;
          taxi.phase = 'wait';
          taxi.customer = null;
          taxi.dest = null;
          pushEvent(state, 'info', 'Taxi fare gave up and walked away');
          return;
        }
        if (taxi.dest && player.inCar
          && Math.hypot(player.x - taxi.dest.x, player.z - taxi.dest.z) < 7) {
          state.money = (state.money || 0) + TAXI_FARE;
          state.stats.bestCash = Math.max(state.stats.bestCash || 0, state.money);
          pushEvent(state, 'cash', `Taxi fare +$${TAXI_FARE}`);
          taxi.active = false;
          taxi.phase = 'wait';
          taxi.customer = null;
          taxi.dest = null;
          taxi.nextIn = 15;
        }
      }
      // Taxi marker for the minimap/HUD/renderer beacon.
      if (taxi.active && taxi.phase === 'ride' && taxi.dest) {
        state.taxiMarker = { x: taxi.dest.x, z: taxi.dest.z };
      } else if (taxi.customer) {
        state.taxiMarker = { x: taxi.customer.x, z: taxi.customer.z };
      } else {
        state.taxiMarker = null;
      }
    },

    objectiveText(state) {
      const m = state.mission || {};
      const marker = m.marker || state.taxiMarker || null;
      const dist = marker && state.player
        ? Math.round(Math.hypot(state.player.x - marker.x, state.player.z - marker.z)) : null;
      return { text: m.objective || '', distance: dist, marker };
    },
  };
  return missions;
}

function landmark(state, name) {
  if (!name) return null;
  if (state.landmarks && state.landmarks[name]) return state.landmarks[name];
  if (state.spawnPoints && state.spawnPoints[name]) return state.spawnPoints[name];
  return null;
}

function pushEvent(state, type, text) {
  if (!state.events) state.events = [];
  if (state.events.length > 24) state.events.shift();
  state.events.push({ type, text, t: state.time || 0 });
}
