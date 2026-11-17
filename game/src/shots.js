// Solmar Bay — staged screenshots (Worker B). stageShot(name, world, systems)
// plays one of the 4 scenes forward from a fresh world with a scripted
// autopilot (no real user input), so the screenshots are reproducible.
// Deterministic per seed: Math.random is temporarily replaced by a seeded
// mulberry32 stream while staging, so police/taxi/pickup placement repeats
// (police.js and missions.js both use Math.random). The scripted input uses
// the input.js shape ({keys, justPressed, dx, dy}); world.step translates
// it. Scenes: cover (driving the beachfront), onfoot (market plaza),
// chase (3 stars, SBPD on your tail), mission (M1 at the docks).

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

function fakeInput(keys) {
  return {
    keys: new Set(keys || []),
    dx: 0,
    dy: 0,
    justPressed: new Set(),
    pointerLocked: false,
  };
}

function firstCar(state, kind) {
  const cars = state.cars || [];
  return cars.find((c) => (!kind || c.kind === kind) && !c.isPolice)
    || cars.find((c) => !c.isPolice)
    || null;
}

function stepWorld(world, systems, input, n) {
  for (let i = 0; i < n; i++) {
    world.step(1 / 60, input, systems);
  }
}

export function stageShot(name, world, systems) {
  const state = world.state;
  if (!state || !state.player) return { name, screen: 'play', ok: false };
  const rng = mulberry32(7);
  const realRandom = Math.random;
  Math.random = rng;
  try {
    return stageShotInner(name, world, systems, state);
  } finally {
    Math.random = realRandom;
  }
}

function stageShotInner(name, world, systems, state) {
  const player = state.player;
  const landmarks = state.landmarks || {};
  const beach = landmarks.beach || { x: -165, z: 0 };
  const plaza = landmarks.plaza || { x: 0, z: 12 };
  const docks = landmarks.docks || { x: 144, z: 48 };

  if (name === 'cover') {
    // Driving down the beachfront street (x=-144), beach on the right.
    // Heading 0 = +z (south) under the (sin, cos) convention.
    const car = firstCar(state, 'sedan') || firstCar(state);
    if (car) world.teleport(-144, -60, 0, car);
    stepWorld(world, systems, fakeInput(['KeyW']), 150);
    return shotInfo(state, name);
  }

  if (name === 'onfoot') {
    // On foot in the market plaza, facing the café (north, -z = angle PI).
    world.teleport(plaza.x, plaza.z + 6, Math.PI);
    const car = firstCar(state, 'sedan');
    if (car) {
      car.x = plaza.x + 10;
      car.z = plaza.z - 6;
      car.angle = Math.PI / 2;
      car.isParked = true;
      car.speed = 0;
    }
    stepWorld(world, systems, fakeInput([]), 90);
    return shotInfo(state, name);
  }

  if (name === 'chase') {
    // 3 stars, SBPD cars chasing, sirens on. Drive south down the x=144
    // downtown street — a long clear run with buildings lining both
    // sides, so the camera is never blocked. (Facing diagonally from
    // downtown puts the car into a building and the camera behind it.)
    // The two police cars are placed flanking ahead (visible in frame,
    // chasing alongside) instead of at a random angle, where one can
    // spawn in the road and box the car in. 90 steps (1.5 s): the car
    // is mid-chase at speed, before the roadblock + rams wreck it.
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) world.teleport(144, -120, 0, car);
    if (systems && systems.police) {
      systems.police.addHeat(3, 'shot', state);
      systems.police.spawnCar(state, player);
      systems.police.spawnCar(state, player);
      const cops = (state.cars || []).filter((c) => c.isPolice);
      cops.forEach((c, i) => {
        c.x = player.x + (i === 0 ? -10 : 10);
        c.z = player.z + 25 + i * 10;
        c.angle = 0;
        c.speed = 22;
      });
    }
    stepWorld(world, systems, fakeInput(['KeyW']), 90);
    return shotInfo(state, name);
  }

  if (name === 'mission') {
    // M1 at the docks: package marker + Rosa's dialogue on the HUD.
    if (systems && systems.missions) {
      systems.missions.start(1, state);
    }
    // Just outside the 7 m pickup radius, facing the docks (east = angle PI/2).
    world.teleport(docks.x - 14, docks.z + 6, Math.PI / 2);
    stepWorld(world, systems, fakeInput([]), 60);
    return shotInfo(state, name);
  }

  return shotInfo(state, name);
}

function shotInfo(state, name) {
  const m = state.mission || {};
  return {
    name,
    screen: 'play',
    ok: true,
    wanted: state.wanted || 0,
    money: state.money || 0,
    mission: m.objective || '',
    speed: Math.abs(state.player.speed || 0),
    inCar: !!state.player.inCar,
    policeCars: (state.cars || []).filter((c) => c.isPolice).length,
    peds: (state.peds || []).length,
  };
}
