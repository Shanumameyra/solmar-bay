// Solmar Bay — staged screenshot (Worker B). stageShot(name, world, systems)
// plays the ONE hero scene forward from a fresh world with a scripted
// autopilot (no real user input), so the screenshot is reproducible.
// Deterministic per seed: Math.random is temporarily replaced by a seeded
// mulberry32 stream while staging, so police/taxi/pickup placement repeats
// (police.js and missions.js both use Math.random). The scripted input uses
// the input.js shape ({keys, justPressed, dx, dy}); world.step translates
// it. Scene: hero (the pink Vespera GT driving south down the beach
// boulevard at sunset, chased by the HKPD — the #1 entry's composition).
// Romi ordered ONE screenshot only (18 Nov): no cover/onfoot/chase/mission, no collage.

export const SHOT_NAMES = ['hero'];
export const SHOT_FILES = {
  hero: '1-hero.jpg',
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

// Reposition the first `spots.length` ordinary peds (not cops, not the taxi
// customer) onto small 2-point pace loops at `spots`, so a staged shot has
// pedestrians visibly in frame. The peds keep pacing their little loop, so
// they stay in frame for the whole shot instead of wandering off. Spots
// must sit at least 3 m from any car path (the car-hit radius is 2.5 m),
// or the ped gets shoved and the shot gains unwanted heat.
function placePeds(state, spots) {
  const peds = (state.peds || []).filter((p) => !p.isCop && !p.isTaxiCustomer);
  let placed = 0;
  for (let i = 0; i < peds.length && placed < spots.length; i += 1) {
    const ped = peds[i];
    const [x, z] = spots[placed];
    ped.x = x;
    ped.z = z;
    ped.loop = [[x - 2, z], [x + 2, z]];
    ped.loopIdx = 1;
    ped.path = null;
    ped.flee = 0;
    ped.fleeT = 0;
    ped.fleeFrom = null;
    ped.state = 'walk';
    ped.angle = Math.PI / 2;
    placed += 1;
  }
  // Park the rest far from the frame (Top 5: no pedestrian crowd —
  // only a few small background figures). Only x/z move; loops stay
  // intact (stepPed reads ped.loop every step — never null it).
  for (let i = placed; i < peds.length; i += 1) {
    const ped = peds[i];
    ped.x = 150 + (i % 5) * 3;
    ped.z = 150 + Math.floor(i / 5) * 3;
  }
  return placed;
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

  if (name === 'hero') {
    // THE hero shot (the only screenshot): the PINK Vespera GT driving
    // SOUTH down the beach boulevard at sunset — the TOP 5 formula
    // (Romi's final order, 18 Nov): NO tank, NO traffic jam — the road
    // ahead is OPEN, only 2-3 small cars far near the sun; pedestrians
    // only a few small background figures. Driving south puts the
    // peach/salmon beachfront buildings on the LEFT, the red palms +
    // FLAMINGO FM billboard + sea on the RIGHT, and the sun at the end
    // of the road, dead centre, low on the horizon. Rear 3/4 chase cam
    // (state.heroCam), hero HUD (state.heroHud). The car hugs the shore
    // (x=-190, on the street at x=-192, 10 m from the shoreline at
    // x=-200). Heading 0 = +z (south) under the (sin, cos) convention.
    // Police: 2 flankers very close + 1 at 21 m + 2 roadblocks at 43 m
    // (the action: a roadblock ahead). Heli far ahead with its beam.
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) world.teleport(-190, -60, 0, car);
    state.heroCam = true;
    state.heroHud = {
      missionTitle: '<span class="m-id">CH 5</span>PAPER MOON',
      timer: '2:06',
      cash: '$38,420',
      clock: 'DAY 1 18:47',
      starsHtml: '<span style="color:#ffd23d">★★★★</span><span style="color:#8a8a92">★</span>',
      insight: 'IN SIGHT',
      objective: 'Lose the cops — reach the safehouse',
      stageLabel: 'STAGE 3/4',
      stagePct: 75,
      next: 'Reach the safehouse',
      speedKmh: 151,
      carName: 'VESPERA GT',
      condPct: '100%',
      gear: '04',
      radio: 'WAVE 88.1 : Neon Drive',
      locName: 'CORAL STRAND',
      rep: { label: 'RESPECT', num: '4', pct: 100 },
      armour: 100,
      weaponsHtml: '<span class="wslot hot">WASP SMG</span><span class="wslot">🔫 PISTOL <span class="ammo">12/0</span></span>',
      policeTitle: 'HKPD RESPONSE — 7 UNITS CODE 4',
      policeRows: [
        { name: 'IBIS-43', dist: '5 m', status: 'RAMMING' },
        { name: 'TARPON-10', dist: '9 m', status: 'RAMMING' },
        { name: 'HERON-17', dist: '21 m', status: 'PURSUIT' },
        { name: 'KESTREL-31', dist: '43 m', status: 'BOXING IN' },
        { name: 'MARLIN-26', dist: '43 m', status: 'ROADBLOCK' },
      ],
      dialogue: {
        name: 'JUNO REYES',
        role: 'WHEELWOMAN',
        initials: 'JR',
        text: 'Alarms are back! You’ve got the whole department coming — lose them!',
      },
    };
    if (systems && systems.police) {
      systems.police.addHeat(3, 'shot', state);
      // FIVE cruisers: they start north of the player (behind, since the
      // player drives south) and pursue during the sim; their final
      // positions are set in the framing block below. NO tank — the
      // example has none (wanted is 3, so police.step never spawns one
      // either).
      for (let i = 0; i < 5; i += 1) systems.police.spawnCar(state, player);
      const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
      cops.forEach((c, i) => {
        const spot = [
          [player.x - 10, player.z - 25],
          [player.x + 10, player.z - 35],
          [player.x - 8, player.z - 48],
          [player.x + 8, player.z - 60],
          [player.x - 2, player.z - 72],
        ][i % 5];
        c.x = spot[0];
        c.z = spot[1];
        c.angle = Math.PI;
        c.speed = 22;
      });
      // Background figures only (Top 5: NO crowd): 5 small pedestrians
      // far ahead on the beach + the avenue sidewalk, 40-90 m away — they
      // read as tiny figures in the background, not a crowd. The rest of
      // the peds are parked far away by placePeds.
      placePeds(state, [
        [-185, 45], [-184, 62], [-186, 80],
        [-153, 55], [-137, 72],
      ]);
      // NO tank (Top 5: the tank is removed — the top 5 entries have
      // none). Wanted is 3, so police.step never spawns one either. The
      // heli (wanted 3+) hovers far ahead with its spotlight beam.
    }
    stepWorld(world, systems, fakeInput(['KeyW']), 120);
    // Frame the pursuit for the camera (rear 3/4, 6.5 m back, low): the
    // sim leaves the cruisers behind the camera, so place them exactly
    // where the example's panel says they are — 2 flankers VERY CLOSE
    // ahead (left-front ~5 m, right-front ~9 m, seen from behind with
    // light bars), 1 at 21 m, 2 roadblocks side by side at 43 m facing
    // the player. (Deterministic: fixed offsets from the player, after
    // the sim. "Ahead" is +z — the player drives south.)
    const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
    if (cops[0]) {
      cops[0].x = player.x - 4; cops[0].z = player.z + 5;
      cops[0].angle = 0; cops[0].speed = 0; // IBIS-43, 5 m
    }
    if (cops[1]) {
      cops[1].x = player.x + 4; cops[1].z = player.z + 8;
      cops[1].angle = 0; cops[1].speed = 0; // TARPON-10, 9 m
    }
    if (cops[2]) {
      cops[2].x = player.x - 3; cops[2].z = player.z + 21;
      cops[2].angle = 0; cops[2].speed = 0; // HERON-17, 21 m
    }
    if (cops[3]) {
      cops[3].x = player.x + 2; cops[3].z = player.z + 43;
      cops[3].angle = Math.PI; cops[3].speed = 0; // KESTREL-31, roadblock
    }
    if (cops[4]) {
      cops[4].x = player.x - 2; cops[4].z = player.z + 43;
      cops[4].angle = Math.PI; cops[4].speed = 0; // MARLIN-26, roadblock
    }
    // Open road ahead (Top 5: NO traffic jam): only 3 small cars far
    // ahead near the sun — live traffic, not a jam. The roadblocks at
    // +43 m are the action (a roadblock ahead), not a queue.
    const civ = (state.cars || []).filter((c) => !c.isPolice && c.kind !== 'sports' && c.kind !== 'tank' && !c.isParked);
    const farSpots = [[player.x - 2, player.z + 70], [player.x + 3, player.z + 85], [player.x - 1, player.z + 100]];
    civ.slice(0, 3).forEach((c, i) => {
      c.x = farSpots[i][0]; c.z = farSpots[i][1];
      c.angle = 0; c.speed = 0;
    });
    // Dust / motion: a smoke puff at the GT's rear wheels (the car drives
    // south, so the trail sits north). Drained by main.js on the next
    // frame, mid-life (~0.4 s of 1.1 s) at screenshot time — reads as
    // speed, not a static pose.
    state.fxBurst = { type: 'smoke', x: player.x, y: 0.6, z: player.z - 2.5, count: 24, spread: 1.6 };
    // No feed messages in the shot: staging pushes wanted/roadblock
    // events, and the HUD would print them top-centre over the scene.
    state.events = [];
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
