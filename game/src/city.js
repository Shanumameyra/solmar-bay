// SOLMAR BAY — city: buildings, neon, palms, props, docks (v6, fresh write)
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';
import { isProtected, rectHitsExclusion, addBoxCollider, addCircleCollider } from './world.js';

// Mission-critical points that must never end up inside a building collider.
const RESERVED = [
  CONFIG.spawn, CONFIG.parkedCar, CONFIG.beachCar,
  CONFIG.safehouse, CONFIG.garage, CONFIG.cafe, CONFIG.docks,
];

function hitsReserved(minX, maxX, minZ, maxZ, margin = 4) {
  for (const p of RESERVED) {
    if (p.x > minX - margin && p.x < maxX + margin && p.z > minZ - margin && p.z < maxZ + margin) return true;
  }
  return false;
}

function makeWindowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#e6e2d8';
  g.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const lit = (row * 4 + col) % 3 === 0;
      g.fillStyle = lit ? '#ffd27a' : '#3a4a5e';
      g.fillRect(10 + col * 30, 14 + row * 30, 20, 18);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNeonTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.font = 'bold 72px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.strokeText(text, 256, 64);
  g.fillStyle = '#ffffff';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStripeTexture(c1, c2) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 === 0 ? c1 : c2;
    g.fillRect(i * 16, 0, 16, 64);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBillboardTexture(lines, bg, fg) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.font = 'bold 64px Arial, sans-serif';
  g.fillText(lines[0], 256, 110);
  g.font = 'bold 34px Arial, sans-serif';
  g.fillText(lines[1], 256, 180);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCity(scene, world, rng) {
  const PASTEL = ['#f2c9c0', '#f7d9a8', '#cfe3d8', '#c3d4ee', '#e8c8e0', '#f5e6c8', '#bcd8d8', '#e6b8a2'];
  const GLASS = ['#9fc3e0', '#7fb0d8', '#a8c8e8'];

  // --- buildings: one per block, 3 height bands, InstancedMesh ---
  const windowTex = makeWindowTexture();
  const placements = { low: [], mid: [], tower: [] };
  const BLOCKS = [-150, -100, -50, 0, 50, 100, 150];
  // Open blocks: plaza (cafe), parking lot (spawn + parked car), beach car,
  // safehouse, garage — markers must stay reachable, so no buildings there.
  const SKIP_BLOCKS = new Set(['0,0', '0,50', '-150,-50', '-100,150', '-50,150']);
  for (const bx of BLOCKS) {
    for (const bz of BLOCKS) {
      if (SKIP_BLOCKS.has(bx + ',' + bz)) continue;
      const downtown = bx > 0 && bz < 0;
      const roll = rng.next();
      const band = downtown ? (roll < 0.45 ? 'tower' : 'mid') : (roll < 0.55 ? 'low' : 'mid');
      const h = band === 'low' ? rng.range(8, 15) : band === 'mid' ? rng.range(20, 35) : rng.range(45, 70);
      const w = rng.range(20, 30);
      const d = rng.range(20, 30);
      const x = bx + rng.range(-3, 3);
      const z = bz + rng.range(-3, 3);
      const minX = x - w / 2, maxX = x + w / 2;
      const minZ = z - d / 2, maxZ = z + d / 2;
      // v6: NEVER block the docks corridor or the M1 approach streets.
      if (rectHitsExclusion(minX, maxX, minZ, maxZ)) continue;
      if (hitsReserved(minX, maxX, minZ, maxZ)) continue;
      placements[band].push({ x, z, w, h, d });
      addBoxCollider(world, minX, maxX, minZ, maxZ);
    }
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const facadeMat = new THREE.MeshStandardMaterial({ map: windowTex, roughness: 0.85, metalness: 0.05 });
  const allBuildings = [];
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const band of ['low', 'mid', 'tower']) {
    const list = placements[band];
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(boxGeo, facadeMat, list.length);
    list.forEach((b, i) => {
      m4.makeScale(b.w, b.h, b.d);
      m4.setPosition(b.x, b.h / 2, b.z);
      mesh.setMatrixAt(i, m4);
      const palette = band === 'tower' ? GLASS : PASTEL;
      mesh.setColorAt(i, col.set(palette[Math.floor(rng.next() * palette.length)]));
      allBuildings.push(b);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  // Roof caps (one instanced mesh for all buildings).
  if (allBuildings.length > 0) {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.95 });
    const roofs = new THREE.InstancedMesh(boxGeo, roofMat, allBuildings.length);
    allBuildings.forEach((b, i) => {
      m4.makeScale(b.w + 0.4, 0.5, b.d + 0.4);
      m4.setPosition(b.x, b.h + 0.25, b.z);
      roofs.setMatrixAt(i, m4);
    });
    roofs.instanceMatrix.needsUpdate = true;
    scene.add(roofs);
  }

  // --- neon signs on downtown towers (original text only) ---
  const neonDefs = [
    ['PIER 9', '#ff5c8a'],
    ['SOLMAR', '#39c5ff'],
    ['TACOS', '#ffd23c'],
    ['HOTEL LUNA', '#b78cff'],
  ];
  const downtownTall = allBuildings.filter((b) => b.x > 0 && b.z < 0 && b.h >= 20);
  neonDefs.forEach(([text, color], i) => {
    const b = downtownTall[i % downtownTall.length];
    if (!b) return;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3),
      new THREE.MeshBasicMaterial({ map: makeNeonTexture(text, color), transparent: true, toneMapped: false })
    );
    sign.position.set(b.x, b.h * 0.72, b.z + b.d / 2 + 0.25);
    scene.add(sign);
  });

  // --- Rosa's cafe (market plaza). Building sits north of the marker so the
  // marker at (0,0) stays reachable on foot. ---
  const cafe = new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0xf7e3c0, roughness: 0.9 })
  );
  cafe.position.set(0, 3, -6);
  cafe.castShadow = true;
  cafe.receiveShadow = true;
  scene.add(cafe);
  addBoxCollider(world, -5, 5, -10, -2);
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 3),
    new THREE.MeshStandardMaterial({ map: makeStripeTexture('#e2574c', '#fdf6e3'), side: THREE.DoubleSide, roughness: 0.9 })
  );
  awning.position.set(0, 4.2, -1.6);
  awning.rotation.x = -0.5;
  scene.add(awning);
  const rosa = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    new THREE.MeshBasicMaterial({ map: makeNeonTexture("ROSA'S", '#ff7a9e'), transparent: true, toneMapped: false })
  );
  rosa.position.set(0, 5.4, -1.8);
  scene.add(rosa);

  // --- market stalls around the plaza (kept off the spawn->cafe path) ---
  const stallAngles = [35, 100, 145, 215, 260, 325];
  const stallCols = ['#e2574c', '#3f8f6b', '#e8a13c', '#5b7fc4', '#c65b8a', '#7a9a3a'];
  stallAngles.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * 17;
    const z = Math.sin(a) * 17;
    const stall = new THREE.Group();
    stall.position.set(x, 0, z);
    stall.rotation.y = -a + Math.PI / 2;
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.1, 2),
      new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 })
    );
    counter.position.y = 0.55;
    counter.castShadow = true;
    stall.add(counter);
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 2.2),
      new THREE.MeshStandardMaterial({ map: makeStripeTexture(stallCols[i], '#fdf6e3'), side: THREE.DoubleSide, roughness: 0.9 })
    );
    top.position.y = 2.3;
    top.rotation.x = -1.15;
    stall.add(top);
    scene.add(stall);
    addCircleCollider(world, x, z, 2);
  });

  // --- palms: beach strip + promenade (never in protected zones) ---
  const palmSpots = [];
  for (let z = -190; z <= 190; z += 14) {
    const x = rng.range(-197, -185);
    const zz = z + rng.range(-3, 3);
    if (!isProtected(x, zz)) palmSpots.push([x, zz]);
  }
  for (let z = -160; z <= 160; z += 40) {
    if (!isProtected(-182, z)) palmSpots.push([-182, z]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.26, 6.5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.95 });
  const frondGeo = new THREE.ConeGeometry(2.4, 1.8, 7);
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    m4.makeTranslation(x, 3.25, z);
    trunks.setMatrixAt(i, m4);
    m4.makeScale(1, 0.55, 1);
    m4.setPosition(x, 6.9, z);
    fronds.setMatrixAt(i, m4);
    addCircleCollider(world, x, z, 0.5);
  });
  trunks.castShadow = true;
  fronds.castShadow = true;
  trunks.instanceMatrix.needsUpdate = true;
  fronds.instanceMatrix.needsUpdate = true;
  scene.add(trunks);
  scene.add(fronds);

  // --- benches ---
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
  const benchSpots = [[-183, -40], [-183, 20], [-183, 80], [17.5, 24]];
  for (const [x, z] of benchSpots) {
    if (isProtected(x, z)) continue;
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.18, 0.6), benchMat);
    seat.position.y = 0.5;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 0.12), benchMat);
    back.position.set(0, 0.9, -0.28);
    bench.add(seat, back);
    bench.position.set(x, 0, z);
    bench.rotation.y = x < -100 ? Math.PI / 2 : 0;
    scene.add(bench);
    addCircleCollider(world, x, z, 1.2);
  }

  // --- hydrants ---
  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xc22e2e, roughness: 0.5, metalness: 0.3 });
  const hydrantSpots = [[33, 33], [-33, -33], [-83, 83], [133, 133], [-133, -133], [33, -133]];
  for (const [x, z] of hydrantSpots) {
    if (isProtected(x, z)) continue;
    const hyd = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 8), hydrantMat);
    body.position.y = 0.35;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), hydrantMat);
    cap.position.y = 0.75;
    hyd.add(body, cap);
    hyd.position.set(x, 0, z);
    scene.add(hyd);
    addCircleCollider(world, x, z, 0.5);
  }

  // --- traffic lights (static red; Worker B modules may animate) ---
  const tlSpots = [[25, -25], [-25, 25], [75, 75], [-75, -75]];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.6 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const [sx, sz] of tlSpots) {
    const x = sx + 7.5;
    const z = sz + 7.5;
    if (isProtected(x, z)) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.5, 6), poleMat);
    pole.position.set(x, 2.25, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.45), darkMat);
    head.position.set(x, 4.4, z);
    scene.add(head);
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), redMat);
    red.position.set(x, 4.72, z + 0.24);
    scene.add(red);
    addCircleCollider(world, x, z, 0.4);
  }

  // --- billboards (procedural canvas textures) ---
  const bbDefs = [
    { x: -190, z: 40, ry: Math.PI / 2, lines: ['SOLMAR BAY', 'SUN - SEA - SPEED'], bg: '#e2703a', fg: '#fff3d6' },
    { x: 190, z: -60, ry: -Math.PI / 2, lines: ['VISIT THE PIER', 'FRESH CATCH DAILY'], bg: '#2e6f8a', fg: '#eaf7ff' },
    { x: -185, z: -120, ry: Math.PI / 2, lines: ['TACOS 24H', 'PIER 9 - EAST SIDE'], bg: '#a03a3a', fg: '#ffe9a8' },
  ];
  for (const bb of bbDefs) {
    if (isProtected(bb.x, bb.z)) continue;
    const group = new THREE.Group();
    group.position.set(bb.x, 0, bb.z);
    group.rotation.y = bb.ry;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7, metalness: 0.4 });
    for (const px of [-3.5, 3.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), postMat);
      post.position.set(px, 3, 0);
      group.add(post);
    }
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshStandardMaterial({ map: makeBillboardTexture(bb.lines, bb.bg, bb.fg), roughness: 0.8 })
    );
    panel.position.y = 7.5;
    panel.castShadow = true;
    group.add(panel);
    scene.add(group);
    addBoxCollider(world, bb.x - 1, bb.x + 1, bb.z - 5, bb.z + 5);
  }

  // --- docks: containers ONLY in the two zones east of the corridor ---
  // v6: nothing — no container, crane leg, prop or parked car — inside the
  // dock corridor {x 168-192, z 12-38} or on the M1 approach streets.
  const containerGeo = new THREE.BoxGeometry(2.6, 2.6, 12);
  const containerCols = [0xb5502e, 0x2e7f8a, 0xc9a13b, 0x7a4a8a];
  const containerSpots = [
    [193, -28, 0, false], [197, -28, 1, false], [193, -28, 2, true],
    [193, 65, 3, false], [197, 65, 0, false], [197, 65, 1, true],
  ];
  for (const [x, z, ci, stacked] of containerSpots) {
    const c = new THREE.Mesh(
      containerGeo,
      new THREE.MeshStandardMaterial({ color: containerCols[ci], roughness: 0.7, metalness: 0.3 })
    );
    c.position.set(x, stacked ? 3.9 : 1.3, z);
    c.castShadow = true;
    c.receiveShadow = true;
    scene.add(c);
    if (!stacked) addBoxCollider(world, x - 1.3, x + 1.3, z - 6, z + 6);
  }

  // --- crane: legs ONLY at (195,-20) and (195,60); beam stays east of x=192 ---
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xd8a020, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of [[195, -20], [195, 60]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 18, 2), craneMat);
    leg.position.set(x, 9, z);
    leg.castShadow = true;
    scene.add(leg);
    addBoxCollider(world, x - 1, x + 1, z - 1, z + 1);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 84), craneMat);
  beam.position.set(195, 18.5, 20);
  beam.castShadow = true;
  scene.add(beam);
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 3.5),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.5 })
  );
  cab.position.set(195, 16.5, -20);
  scene.add(cab);

  // --- pier (west beachfront, walkable deck, no collider) ---
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.95 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(18, 0.4, 8), pierMat);
  pier.position.set(-191, 0.2, -20);
  pier.receiveShadow = true;
  scene.add(pier);
  for (const dz of [-3.7, 3.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 0.15), pierMat);
    rail.position.set(-191, 0.85, -20 + dz);
    scene.add(rail);
  }

  return { buildings: allBuildings.length, palms: palmSpots.length, containers: containerSpots.length };
}
