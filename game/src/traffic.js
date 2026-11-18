// traffic.js — Solmar Bay ambient traffic + stealable parked cars (Worker B, v6 fresh)
// Contract: createTraffic(G) -> {cars:[10], parked:[8]}; updateTraffic(G, dt)
// Parked cars are NEVER placed inside dockCorridor {x 168-192, z 12-38}.
import { createCar, updateCar } from './vehicle.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

// Fallback street grid (8x8 blocks, ~400x400 m, streets every 50 m).
function streetLines(G) {
  if (G.world && Array.isArray(G.world.streets) && G.world.streets.length) return G.world.streets;
  return [-175, -125, -75, -25, 25, 75, 125, 175];
}

// Rectangular loop around one city block, on street centrelines.
function makeLoop(lines, bi, bj, rng) {
  const x0 = lines[bi], x1 = lines[bi + 1];
  const z0 = lines[bj], z1 = lines[bj + 1];
  const cw = rng ? rng.next() > 0.5 : true;
  const pts = [
    { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
  ];
  return cw ? pts : pts.reverse();
}

const PARKED_SPOTS = [
  { x: 12, z: 6, heading: Math.PI / 2 },      // market plaza edge (near cafe)
  { x: -10, z: 14, heading: -Math.PI / 2 },   // market plaza edge
  { x: -150, z: -38, heading: 0 },            // beachfront avenue
  { x: -138, z: -72, heading: Math.PI },      // beachfront, near M2 sports car zone
  { x: 80, z: 88, heading: Math.PI / 2 },     // downtown
  { x: -60, z: -118, heading: 0 },            // barrios
  { x: 118, z: -62, heading: -Math.PI / 2 },  // east side, clear of docks
  { x: 38, z: -152, heading: Math.PI },       // south avenue
];

const TRAFFIC_COLORS = [0x8a97a5, 0xb03a2e, 0x2e86c1, 0xd4ac0d, 0x1e8449, 0x7d3c98, 0xe67e22, 0x5d6d7e, 0xc0392b, 0x2471a3];

export function createTraffic(G) {
  const rng = G.rng || { next: () => Math.random(), int: (n) => Math.floor(Math.random() * n) };
  const lines = streetLines(G);
  const cars = [];
  for (let i = 0; i < 10; i++) {
    const bi = 1 + Math.floor(rng.next() * (lines.length - 2));
    const bj = 1 + Math.floor(rng.next() * (lines.length - 2));
    const loop = makeLoop(lines, bi, bj, rng);
    const start = loop[Math.floor(rng.next() * loop.length)];
    const next = loop[(loop.indexOf(start) + 1) % loop.length];
    const heading = Math.atan2(next.x - start.x, next.z - start.z);
    const car = createCar(G, {
      x: start.x, z: start.z, heading,
      color: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
    });
    car._loop = loop;
    car._wp = (loop.indexOf(start) + 1) % loop.length;
    car._stopTimer = rng.next() * 2; // staggered starts
    car._blockedTimer = 0;
    car._honkTimer = 0;
    cars.push(car);
  }

  // 8 parked cars — fixed spots, all outside dockCorridor {x 168-192, z 12-38}.
  const parked = [];
  for (let i = 0; i < PARKED_SPOTS.length; i++) {
    const s = PARKED_SPOTS[i];
    const car = createCar(G, {
      x: s.x, z: s.z, heading: s.heading,
      color: TRAFFIC_COLORS[(i + 3) % TRAFFIC_COLORS.length],
      parked: true,
    });
    parked.push(car);
  }

  return { cars, parked };
}

function driveToward(car, tx, tz, dt, G) {
  const dx = tx - car.pos.x, dz = tz - car.pos.z;
  const dist = Math.hypot(dx, dz);
  const targetHeading = Math.atan2(dx, dz);
  const dh = normAngle(targetHeading - car.heading);
  const steer = clamp(dh * 1.6, -1, 1);
  // Slow down when close to the waypoint or turning hard.
  const want = dist < 10 ? 0.45 : Math.abs(dh) > 0.9 ? 0.5 : 1;
  updateCar(G, car, dt, { throttle: want > 0.4, brake: dist < 4, steer, handbrake: false });
  return dist;
}

export function updateTraffic(G, dt) {
  const t = G.traffic;
  if (!t) return;
  const playerCar = G.player && G.player.car;
  const playerPos = G.player && G.player.pos;

  for (const car of t.cars) {
    if (car.stalled) { updateCar(G, car, dt, {}); continue; }

    // Red-light pause.
    if (car._stopTimer > 0) {
      car._stopTimer -= dt;
      updateCar(G, car, dt, { brake: true });
      continue;
    }

    const wp = car._loop[car._wp];
    const dx = wp.x - car.pos.x, dz = wp.z - car.pos.z;
    const dist = Math.hypot(dx, dz);

    // Yield: player car directly ahead and close -> stop.
    let yieldStop = false;
    if (playerCar && playerPos) {
      const pdx = playerCar.pos.x - car.pos.x, pdz = playerCar.pos.z - car.pos.z;
      const pd = Math.hypot(pdx, pdz);
      if (pd < 10) {
        const ahead = (pdx * Math.sin(car.heading) + pdz * Math.cos(car.heading)) / Math.max(pd, 1e-4);
        if (ahead > 0.7) yieldStop = true;
      }
    }
    // Yield: police cruiser directly ahead (same as the player car).
    if (!yieldStop && G.police) {
      for (const o of G.police.cars) {
        const odx = o.pos.x - car.pos.x, odz = o.pos.z - car.pos.z;
        const od = Math.hypot(odx, odz);
        if (od < 10) {
          const ahead = (odx * Math.sin(car.heading) + odz * Math.cos(car.heading)) / Math.max(od, 1e-4);
          if (ahead > 0.75) { yieldStop = true; break; }
        }
      }
    }
    // Yield: traffic car directly ahead.
    if (!yieldStop) {
      for (const o of t.cars) {
        if (o === car) continue;
        const odx = o.pos.x - car.pos.x, odz = o.pos.z - car.pos.z;
        const od = Math.hypot(odx, odz);
        if (od < 8) {
          const ahead = (odx * Math.sin(car.heading) + odz * Math.cos(car.heading)) / Math.max(od, 1e-4);
          if (ahead > 0.75 && o.speed < car.speed + 1) { yieldStop = true; break; }
        }
      }
    }

    if (yieldStop) {
      car._blockedTimer += dt;
      updateCar(G, car, dt, { brake: true });
      if (car._blockedTimer > 3 && car._honkTimer <= 0 && G.audio) {
        G.audio.sfx('honk');
        car._honkTimer = 5;
      }
      continue;
    }
    car._blockedTimer = 0;
    car._honkTimer = Math.max(0, (car._honkTimer || 0) - dt);

    const d = driveToward(car, wp.x, wp.z, dt, G);
    if (d < 7) {
      car._wp = (car._wp + 1) % car._loop.length;
      // Simulated traffic light: sometimes stop at the intersection.
      if ((G.rng ? G.rng.next() : Math.random()) < 0.3) car._stopTimer = 2 + Math.random() * 2.5;
    }
  }

  // Parked cars do not move; nothing to do. (They are enterable via E.)
}
