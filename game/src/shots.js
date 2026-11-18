// Solmar Bay — staged screenshots (Worker B). stageShot(name, world, systems)
// plays a scene forward from a fresh world with a scripted autopilot (no
// real user input), so the screenshot is reproducible.
// Deterministic per seed: Math.random is temporarily replaced by a seeded
// mulberry32 stream while staging, so police/taxi/pickup placement repeats
// (police.js and missions.js both use Math.random). The scripted input uses
// the input.js shape ({keys, justPressed, dx, dy}); world.step translates
// it.
// Shots (4, the kit gate allows 3-4):
//   hero    — 1-hero.jpg: the silver Vespera GT driving north up the beach
//             boulevard at sunset, shot HEAD-ON from the front, drifted,
//             sandwiched by two HKPD cruisers, the heli's spotlight on it
//             (the final format, Romi 18 Nov).
//   title   — 2-title.jpg: the title screen over the live city — the silver
//             GT parked on the beach boulevard facing the sunset.
//   onfoot  — 3-onfoot.jpg: Dario on foot on the boulevard, pistol out, the
//             silver GT parked beside him, peds walking, sunset ahead.
//   mission — 4-mission.jpg: M1 'The Pickup' active — the silver GT driving
//             east toward the docks, mission HUD + minimap marker visible.
// NOTE: 1-hero.jpg is Romi's approved image — tests/shots.py does NOT
// regenerate it; only 2-title/3-onfoot/4-mission are captured by the flow.

