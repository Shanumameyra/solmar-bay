// Solmar Bay — the city (Worker A, v3 rebuild).
// Builds the whole static city from a seed: ground, streets, sand + sea,
// buildings (InstancedMesh, 3 height bands, bright pastel facades), palms,
// streetlights, traffic lights, neon signs, beachfront row, pier, plaza +
// fountain, market stalls, port containers + crane, billboard.
// All textures are procedural DataTextures / canvas textures guarded for
// Node (headless tests have no document): in Node, signs fall back to plain
// emissive panels and the window texture is still a DataTexture, so
// buildCity works identically in the browser and in node.
//
// Layout: 9 streets each way (centrelines -192..192 step 48), 8x8 blocks
// (36 m wide) between them, city half 200 m. Sea west of x=-200, sand
// -200..-168, pier at z=48 reaching x=-216.
//
// Lessons baked in from v1:
//  - Beachfront building row sits at x=-162 (14 m wide), so the beachfront
//    avenue (street x=-144) is clear to drive.
//  - Bright golden-hour palette: light window-texture base, pastel facades.

import * as THREE from 'three';
import { CONFIG, LANDMARKS } from './config.js';
import { createRandom } from './random.js';

const HALF = CONFIG.CITY.HALF;
const STREETS = CONFIG.CITY.STREETS;
const CENTRES = CONFIG.CITY.CENTRES;
const HAS_DOM = typeof document !== 'undefined';

// ---------------------------------------------------------------------------
// Collision helpers (pure, no THREE needed)
// ---------------------------------------------------------------------------

// True when a circle at (x, z) with radius r overlaps any building AABB.
export function hitsCollider(city, x, z, r) {
  const cs = city.colliders;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) {
      return true;
    }
  }
  return false;
}

// Resolve a circle against building AABBs, the city bounds and the sea.
// Returns { x, z, hit }. The sea (x < -199) is blocked except for the pier
// corridor (|z - 48| <= 5, down to x = -214) so the pier stays walkable.
export function collideCircle(city, x, z, r) {
  let hit = false;
  let nx = x;
  let nz = z;
  const cs = city.colliders;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) {
      // Push out along the smallest penetration axis.
      const pushL = nx + r - c.minX;
      const pushR = c.maxX - (nx - r);
      const pushT = nz + r - c.minZ;
      const pushB = c.maxZ - (nz - r);
      const m = Math.min(pushL, pushR, pushT, pushB);
      if (m === pushL) nx = c.minX - r;
      else if (m === pushR) nx = c.maxX + r;
      else if (m === pushT) nz = c.minZ - r;
      else nz = c.maxZ + r;
      hit = true;
    }
  }
  // City bounds. The pier corridor (|z - 48| <= 5) reaches x = -215, past
  // the -200 city edge, so its west limit is lower.
  const onPierCorridor = Math.abs(nz - 48) <= 5;
  const minX = onPierCorridor ? -215 : -HALF + r;
  if (nx < minX) { nx = minX; hit = true; }
  if (nx > HALF - r) { nx = HALF - r; hit = true; }
  if (nz < -HALF + r) { nz = -HALF + r; hit = true; }
  if (nz > HALF - r) { nz = HALF - r; hit = true; }
  // Sea: blocked unless on the pier corridor.
  if (nx < -199 + r && !onPierCorridor) { nx = -199 + r; hit = true; }
  return { x: nx, z: nz, hit };
}

// District name for a point (first DISTRICTS region that contains it).
export function districtAt(x, z) {
  const ds = CONFIG.DISTRICTS;
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) return d.name;
  }
  return 'uptown';
}

