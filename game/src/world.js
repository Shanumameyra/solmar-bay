// SOLMAR BAY — world: ground, streets, sky, fog, streetlights (v6, fresh write)
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';

// --- v6 protection zones: the M1 approach route and the docks corridor must
// stay totally free of colliders, props and parked cars. ---
export const DOCK_CORRIDOR = { xMin: 166, xMax: 194, zMin: 10, zMax: 40 };
const ROUTE_VERTICAL = { xMin: 167, xMax: 183, zMin: -77, zMax: 27 }; // street x=175
const ROUTE_HORIZONTAL = { xMin: 98, xMax: 177, zMin: -83, zMax: -67 }; // street z=-75
// Tighter rects used when placing buildings (lane + 1 m). Buildings sit on
// blocks/sidewalks, so they may touch the lane edge but never enter the lane.
export const BUILDING_EXCLUSION = [
  { xMin: 167, xMax: 193, zMin: 11, zMax: 39 }, // docks corridor
  { xMin: 168, xMax: 182, zMin: -76, zMax: 26 }, // vertical route x=175
  { xMin: 99, xMax: 176, zMin: -82, zMax: -68 }, // horizontal route z=-75
];

export function isProtected(x, z) {
  for (const r of [DOCK_CORRIDOR, ROUTE_VERTICAL, ROUTE_HORIZONTAL]) {
    if (x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax) return true;
  }
  return false;
}

export function rectHitsExclusion(minX, maxX, minZ, maxZ) {
  for (const r of BUILDING_EXCLUSION) {
    if (minX < r.xMax && maxX > r.xMin && minZ < r.zMax && maxZ > r.zMin) return true;
  }
  return false;
}

export const STREET_CENTERS = [-175, -125, -75, -25, 25, 75, 125, 175];

export function addBoxCollider(world, minX, maxX, minZ, maxZ) {
  world.colliders.push({ minX, maxX, minZ, maxZ });
}

export function addCircleCollider(world, x, z, r) {
  world.circleColliders.push({ x, z, r });
}

function makeGroundTexture() {
  const S = 2048;
  const m = S / CONFIG.worldSize;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const X = (x) => (x + 200) * m;
  const Z = (z) => (z + 200) * m;
  const W = (w) => w * m;
  g.fillStyle = '#7e8272'; // base ground
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#d9b380'; // beach strip (west)
  g.fillRect(0, 0, W(19), S);
  g.fillStyle = '#8f8f88'; // docks concrete (east)
  g.fillRect(X(181), 0, W(19), S);
  g.fillStyle = '#c9b896'; // market plaza block
  g.fillRect(X(-19), Z(-19), W(38), W(38));
  g.fillStyle = '#55585e'; // parking lot block (spawn)
  g.fillRect(X(-19), Z(31), W(38), W(38));
  g.fillStyle = '#b3ac9c'; // sidewalks (3 m each side of every street)
  for (const c of STREET_CENTERS) {
    g.fillRect(X(c - 9), 0, W(18), S);
    g.fillRect(0, Z(c - 9), S, W(18));
  }
  g.fillStyle = '#33363b'; // asphalt
  for (const c of STREET_CENTERS) {
    g.fillRect(X(c - 6), 0, W(12), S);
    g.fillRect(0, Z(c - 6), S, W(12));
  }
  g.fillStyle = '#e8c33c'; // centre dashes
  for (const c of STREET_CENTERS) {
    for (let p = -196; p < 200; p += 8) {
      g.fillRect(X(c) - 1, Z(p), 2, W(3));
      g.fillRect(X(p), Z(c) - 1, W(3), 2);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 512;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#274b7a');
  grad.addColorStop(0.45, '#7d90b8');
  grad.addColorStop(0.62, '#f7a55c');
  grad.addColorStop(0.78, '#ffd9a0');
  grad.addColorStop(1, '#ffe9c4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 244, 200, 1)');
  grad.addColorStop(0.35, 'rgba(255, 200, 120, 0.55)');
  grad.addColorStop(1, 'rgba(255, 180, 90, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255, 235, 220, 0.9)';
  const blobs = [
    [70, 80, 55, 30],
    [120, 65, 65, 34],
    [180, 82, 55, 28],
    [105, 88, 70, 26],
    [155, 92, 60, 24],
  ];
  for (const [x, y, rx, ry] of blobs) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene, rng) {
  const colliders = [];
  const circleColliders = [];
  const world = {
    colliders,
    circleColliders,
    isBlocked(x, z, r = 0.5) {
      for (const c of colliders) {
        if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
      }
      for (const c of circleColliders) {
        const dx = x - c.x;
        const dz = z - c.z;
        const rr = r + c.r;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
      return false;
    },
    clampToWorld(x, z) {
      return {
        x: Math.max(-198, Math.min(198, x)),
        z: Math.max(-198, Math.min(198, z)),
      };
    },
  };

  // --- ground (400 x 400, procedural canvas texture) ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.worldSize, CONFIG.worldSize),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- sky gradient, sun, clouds, fog ---
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xf2a56b, 150, 380);

  const glowTex = makeGlowTexture();
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, fog: false, depthWrite: false })
  );
  sun.position.set(-170, 62, -110);
  sun.scale.set(90, 90, 1);
  scene.add(sun);

  const cloudTex = makeCloudTexture();
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.7, fog: false, depthWrite: false })
    );
    cloud.position.set(rng.range(-190, 190), rng.range(75, 115), rng.range(-190, 190));
    cloud.scale.set(rng.range(50, 100), rng.range(16, 28), 1);
    scene.add(cloud);
  }

  // --- lights: fixed golden hour 17:40, no day cycle ---
  const hemi = new THREE.HemisphereLight(0xffe0b3, 0x5a4a3a, 0.75);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sunLight.position.set(-90, 110, 60);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -160;
  sunLight.shadow.camera.right = 160;
  sunLight.shadow.camera.top = 160;
  sunLight.shadow.camera.bottom = -160;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // --- streetlights (one per intersection corner, never in protected zones) ---
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5.6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.6 });
  const lampGeo = new THREE.SphereGeometry(0.26, 10, 8);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffc46a, emissiveIntensity: 1.2 });
  const spots = [];
  for (const sx of STREET_CENTERS) {
    for (const sz of STREET_CENTERS) {
      const x = sx + 7.8;
      const z = sz + 7.8;
      if (!isProtected(x, z)) spots.push([x, z]);
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    m4.makeTranslation(x, 2.8, z);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(x, 5.7, z);
    lamps.setMatrixAt(i, m4);
  });
  poles.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(lamps);

  return world;
}
