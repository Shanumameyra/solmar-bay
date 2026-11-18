// city.js — Solmar Bay: the city itself, as pure data.
// generateCity(seed) builds the whole layout deterministically: districts,
// streets, buildings (with AABB colliders), props, traffic lights, neon
// signs and the mission anchor points. This module knows NOTHING about
// three.js — render.js turns this data into meshes. Collision queries here
// are the only thing player / vehicle / traffic need from the city.
//
// Coordinate system: x east, z south, y up. 1 unit = 1 metre. The city
// spans x,z in [-200, +200]. Streets run along the 8 centrelines in each
// direction (see config.js STREET_LINES). North is -z.

import {
  WORLD_HALF, STREET_LINES, STREET_WIDTH, SIDEWALK_WIDTH, DISTRICTS,
  TRAFFIC, PALETTE,
} from './config.js';
import { createRng } from './random.js';

const PLOT = 38;            // buildable plot size between streets (50 - 12)
const CLEAR = STREET_WIDTH / 2 + SIDEWALK_WIDTH; // 9 m from centreline to plot
const BLOCK_CENTRES = [-150, -100, -50, 0, 50, 100, 150];

export const NEON_TEXTS = ["ROSA'S", 'PIER 9', 'SOLMAR', 'TACOS', 'HOTEL LUNA'];

// ------------------------------------------------------------------ util --
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Which district contains point (x, z)? Falls back to 'plaza'. */
export function districtAt(x, z) {
  for (const key of Object.keys(DISTRICTS)) {
    const d = DISTRICTS[key];
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return key;
  }
  return 'plaza';
}

/** True when (x, z) is on asphalt (a street), false on sidewalk / plot. */
export function isRoad(x, z) {
  for (const line of STREET_LINES) {
    if (Math.abs(x - line) <= STREET_WIDTH / 2) return true;
    if (Math.abs(z - line) <= STREET_WIDTH / 2) return true;
  }
  return false;
}

/** True when (x, z) is on a sidewalk ring around a street. */
export function isSidewalk(x, z) {
  if (isRoad(x, z)) return false;
  for (const line of STREET_LINES) {
    if (Math.abs(x - line) <= CLEAR) return true;
    if (Math.abs(z - line) <= CLEAR) return true;
  }
  return false;
}

// ------------------------------------------------------------- generation --
/**
 * Build the city. Deterministic for a given seed.
 * Returns:
 * {
 *   seed, size, buildings: [{x,z,w,d,h,color,district,roof,neon}],
 *   colliders: [{x,z,r}] (prop circles),
 *   palms: [{x,z,scale}], streetlights: [{x,z}], trafficLights: [{x,z,phase}],
 *   stalls: [{x,z,angle,color}], containers: [{x,z,angle,color}],
 *   benches: [{x,z,angle}], hydrants: [{x,z}], billboards: [{x,z,angle,text,color}],
 *   neonSigns: [{x,z,y,text,color,angle}],
 *   beach: {x0,x1}, pier: {x,z,length,width}, sea: {x0},
 *   spots: {cafe, docks, beachCar, garage, safehouse, hospital, precinct,
 *           gunShop, pierEnd, taxiStand},
 *   intersections: [{x,z}]
 * }
 */
