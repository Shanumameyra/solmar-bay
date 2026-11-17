// SOLMAR BAY — the city. buildCity(seed) lays out the 8x8-block coastal city,
// builds its three.js visuals (InstancedMesh buildings/palms/props, one procedural
// ground texture), its building colliders and its A* nav grid for peds/police.
// Runs in the browser; in node (no document) canvas textures are skipped and
// plain colours are used, so the logic smoke test can still build the city.
import * as THREE from 'three';
import { CONFIG, LANDMARKS } from './config.js';
import { createRandom } from './random.js';

const HALF = CONFIG.CITY.HALF;
const STREETS = CONFIG.CITY.STREETS;
const CENTRES = CONFIG.CITY.CENTRES;
const PITCH = CONFIG.CITY.PITCH;
const BLOCK = CONFIG.CITY.BLOCK;
const STREET_W = CONFIG.CITY.STREET;

// ---------------------------------------------------------------------------
// NavGrid: A* over a 2 m grid. 8-way movement, a diagonal step is allowed only
// when both orthogonal neighbours are open (no corner cutting). Octile
// heuristic, so the estimate never overestimates the true cost.
// The open set is a binary heap — the search stays fast on a 200x200 grid.
// ---------------------------------------------------------------------------
export class NavGrid {
  constructor(min, max, cell = 2) {
    this.min = min;
    this.max = max;
    this.cell = cell;
    this.w = Math.round((max - min) / cell);
    this.h = Math.round((max - min) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
  }
  idx(cx, cz) { return cz * this.w + cx; }
  toCell(x, z) {
    return [
      Math.max(0, Math.min(this.w - 1, Math.floor((x - this.min) / this.cell))),
      Math.max(0, Math.min(this.h - 1, Math.floor((z - this.min) / this.cell))),
    ];
  }
  cellCenter(cx, cz) {
    return [this.min + (cx + 0.5) * this.cell, this.min + (cz + 0.5) * this.cell];
  }
  setBlockedWorld(x0, z0, x1, z1, v = 1) {
    const [a, b] = this.toCell(Math.min(x0, x1), Math.min(z0, z1));
    const [c, d] = this.toCell(Math.max(x0, x1), Math.max(z0, z1));
    for (let cz = b; cz <= d; cz += 1) {
      for (let cx = a; cx <= c; cx += 1) this.blocked[this.idx(cx, cz)] = v;
    }
  }
  isOpen(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h
      && this.blocked[this.idx(cx, cz)] === 0;
  }
  // World waypoints from (sx,sz) to (tx,tz), or null when unreachable.
  findPath(sx, sz, tx, tz) {
    const [scx, scz] = this.toCell(sx, sz);
    const [tcx, tcz] = this.toCell(tx, tz);
    if (!this.isOpen(tcx, tcz)) return null;
    if (scx === tcx && scz === tcz) return [[tx, tz]];
    const w = this.w;
    const key = (cx, cz) => cz * w + cx;
    const gScore = new Map([[key(scx, scz), 0]]);
    const came = new Map([[key(scx, scz), -1]]);
    const closed = new Set();
    const heap = []; // [f, cx, cz, g]
    const hOf = (cx, cz) => {
      const dx = Math.abs(cx - tcx), dz = Math.abs(cz - tcz);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    const push = (f, cx, cz, g) => {
      heap.push([f, cx, cz, g]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let s = i;
          if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
          if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
          if (s === i) break;
          const tmp = heap[s]; heap[s] = heap[i]; heap[i] = tmp; i = s;
        }
      }
      return top;
    };
    push(hOf(scx, scz), scx, scz, 0);
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (heap.length) {
      const [, cx, cz, g] = pop();
      const ck = key(cx, cz);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (cx === tcx && cz === tcz) {
        const cells = [];
        let k = ck;
        while (k !== -1) { cells.push([k % w, Math.floor(k / w)]); k = came.get(k); }
        cells.reverse();
        const pts = [];
        for (let i = 0; i < cells.length; i += 1) {
          if (i === 0 || i === cells.length - 1) {
            pts.push(this.cellCenter(cells[i][0], cells[i][1]));
            continue;
          }
          const [px, pz] = cells[i - 1];
          const [qx, qz] = cells[i];
          const [nx, nz] = cells[i + 1];
          if ((qx - px) === (nx - qx) && (qz - pz) === (nz - qz)) continue;
          pts.push(this.cellCenter(qx, qz));
        }
        pts[pts.length - 1] = [tx, tz];
        return pts;
      }
      for (const [dx, dz, step] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isOpen(nx, nz)) continue;
        if (dx !== 0 && dz !== 0
          && (!this.isOpen(cx + dx, cz) || !this.isOpen(cx, cz + dz))) continue;
        const ng = g + step;
        const nk = key(nx, nz);
        if (gScore.has(nk) && gScore.get(nk) <= ng) continue;
        gScore.set(nk, ng);
        came.set(nk, ck);
        push(ng + hOf(nx, nz), nx, nz, ng);
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Procedural canvas textures (browser only; skipped headless).
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// One 1024x1024 texture for the whole ground: asphalt, sidewalks, lane dashes,
// crosswalks, sand on the west edge, plaza paving in the centre.
function makeGroundTexture() {
  const c = makeCanvas(1024, 1024);
  if (!c) return null;
  const g = c.getContext('2d');
  const S = 1024 / (HALF * 2); // px per metre
  const toPx = (v) => (v + HALF) * S;
  // Base: asphalt (brightened for the golden-hour look, not near-black).
  g.fillStyle = '#45484f';
  g.fillRect(0, 0, 1024, 1024);
  // Sand strip on the west edge (x < -168).
  g.fillStyle = '#d9b380';
  g.fillRect(0, 0, toPx(-168), 1024);
  // Sea is a separate plane; the sand edge gets a wet band.
  g.fillStyle = '#c8a06a';
  g.fillRect(toPx(-176), 0, toPx(-168) - toPx(-176), 1024);
  // Plaza paving in the centre (|x|<=48, |z|<=48).
  g.fillStyle = '#b8a888';
  g.fillRect(toPx(-48), toPx(-48), toPx(48) - toPx(-48), toPx(48) - toPx(-48));
  // Sidewalks: lighter strips along every street.
  g.fillStyle = '#9a9184';
  for (const s of STREETS) {
    const w = (CONFIG.CITY.STREET / 2 + CONFIG.CITY.SIDEWALK) * S;
    const c0 = s * S;
    g.fillRect(0, toPx(s) - w, 1024, w * 2);
    g.fillRect(toPx(s) - w, 0, w * 2, 1024);
  }
  // Re-lay asphalt over the street centres so sidewalks read as edges.
  g.fillStyle = '#45484f';
  for (const s of STREETS) {
    const w = (CONFIG.CITY.STREET / 2) * S;
    g.fillRect(0, toPx(s) - w, 1024, w * 2);
    g.fillRect(toPx(s) - w, 0, w * 2, 1024);
  }
  // Lane dashes (centre of each street) + crosswalk stripes at intersections.
  g.fillStyle = '#e8e4d8';
  for (const s of STREETS) {
    for (let d = -192; d < 192; d += 16) {
      g.fillRect(toPx(d), toPx(s) - 1, 8 * S, 2);
      g.fillRect(toPx(s) - 1, toPx(d), 2, 8 * S);
    }
    for (const t of STREETS) {
      for (let k = -2; k <= 2; k += 1) {
        g.fillRect(toPx(t) - 5 + k * 4 * S * 0.5, toPx(s) - 7 * S, 2 * S, 3 * S);
        g.fillRect(toPx(t) - 5 + k * 4 * S * 0.5, toPx(s) + 4 * S, 2 * S, 3 * S);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Window grid texture for building facades (lit windows glow warm).
// The base is a LIGHT grey-blue: a dark navy base made every building read
// as a black slab with glowing windows, which is what made the city look
// gloomy even under a bright sun. The facade colour now comes through.
function makeWindowTexture(rows, cols, rng) {
  const c = makeCanvas(128, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#7a8a9a';
  g.fillRect(0, 0, 128, 256);
  const cw = 128 / cols, rh = 256 / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < cols; col += 1) {
      const lit = rng.next() < 0.42;
      g.fillStyle = lit ? (rng.next() < 0.5 ? '#ffd98a' : '#ffeec0') : '#5a6a7a';
      g.fillRect(col * cw + 3, r * rh + 4, cw - 6, rh - 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Neon sign texture: glowing original text on a dark plate.
function makeSignTexture(text, color, rng) {
  const c = makeCanvas(256, 64);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#101018';
  g.fillRect(0, 0, 256, 64);
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(text, 128, 34);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// District lookup (by block centre).
// ---------------------------------------------------------------------------
function districtOf(bx, bz) {
  const D = CONFIG.DISTRICTS;
  if (Math.abs(bx) <= D.PLAZA_R && Math.abs(bz) <= D.PLAZA_R) return 'plaza';
  if (bx <= D.BEACH_X) return 'beach';
  if (bx >= D.PORT_X) return 'port';
  if (bz >= D.BARRIOS_Z) return 'barrios';
  if (bx >= D.DOWNTOWN_X && bz <= D.DOWNTOWN_Z) return 'downtown';
  if (Math.abs(bx) <= 96 && Math.abs(bz) <= 96) return 'market';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// buildCity(seed)
// ---------------------------------------------------------------------------
export function buildCity(seed) {
  const rng = createRandom(seed);
  const group = new THREE.Group();
  group.name = 'solmar-bay-city';
  const colliders = [];
  const blocks = [];
  // Streetlights: { positions, poles, heads } — instanced (2 draw calls for
  // all 49 intersections instead of ~98); render.js tints the heads green/red
  // each frame via the shared nsGreen phase rule.
  const lights = { positions: [], poles: null, heads: null };

  // ---- Ground: one textured plane + sea to the west ----
  const groundTex = makeGroundTexture();
  const groundMat = groundTex
    ? new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: CONFIG.PALETTE.ASPHALT, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(120, HALF * 2 + 40),
    new THREE.MeshStandardMaterial({ color: CONFIG.PALETTE.SEA, roughness: 0.35, metalness: 0.1 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-HALF - 60, -0.15, 0);
  sea.name = 'sea';
  group.add(sea);

  // ---- Buildings: one InstancedMesh per height band ----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const winTex = makeWindowTexture(10, 6, rng);
  const bands = [
    { name: 'low', minH: 8, maxH: 15, colors: CONFIG.PALETTE.BUILDING_LOW },
    { name: 'mid', minH: 20, maxH: 35, colors: CONFIG.PALETTE.BUILDING_MID },
    { name: 'tower', minH: 45, maxH: 70, colors: CONFIG.PALETTE.BUILDING_TOWER },
  ];
  // First pass: decide every building (position/size/district) without drawing.
  const planned = [];
  for (const bx of CENTRES) {
    for (const bz of CENTRES) {
      const district = districtOf(bx, bz);
      if (district === 'plaza') continue; // open plaza, no buildings
      if (district === 'beach') continue; // sand + palms, buildings face the sea
      const isPort = district === 'port';
      const isDowntown = district === 'downtown';
      const isBarrios = district === 'barrios';
      // 1-3 buildings per block, inset from the block edge.
      const count = isPort ? 1 : (isDowntown ? 2 : (rng.int(2) + 1));
      for (let i = 0; i < count; i += 1) {
        const w = isPort ? 26 : rng.range(12, 22);
        const d = isPort ? 18 : rng.range(12, 22);
        const x = bx + rng.range(-(BLOCK / 2 - w / 2 - 2), BLOCK / 2 - w / 2 - 2);
        const z = bz + rng.range(-(BLOCK / 2 - d / 2 - 2), BLOCK / 2 - d / 2 - 2);
        const band = isDowntown ? 2 : (isBarrios ? 0 : (rng.chance(0.3) ? 1 : 0));
        const h = rng.range(bands[band].minH, bands[band].maxH);
        planned.push({ x, z, w, d, h, band, district });
        colliders.push({ minX: x - w / 2, minZ: z - d / 2, maxX: x + w / 2, maxZ: z + d / 2 });
      }
    }
  }
  // Beachfront row: low buildings facing the sea at x = -162 (west of the
  // beachfront avenue at x = -144 — the row must NOT block the street).
  for (let z = -168; z <= 168; z += 48) {
    const h = rng.range(8, 14);
    planned.push({ x: -162, z, w: 14, d: 20, h, band: 0, district: 'beach' });
    colliders.push({ minX: -169, minZ: z - 10, maxX: -155, maxZ: z + 10 });
  }
  const dummy = new THREE.Object3D();
  const colorObj = new THREE.Color();
  bands.forEach((band, bi) => {
    const list = planned.filter((b) => b.band === bi);
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({
      map: winTex, roughness: 0.85, metalness: 0.05,
    });
    const mesh = new THREE.InstancedMesh(boxGeo, mat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, colorObj.setHex(rng.pick(band.colors)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = `buildings-${band.name}`;
    group.add(mesh);
  });

  // ---- Neon signs on downtown towers (emissive planes, original text) ----
  const SIGNS = ["ROSA'S", 'PIER 9', 'SOLMAR', 'TACOS', 'HOTEL LUNA'];
  const signMeshes = [];
  planned.filter((b) => b.band === 2).slice(0, 5).forEach((b, i) => {
    const text = SIGNS[i % SIGNS.length];
    const tex = makeSignTexture(text, `#${CONFIG.PALETTE.NEON[i % 5].toString(16).padStart(6, '0')}`, rng);
    const mat = tex
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: false })
      : new THREE.MeshBasicMaterial({ color: CONFIG.PALETTE.NEON[i % 5] });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), mat);
    sign.position.set(b.x, b.h * 0.82, b.z - b.d / 2 - 0.15);
    sign.rotation.y = Math.PI;
    sign.name = `neon-${text}`;
    group.add(sign);
    signMeshes.push(sign);
  });

  // ---- Palms along the beachfront + plaza (instanced trunks + crowns) ----
  const palmSpots = [];
  for (let z = -180; z <= 180; z += 24) palmSpots.push({ x: -182 + rng.range(-3, 3), z });
  for (let i = 0; i < 8; i += 1) {
    palmSpots.push({ x: rng.range(-40, 40), z: rng.range(-40, 40) });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crownGeo = new THREE.ConeGeometry(2.2, 2.4, 7);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 1 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length);
  palmSpots.forEach((p, i) => {
    dummy.position.set(p.x, 2.5, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, rng.next() * Math.PI, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 5.6, p.z);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  trunks.name = 'palms-trunks';
  crowns.name = 'palms-crowns';
  group.add(trunks);
  group.add(crowns);

  // ---- Market plaza: stalls, café, benches, fountain ----
  const stallMat = new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.9 });
  const stallTopMat = new THREE.MeshStandardMaterial({ color: 0xff2d78, roughness: 0.8 });
  const stallGeo = new THREE.BoxGeometry(3, 2.2, 2);
  const stallTopGeo = new THREE.BoxGeometry(3.4, 0.25, 2.4);
  const stalls = new THREE.InstancedMesh(stallGeo, stallMat, 8);
  const stallTops = new THREE.InstancedMesh(stallTopGeo, stallTopMat, 8);
  const stallSpots = [
    [-30, -18], [-12, -30], [14, -28], [30, -14],
    [-28, 20], [-10, 30], [16, 28], [30, 16],
  ];
  stallSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 1.1, z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, rng.next() * Math.PI, 0);
    dummy.updateMatrix();
    stalls.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 2.3, z);
    dummy.updateMatrix();
    stallTops.setMatrixAt(i, dummy.matrix);
    colliders.push({ minX: x - 1.7, minZ: z - 1.2, maxX: x + 1.7, maxZ: z + 1.2 });
  });
  stalls.instanceMatrix.needsUpdate = true;
  stallTops.instanceMatrix.needsUpdate = true;
  stalls.castShadow = true;
  stalls.name = 'market-stalls';
  group.add(stalls);
  group.add(stallTops);
  // Rosa's café: a low building at the plaza's north edge.
  const cafe = new THREE.Mesh(
    new THREE.BoxGeometry(16, 6, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8b4a0, roughness: 0.85, map: winTex }),
  );
  cafe.position.set(0, 3, -44);
  cafe.castShadow = true;
  cafe.receiveShadow = true;
  cafe.name = 'cafe-rosas';
  group.add(cafe);
  colliders.push({ minX: -8, minZ: -49, maxX: 8, maxZ: -39 });
  // Fountain at the plaza centre.
  const fountain = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4.4, 0.9, 20),
    new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.6 }),
  );
  fountain.position.set(0, 0.45, 0);
  fountain.name = 'fountain';
  group.add(fountain);
  colliders.push({ minX: -4.4, minZ: -4.4, maxX: 4.4, maxZ: 4.4 });

  // ---- Port: containers + cranes (east edge) ----
  const contColors = [0xc8552e, 0x2e7ac8, 0x3a9a5a, 0xc8a02e, 0x8a5a9a];
  const contGeo = new THREE.BoxGeometry(6, 2.6, 2.6);
  const contSpots = [];
  for (let z = -144; z <= 144; z += 24) {
    for (let x = 150; x <= 180; x += 14) {
      if (rng.chance(0.55)) contSpots.push({ x, z: z + rng.range(-4, 4) });
    }
  }
  const contMesh = new THREE.InstancedMesh(
    contGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    Math.max(1, contSpots.length),
  );
  contSpots.forEach((p, i) => {
    dummy.position.set(p.x, 1.3, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, rng.next() < 0.5 ? 0 : Math.PI / 2, 0);
    dummy.updateMatrix();
    contMesh.setMatrixAt(i, dummy.matrix);
    contMesh.setColorAt(i, colorObj.setHex(rng.pick(contColors)));
    colliders.push({ minX: p.x - 3.2, minZ: p.z - 3.2, maxX: p.x + 3.2, maxZ: p.z + 3.2 });
  });
  contMesh.instanceMatrix.needsUpdate = true;
  if (contMesh.instanceColor) contMesh.instanceColor.needsUpdate = true;
  contMesh.castShadow = true;
  contMesh.name = 'port-containers';
  group.add(contMesh);
  // Two cranes: tower + jib.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xd8b13a, roughness: 0.7 });
  [[168, -96], [168, 96]].forEach(([x, z]) => {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 26, 2), craneMat);
    tower.position.set(x, 13, z);
    tower.castShadow = true;
    group.add(tower);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 1.2), craneMat);
    jib.position.set(x - 8, 25, z);
    group.add(jib);
    colliders.push({ minX: x - 1.2, minZ: z - 1.2, maxX: x + 1.2, maxZ: z + 1.2 });
  });

  // ---- Pier (west, over the sea) ----
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 8), pierMat);
  pier.position.set(-212, 0.4, 48);
  pier.receiveShadow = true;
  pier.name = 'pier';
  group.add(pier);
  // Pier posts.
  const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 3, 6);
  const posts = new THREE.InstancedMesh(postGeo, pierMat, 8);
  for (let i = 0; i < 8; i += 1) {
    dummy.position.set(-222 + (i % 4) * 7, -0.8, 44 + Math.floor(i / 4) * 8);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  // ---- Streetlights at intersections (instanced; heads tinted by render.js) ----
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      if (Math.abs(sx) > 168 || Math.abs(sz) > 168) continue;
      lights.positions.push({ x: sx, z: sz });
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.5, 6);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lights.positions.length);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const heads = new THREE.InstancedMesh(headGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff }), lights.positions.length);
  lights.positions.forEach((p, i) => {
    dummy.position.set(p.x + 7, 2.75, p.z + 7);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x + 7, 5.6, p.z + 7);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, colorObj.setHex(0x39ff88));
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  poles.name = 'light-poles';
  heads.name = 'light-heads';
  group.add(poles);
  group.add(heads);
  lights.poles = poles;
  lights.heads = heads;

  // ---- Nav grid: block every cell a building collider covers ----
  const navGrid = new NavGrid(-HALF, HALF, 2);
  for (const c of colliders) navGrid.setBlockedWorld(c.minX, c.minZ, c.maxX, c.maxZ);

  // ---- Landmarks (also written into the shared LANDMARKS object) ----
  // Every landmark sits on a street centreline or in the open plaza — never
  // inside a building collider — so missions (radius 7 m) and the A* grid
  // can always reach them.
  const landmarks = {
    cafe: { x: 0, z: -36 },
    docks: { x: 144, z: 48 },
    garage: { x: -24, z: 144 },
    safehouse: { x: -120, z: 144 },
    hospital: { x: 144, z: -72 },
    precinct: { x: 72, z: 144 },
    gunshop: { x: -72, z: 96 },
    beachCar: { x: -176, z: -72 },
    beach: { x: -156, z: 0 },
    downtown: { x: 120, z: -144 },
    plaza: { x: 0, z: 12 },
    pier: { x: -210, z: 48 },
    market: { x: 0, z: 24 },
  };
  Object.assign(LANDMARKS, landmarks);

  // ---- Spawn points ----
  const spawnPoints = {
    player: { ...CONFIG.START.PLAYER_SPAWN },
    // 8 parked (stealable) cars, on streets near the plaza / beachfront.
    // angle uses the shared convention: forward = (sin angle, cos angle).
    parked: [
      // Parked cars sit ON a street centreline and face ALONG that street,
      // so stealing one and driving straight ahead never stalls it against
      // a wall. (The taxi used to face north into a market stall; the van
      // east into a narrow gap between buildings; the truck sat inside a
      // port block, off any street.)
      { model: 'sedan', x: -24, z: 0, angle: -Math.PI / 2 },
      { model: 'taxi', x: 30, z: 0, angle: Math.PI / 2 },
      { model: 'van', x: 0, z: 54, angle: 0 },
      { model: 'sedan', x: 48, z: 30, angle: 0 },
      { model: 'sports', x: -176, z: -72, angle: 0 }, // M2 target (yellow)
      { model: 'sedan', x: -144, z: 30, angle: Math.PI },
      { model: 'truck', x: 144, z: -30, angle: 0 },
      { model: 'sedan', x: 30, z: -48, angle: Math.PI / 2 },
    ],
  };

  return {
    group,
    seed,
    streets: STREETS.slice(),
    centres: CENTRES.slice(),
    blocks,
    landmarks,
    spawnPoints,
    colliders,
    navGrid,
    lights,
    signMeshes,
    // ---- Queries ----
    districtAt(x, z) {
      const bx = CENTRES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
      const bz = CENTRES.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
      return districtOf(bx, bz);
    },
    isOnRoad(x, z) {
      const near = (v) => STREETS.some((s) => Math.abs(v - s) <= STREET_W / 2);
      return near(x) || near(z);
    },
  };
}

