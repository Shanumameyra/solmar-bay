// Solmar Bay — staged screenshot (Worker B). stageShot(name, world, systems)
// plays the ONE hero scene forward from a fresh world with a scripted
// autopilot (no real user input), so the screenshot is reproducible.
// Deterministic per seed: Math.random is temporarily replaced by a seeded
// mulberry32 stream while staging, so police/taxi/pickup placement repeats
// (police.js and missions.js both use Math.random). The scripted input uses
// the input.js shape ({keys, justPressed, dx, dy}); world.step translates
// it. Scene: hero (the red Vespera GT driving the beach boulevard at
// sunset, chased by the MBPD — the #1 entry's composition). Romi ordered
// ONE screenshot only (18 Nov): no cover/onfoot/chase/mission, no collage.

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
    // THE hero shot (the only screenshot): the red Vespera GT driving
    // north up the beach boulevard at sunset, chased by the MBPD — the #1
    // entry's composition. Rear 3/4 chase cam (state.heroCam), hero HUD
    // (state.heroHud), FLAMINGO FM billboard on the left, sea + palms,
    // pastel beachfront buildings on the right, sun glare straight ahead.
    // The car hugs the shore (x=-190, on the street at x=-192, 10 m from
    // the shoreline at x=-200): the sea fills the left of the frame, the
    // beachfront buildings stand back on the right, and the sunset sits
    // ahead over the water. Heading PI = -z (north) under the (sin, cos)
    // convention.
    const car = firstCar(state, 'sports') || firstCar(state);
    if (car) world.teleport(-190, 60, Math.PI, car);
    state.heroCam = true;
    state.heroHud = {
      missionTitle: '<span class="m-id">MISSION 7/7</span>THE TIDE JOB',
      cash: '$18,450',
      starsHtml: '<span style="color:#ffd23d">★★★★</span><span style="color:#8a8a92">★</span>',
      insight: 'IN SIGHT · GULL-1',
      objective: 'Lose the MBPD — reach the safehouse',
      stageLabel: 'STAGE 3/3',
      stagePct: 100,
      next: 'Reach the safehouse',
      speedKmh: 151,
      carName: 'VESPERA GT',
      dialogue: {
        name: 'LUCÍA ORTEGA',
        initials: 'LO',
        text: 'The tide’s coming in, Jason. Run the boulevard — don’t let them box you in.',
      },
    };
    if (systems && systems.police) {
      systems.police.addHeat(3, 'shot', state);
      // FIVE cruisers (the wanted-3 tier wants 3, the #1 shot shows a
      // full dragnet): flanking left AND right of the player, light bars
      // flashing, so the frame reads busy from both sides.
      for (let i = 0; i < 5; i += 1) systems.police.spawnCar(state, player);
      const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
      cops.forEach((c, i) => {
        const spot = [
          [player.x - 10, player.z + 25],
          [player.x + 10, player.z + 35],
          [player.x - 8, player.z + 48],
          [player.x + 8, player.z + 60],
          [player.x - 2, player.z + 72],
        ][i % 5];
        c.x = spot[0];
        c.z = spot[1];
        c.angle = 0;
        c.speed = 22;
      });
      // Crowd: pedestrians on the sand + both sidewalks of the street,
      // so the boulevard feels alive, not empty. (Traffic cars are placed
      // on the street after the sim, in the framing block below.)
      placePeds(state, [[-185, 12], [-185, 2], [-184, -18], [-153, 30], [-152, -6], [-155, -28], [-137, 10], [-137, -14], [-199, 30], [-199, 20], [-183, 32], [-183, 24], [-183, 14], [-199, 8]]);
      // Tank + helicopter: the tank rumbles in 40 m behind on the left,
      // facing NORTH (toward the player, angle PI) so it closes in
      // head-on instead of driving away — the pursuit turns it around
      // too slowly otherwise. The heli (wanted 3+) hovers ahead with its
      // spotlight beam on the road.
      const tank = systems.police.spawnTank(state, player);
      if (tank) {
        tank.x = player.x - 4;
        tank.z = player.z + 40;
        tank.angle = Math.PI;
        tank.speed = 0;
      }
    }
    stepWorld(world, systems, fakeInput(['KeyW']), 120);
    // Frame the pursuit for the camera (rear 3/4, 9 m back): the sim
    // leaves the tank + most cruisers behind the camera, so pull one
    // cruiser + the tank into the visible band behind the player — tank
    // left-rear with its cannon toward the camera, a cruiser right-rear —
    // so the dragnet reads left AND right like the #1 shot. (Deterministic:
    // fixed offsets from the player, after the sim. cops[0] stays the
    // roadblock parked ahead in the spotlight pool.)
    const cops = (state.cars || []).filter((c) => c.isPolice && c.kind !== 'tank');
    if (cops[1]) {
      cops[1].x = player.x + 7; cops[1].z = player.z - 2;
      cops[1].angle = Math.PI; cops[1].speed = 0;
    }
    // Flanking dragnet: two more cruisers CLOSE on the GT's left + right,
    // a few metres ahead — the player is surrounded, not chased by one
    // far car. (cops[0] stays the roadblock parked ahead in the pool.)
    if (cops[2]) {
      cops[2].x = player.x - 6; cops[2].z = player.z - 8;
      cops[2].angle = Math.PI; cops[2].speed = 0;
    }
    if (cops[3]) {
      cops[3].x = player.x + 4; cops[3].z = player.z - 10;
      cops[3].angle = Math.PI; cops[3].speed = 0;
    }
    // Traffic ON the street ahead of the player (not the far avenue), so
    // the road reads full: three civilian cars in both lanes, mid-frame
    // and in the distance.
    const civ = (state.cars || []).filter((c) => !c.isPolice && c.kind !== 'sports' && c.kind !== 'tank' && !c.isParked).slice(0, 3);
    const civSpots = [[player.x - 2, player.z - 28], [player.x + 3, player.z - 34], [player.x - 1, player.z - 55]];
    civ.forEach((c, i) => {
      c.x = civSpots[i][0]; c.z = civSpots[i][1];
      c.angle = Math.PI; c.speed = 0;
    });
    const tank = (state.cars || []).find((c) => c.kind === 'tank');
    if (tank) {
      tank.x = player.x - 4; tank.z = player.z + 3;
      tank.angle = 0; tank.speed = 0; // cannon toward the camera
    }
    // Dust / motion: a smoke puff at the GT's rear wheels (the car drives
    // north, so the trail sits south). Drained by main.js on the next
    // frame, mid-life (~0.4 s of 1.1 s) at screenshot time — reads as
    // speed, not a static pose.
    state.fxBurst = { type: 'smoke', x: player.x, y: 0.6, z: player.z + 2.5, count: 24, spread: 1.6 };
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