export function generateCity(seed) {
  const rng = createRng(seed);
  const city = {
    seed,
    size: WORLD_HALF * 2,
    buildings: [],
    colliders: [],
    palms: [],
    streetlights: [],
    trafficLights: [],
    stalls: [],
    containers: [],
    benches: [],
    hydrants: [],
    billboards: [],
    neonSigns: [],
    intersections: [],
    beach: { x0: -200, x1: -184 },
    pier: { x: -192, z: -25, length: 46, width: 8 },
    sea: { x0: -200 },
    spots: {},
  };

  // ---- buildings: one plot per block-centre pair -------------------------
  for (const cx of BLOCK_CENTRES) {
    for (const cz of BLOCK_CENTRES) {
      const district = districtAt(cx, cz);
      if (district === 'beach') continue; // west strip stays open sand/palms
      buildPlot(city, rng, cx, cz, district);
    }
  }

  // ---- port strip: warehouses + container yard (east edge) ---------------
  for (let i = 0; i < 5; i++) {
    const z = -150 + i * 70 + rng.range(-8, 8);
    addBuilding(city, rng, 188, z, 18, 26, rng.range(8, 12), 'port',
      rng.pick(PALETTE.buildingPastel));
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(150, 194);
    const z = rng.range(-170, 170);
    if (isRoad(x, z)) continue;
    city.containers.push({
      x, z, angle: rng.chance(0.5) ? 0 : Math.PI / 2,
      color: rng.pick([0xc0392b, 0x2471a3, 0xf39c12, 0x27ae60, 0x8e44ad]),
    });
    city.colliders.push({ x, z, r: 3.4 });
  }
  // Fixed docks cluster: the M1 package yard needs to read as a container
  // yard on sight, so four containers sit right by the package marker
  // (182, 24) — clear of the warehouse at (188, -3) and of the marker's
  // 5 m ring, so the approach from the west stays open.
  for (const [x, z] of [[184, 12], [191, 12], [184, 18], [191, 18]]) {
    city.containers.push({
      x, z, angle: 0,
      color: [0xc0392b, 0x2471a3, 0xf39c12, 0x27ae60][
        (x + z) % 4],
    });
    city.colliders.push({ x, z, r: 3.4 });
  }
  // Crane legs (the gantry crane rendered at (190, 30)) are solid.
  city.colliders.push({ x: 190, z: 27, r: 1.2 });
  city.colliders.push({ x: 190, z: 33, r: 1.2 });

  // ---- beach: sand strip, palms, pier ------------------------------------
  for (let i = 0; i < 34; i++) {
    const z = rng.range(-190, 190);
    city.palms.push({ x: rng.range(-198, -186), z, scale: rng.range(0.8, 1.3) });
    city.colliders.push({ x: city.palms[city.palms.length - 1].x, z, r: 0.5 });
  }
  // palm-lined beachfront avenue
  for (let z = -175; z <= 175; z += 25) {
    city.palms.push({ x: -178, z: z + rng.range(-3, 3), scale: rng.range(0.9, 1.2) });
    city.palms.push({ x: 178, z: z + rng.range(-3, 3), scale: rng.range(0.9, 1.2) });
  }
  // plaza palms around the cafe
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    city.palms.push({ x: Math.cos(a) * 26, z: Math.sin(a) * 26, scale: 1.1 });
  }

  // ---- market plaza stalls + benches --------------------------------------
  const stallColors = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0xe67e22];
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-38, 38);
    const z = rng.range(-38, 38);
    if (Math.hypot(x, z) < 14) continue; // keep the cafe forecourt clear
    city.stalls.push({ x, z, angle: rng.range(0, Math.PI), color: stallColors[i % 5] });
    city.colliders.push({ x, z, r: 2.2 });
  }
  for (let i = 0; i < 12; i++) {
    const x = rng.range(-170, 170);
    const z = rng.range(-170, 170);
    if (!isSidewalk(x, z)) continue;
    city.benches.push({ x, z, angle: rng.chance(0.5) ? 0 : Math.PI / 2 });
  }

  // ---- streetlights at intersections, hydrants along sidewalks ------------
  for (const lx of STREET_LINES) {
    for (const lz of STREET_LINES) {
      city.intersections.push({ x: lx, z: lz });
      city.streetlights.push({ x: lx + 8, z: lz + 8 });
      city.streetlights.push({ x: lx - 8, z: lz - 8 });
      // every other intersection gets a traffic light
      if ((Math.round(lx / 50) + Math.round(lz / 50)) % 2 === 0) {
        city.trafficLights.push({ x: lx, z: lz, phase: rng.range(0, TRAFFIC.lightCycle) });
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const line = rng.pick(STREET_LINES);
    const along = rng.range(-170, 170);
    const side = rng.chance(0.5) ? 1 : -1;
    if (rng.chance(0.5)) city.hydrants.push({ x: line + side * 8.2, z: along });
    else city.hydrants.push({ x: along, z: line + side * 8.2 });
  }

  // ---- billboards (procedural canvas textures in render.js) ---------------
  const ads = ['SOLMAR', 'PIER 9', 'TACOS', 'HOTEL LUNA', "ROSA'S"];
  for (let i = 0; i < 6; i++) {
    const line = rng.pick(STREET_LINES);
    city.billboards.push({
      x: line, z: rng.pick([-178, 178]), angle: 0,
      text: ads[i % ads.length], color: rng.pick(PALETTE.neon),
    });
  }

  // ---- mission anchor points (fixed, hand-placed, not random) -------------
  city.spots = {
    cafe:       { x: 0,    z: 0,    label: "Rosa's Cafe" },
    docks:      { x: 168,  z: 120,  label: 'Docks Package' },
    beachCar:   { x: -160, z: -75,  label: 'Yellow Sports Car' },
    garage:     { x: -25,  z: 175,  label: 'Garage' },
    safehouse:  { x: -75,  z: 150,  label: 'Safehouse' },
    hospital:   { x: 75,   z: -125, label: 'Hospital' },
    precinct:   { x: 125,  z: 25,   label: 'SBPD Precinct' },
    gunShop:    { x: 25,   z: -75,  label: 'Gun Shop' },
    pierEnd:    { x: -196, z: -25,  label: 'Pier End' },
    taxiStand:  { x: 25,   z: 25,   label: 'Taxi Stand' },
    playerSpawn:{ x: 0,   z: 26,   label: 'Start' },
  };

  return city;
}

/** Fill one 38x38 m plot with 1-4 buildings, by district height band. */
function buildPlot(city, rng, cx, cz, district) {
  const band = heightBand(district, rng);
  const count = district === 'downtown' ? 1 : rng.int(1, 3);
  if (count === 1) {
    const w = rng.range(PLOT * 0.55, PLOT * 0.85);
    const d = rng.range(PLOT * 0.55, PLOT * 0.85);
    addBuilding(city, rng, cx + rng.range(-3, 3), cz + rng.range(-3, 3), w, d,
      band(rng), district, pickBuildingColor(rng, district));
    return;
  }
  // 2-3 smaller buildings arranged in the plot
  const slots = [
    { dx: -PLOT / 4, dz: -PLOT / 4 }, { dx: PLOT / 4, dz: -PLOT / 4 },
    { dx: -PLOT / 4, dz: PLOT / 4 }, { dx: PLOT / 4, dz: PLOT / 4 },
  ];
  for (const s of rng.shuffle(slots).slice(0, count)) {
    const w = rng.range(12, 17);
    const d = rng.range(12, 17);
    addBuilding(city, rng, cx + s.dx, cz + s.dz, w, d, band(rng), district,
      pickBuildingColor(rng, district));
  }
}

function heightBand(district, rng) {
  switch (district) {
    case 'downtown': return () => rng.chance(0.4) ? rng.range(45, 70) : rng.range(20, 35);
    case 'port':     return () => rng.range(8, 12);
    case 'barrios':  return () => rng.range(6, 10);
    case 'plaza':    return () => rng.range(10, 18);
    default:         return () => rng.range(8, 15);
  }
}

function pickBuildingColor(rng, district) {
  if (district === 'downtown' && rng.chance(0.6)) return rng.pick(PALETTE.buildingGlass);
  return rng.pick(PALETTE.buildingPastel);
}

function addBuilding(city, rng, x, z, w, d, h, district, color) {
  const b = {
    x, z, w, d, h,
    color,
    district,
    roof: 0x5a5a5a,
    neon: null,
  };
  // neon signs on tall downtown buildings and the plaza cafe block
  if ((district === 'downtown' && h > 30 && rng.chance(0.7)) ||
      (district === 'plaza' && h > 14)) {
    b.neon = {
      text: rng.pick(NEON_TEXTS),
      color: rng.pick(PALETTE.neon),
    };
    city.neonSigns.push({
      x: b.x, z: b.z - b.d / 2 - 0.3, y: b.h * 0.82,
      text: b.neon.text, color: b.neon.color, angle: 0,
    });
  }
  city.buildings.push(b);
}

// -------------------------------------------------------------- collision --
/**
 * Push a circle (x, z, radius r) out of every building AABB and prop
 * collider it overlaps, and clamp it inside the world. Returns a NEW
 * {x, z} — the input is never mutated. Call once per axis or once per
 * frame; callers that slide along walls should resolve x and z separately
 * (see moveWithCollision in player.js).
 */
export function collideCircle(x, z, r, city) {
  let px = clamp(x, -WORLD_HALF + r, WORLD_HALF - r);
  let pz = clamp(z, -WORLD_HALF + r, WORLD_HALF - r);

  for (const b of city.buildings) {
    const minX = b.x - b.w / 2 - r, maxX = b.x + b.w / 2 + r;
    const minZ = b.z - b.d / 2 - r, maxZ = b.z + b.d / 2 + r;
    if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
      const pushL = px - minX, pushR = maxX - px;
      const pushT = pz - minZ, pushB = maxZ - pz;
      const m = Math.min(pushL, pushR, pushT, pushB);
      if (m === pushL) px = minX;
      else if (m === pushR) px = maxX;
      else if (m === pushT) pz = minZ;
      else pz = maxZ;
    }
  }
  for (const c of city.colliders) {
    const dx = px - c.x, dz = pz - c.z;
    const d2 = dx * dx + dz * dz;
    const min = c.r + r;
    if (d2 < min * min && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      px = c.x + (dx / d) * min;
      pz = c.z + (dz / d) * min;
    }
  }
  return { x: px, z: pz };
}