// True when the point is on a street (within half the street width of a
// street centreline on either axis).
export function isOnRoad(x, z) {
  const hw = CONFIG.CITY.STREET_WIDTH / 2;
  for (let i = 0; i < STREETS.length; i++) {
    if (Math.abs(x - STREETS[i]) <= hw) return true;
    if (Math.abs(z - STREETS[i]) <= hw) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// NavGrid — coarse A* grid for peds / police (game-ai skill: cache the path,
// follow waypoints with steering; 8-way moves, no diagonal corner cutting).
// ---------------------------------------------------------------------------

// Guard for the lazy default-grid build below (buildCity creates a
// NavGrid internally, so the flag stops infinite recursion).
let buildingDefaultGrid = false;

export class NavGrid {
  // cell: cell size in metres. colliders: optional AABB list to build from.
  // With no colliders given, a bare `new NavGrid()` builds the default
  // (seed 7) city grid, so a grid constructed on its own still knows the
  // city's walls — including the plaza fountain. buildCity passes
  // autoDefault=false because it builds the grid itself right after.
  constructor(cell = 4, colliders = null, autoDefault = true) {
    if (Array.isArray(cell)) {
      colliders = cell;
      cell = 4;
    }
    this.cell = cell;
    this.half = HALF;
    this.cols = Math.ceil((HALF * 2) / cell);
    this.rows = this.cols;
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.colliders = [];
    if (colliders) {
      this.buildFromColliders(colliders);
    } else if (autoDefault && !buildingDefaultGrid) {
      buildingDefaultGrid = true;
      try {
        this.buildFromColliders(buildCity(7).colliders);
      } finally {
        buildingDefaultGrid = false;
      }
    }
  }

  // Mark cells whose centre falls inside a collider (expanded by pad) or in
  // the sea / outside the city as blocked.
  buildFromColliders(colliders, pad = 1.2) {
    this.colliders = colliders;
    const { cell, cols, rows, half } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -half + (c + 0.5) * cell;
        const z = -half + (r + 0.5) * cell;
        let b = x < -198 || Math.abs(x) > half || Math.abs(z) > half;
        if (!b) {
          for (let i = 0; i < colliders.length; i++) {
            const k = colliders[i];
            if (x > k.minX - pad && x < k.maxX + pad && z > k.minZ - pad && z < k.maxZ + pad) {
              b = true;
              break;
            }
          }
        }
        this.blocked[r * cols + c] = b ? 1 : 0;
      }
    }
  }

  worldToCell(x, z) {
    const c = Math.floor((x + this.half) / this.cell);
    const r = Math.floor((z + this.half) / this.cell);
    return [Math.max(0, Math.min(this.cols - 1, c)), Math.max(0, Math.min(this.rows - 1, r))];
  }

  cellToWorld(c, r) {
    return [-this.half + (c + 0.5) * this.cell, -this.half + (r + 0.5) * this.cell];
  }

  isBlockedCell(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return true;
    return this.blocked[r * this.cols + c] === 1;
  }

  // Exact test: is the point itself inside a collider, in the sea, or
  // outside the city? (Cell centres can miss points near a collider edge.)
  pointBlocked(x, z) {
    if (Math.abs(x) > this.half || Math.abs(z) > this.half) return true;
    if (x < -198) return true;
    const ks = this.colliders;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (x > k.minX && x < k.maxX && z > k.minZ && z < k.maxZ) return true;
    }
    return false;
  }

  // A* from (sx, sz) to (tx, tz). Returns [[x, z], ...] waypoints (world
  // coords, start excluded, target included) or null when unreachable.
  // A start or target point that lies exactly inside a collider (not just
  // a blocked cell — a point near a collider's edge can sit in an open
  // cell) is also unreachable: the exact point test catches it.
  findPath(sx, sz, tx, tz) {
    const [sc, sr] = this.worldToCell(sx, sz);
    const [tc, tr] = this.worldToCell(tx, tz);
    if (this.isBlockedCell(sc, sr)) return null; // start inside a wall: no path
    if (this.isBlockedCell(tc, tr)) return null;
    if (this.pointBlocked(sx, sz)) return null;
    if (this.pointBlocked(tx, tz)) return null;
    if (sc === tc && sr === tr) return [[tx, tz]];
    const cols = this.cols;
    const rows = this.rows;
    const idx = (c, r) => r * cols + c;
    const SQRT2 = Math.SQRT2;
    // Octile heuristic (admissible for 8-way moves with diagonal cost √2).
    const heur = (c, r) => {
      const dx = Math.abs(c - tc);
      const dz = Math.abs(r - tr);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    const g = new Float32Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    // Tiny binary heap of [f, cellIndex].
    const heap = [];
    const heapPush = (f, i) => {
      heap.push([f, i]);
      let n = heap.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (heap[p][0] <= heap[n][0]) break;
        const t = heap[p]; heap[p] = heap[n]; heap[n] = t;
        n = p;
      }
    };
    const heapPop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let n = 0;
        for (;;) {
          const l = n * 2 + 1;
          const r2 = l + 1;
          let s = n;
          if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
          if (r2 < heap.length && heap[r2][0] < heap[s][0]) s = r2;
          if (s === n) break;
          const t = heap[s]; heap[s] = heap[n]; heap[n] = t;
          n = s;
        }
      }
      return top;
    };
    g[idx(sc, sr)] = 0;
    heapPush(heur(sc, sr), idx(sc, sr));
    const DIRS = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
    ];
    let expansions = 0;
    let found = false;
    while (heap.length > 0) {
      const [, cur] = heapPop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % cols;
      const cr = (cur / cols) | 0;
      if (cc === tc && cr === tr) { found = true; break; }
      if (++expansions > 6000) return null; // unreachable / too far: give up
      for (let d = 0; d < DIRS.length; d++) {
        const [dc, dr, cost] = DIRS[d];
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (this.isBlockedCell(nc, nr)) continue;
        // No diagonal corner cutting: both orthogonal neighbours must be open.
        if (dc !== 0 && dr !== 0) {
          if (this.isBlockedCell(cc + dc, cr) || this.isBlockedCell(cc, cr + dr)) continue;
        }
        const ni = idx(nc, nr);
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heapPush(ng + heur(nc, nr), ni);
        }
      }
    }
    if (!found) return null;
    // Reconstruct, then simplify (drop collinear middle points).
    const cells = [];
    let cur = idx(tc, tr);
    while (cur !== -1) {
      cells.push(cur);
      cur = came[cur];
    }
    cells.reverse();
    const pts = cells.map((ci) => this.cellToWorld(ci % cols, (ci / cols) | 0));
    pts[pts.length - 1] = [tx, tz]; // end exactly on the target
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, az] = out[out.length - 1];
      const [bx, bz] = pts[i];
      const [cx, cz] = pts[i + 1];
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (Math.abs(cross) > 0.01) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out.slice(1); // drop the start point: the walker is already there
  }
}

