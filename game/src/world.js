// Solmar Bay — the world: central state + fixed-step update (Worker A,
// v3 rebuild). Owns the update order: input -> player -> player car ->
// traffic -> police -> missions -> combat. Systems are Worker B's and are
// called only when present (they land in parallel), so the world runs
// standalone in node tests with systems = {}.
//
// State shape (the contract in NOTES.md — field names are law):
//   state = { seed, time, money, health, wanted, player, cars, peds,
//     police, mission, stats, feed, events, screen, screenT, systems,
//     pickups, taxiMarker, policeNear, shakeTrauma, fxBurst, landmarks,
//     spawnPoints, colliders, navGrid, paused, over }

import { CONFIG, LANDMARKS } from './config.js';
import { createRandom } from './random.js';
import { buildCity, collideCircle } from './city.js';
import { createPlayer, stepPlayer } from './player.js';
import { createCar, stepCar, enterCar } from './vehicle.js';
import { createTraffic, stepTraffic } from './traffic.js';

// Translate a raw input object ({ keys:Set, dx, dy, justPressed:Set }) into
// the drive intent the player/car steps read. Exported for tests + shots.
export function translateInput(input) {
  const keys = (input && input.keys) || new Set();
  const jp = (input && input.justPressed) || new Set();
  return {
    moveX:
      (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
    moveZ:
      (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    lookDX: (input && input.dx) || 0,
    lookDY: (input && input.dy) || 0,
    enter: jp.has('KeyE'),
    honk: jp.has('KeyH'),
  };
}

export function createWorld(seed = 7) {
  const rng = createRandom(seed);
  const city = buildCity(seed);

  function buildInitialState() {
    const traffic = createTraffic(city, rng);
    const cars = [];
    // Parked cars first (stealable), then traffic.
    city.spawnPoints.parked.forEach((sp, i) => {
      cars.push(
        createCar(sp.model, sp.x, sp.z, sp.angle, { id: `pk${i}`, isParked: true }),
      );
    });
    for (const c of traffic.cars) cars.push(c);
    return {
      seed,
      time: 0,
      money: CONFIG.START.MONEY,
      health: CONFIG.PLAYER.HEALTH,
      wanted: 0,
      player: createPlayer(CONFIG.START.PLAYER_SPAWN),
      cars,
      peds: traffic.peds,
      police: [],
      mission: {
        index: 0,
        phase: 'idle',
        step: 0,
        objective: "Go to Rosa's café",
        marker: { x: LANDMARKS.cafe.x, z: LANDMARKS.cafe.z },
        timer: 0,
        dialogue: "Rosa: Dario, it's Rosa. Come to the café. We need to talk.",
      },
      stats: {
        missionsDone: 0,
        carsStolen: 0,
        busted: 0,
        deaths: 0,
        bestCash: CONFIG.START.MONEY,
        distanceDriven: 0,
        pedsHit: 0,
        shotsFired: 0,
        shotsHit: 0,
      },
      feed: [],
      events: [],
      screen: 'title',
      screenT: 0,
      systems: null,
      pickups: [],
      taxiMarker: null,
      policeNear: false,
      shakeTrauma: 0,
      fxBurst: null,
      landmarks: city.landmarks,
      spawnPoints: city.spawnPoints,
      colliders: city.colliders,
      navGrid: city.navGrid,
      paused: false,
      over: false,
    };
  }

  const state = buildInitialState();

  const world = {
    state,
    city,
    rng,

    // One fixed step. Returns state.events (the same array main.js + hud.js
    // drain once per frame — NOT cleared here).
    step(dt, input, systems) {
      state.systems = systems || null;
      state.time += dt;
      const drive = translateInput(input);
      stepPlayer(state, drive, dt, world, systems);
      if (!state.player.onFoot && state.player.car) {
        stepCar(state, state.player.car, dt, drive, world, systems);
      }
      stepTraffic(state, dt, world, systems);
      if (systems) {
        if (systems.police && typeof systems.police.step === 'function') {
          systems.police.step(dt, state);
        }
        if (systems.missions && typeof systems.missions.step === 'function') {
          systems.missions.step(dt, state);
        }
        if (systems.combat && typeof systems.combat.step === 'function') {
          systems.combat.step(dt, state, input);
        }
      }
      state.health = state.player.hp;
      return state.events;
    },

    // Restore the initial state (screen 'play'). Mutates the existing state
    // object in place so holders of world.state keep seeing it.
    reset() {
      const fresh = buildInitialState();
      fresh.screen = 'play';
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, fresh);
    },

    // Heat goes through the police system when it exists (police OWNS the
    // wanted level); otherwise the world bumps it directly.
    addHeat(n, reason) {
      const pol = state.systems && state.systems.police;
      if (pol && typeof pol.addHeat === 'function') {
        pol.addHeat(n, reason, state);
      } else {
        state.wanted = Math.max(
          0,
          Math.min(CONFIG.WANTED.MAX_STARS, state.wanted + n),
        );
      }
    },

    addMoney(n, reason) {
      state.money += n;
      if (n > 0 && state.money > state.stats.bestCash) {
        state.stats.bestCash = state.money;
      }
    },

    // Damage the player. Respects invulnerability frames; syncs player.hp
    // and state.health; pushes {type:'damage'} and {type:'playerDown'} at 0.
    // Uses ?? (not ||) so a dead player (hp 0) is never resurrected by a
    // second hit in the same frame.
    damagePlayer(n) {
      const p = state.player;
      if (p.invuln > 0) return;
      p.hp = Math.max(0, (p.hp ?? CONFIG.PLAYER.HEALTH) - n);
      state.health = p.hp;
      state.events.push({ type: 'damage', amount: n });
      if (p.hp <= 0) state.events.push({ type: 'playerDown' });
    },

    healPlayer(n) {
      const p = state.player;
      p.hp = Math.min(p.maxHp, (p.hp ?? CONFIG.PLAYER.HEALTH) + n);
      state.health = p.hp;
    },

    pushFeed(text) {
      state.feed.unshift({ text, at: state.time });
      if (state.feed.length > 6) state.feed.length = 6;
    },

    nearestCar(x, z, maxDist, opts = {}) {
      let best = null;
      let bestD = maxDist;
      for (const car of state.cars) {
        if (opts.excludeId && car.id === opts.excludeId) continue;
        if (opts.parkedOnly && !car.isParked) continue;
        if (opts.driver && car.driver !== opts.driver) continue;
        const d = Math.hypot(car.x - x, car.z - z);
        if (d < bestD) {
          bestD = d;
          best = car;
        }
      }
      return best;
    },

    nearestPed(x, z, maxDist) {
      let best = null;
      let bestD = maxDist;
      for (const ped of state.peds) {
        const d = Math.hypot(ped.x - x, ped.z - z);
        if (d < bestD) {
          bestD = d;
          best = ped;
        }
      }
      return best;
    },

    carsNear(x, z, radius) {
      const out = [];
      for (const car of state.cars) {
        if (Math.hypot(car.x - x, car.z - z) <= radius) out.push(car);
      }
      return out;
    },

    // Teleport the player. On foot: collision-resolved move. With a car:
    // the car is moved and the player is put IN it (enterCar).
    teleport(x, z, angle, car) {
      if (car) {
        car.x = x;
        car.z = z;
        if (angle !== undefined && angle !== null) car.angle = angle;
        car.speed = 0;
        enterCar(state, car);
        state.player.x = x;
        state.player.z = z;
        state.player.heading = car.angle;
      } else {
        const res = collideCircle(city, x, z, 0.5);
        state.player.x = res.x;
        state.player.z = res.z;
        if (angle !== undefined && angle !== null) {
          state.player.heading = angle;
          state.player.yaw = angle;
        }
      }
    },
  };

  return world;
}