// Push a circle (x, z, radius r) out of every building/prop AABB it overlaps.
// Colliders use {minX, maxX, minZ, maxZ} (shared with police.js + minimap.js).
// Returns a fresh {x, z}; the input is not mutated.
export function collideCircle(city, x, z, r) {
  let nx = x, nz = z;
  for (const c of city.colliders) {
    if (nx + r <= c.minX || nx - r >= c.maxX || nz + r <= c.minZ || nz - r >= c.maxZ) continue;
    const pushL = (nx + r) - c.minX;
    const pushR = c.maxX - (nx - r);
    const pushT = (nz + r) - c.minZ;
    const pushB = c.maxZ - (nz - r);
    const m = Math.min(pushL, pushR, pushT, pushB);
    if (m === pushL) nx = c.minX - r;
    else if (m === pushR) nx = c.maxX + r;
    else if (m === pushT) nz = c.minZ - r;
    else nz = c.maxZ + r;
  }
  // Clamp to the city bounds.
  nx = Math.max(-HALF + r, Math.min(HALF - r, nx));
  nz = Math.max(-HALF + r, Math.min(HALF - r, nz));
  return { x: nx, z: nz };
}

// True when the circle overlaps any building/prop AABB.
export function hitsCollider(city, x, z, r) {
  for (const c of city.colliders) {
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
  }
  return false;
}
