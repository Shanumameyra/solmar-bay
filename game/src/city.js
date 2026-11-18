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

// One 2048x2048 texture for the whole ground: asphalt, sidewalks, lane
// dashes, crosswalks, sand on the west edge, plaza paving in the centre.
// HD: 2048 (5.1 px/m) so lane markings and curbs stay crisp instead of
// blurry. Wet-look support: asphalt speckle (a separate seeded rng, so the
// layout rng is untouched), darker tire-wear bands along the street centres
// and curb lines, so the boulevard reads as a real damp street at sunset.
function makeGroundTexture() {
  const SIZE = 2048;
  const c = makeCanvas(SIZE, SIZE);
  if (!c) return null;
  const g = c.getContext('2d');
  const S = SIZE / (HALF * 2); // px per metre
  const toPx = (v) => (v + HALF) * S;
  // Base: asphalt (warm dark, not near-black).
  g.fillStyle = '#4a4448';
  g.fillRect(0, 0, SIZE, SIZE);
  // Asphalt speckle (fixed seed — does not consume the layout rng).
  const srng = createRandom(1234);
  for (let i = 0; i < 900; i += 1) {
    const v = srng.next();
    g.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
    g.fillRect(srng.next() * SIZE, srng.next() * SIZE, 4, 4);
  }
  // Sand strip on the west edge (x < -168).
  g.fillStyle = '#e0a878';
  g.fillRect(0, 0, toPx(-168), SIZE);
  // Sea is a separate plane; the sand edge gets a wet band.
  g.fillStyle = '#c8a06a';
  g.fillRect(toPx(-176), 0, toPx(-168) - toPx(-176), SIZE);
  // Plaza paving in the centre (|x|<=48, |z|<=48) + paving joints.
  g.fillStyle = '#b8a888';
  g.fillRect(toPx(-48), toPx(-48), toPx(48) - toPx(-48), toPx(48) - toPx(-48));
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 2;
  for (let d = -48; d <= 48; d += 8) {
    g.beginPath(); g.moveTo(toPx(d), toPx(-48)); g.lineTo(toPx(d), toPx(48)); g.stroke();
    g.beginPath(); g.moveTo(toPx(-48), toPx(d)); g.lineTo(toPx(48), toPx(d)); g.stroke();
  }
  // Sidewalks: lighter strips along every street.
  g.fillStyle = '#a89888';
  for (const s of STREETS) {
    const w = (CONFIG.CITY.STREET / 2 + CONFIG.CITY.SIDEWALK) * S;
    const c0 = s * S;
    g.fillRect(0, toPx(s) - w, SIZE, w * 2);
    g.fillRect(toPx(s) - w, 0, w * 2, SIZE);
  }
  // Re-lay asphalt over the street centres so sidewalks read as edges.
  g.fillStyle = '#4a4448';
  for (const s of STREETS) {
    const w = (CONFIG.CITY.STREET / 2) * S;
    g.fillRect(0, toPx(s) - w, SIZE, w * 2);
    g.fillRect(toPx(s) - w, 0, w * 2, SIZE);
  }
  // Curb lines: a thin light edge where sidewalk meets road.
  g.fillStyle = 'rgba(232,228,216,0.5)';
  for (const s of STREETS) {
    const e = (CONFIG.CITY.STREET / 2) * S;
    g.fillRect(0, toPx(s) - e - 2, SIZE, 4);
    g.fillRect(0, toPx(s) + e - 2, SIZE, 4);
    g.fillRect(toPx(s) - e - 2, 0, 4, SIZE);
    g.fillRect(toPx(s) + e - 2, 0, 4, SIZE);
  }
  // Tire-wear bands: darker strips where wheels actually run.
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (const s of STREETS) {
    for (const off of [-2.2, 2.2]) {
      g.fillRect(0, toPx(s + off) - 1.4 * S, SIZE, 2.8 * S);
      g.fillRect(toPx(s + off) - 1.4 * S, 0, 2.8 * S, SIZE);
    }
  }
  // Lane dashes (centre of each street) + crosswalk stripes at intersections.
  // The beach boulevard (s = -192) has NO white centre dashes — instead it
  // carries DOUBLE YELLOW lines, left of the hero car, like the #1 entry.
  g.fillStyle = '#e8e4d8';
  for (const s of STREETS) {
    if (s !== -192) {
      for (let d = -192; d < 192; d += 16) {
        g.fillRect(toPx(d), toPx(s) - 2, 8 * S, 4);
        g.fillRect(toPx(s) - 2, toPx(d), 4, 8 * S);
      }
    }
    for (const t of STREETS) {
      for (let k = -2; k <= 2; k += 1) {
        g.fillRect(toPx(t) - 10 + k * 4 * S * 0.5, toPx(s) - 7 * S, 2 * S, 3 * S);
        g.fillRect(toPx(t) - 10 + k * 4 * S * 0.5, toPx(s) + 4 * S, 2 * S, 3 * S);
      }
    }
  }
  // Double yellow centre lines on the beach boulevard (x = -193.2 / -191.2).
  g.fillStyle = '#ffd23d';
  for (const off of [-1.2, 0.8]) {
    g.fillRect(toPx(-192 + off) - 1.5, 0, 3, SIZE);
  }
  // Wet-road reflections (painted into the texture — the street is static):
  // a warm sun streak down the beach boulevard, brightest at the south
  // end (toward the sun at z=+700) and fading north, so the wet asphalt
  // carries the sunset pink/orange like the reference's wet boulevard.
  const streak = g.createLinearGradient(0, toPx(30), 0, toPx(200));
  streak.addColorStop(0, 'rgba(255,120,110,0)');
  streak.addColorStop(0.55, 'rgba(255,140,90,0.18)');
  streak.addColorStop(1, 'rgba(255,160,90,0.42)');
  g.fillStyle = streak;
  g.fillRect(toPx(-195.5), toPx(30), toPx(-188.5) - toPx(-195.5), toPx(200) - toPx(30));
  // Brighter core of the streak (the sun's direct reflection).
  const core = g.createLinearGradient(0, toPx(60), 0, toPx(200));
  core.addColorStop(0, 'rgba(255,190,130,0)');
  core.addColorStop(1, 'rgba(255,200,140,0.5)');
  g.fillStyle = core;
  g.fillRect(toPx(-193.2), toPx(60), toPx(-190.8) - toPx(-193.2), toPx(200) - toPx(60));
  // Pink reflection of the FLAMINGO FM billboard on the wet road edge.
  const bbGlow = g.createRadialGradient(toPx(-198), toPx(15), 0, toPx(-198), toPx(15), 12 * S);
  bbGlow.addColorStop(0, 'rgba(255,90,168,0.30)');
  bbGlow.addColorStop(1, 'rgba(255,90,168,0)');
  g.fillStyle = bbGlow;
  g.fillRect(toPx(-210), toPx(3), 24 * S, 24 * S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Window grid texture for building facades (HD: 256x512): a warm gradient
// base, floor slab lines, framed windows in varied states (lit warm / lit
// cool / curtains / dark glass with a sunset sheen), and a ground-floor
// shopfront band (the canvas bottom = the building's ground floor). The
// facade colour now comes through the instance colour; the texture only
// adds the detail.
function makeWindowTexture(rows, cols, rng) {
  const W = 256, H = 512;
  const c = makeCanvas(W, H);
  if (!c) return null;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, H);
  // Light grey-blue base: the facade colour comes through the instance
  // colour, so a dark base would mute the peach/salmon pastels to brown.
  base.addColorStop(0, '#c8ccd2');
  base.addColorStop(0.5, '#bcc2ca');
  base.addColorStop(1, '#aab2bc');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r += 1) {
    // Floor slab line.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, r * rh, W, 4);
    for (let col = 0; col < cols; col += 1) {
      const x = col * cw + 6, y = r * rh + 8, w = cw - 12, h = rh - 16;
      // Window frame.
      g.fillStyle = '#3a4552';
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
      const roll = rng.next();
      if (roll < 0.48) {
        // Lit warm (sunset lamps) — most windows glow at dusk.
        g.fillStyle = rng.next() < 0.6 ? '#ffd98a' : '#ffeec0';
        g.fillRect(x, y, w, h);
      } else if (roll < 0.56) {
        // Lit cool.
        g.fillStyle = '#bfe0ff';
        g.fillRect(x, y, w, h);
      } else if (roll < 0.64) {
        // Curtains.
        g.fillStyle = '#d8a0a0';
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + w * 0.45, y, w * 0.1, h);
      } else {
        // Dark glass with a sunset sheen diagonal.
        g.fillStyle = '#4a5a6e';
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,180,120,0.35)';
        g.beginPath();
        g.moveTo(x, y + h);
        g.lineTo(x + w * 0.6, y);
        g.lineTo(x + w * 0.85, y);
        g.lineTo(x + w * 0.25, y + h);
        g.closePath();
        g.fill();
      }
    }
  }
  // Ground-floor shopfront (canvas bottom = ground floor): PINK plate,
  // warm awning strip, large glass panes — the #1 entry's pink ground
  // floors, not a dark slab.
  const shopY = H - rh;
  g.fillStyle = '#e85a7a';
  g.fillRect(0, shopY, W, rh);
  g.fillStyle = '#ffb36b';
  g.fillRect(0, shopY, W, 10);
  for (let col = 0; col < cols; col += 1) {
    g.fillStyle = rng.next() < 0.5 ? '#ffd98a' : '#5a6a7a';
    g.fillRect(col * cw + 6, shopY + 16, cw - 12, rh - 24);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Sea texture (HD: 512x512): bright TURQUOISE tropical water — teal near
// shore to deeper blue-green offshore — with white wave streaks and a warm
// sunset glint band on the west (sun) side. A dusky violet sea read as
// murk; the reference water is bright turquoise.
function makeSeaTexture() {
  const SIZE = 512;
  const c = makeCanvas(SIZE, SIZE);
  if (!c) return null;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, SIZE, 0);
  grad.addColorStop(0, '#0a5a7a');
  grad.addColorStop(0.5, '#127a9c');
  grad.addColorStop(1, '#1f96b0');
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);
  const srng = createRandom(777);
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 2;
  for (let i = 0; i < 40; i += 1) {
    const y = srng.next() * SIZE;
    const x = srng.next() * (SIZE - 100);
    const len = 40 + srng.next() * 100;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y);
    g.stroke();
  }
  const glint = g.createLinearGradient(0, 0, SIZE, 0);
  glint.addColorStop(0, 'rgba(255,170,90,0.10)');
  glint.addColorStop(0.4, 'rgba(255,170,90,0.03)');
  glint.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Neon sign texture (HD: 512x128): glowing original text on a dark plate.