// ---------------------------------------------------------------------------
// Procedural textures (no files, no network)
// ---------------------------------------------------------------------------

// Window texture for building facades: light grey-blue base (bright
// golden-hour facades, not dark slabs) with a grid of windows — ~48% warm
// lit, some cool lit, some curtained, the rest mid-grey. DataTexture, so it
// works in Node as well as the browser.
function makeWindowTexture(rng) {
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  const base = [0xc8, 0xcc, 0xd2];
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = base[0];
    data[i * 4 + 1] = base[1];
    data[i * 4 + 2] = base[2];
    data[i * 4 + 3] = 255;
  }
  const cols = 6;
  const rows = 12;
  const ww = 6;
  const wh = 6;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const roll = rng.next();
      let col;
      if (roll < 0.48) col = [0xff, 0xd2, 0x7a]; // warm lit
      else if (roll < 0.56) col = [0x9f, 0xd8, 0xff]; // cool lit
      else if (roll < 0.64) col = [0x8a, 0x7a, 0x6a]; // curtain
      else col = [0x6a, 0x76, 0x82]; // unlit mid-grey
      const x0 = 4 + c * 10;
      const y0 = 5 + r * 10;
      for (let y = y0; y < y0 + wh; y++) {
        for (let x = x0; x < x0 + ww; x++) {
          const i = (y * w + x) * 4;
          data[i] = col[0];
          data[i + 1] = col[1];
          data[i + 2] = col[2];
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Neon sign texture (canvas, browser only). In Node returns null and the
// caller falls back to a plain emissive panel.
function makeSignTexture(text, color) {
  if (!HAS_DOM) return null;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = 'bold 72px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// buildCity
// ---------------------------------------------------------------------------

export function buildCity(seed = 7) {
  const rng = createRandom(seed);
  const group = new THREE.Group();
  group.name = 'city';
  const colliders = [];
  const blocks = [];
  const lights = [];
  const signMeshes = [];

  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const col = new THREE.Color();

  // --- Ground: sidewalk base, asphalt streets, sand, sea -------------------
  const groundMat = new THREE.MeshLambertMaterial({ color: CONFIG.PALETTE.sidewalk });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 32, HALF * 2 + 32), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: CONFIG.PALETTE.asphalt });
  const roadNS = new THREE.InstancedMesh(new THREE.PlaneGeometry(12, HALF * 2 + 32), roadMat, STREETS.length);
  const roadEW = new THREE.InstancedMesh(new THREE.PlaneGeometry(HALF * 2 + 32, 12), roadMat, STREETS.length);
  for (let i = 0; i < STREETS.length; i++) {
    euler.set(-Math.PI / 2, 0, 0);
    quat.setFromEuler(euler);
    mat4.compose(v3.set(STREETS[i], 0.02, 0), quat, new THREE.Vector3(1, 1, 1));
    roadNS.setMatrixAt(i, mat4);
    mat4.compose(v3.set(0, 0.02, STREETS[i]), quat, new THREE.Vector3(1, 1, 1));
    roadEW.setMatrixAt(i, mat4);
  }
  roadNS.receiveShadow = true;
  roadEW.receiveShadow = true;
  group.add(roadNS);
  group.add(roadEW);

  // Sand strip (-200..-168) and sea (west of -200, out to the horizon).
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(32, HALF * 2 + 32),
    new THREE.MeshLambertMaterial({ color: CONFIG.PALETTE.sand }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-184, 0.03, 0);
  sand.receiveShadow = true;
  group.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 1100),
    new THREE.MeshLambertMaterial({ color: CONFIG.PALETTE.sea }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-480, 0.01, 0);
  group.add(sea);

  // --- Road markings: dashed white centrelines + double yellow on the ------
  // --- beach boulevard (x = -192) ------------------------------------------
  const dashGeo = new THREE.PlaneGeometry(0.18, 3);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2f2e8 });
  const dashCount = STREETS.length * 2 * 39 - 39; // every street both ways, minus the -192 NS dashes
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  let di = 0;
  for (const s of STREETS) {
    for (let k = -190; k <= 190; k += 10) {
      if (s !== -192) {
        euler.set(-Math.PI / 2, 0, 0);
        quat.setFromEuler(euler);
        mat4.compose(v3.set(s, 0.05, k), quat, new THREE.Vector3(1, 1, 1));
        dashes.setMatrixAt(di++, mat4);
      }
      euler.set(-Math.PI / 2, 0, Math.PI / 2);
      quat.setFromEuler(euler);
      mat4.compose(v3.set(k, 0.05, s), quat, new THREE.Vector3(1, 1, 1));
      dashes.setMatrixAt(di++, mat4);
    }
  }
  dashes.count = di;
  group.add(dashes);
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffd23d });
  for (const lx of [-193.2, -190.8]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 380), yellowMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(lx, 0.05, 0);
    group.add(line);
  }

  // --- Buildings ------------------------------------------------------------
  // One InstancedMesh holds buildings + cornices + penthouses (unit box,
  // per-instance scale + colour). Height bands: low 8-15, mid 20-35,
  // towers 45-70.
  const windowTex = makeWindowTexture(rng);
  const bldgMat = new THREE.MeshStandardMaterial({
    map: windowTex, roughness: 0.85, metalness: 0.05,
  });
  const bldgSlots = [];
  const addBuilding = (cx, cz, w, h, d, palette) => {
    const color = rng.pick(palette);
    bldgSlots.push({ x: cx, y: h / 2, z: cz, sx: w, sy: h, sz: d, color });
    // Cornice: bright band on top of every facade.
    bldgSlots.push({ x: cx, y: h + 0.25, z: cz, sx: w + 0.6, sy: 0.5, sz: d + 0.6, color: CONFIG.PALETTE.cornice });
    // Penthouse on every second building: varied roof silhouette.
    if (rng.chance(0.5)) {
      bldgSlots.push({ x: cx, y: h + 1.5, z: cz, sx: w * 0.4, sy: 2.5, sz: d * 0.4, color: rng.pick(CONFIG.PALETTE.beach) });
    }
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    return { x: cx, z: cz, w, h, d };
  };

  const signs = []; // { text, x, y, z, rotY, w, h, color }
  for (const cx of CENTRES) {
    for (const cz of CENTRES) {
      const district = districtAt(cx, cz);
      const block = { cx, cz, district, buildings: [] };
      // Plaza blocks stay open (fountain + stalls go there instead).
      if ((cx === -24 || cx === 24) && cz === 24) { blocks.push(block); continue; }
      if (district === 'beach') {
        // Beachfront row: x=-162, varied width/depth/height, avenue clear.
        const w = rng.range(12, 16);
        const d = rng.range(18, 22);
        const h = rng.range(8, 14);
        block.buildings.push(addBuilding(-162, cz, w, h, d, CONFIG.PALETTE.beach));
        if (cz === -24) signs.push({ text: 'PIER 9', x: -154.5, y: 7, z: cz, rotY: Math.PI / 2, w: 12, h: 3, color: '#ff5a7a' });
      } else if (district === 'port') {
        // Containers, not buildings (see below).
        block.containers = true;
      } else if (district === 'downtown') {
        const w = rng.range(20, 26);
        const d = rng.range(20, 26);
        const h = rng.range(45, 70);
        block.buildings.push(addBuilding(cx, cz, w, h, d, CONFIG.PALETTE.tower));
        if (cx === 120 && cz === -144) signs.push({ text: 'SOLMAR', x: cx, y: 34, z: cz - d / 2 - 0.2, rotY: Math.PI, w: 16, h: 4, color: '#5ad8ff' });
        if (cx === 168 && cz === -120) signs.push({ text: 'HOTEL LUNA', x: cx + w / 2 + 0.2, y: 26, z: cz, rotY: Math.PI / 2, w: 16, h: 4, color: '#ffd23d' });
      } else if (district === 'barrios') {
        // Two low colourful houses per block.
        for (const off of [-8, 8]) {
          const w = rng.range(10, 14);
          const d = rng.range(10, 14);
          const h = rng.range(8, 12);
          block.buildings.push(addBuilding(cx + off, cz, w, h, d, CONFIG.PALETTE.buildingLow));
        }
      } else if (cx === -24 && cz === -24) {
        // Rosa's café block: one low building with the ROSA'S sign.
        block.buildings.push(addBuilding(cx, cz, 22, 10, 18, CONFIG.PALETTE.buildingLow));
        signs.push({ text: "ROSA'S", x: cx + 11.2, y: 6.5, z: cz, rotY: Math.PI / 2, w: 12, h: 3, color: '#ff8ab0' });
      } else if (cx === 24 && cz === -24) {
        // Market block: stalls + one low building.
        block.buildings.push(addBuilding(cx, cz, 18, 9, 14, CONFIG.PALETTE.buildingLow));
        signs.push({ text: 'TACOS', x: cx, y: 6, z: cz - 7.2, rotY: Math.PI, w: 10, h: 2.5, color: '#ffb03d' });
      } else {
        // Mid/low mix elsewhere.
        if (rng.chance(0.35)) {
          const w = rng.range(18, 24);
          const d = rng.range(18, 24);
          const h = rng.range(20, 35);
          block.buildings.push(addBuilding(cx, cz, w, h, d, CONFIG.PALETTE.buildingMid));
        } else {
          const w = rng.range(16, 24);
          const d = rng.range(16, 24);
          const h = rng.range(8, 15);
          block.buildings.push(addBuilding(cx, cz, w, h, d, CONFIG.PALETTE.buildingLow));
        }
      }
      blocks.push(block);
    }
  }
  const bldgMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bldgMat, bldgSlots.length);
  for (let i = 0; i < bldgSlots.length; i++) {
    const s = bldgSlots[i];
    euler.set(0, 0, 0);
    quat.setFromEuler(euler);
    mat4.compose(v3.set(s.x, s.y, s.z), quat, new THREE.Vector3(s.sx, s.sy, s.sz));
    bldgMesh.setMatrixAt(i, mat4);
    bldgMesh.setColorAt(i, col.setHex(s.color));
  }
  bldgMesh.castShadow = true;
  bldgMesh.receiveShadow = true;
  group.add(bldgMesh);

  // --- Neon signs ------------------------------------------------------------
  for (const s of signs) {
    const tex = makeSignTexture(s.text, s.color);
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true })
      : new THREE.MeshBasicMaterial({ color: new THREE.Color(s.color) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.rotY;
    group.add(mesh);
    signMeshes.push(mesh);
  }

  // --- Port containers + crane ------------------------------------------------
  const contColors = [0xd84a3a, 0x3a7ad8, 0x3aa84a, 0xd8a23a, 0x8a5ad8];
  const contSlots = [];
  for (const cx of [120, 168]) {
    for (const cz of [24, 72]) {
      for (let k = 0; k < 4; k++) {
        const horizontal = rng.chance(0.5);
        const ox = rng.range(-8, 8);
        const oz = rng.range(-8, 8);
        const w = horizontal ? 12 : 2.6;
        const d = horizontal ? 2.6 : 12;
        contSlots.push({ x: cx + ox, z: cz + oz, w, d, color: rng.pick(contColors), rotY: horizontal ? 0 : Math.PI / 2 });
        colliders.push({ minX: cx + ox - w / 2, maxX: cx + ox + w / 2, minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2 });
      }
    }
  }
  const contMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 }),
    contSlots.length,
  );
  for (let i = 0; i < contSlots.length; i++) {
    const s = contSlots[i];
    euler.set(0, s.rotY, 0);
    quat.setFromEuler(euler);
    mat4.compose(v3.set(s.x, 1.3, s.z), quat, new THREE.Vector3(s.w, 2.6, s.d));
    contMesh.setMatrixAt(i, mat4);
    contMesh.setColorAt(i, col.setHex(s.color));
  }
  contMesh.castShadow = true;
  group.add(contMesh);
  // Crane at the docks.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xd8a23a, roughness: 0.6, metalness: 0.4 });
  const craneTower = new THREE.Mesh(new THREE.BoxGeometry(3, 18, 3), craneMat);
  craneTower.position.set(168, 9, 48);
  craneTower.castShadow = true;
  group.add(craneTower);
  const craneJib = new THREE.Mesh(new THREE.BoxGeometry(22, 1.5, 1.5), craneMat);
  craneJib.position.set(160, 17, 48);
  group.add(craneJib);
  colliders.push({ minX: 166.5, maxX: 169.5, minZ: 46.5, maxZ: 49.5 });

  // --- Palms -------------------------------------------------------------------
  // Beachfront (in front of the row + on the sand), plaza, market. Four
  // beach palms have red/orange trunks (hero-shot dressing).
  const palmSpots = [];
  for (let z = -180; z <= 180; z += 24) {
    palmSpots.push({ x: -157, z, red: false });
    palmSpots.push({ x: -196, z: z + 12, red: z % 96 === 0 });
  }
  palmSpots.push({ x: -14, z: 4, red: false }, { x: 14, z: 4, red: false });
  palmSpots.push({ x: -14, z: 22, red: false }, { x: 14, z: 22, red: false });
  palmSpots.push({ x: -8, z: -44, red: false }, { x: 8, z: -44, red: false });
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.18, 0.3, 7, 6),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    palmSpots.length,
  );
  const crownMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.4, 2.6, 7),
    new THREE.MeshStandardMaterial({ color: 0x3a8a4a, roughness: 0.9, flatShading: true }),
    palmSpots.length,
  );
  for (let i = 0; i < palmSpots.length; i++) {
    const p = palmSpots[i];
    const lean = rng.range(-0.06, 0.06);
    euler.set(lean, 0, rng.range(-0.06, 0.06));
    quat.setFromEuler(euler);
    mat4.compose(v3.set(p.x, 3.5, p.z), quat, new THREE.Vector3(1, 1, 1));
    trunkMesh.setMatrixAt(i, mat4);
    trunkMesh.setColorAt(i, col.setHex(p.red ? 0xc85a3a : 0x8a6a4a));
    euler.set(0, rng.range(0, Math.PI * 2), 0);
    quat.setFromEuler(euler);
    mat4.compose(v3.set(p.x, 7.6, p.z), quat, new THREE.Vector3(1, 0.75, 1));
    crownMesh.setMatrixAt(i, mat4);
  }
  trunkMesh.castShadow = true;
  group.add(trunkMesh);
  group.add(crownMesh);

  // --- Streetlights ------------------------------------------------------------
  const lampSpots = [];
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      if ((sx + sz) % 96 === 0) lampSpots.push({ x: sx + 7, z: sz + 7 });
    }
  }
  const poleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.12, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3f, roughness: 0.6, metalness: 0.5 }),
    lampSpots.length,
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.25, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xffe8b0, emissive: 0xffc860, emissiveIntensity: 0.9 }),
    lampSpots.length,
  );
  for (let i = 0; i < lampSpots.length; i++) {
    const p = lampSpots[i];
    euler.set(0, 0, 0);
    quat.setFromEuler(euler);
    mat4.compose(v3.set(p.x, 3, p.z), quat, new THREE.Vector3(1, 1, 1));
    poleMesh.setMatrixAt(i, mat4);
    mat4.compose(v3.set(p.x, 6.1, p.z), quat, new THREE.Vector3(1, 1, 1));
    headMesh.setMatrixAt(i, mat4);
  }
  group.add(poleMesh);
  group.add(headMesh);

  // --- Traffic lights (render.js flips ns/ew lamps via nsGreen) ---------------
  const lampGeo = new THREE.BoxGeometry(0.5, 1.1, 0.5);
  for (const [lx, lz] of [[0, 0], [48, -48], [-48, 48], [96, 96], [-96, -96], [144, -144]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.5 }));
    pole.position.set(lx + 6.5, 2.7, lz + 6.5);
    group.add(pole);
    const ns = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x2aff5a }));
    ns.position.set(lx + 6.5, 5.6, lz + 6.5);
    group.add(ns);
    const ew = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    ew.position.set(lx + 6.5, 4.4, lz + 6.5);
    group.add(ew);
    lights.push({ x: lx, z: lz, ns, ew });
  }

  // --- Plaza: fountain + market stalls -----------------------------------------
  const fountain = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 0.8, 20),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }));
  basin.position.y = 0.4;
  fountain.add(basin);
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.6, 20),
    new THREE.MeshStandardMaterial({ color: 0x2a9ab8, roughness: 0.2, metalness: 0.3 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.72;
  fountain.add(water);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 }));
  column.position.y = 1.4;
  fountain.add(column);
  fountain.position.set(0, 0, 12);
  group.add(fountain);
  colliders.push({ minX: -4, maxX: 4, minZ: 8, maxZ: 16 });

  const stallColors = [0xe85a7a, 0x3a9ad8, 0x3aa84a, 0xd8a23a, 0x8a5ad8, 0xe87a3a];
  const stallSpots = [[-12, 24], [12, 24], [-20, 12], [20, 12], [-12, 36], [12, 36]];
  for (let i = 0; i < stallSpots.length; i++) {
    const [sx, sz] = stallSpots[i];
    const stall = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }));
    box.position.y = 0.8;
    stall.add(box);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.8),
      new THREE.MeshStandardMaterial({ color: stallColors[i], roughness: 0.8 }));
    awn.position.y = 1.9;
    stall.add(awn);
    stall.position.set(sx, 0, sz);
    group.add(stall);
    colliders.push({ minX: sx - 1.7, maxX: sx + 1.7, minZ: sz - 1.4, maxZ: sz + 1.4 });
  }

  // --- Pier (x -200..-216, z 43..53) + FLAMINGO FM billboard -------------------
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x9a7a5a, roughness: 0.9 });
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 10), pierMat);
  pierDeck.position.set(-208, 0.5, 48);
  group.add(pierDeck);
  for (let k = 0; k < 5; k++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 6), pierMat);
    post.position.set(-202 - k * 3.2, -0.5, 43.5);
    group.add(post);
    const post2 = post.clone();
    post2.position.z = 52.5;
    group.add(post2);
  }
  const bbTex = makeSignTexture('FLAMINGO FM', '#ff5ad8');
  const bbMat = bbTex
    ? new THREE.MeshBasicMaterial({ map: bbTex })
    : new THREE.MeshBasicMaterial({ color: 0xff5ad8 });
  const billboard = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), bbMat);
  billboard.position.set(-198, 8, 12);
  billboard.rotation.y = Math.PI / 2 + 0.6;
  group.add(billboard);
  const bbPost = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3f, roughness: 0.6, metalness: 0.5 }));
  bbPost.position.set(-199.5, 4, 12);
  group.add(bbPost);

  // --- Nav grid ------------------------------------------------------------------
  // buildCity builds the grid itself (autoDefault=false avoids a second
  // city build inside the NavGrid constructor).
  const navGrid = new NavGrid(4, null, false);
  navGrid.buildFromColliders(colliders);

  // --- Spawn points ---------------------------------------------------------------
  // Parked cars sit ON a street centreline and face ALONG that street, so
  // driving away never runs into a wall. (Curb-offset parking jammed the
  // orientation check: the spots must read as on-street, not off-street.)
  const parked = [
    { model: 'taxi', x: 30, z: 0, angle: Math.PI / 2 },
    { model: 'van', x: 0, z: 54, angle: 0 },
    { model: 'truck', x: 144, z: 30, angle: 0 },
    { model: 'sedan', x: 48, z: 30, angle: 0 },
    { model: 'sedan', x: 30, z: -48, angle: Math.PI / 2 },
    { model: 'sedan', x: -144, z: 30, angle: Math.PI },
    { model: 'sedan', x: -24, z: 0, angle: -Math.PI / 2 },
    { model: 'sedan', x: 96, z: -30, angle: Math.PI },
  ];

  return {
    group,
    streets: STREETS,
    centres: CENTRES,
    blocks,
    landmarks: LANDMARKS,
    spawnPoints: { player: { ...CONFIG.START.PLAYER_SPAWN }, parked },
    colliders,
    navGrid,
    lights,
    signMeshes,
    districtAt,
    isOnRoad,
  };
}
