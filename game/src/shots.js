// shots.js — staged screenshots (cover / onfoot / chase / mission).
//
// Each shot plays forward from a fresh world with a scripted autopilot
// (scripted inputs, no real user), so the screenshots are reproducible.
// Deterministic per seed: Math.random is temporarily replaced by a seeded
// mulberry32 stream while staging. Peds are repositioned by moving x/z
// ONLY — their loop/path stay intact (stepPed reads ped.loop every step;
// nulling it crashes the world).

import { createCar } from './vehicle.js';

export const SHOT_NAMES = ['cover', 'onfoot', 'chase', 'mission'];
export const SHOT_FILES = {
  cover: '1-cover.jpg',
  onfoot: '2-onfoot.jpg',
  chase: '3-chase.jpg',
  mission: '4-mission.jpg',
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scriptedInput() {
  return {
    keys: new Set(),
    dx: 0,
    dy: 0,
    justPressed: new Set(),
    pointerLocked: false,
    endFrame() {},
  };
}

// Move an existing ped to a staging spot (x/z only — loop stays intact).
function placePed(state, i, x, z) {
  const ped = (state.peds || [])[i];
  if (!ped) return;
  ped.x = x;
  ped.z = z;
}

function putPlayerInCar(world, state, car, x, z, angle) {
  if (!state.cars.includes(car)) state.cars.push(car);
  world.teleport(x, z, angle, car);
}

export function stageShot(name, world, systems) {
  // Re-read world.state AFTER reset(): reset() may replace the state object,
  // and staging against the stale one would never reach the live world.
  let state = world.state;
  const seed = state.seed ?? 7;
  const prevRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    world.reset();
    state = world.state;
    state.screen = 'play';
    // World routes addHeat through state.systems.police when it is set;
    // set it before staging so the chase heat lands on police (not on a
    // state.wanted that police.step would mirror back to 0).
    state.systems = systems;
    const input = scriptedInput();
    const stepN = (n, keys) => {
      input.keys = new Set(keys || []);
      for (let i = 0; i < n; i++) world.step(1 / 60, input, systems);
      input.keys.clear();
    };
    const drive = (n) => stepN(n, ['KeyW']);
    const walk = (n) => stepN(n, ['KeyW']);

    if (name === 'title') {
      // Title screen over a living city (traffic + peds moving).
      state.screen = 'title';
      stepN(30, []);
    } else if (name === 'cover' || name === 'hero') {
      // Golden-hour drive south down the beach: sea on the right, sunlit
      // beachfront buildings + palms on the left, pier ahead in the distance.
      const car = createCar('sedan', -174, -60, 0, { isParked: false, driver: null });
      putPlayerInCar(world, state, car, -174, -60, 0);
      placePed(state, 0, -180, -40);
      placePed(state, 1, -168, -20);
      drive(180); // 3 s south at speed
    } else if (name === 'onfoot') {
      // Dario on foot in the market plaza, peds ahead, café sign in frame.
      world.teleport(0, 30, Math.PI, null);
      placePed(state, 0, -4, 18);
      placePed(state, 1, 4, 16);
      placePed(state, 2, 0, 8);
      walk(45);
      stepN(45, []);
    } else if (name === 'chase') {
      // 3 stars: yellow sports car south down the x=144 downtown street
      // (a clear run — the old diagonal start wedged into a tower),
      // police cruisers ahead, sirens on.
      // Staging order matters: the cruisers pursue HEAD-ON (they drive
      // north, straight at the player), so spawning them in the player's
      // path first and then driving rams them at once — the car came out
      // of 1.5 s at 26 km/h with hp 73. Instead: pre-drive the player
      // alone for 90 steps (65 km/h, no police yet), THEN add the heat
      // and spawn the cruisers 20-40 m ahead, and drive 30 more steps
      // (86 km/h, hp 100, cruisers closing but not yet in contact).
      const car = createCar('sports', 144, -144, 0, {
        color: 0xffd21f,
        isParked: false,
        driver: null,
      });
      car.color = 0xffd21f;
      putPlayerInCar(world, state, car, 144, -144, 0);
      drive(90); // 1.5 s alone: 65 km/h at z ≈ -130, hp 100
      world.addHeat(3, 'staged chase');
      systems.police.spawnCar(state, 138, -100, 0);
      systems.police.spawnCar(state, 150, -94, 0);
      systems.police.spawnCar(state, 144, -82, 0);
      drive(30); // 0.5 s more: 86 km/h, cruisers 21-39 m ahead
    } else if (name === 'mission') {
      // M1 at the docks: package marker glowing, Rosa's line on the HUD.
      systems.missions.start(1, state);
      world.teleport(132, 40, 0.98, null);
      placePed(state, 0, 150, 60);
      walk(30);
      stepN(30, []);
    } else {
      // Unknown name: fall back to the cover drive.
      const car = createCar('sedan', -174, -60, 0, { isParked: false, driver: null });
      putPlayerInCar(world, state, car, -174, -60, 0);
      drive(180);
    }

    const snap = {
      name,
      ok: true,
      seed,
      screen: state.screen,
      wanted: state.wanted,
      money: state.money,
      mission: state.mission?.index ?? 0,
      objective: state.mission?.objective ?? '',
      speed: Math.round(((state.player?.car?.speed ?? state.player?.speed ?? 0) * 3.6)),
      inCar: !state.player?.onFoot,
      health: state.player?.hp ?? 100,
      policeCars: (state.cars || []).filter((c) => c.isPolice).length,
      peds: (state.peds || []).length,
    };
    if (typeof window !== 'undefined') {
      window.__GTA = { ...(window.__GTA || {}), ...snap, shotReady: true };
      window.__shotReady = true;
    }
    return snap;
  } finally {
    Math.random = prevRandom;
  }
}
