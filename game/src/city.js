// Solmar Bay — deterministic city generation. Pure module, no imports.
import { CONFIG } from './config.js';
import { mulberry32, range, int, choice } from './random.js';

const SIZE = CONFIG.WORLD_SIZE;
const HALF = SIZE / 2;
const BLOCKS = CONFIG.BLOCKS;
const PITCH = SIZE / BLOCKS; // 50 m per grid cell

const DISTRICTS = [
  { name: 'Beachfront', x0: -200, z0: -200, x1: -110, z1: 200 },
  { name: 'Downtown', x0: 60, z0: -200, x1: 200, z1: -60 },
  { name: 'Port/Docks', x0: 110, z0: -50, x1: 200, z1: 150 },
  { name: 'Market Plaza', x0: -60, z0: -60, x1: 60, z1: 60 },
  { name: 'Barrios', x0: -110, z0: 110, x1: 110, z1: 200 },
];

function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  }
  return 'Barrios';
}

function rectsOverlap(ax0, az0, ax1, az1, b) {
  return ax0 < b.x1 && ax1 > b.x0 && az0 < b.z1 && az1 > b.z0;
}

export function buildCity(seed) {
  const rng = mulberry32(seed);
  const plaza = { x: 0, z: 0, r: 35 };
  const beach = { x0: -200, z0: -200, x1: -172, z1: 200 };
  const docks = { x: 160, z: 50 };
  const pier = { x: -186, z: 0, w: 14, l: 60 };

  const clearZones = [
    { x0: plaza.x - plaza.r, z0: plaza.z - plaza.r, x1: plaza.x + plaza.r, z1: plaza.z + plaza.r },
    { x0: beach.x0, z0: beach.z0, x1: beach.x1, z1: beach.z1 },
    { x0: docks.x - 45, z0: docks.z - 45, x1: docks.x + 40, z1: docks.z + 45 },
  ];

  const buildings = [];
  // 8x8 blocks; streets run on the cell boundaries, buildings sit inside cells.
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const cx = -HALF + i * PITCH + PITCH / 2;
      const cz = -HALF + j * PITCH + PITCH / 2;
      const district = districtAt(cx, cz);
      // One or two buildings per block, offset inside the block interior.
      const count = rng() < 0.45 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const w = range(rng, 16, 26);
        const d = range(rng, 16, 26);
        const ox = count === 1 ? 0 : (k === 0 ? -9 : 9);
        const oz = count === 1 ? 0 : (k === 0 ? -9 : 9);
        const x = cx + ox;
        const z = cz + oz;
        if (x - w / 2 < -HALF + 8 || x + w / 2 > HALF - 8) continue;
        if (z - d / 2 < -HALF + 8 || z + d / 2 > HALF - 8) continue;
        let blocked = false;
        for (const czone of clearZones) {
          if (rectsOverlap(x - w / 2, z - d / 2, x + w / 2, z + d / 2, czone)) { blocked = true; break; }
        }
        if (blocked) continue;
        let h;
        let palette = CONFIG.COLORS.buildings;
        if (district === 'Downtown') {
          h = rng() < 0.35 ? range(rng, 45, 70) : range(rng, 20, 35);
          palette = CONFIG.COLORS.downtown;
        } else if (district === 'Market Plaza') {
          h = range(rng, 20, 35);
        } else if (district === 'Barrios' || district === 'Port/Docks') {
          h = range(rng, 8, 15);
          if (district === 'Barrios') palette = CONFIG.COLORS.barrios;
        } else {
          h = range(rng, 8, 15);
        }
        buildings.push({ x, z, w, d, h, district, color: choice(rng, palette) });
      }
    }
  }

  // Street segments along every grid line (both axes).
  const streets = [];
  for (let k = 0; k <= BLOCKS; k++) {
    const c = -HALF + k * PITCH;
    streets.push({ x1: c, z1: -HALF, x2: c, z2: HALF });
    streets.push({ x1: -HALF, z1: c, x2: HALF, z2: c });
  }

  // Palms along the beachfront avenue and the plaza edge.
  const palms = [];
  for (let z = -190; z <= 190; z += 14) {
    palms.push({ x: -168 + range(rng, -2, 2), z: z + range(rng, -3, 3), s: range(rng, 0.8, 1.3) });
    if (rng() < 0.5) palms.push({ x: -158 + range(rng, -2, 2), z: z + 7, s: range(rng, 0.8, 1.2) });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    palms.push({ x: Math.cos(a) * 30, z: Math.sin(a) * 30, s: range(rng, 0.9, 1.3) });
  }

  // Street lamps along the main avenues.
  const lamps = [];
  for (let k = 1; k < BLOCKS; k++) {
    const c = -HALF + k * PITCH;
    for (let t = -175; t <= 175; t += 50) {
      lamps.push({ x: c + 7, z: t });
      lamps.push({ x: t, z: c + 7 });
    }
  }

  // Market stalls ringing the plaza.
  const stalls = [];
  const stallColors = ['#ff8a5a', '#4ad8ff', '#ffd24a', '#ff5a8a', '#7aff8a'];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    stalls.push({
      x: Math.cos(a) * 24,
      z: Math.sin(a) * 24,
      rot: -a + Math.PI / 2,
      color: stallColors[i % stallColors.length],
    });
  }

  // Shipping containers + cranes at the docks.
  const containers = [];
  const contColors = ['#c94a3a', '#3a7ac9', '#d8a03a', '#3a9e6a', '#7a5ac9'];
  for (let i = 0; i < 12; i++) {
    containers.push({
      x: 130 + (i % 4) * 16 + range(rng, -2, 2),
      z: 15 + Math.floor(i / 4) * 16 + range(rng, -2, 2),
      rot: rng() < 0.8 ? 0 : Math.PI / 2,
      color: contColors[i % contColors.length],
    });
  }
  const cranes = [
    { x: 175, z: 20 },
    { x: 175, z: 80 },
    { x: 150, z: 95 },
  ];

  const benches = [];
  for (let i = 0; i < 12; i++) {
    benches.push({ x: range(rng, -45, 45), z: range(rng, -45, 45) });
  }
  const hydrants = [];
  for (let i = 0; i < 16; i++) {
    hydrants.push({ x: range(rng, -180, 180), z: range(rng, -180, 180) });
  }

  const billboards = [
    { x: -120, z: -150, rot: Math.PI / 4, text: 'SOLMAR BAY' },
    { x: 90, z: -140, rot: -Math.PI / 3, text: 'VISIT THE PIER' },
    { x: 140, z: 120, rot: Math.PI / 2, text: 'PIER 9' },
    { x: -60, z: 150, rot: 0, text: 'HOTEL LUNA' },
    { x: 40, z: -170, rot: Math.PI, text: "ROSA'S CAFE" },
  ];

  return {
    seed,
    size: SIZE,
    blocks: BLOCKS,
    streetW: CONFIG.STREET_W,
    buildings,
    streets,
    palms,
    lamps,
    stalls,
    containers,
    cranes,
    benches,
    hydrants,
    billboards,
    districts: DISTRICTS.map((d) => ({ ...d })),
    beach,
    pier,
    plaza,
    docks,
    garage: { x: 0, z: 170 },
    safehouse: { x: -60, z: 160 },
    cafe: { x: -20, z: -10 },
    hospital: { x: 120, z: -120 },
    gunshop: { x: 80, z: 40 },
    spawn: { x: 0, z: 20, heading: 0 },
    precinct: { x: 100, z: -80 },
  };
}

// Circle vs building AABB (buildings are axis-aligned boxes).
export function collidesWithBuildings(city, x, z, r) {
  for (const b of city.buildings) {
    const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
    const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

export function clampToCity(city, x, z) {
  const half = city.size / 2 - 2;
  return {
    x: Math.max(-half, Math.min(half, x)),
    z: Math.max(-half, Math.min(half, z)),
  };
}