function makeSignTexture(text, color, rng) {
  const c = makeCanvas(512, 128);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#101018';
  g.fillRect(0, 0, 512, 128);
  g.font = 'bold 68px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 32;
  g.fillStyle = color;
  g.fillText(text, 256, 68);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(text, 256, 68);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
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
  // Wet boulevard: low roughness + higher metalness/envMapIntensity so
  // the asphalt reads as rain-slicked — it mirrors the pink/orange sunset
  // env map instead of a flat matte grey (the reference's wet street).
  const groundTex = makeGroundTexture();
  const groundMat = groundTex
    ? new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.18, metalness: 0.45, envMapIntensity: 0.8 })
    : new THREE.MeshStandardMaterial({ color: CONFIG.PALETTE.ASPHALT, roughness: 0.18, metalness: 0.45 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);
  // Wet-look sea: low roughness so the sun glints across the water, but
  // low metalness / envMapIntensity so the blue base stays blue instead
  // of mirroring the orange sunset env map (at 0.9 it read as orange
  // sand, not water). envMapIntensity 0.1 (was 0.2): the sea must read
  // as turquoise water at sunset, not a washed-out white band.
  const seaTex = makeSeaTexture();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(120, HALF * 2 + 40),
    seaTex
      ? new THREE.MeshStandardMaterial({ map: seaTex, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.1, fog: false })
      : new THREE.MeshStandardMaterial({ color: CONFIG.PALETTE.SEA, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.1, fog: false }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-HALF - 60, -0.15, 0);
  sea.name = 'sea';
  group.add(sea);
  // Surf foam: a white, wavy strip where the waves break on the shore
  // (x=-200). A canvas texture with soft white blobs on transparency,
  // tiled along the beach, so the waterline reads as breaking surf and
  // the sea does not meet the sand as a hard flat edge.
  const foamTex = (() => {
    const c = makeCanvas(128, 512);
    if (!c) return null;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 512);
    const frng = createRandom(4242);
    for (let i = 0; i < 90; i += 1) {
      const x = frng.next() * 128;
      const y = frng.next() * 512;
      const r = 4 + frng.next() * 14;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    return tex;
  })();
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(4, HALF * 2 + 40),
    new THREE.MeshBasicMaterial({
      map: foamTex, transparent: true, opacity: 0.85, depthWrite: false,
    }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(-HALF - 0.5, -0.08, 0);
  foam.name = 'surf-foam';
  group.add(foam);

  // ---- Buildings: one InstancedMesh per height band ----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const winTex = makeWindowTexture(10, 6, rng);
  const winTexTall = makeWindowTexture(16, 6, rng);
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
    const w = rng.range(12, 16);
    const d = rng.range(18, 22);
    planned.push({ x: -162, z, w, d, h, band: 0, district: 'beach' });
    colliders.push({ minX: -162 - w / 2, minZ: z - d / 2, maxX: -162 + w / 2, maxZ: z + d / 2 });
  }
  const dummy = new THREE.Object3D();
  const colorObj = new THREE.Color();
  bands.forEach((band, bi) => {
    const list = planned.filter((b) => b.band === bi);
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({
      map: band.name === 'tower' ? winTexTall : winTex, roughness: 0.85, metalness: 0.05,
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
      // Beachfront row: peach/salmon palette (the #1 entry's buildings on
      // the left), not the generic low-band pastels.
      const palette = b.district === 'beach' ? CONFIG.PALETTE.BUILDING_BEACH : band.colors;
      mesh.setColorAt(i, colorObj.setHex(rng.pick(palette)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = `buildings-${band.name}`;
    group.add(mesh);
  });

  // Roof caps: thin dark slabs on every building top, so the roof reads as
  // a roof (not a stretched window texture) from the chase camera.
  const roofMesh = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: CONFIG.PALETTE.ROOF, roughness: 0.9 }), planned.length);
  planned.forEach((b, i) => {
    dummy.position.set(b.x, b.h + 0.25, b.z);
    dummy.scale.set(b.w * 1.02, 0.5, b.d * 1.02);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    roofMesh.setMatrixAt(i, dummy.matrix);
  });
  roofMesh.instanceMatrix.needsUpdate = true;
  roofMesh.name = 'roof-caps';
  group.add(roofMesh);

  // ---- Balconies + awnings on the beachfront row (x=-162) ----
  // The colourful beachfront facades face the sea (west). Balconies
  // (slabs + railings) on the upper floors and sloped, colourful awnings
  // over the ground-floor shopfronts break the flat "box with a window
  // grid" read — the reference facades are layered, not flat.
  const beachRow = planned.filter((b) => b.district === 'beach');
  const AWNING_COLORS = [0xff5a8a, 0xff8a3d, 0x2ab8a0, 0xffd23d, 0xe85a7a];
  const balconySpots = [];
  const awningSpots = [];
  beachRow.forEach((b, bi) => {
    const floors = Math.max(1, Math.floor(b.h / 4.5));
    for (let f = 1; f < floors; f += 1) {
      // A balcony on BOTH ends of the facade per floor, not one side
      // only — the reference facades are layered on every floor.
      balconySpots.push({ x: b.x - b.w / 2 - 0.5, y: f * 4.2 + 0.6, z: b.z - 4.5 });
      balconySpots.push({ x: b.x - b.w / 2 - 0.5, y: f * 4.2 + 0.6, z: b.z + 4.5 });
    }
    awningSpots.push({ x: b.x - b.w / 2 - 0.6, y: 3.4, z: b.z - 4.5, color: AWNING_COLORS[bi % AWNING_COLORS.length] });
    awningSpots.push({ x: b.x - b.w / 2 - 0.6, y: 3.4, z: b.z + 4.5, color: AWNING_COLORS[(bi + 2) % AWNING_COLORS.length] });
  });
  const balconySlab = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.9 }), Math.max(1, balconySpots.length));
  const balconyRail = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.4 }), Math.max(1, balconySpots.length));
  balconySpots.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(1.0, 0.18, 2.6);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    balconySlab.setMatrixAt(i, dummy.matrix);
    dummy.position.set(s.x - 0.5, s.y + 0.55, s.z);
    dummy.scale.set(0.06, 1.0, 2.6);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    balconyRail.setMatrixAt(i, dummy.matrix);
  });
  balconySlab.instanceMatrix.needsUpdate = true;
  balconyRail.instanceMatrix.needsUpdate = true;
  balconySlab.name = 'balconies';
  balconyRail.name = 'balcony-rails';
  group.add(balconySlab);
  group.add(balconyRail);

  // Cornices + rooftop penthouses on the beachfront row: a thin light
  // band at the top of each facade (a clear roofline) and a small
  // rooftop box on every other building, so the row's silhouette varies
  // instead of reading as eight identical boxes.
  const corniceMesh = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0xf5ead8, roughness: 0.9 }), beachRow.length);
  beachRow.forEach((b, i) => {
    dummy.position.set(b.x, b.h - 0.15, b.z);
    dummy.scale.set(b.w + 0.3, 0.25, b.d + 0.3);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    corniceMesh.setMatrixAt(i, dummy.matrix);
  });
  corniceMesh.instanceMatrix.needsUpdate = true;
  corniceMesh.name = 'cornices';
  group.add(corniceMesh);
  const penthouseRow = beachRow.filter((b, bi) => bi % 2 === 0);
  const penthouseMesh = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.9 }), Math.max(1, penthouseRow.length));
  penthouseRow.forEach((b, i) => {
    dummy.position.set(b.x, b.h + 1.0, b.z);
    dummy.scale.set(b.w * 0.45, 2.0, b.d * 0.45);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    penthouseMesh.setMatrixAt(i, dummy.matrix);
    penthouseMesh.setColorAt(i, colorObj.setHex(
      CONFIG.PALETTE.BUILDING_BEACH[i % CONFIG.PALETTE.BUILDING_BEACH.length]));
  });
  penthouseMesh.instanceMatrix.needsUpdate = true;
  if (penthouseMesh.instanceColor) penthouseMesh.instanceColor.needsUpdate = true;
  penthouseMesh.name = 'penthouses';
  group.add(penthouseMesh);
  const awningMesh = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85 }), Math.max(1, awningSpots.length));
  awningSpots.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(1.2, 0.08, 2.8);
    dummy.rotation.set(0.55, 0, 0);
    dummy.updateMatrix();
    awningMesh.setMatrixAt(i, dummy.matrix);
    awningMesh.setColorAt(i, colorObj.setHex(s.color));
  });
  awningMesh.instanceMatrix.needsUpdate = true;
  if (awningMesh.instanceColor) awningMesh.instanceColor.needsUpdate = true;
  awningMesh.name = 'awnings';
  group.add(awningMesh);

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

  // ---- "VALE" sign on the beachfront (teal, the #1 entry's landmark) ----
  // On the beach building at z=-24, west face (toward the boulevard) —
  // the hero shot drives south past it on the left, above the balconies.
  const valeB = beachRow.find((b) => b.z === -24);
  if (valeB) {
    const valeTex = makeSignTexture('VALE', '#2dd4bf', rng);
    const valeMat = valeTex
      ? new THREE.MeshBasicMaterial({ map: valeTex, transparent: false })
      : new THREE.MeshBasicMaterial({ color: 0x2dd4bf });
    const vale = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), valeMat);
    vale.position.set(valeB.x - valeB.w / 2 - 0.15, valeB.h * 0.82, valeB.z);
    vale.rotation.y = -Math.PI / 2; // face west, toward the boulevard
    vale.name = 'sign-vale';
    group.add(vale);
  }

  // ---- FLAMINGO FM billboard on the beach (the #1 entry's landmark) ----
  // A big pink billboard on the sand, facing the boulevard — the hero shot
  // drives south past it on the right, red palm trunks cutting its text.
  function makeBillboardTexture() {
    const c = makeCanvas(512, 256);
    if (!c) return null;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#ff5aa8');
    grad.addColorStop(1, '#ff2d78');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#ffd23d';
    g.beginPath(); g.arc(256, 62, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = '900 58px sans-serif';
    g.textAlign = 'center';
    g.fillText('FLAMINGO', 256, 158);
    g.fillStyle = '#ffe9a8';
    g.font = '900 84px sans-serif';
    g.fillText('FM', 256, 240);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
  const bbTex = makeBillboardTexture();
  const bbMat = bbTex
    ? new THREE.MeshBasicMaterial({ map: bbTex })
    : new THREE.MeshBasicMaterial({ color: 0xff2d78 });
  const billboard = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), bbMat);
  // Angled ~35° toward the oncoming (southbound) traffic — a billboard
  // facing due east is edge-on from the chase cam (which sits north of
  // it), so its face must turn north-east for the text to read.
  billboard.position.set(-198, 6.5, 15);
  billboard.rotation.y = Math.PI / 2 + 0.6;
  billboard.name = 'flamingo-fm-billboard';
  group.add(billboard);
  const bbPostMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 });
  // Posts under the board, inset along its (rotated) width direction.
  const bbWdx = Math.cos(Math.PI / 2 + 0.6), bbWdz = -Math.sin(Math.PI / 2 + 0.6);
  for (const s of [-5.5, 5.5]) {
    const post = new THREE.Mesh(boxGeo, bbPostMat);
    post.scale.set(0.5, 6.5, 0.5);
    post.position.set(-198 + s * bbWdx, 3.25, 15 + s * bbWdz);
    group.add(post);
  }
  colliders.push({ minX: -203, minZ: 7, maxX: -193, maxZ: 23 });

  // ---- Palms along the beachfront + plaza (curved trunks + fronds) ----
  // A palm is a gently leaning curved trunk (TubeGeometry, not a straight
  // 6-sided cylinder) topped by DROOPING fronds — tapered, curved leaves
  // radiating from the crown — not a green cone or a faceted blob.
  const palmSpots = [];
  for (let z = -180; z <= 180; z += 24) palmSpots.push({ x: -182 + rng.range(-3, 3), z });
  for (let i = 0; i < 8; i += 1) {
    palmSpots.push({ x: rng.range(-40, 40), z: rng.range(-40, 40) });
  }
  // Red/orange-trunked palms on the beach (the #1 entry's row on the
  // right): their trunks cut across the FLAMINGO FM billboard, so its
  // text reads partially obscured ("FLA...N...O FM").
  for (const [x, z] of [[-198, 30], [-196, 12], [-199, -6], [-197, -24]]) {
    palmSpots.push({ x, z, red: true });
  }
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.22, 1.6, 0),
    new THREE.Vector3(0.38, 3.2, 0),
    new THREE.Vector3(0.42, 4.8, 0),
  ]);
  const trunkGeo = new THREE.TubeGeometry(trunkCurve, 8, 0.22, 8, false);
  // White base: the per-instance colour (brown, or red/orange for the
  // beach row) carries the trunk colour.
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  // One drooping frond: a tapered plane, curved down toward the tip.
  function makeFrondGeo() {
    const g = new THREE.PlaneGeometry(0.95, 2.8, 1, 6);
    g.rotateX(-Math.PI / 2); // lie flat, length along +Z
    g.translate(0, 0, 1.4);  // base at z=0, tip at z=2.8
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setX(i, x * (1 - (z / 2.8) * 0.75)); // taper to a point
      pos.setY(i, -(z * z) * 0.16);             // droop (parabolic)
    }
    g.computeVertexNormals();
    return g;
  }
  const FRONDS_PER_PALM = 9;
  const frondGeo = makeFrondGeo();
  const frondMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
  });
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmSpots.length * FRONDS_PER_PALM);
  // Crown core: a small flattened sphere filling the centre where the
  // fronds meet (so the top is not a hollow starburst).
  const crownGeo = new THREE.IcosahedronGeometry(0.85, 1);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length);
  const frondDummy = new THREE.Object3D();
  frondDummy.rotation.order = 'YXZ';
  palmSpots.forEach((p, i) => {
    const lean = rng.next() * Math.PI * 2;
    dummy.position.set(p.x, 0, p.z);
    dummy.scale.set(1, 1.35, 1);
    dummy.rotation.set(0, lean, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    trunks.setColorAt(i, colorObj.setHex(p.red
      ? rng.pick([0xc8552e, 0xd86a2a, 0xb84a28])
      : 0x7a5a3a));
    dummy.position.set(p.x, 6.6, p.z);
    dummy.scale.set(1, 0.55, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(i, colorObj.setHex(rng.pick(CONFIG.PALETTE.TREE)));
    for (let f = 0; f < FRONDS_PER_PALM; f += 1) {
      const yaw = lean + (f / FRONDS_PER_PALM) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const tilt = rng.range(-0.55, -0.05); // arch up, then the droop pulls the tip down
      frondDummy.position.set(p.x, 6.75, p.z);
      frondDummy.scale.set(1.15, 1, 1.15);
      frondDummy.rotation.set(tilt, yaw, 0);
      frondDummy.updateMatrix();
      const fi = i * FRONDS_PER_PALM + f;
      fronds.setMatrixAt(fi, frondDummy.matrix);
      fronds.setColorAt(fi, colorObj.setHex(rng.pick(CONFIG.PALETTE.TREE)));
    }
  });
  trunks.instanceMatrix.needsUpdate = true;
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  fronds.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
  trunks.castShadow = true;
  trunks.name = 'palms-trunks';
  crowns.name = 'palms-crowns';
  fronds.name = 'palms-fronds';
  group.add(trunks);
  group.add(crowns);
  group.add(fronds);

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
  // Fountain water: a reflective disc on top of the basin.
  const fountainWater = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 20),
    new THREE.MeshStandardMaterial({ color: 0x7ab8d8, roughness: 0.1, metalness: 0.3, envMapIntensity: 1.0 }),
  );
  fountainWater.rotation.x = -Math.PI / 2;
  fountainWater.position.set(0, 0.92, 0);
  fountainWater.name = 'fountain-water';
  group.add(fountainWater);
  // Benches around the plaza (one InstancedMesh, with colliders).
  const benchGeo = new THREE.BoxGeometry(1.8, 0.5, 0.6);
  const benchMat = new THREE.MeshStandardMaterial({ color: CONFIG.PALETTE.BENCH, roughness: 0.9 });
  const benchSpots = [[-12, -8], [12, -8], [-12, 32], [12, 32]];
  const benches = new THREE.InstancedMesh(benchGeo, benchMat, benchSpots.length);
  benchSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 0.25, z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, i % 2 === 0 ? 0 : Math.PI, 0);
    dummy.updateMatrix();
    benches.setMatrixAt(i, dummy.matrix);
    colliders.push({ minX: x - 0.9, minZ: z - 0.3, maxX: x + 0.9, maxZ: z + 0.3 });
  });
  benches.instanceMatrix.needsUpdate = true;
  benches.name = 'plaza-benches';
  group.add(benches);

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
  const headGeo = new THREE.BoxGeometry(0.55, 1.1, 0.55);
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

  // ---- Street trees along the beachfront avenue + plaza edges ----
  const treeSpots = [];
  for (let z = -156; z <= 156; z += 24) {
    treeSpots.push({ x: -153, z });
    treeSpots.push({ x: -135, z });
  }
  [[-54, -12], [54, -12], [-54, 36], [54, 36]].forEach(([x, z]) => treeSpots.push({ x, z }));
  const treeTrunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 2.5, 6);
  const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 1 });
  const treeTrunks = new THREE.InstancedMesh(treeTrunkGeo, treeTrunkMat, treeSpots.length);
  const treeCrownGeo = new THREE.IcosahedronGeometry(1.6, 0);
  const treeCrownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const treeCrowns = new THREE.InstancedMesh(treeCrownGeo, treeCrownMat, treeSpots.length);
  treeSpots.forEach((p, i) => {
    dummy.position.set(p.x, 1.25, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, rng.next() * Math.PI, 0);
    dummy.updateMatrix();
    treeTrunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 3.1, p.z);
    dummy.scale.set(1, 0.75, 1);
    dummy.updateMatrix();
    treeCrowns.setMatrixAt(i, dummy.matrix);
    treeCrowns.setColorAt(i, colorObj.setHex(rng.pick(CONFIG.PALETTE.TREE)));
  });
  treeTrunks.instanceMatrix.needsUpdate = true;
  treeCrowns.instanceMatrix.needsUpdate = true;
  if (treeCrowns.instanceColor) treeCrowns.instanceColor.needsUpdate = true;
  treeTrunks.name = 'street-trees-trunks';
  treeCrowns.name = 'street-trees-crowns';
  group.add(treeTrunks);
  group.add(treeCrowns);

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
      { model: 'sports', x: -176, z: -72, angle: 0 }, // M2 target (violet)
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