/** True when a circle at (x, z) with radius r overlaps any solid. */
export function pointInSolid(x, z, r, city) {
  const p = collideCircle(x, z, r, city);
  return Math.abs(p.x - x) > 0.001 || Math.abs(p.z - z) > 0.001;
}

/** Red/green state of a traffic light at world time t (seconds). */
export function lightState(light, t) {
  const phase = (t + light.phase) % TRAFFIC.lightCycle;
  return phase < TRAFFIC.lightGreen ? 'green' : 'red';
}

/** The nearest traffic light to (x, z), or null when far from any. */
export function nearestTrafficLight(x, z, city, maxDist = 30) {
  let best = null, bestD = maxDist;
  for (const l of city.trafficLights) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bestD) { best = l; bestD = d; }
  }
  return best;
}

// ----------------------------------------------------------------- spawns --
/** A random point on a road (street centreline, with lane offset). */
export function randomRoadPoint(rng, city) {
  const vertical = rng.chance(0.5);
  const line = rng.pick(STREET_LINES);
  const along = rng.range(-175, 175);
  const lane = rng.pick([-3, 3]); // drive on the right
  return vertical
    ? { x: line + lane, z: along, heading: along >= 0 ? 0 : Math.PI }
    : { x: along, z: line + lane, heading: along >= 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/** A random point on a sidewalk (for pedestrians and cash pickups). */
export function randomSidewalkPoint(rng, city) {
  for (let tries = 0; tries < 20; tries++) {
    const x = rng.range(-180, 180);
    const z = rng.range(-180, 180);
    if (isSidewalk(x, z)) return { x, z };
  }
  return { x: 10, z: 10 };
}

/** Nearest point on a road centreline to (x, z) — used for respawns. */
export function nearestRoadPoint(x, z) {
  let bestX = x, bestZ = z, bestD = Infinity;
  for (const line of STREET_LINES) {
    const d1 = Math.abs(x - line);
    if (d1 < bestD) { bestD = d1; bestX = line; bestZ = z; }
    const d2 = Math.abs(z - line);
    if (d2 < bestD) { bestD = d2; bestX = x; bestZ = line; }
  }
  return { x: bestX, z: bestZ };
}

/** Heading (radians) that points from (x,z) toward (tx,tz). */
export function headingTo(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z);
}

export default generateCity;