export const SHOT_NAMES = ['hero', 'title', 'onfoot', 'mission'];
export const SHOT_FILES = {
  hero: '1-hero.jpg',
  title: '2-title.jpg',
  onfoot: '3-onfoot.jpg',
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
    // THE hero shot (the only screenshot): the SILVER Vespera GT driving
    // NORTH up the beach boulevard at sunset, shot HEAD-ON from the
    // FRONT — the FINAL format (Romi, 18 Nov): a low head-on front
    // camera (the car faces the lens straight, headlights/grille/bumper/
    // plate readable, NOT a 3/4), the silver car straight (no drift
    // yaw), TWO white police cruisers sandwiching it left-right (very
    // close, red-blue light bars), the heli above-behind with its
    // searchlight aimed down onto the car, and the sun/glow behind the
    // car in the centre.
    // Driving north puts the sun (south, z=+700) BEHIND the car, the
    // peach/salmon beachfront buildings on the LEFT of the frame (east)
    // and the sea + FLAMINGO FM billboard on the RIGHT (west). NO tank,
    // NO traffic jam — the road ahead is open, only 3 small cars far
    // south near the sun; pedestrians only a few small background
    // figures. Front camera (state.heroCam), hero HUD (state.heroHud).
    // The car hugs the shore (x=-190, on the street at x=-192, 10 m from
    // the shoreline at x=-200). Heading PI = -z (north) under the
    // (sin, cos) convention. Police: 2 sandwiching (left + right, 2.8 m
    // out) + 1 chasing 22 m behind. Heli 12 m behind the car, 15 m up,
    // beam tilted down onto the GT.
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) world.teleport(-190, 60, Math.PI, car);
    state.heroCam = true;
    state.heroHud = {
      missionTitle: '<span class="m-id">MISSION 7/7</span>THE TIDE JOB',
      timer: '2:06',
      cash: '$18,450',
      clock: 'DAY 1 18:47',
      starsHtml: '<span style="color:#ffd23d">★★★★</span><span style="color:#8a8a92">★</span>',
      insight: 'IN SIGHT – GULL-1',
      objective: 'Escape with the cash! Lose the cops.',
      objectiveDist: '', // no distance: the live marker distance (Rosa's
      // café) has nothing to do with the escape objective.
      stageLabel: 'STAGE 3/4',
      stagePct: 75,
      next: 'Bring the money home to Lucía.',
      speedKmh: 151,
      carName: 'VESPERA GT',
      condPct: '61%',
      gear: '04',
      radio: 'WAVE 88.1 : Neon Drive',
      locName: 'CORAL SHORE',
      locStreet: 'Paloma Boulevard',
      hp: 82,
      rep: { label: 'RESPECT', num: '4', pct: 100 },
      armour: 64,
      weaponsHtml: '<span class="wslot hot">WASP SMG</span><span class="wslot">🔫 PISTOL <span class="ammo">12/0</span></span>',
      policeTitle: 'MBPD RESPONSE',
      policeRows: [
        { name: 'GULL-1', dist: '35 m', status: 'SPOTLIGHT ON YOU' },
        { name: 'MARLIN-11', dist: '9 m', status: 'RAMMING' },
        { name: 'SNAPPER-25', dist: '17 m', status: 'RAMMING' },
        { name: 'TARPON-18', dist: '22 m', status: 'RAMMING' },
      ],
      dialogue: {
        name: 'LUCÍA ORTEGA',
        role: 'CONTACT',
        initials: 'LO',
        text: 'Lose that helicopter before you come near my…',
      },
    };
    if (systems && systems.police) {
      systems.police.addHeat(3, 'shot', state);
      // THREE cruisers: they start south of the player (behind, since
      // the player drives north) and pursue during the sim; their final
      // positions are set in the framing block below. NO tank — the
      // final format removes it (wanted is 3, so police.step never
      // spawns one either).
      for (let i = 0; i < 3; i += 1) systems.police.spawnCar(state, player);
      const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
      cops.forEach((c, i) => {
        const spot = [
          [player.x - 10, player.z + 25],
          [player.x + 10, player.z + 35],
          [player.x - 8, player.z + 48],
        ][i % 3];
        c.x = spot[0];
        c.z = spot[1];
        c.angle = Math.PI;
        c.speed = 22;
      });
      // NO tank (final format: the tank is removed). Wanted is 3, so
      // police.step never spawns one either. The heli (wanted 3+) hovers
      // 12 m behind the car with its spotlight aimed down onto the GT.
      // (The background figures are placed AFTER the sim — their spots
      // are relative to the car's final position.)
    }
    stepWorld(world, systems, fakeInput(['KeyW']), 120);
    // Frame the sandwich for the HEAD-ON front camera (6 m ahead, low):
    // the sim leaves the cruisers behind the camera, so place them
    // exactly — TWO cruisers SANDWICHING the silver GT (left + right,
    // 2.6 m to each side, ~0.7 m gap, facing north toward the camera,
    // light bars lit red+blue, their fronts readable head-on too), and
    // ONE cruiser 22 m BEHIND the car (south, 4 m to the left, chasing,
    // visible in the background beside the GT, near the sun).
    // (Deterministic: fixed offsets from the player, after the sim.
    // "Ahead" is -z — the player drives north.)
    const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
    if (cops[0]) {
      cops[0].x = player.x - 2.6; cops[0].z = player.z + 0.5;
      cops[0].angle = Math.PI; cops[0].speed = 0; // MARLIN-11, left
    }
    if (cops[1]) {
      cops[1].x = player.x + 2.6; cops[1].z = player.z + 0.5;
      cops[1].angle = Math.PI; cops[1].speed = 0; // SNAPPER-25, right
    }
    if (cops[2]) {
      cops[2].x = player.x - 4; cops[2].z = player.z + 22;
      cops[2].angle = Math.PI; cops[2].speed = 0; // TARPON-18, behind
    }
    // NO drift yaw: the car stays STRAIGHT (angle PI, north) so the
    // head-on camera reads it upright from the front — a yawed car reads
    // as a 3/4 side view, not head-on. Set explicitly (the sim keeps it
    // at PI, but the shot must not depend on that). The drift smoke
    // below still sells the speed.
    if (car) car.angle = Math.PI;
    if (car) car.angle = Math.PI + 0.25;
    // Background figures only (Top 5: NO crowd): 5 small pedestrians
    // 15-40 m SOUTH of the car (behind it, toward the sun) — tiny
    // figures in the background, not a crowd. Placed AFTER the sim so
    // the offsets are exact from the car's final position. The rest of
    // the peds are parked far away by placePeds.
    placePeds(state, [
      [-185, player.z + 18], [-184, player.z + 28], [-186, player.z + 38],
      [-153, player.z + 25], [-137, player.z + 32],
    ]);
    // Open road (final format: NO traffic jam): only 3 small cars far
    // SOUTH (behind the car, toward the sun) — live traffic in the
    // distance, not a jam. Spread wide (±3-5 m) so they read beside the
    // GT from the head-on camera instead of hiding behind it.
    const civ = (state.cars || []).filter((c) => !c.isPolice && c.kind !== 'sports' && c.kind !== 'tank' && !c.isParked);
    const farSpots = [[player.x - 5, player.z + 70], [player.x + 5, player.z + 85], [player.x - 3, player.z + 100]];
    civ.slice(0, 3).forEach((c, i) => {
      c.x = farSpots[i][0]; c.z = farSpots[i][1];
      c.angle = Math.PI; c.speed = 0;
    });
    // Thick drift smoke: a big smoke puff at the GT's rear tyres (the car
    // drives north, so the trail sits south, behind the car). Drained by
    // main.js on the next frame, mid-life (~0.4 s of 1.1 s) at
    // screenshot time — reads as speed and a drift, not a static pose.
    state.fxBurst = { type: 'smoke', x: player.x, y: 0.6, z: player.z + 2.5, count: 40, spread: 2.2 };
    // No feed messages in the shot: staging pushes wanted/roadblock
    // events, and the HUD would print them top-centre over the scene.
    state.events = [];
    return shotInfo(state, name);
  }

  if (name === 'title') {
    // The title screen over the live city: the silver Vespera GT parked
    // on the beach boulevard FACING SOUTH, down the road toward the low
    // sun — the chase camera (9.5 m behind, 4.4 m up) frames the road
    // leading into the sunset, sea on the right, beachfront buildings on
    // the left. No wanted, no police, no hero HUD — the DOM title
    // overlay (SOLMAR BAY + START) is the shot. runShot shows it by
    // passing info.screen ('title') to hud.update.
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) world.teleport(-190, -40, 0, car);
    state.events = [];
    return shotInfo(state, name, 'title');
  }

  if (name === 'onfoot') {
    // Dario ON FOOT on the beach boulevard, pistol out, facing south
    // toward the sunset — the over-shoulder camera (4.6 m behind) shows
    // him walking the boulevard with the silver GT parked beside him and
    // a few pedestrians around. The live HUD shows the idle mission
    // (CALL — go to Rosa's café), ON FOOT speed, and the minimap.
    // No car, no wanted, no police.
    world.teleport(-190, 20, 0, null);
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) {
      car.x = -193; car.z = 34; car.angle = 0; car.speed = 0;
      car.isParked = true;
    }
    const p = state.player;
    p.weapon = 'pistol';
    p.ammo = 12;
    p.reserveAmmo = 24;
    placePeds(state, [
      [-186, 26], [-194, 30], [-187, 40],
    ]);
    state.events = [];
    return shotInfo(state, name);
  }

  if (name === 'mission') {
    // M1 'The Pickup' active: the silver GT driving EAST along the z=48
    // street toward the docks marker (144, 48) — the chase camera behind
    // the car, the mission HUD (objective + distance + 2:30 timer +
    // STAGE 1/3) and the minimap marker show the mission + map systems.
    // No police (wanted 0).
    state.systems = systems;
    if (systems && systems.missions) systems.missions.start(1, state);
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) world.teleport(48, 48, Math.PI / 2, car);
    stepWorld(world, systems, fakeInput(['KeyW']), 90);
    state.events = [];
    return shotInfo(state, name);
  }

  return shotInfo(state, name);
}

function shotInfo(state, name, screen = 'play') {
  const m = state.mission || {};
  return {
    name,
    screen,
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
