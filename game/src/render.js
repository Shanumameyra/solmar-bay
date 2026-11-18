// render.js — Solmar Bay: everything you see.
// Builds the three.js scene from the city data (city.js) and syncs it with
// the world state (world.js) every frame: player, cars, traffic, peds,
// police light bars, pickups, mission marker, traffic lights, camera.
// InstancedMesh for buildings / palms / containers / stalls keeps the draw
// calls low (budget: <=60). All art is procedural canvas textures — no
// files, no network. Fixed golden-hour light (17:40) for consistent shots.
//
// This is the only core module that imports three.js. Everything else in
// the core (config/random/city/world/player/vehicle/traffic/input) is plain
// data + math and runs in Node.

import * as THREE from 'three';
import { WORLD_HALF, CAMERA, PALETTE } from './config.js';
import { lightState } from './city.js';

// ------------------------------------------------------------ canvas art --
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Window grid texture for building facades (procedural, no files). */
function windowsTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#d8cfc4'; g.fillRect(0, 0, w, h);
    for (let y = 12; y < h - 12; y += 24) {
      for (let x = 10; x < w - 10; x += 22) {
        const lit = Math.random() < 0.35;
        g.fillStyle = lit ? '#ffd98a' : '#2e4a63';
        g.fillRect(x, y, 14, 16);
      }
    }
  });
}

/** Neon sign texture: glowing text on transparent background. */
function neonTexture(text, color) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 40px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 18;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.fillText(text, w / 2, h / 2);
  });
}

/** Billboard texture: big coloured text. */
function billboardTexture(text, color) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#20242c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
  });
}

/** Ground texture: the whole 400x400 m map painted once (roads, sand...). */
function groundTexture(city) {
  const S = 1024;
  const toPx = (v) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * S;
  return canvasTexture(S, S, (g) => {
    // base: dry grass / dirt
    g.fillStyle = '#8a7f63'; g.fillRect(0, 0, S, S);
    // beach sand (west strip) + sea edge
    g.fillStyle = '#e8d29a';
    g.fillRect(0, 0, toPx(-184), S);
    g.fillStyle = '#2e7f9e';
    g.fillRect(0, 0, toPx(-200) + 2, S);
    // plaza paving
    g.fillStyle = '#b8a88f';
    g.fillRect(toPx(-50), toPx(-50), toPx(50) - toPx(-50), toPx(50) - toPx(-50));
    // sidewalks + roads
    for (const line of [-175, -125, -75, -25, 25, 75, 125, 175]) {
      const c = toPx(line);
      const road = (12 / 400) * S;
      const walk = (18 / 400) * S;
      g.fillStyle = '#9a938a';
      g.fillRect(c - walk / 2, 0, walk, S);
      g.fillRect(0, c - walk / 2, S, walk);
      g.fillStyle = '#2e3138';
      g.fillRect(c - road / 2, 0, road, S);
      g.fillRect(0, c - road / 2, S, road);
      // dashed centre line
      g.fillStyle = '#e8e8e8';
      for (let p = 8; p < S; p += 32) {
        g.fillRect(c - 1, p, 2, 16);
        g.fillRect(p, c - 1, 16, 2);
      }
    }
    // port concrete
    g.fillStyle = '#7d838a';
    g.fillRect(toPx(140), toPx(-170), toPx(200) - toPx(140), toPx(170) - toPx(-170));
  });
}

/** Vertical gradient sky dome texture.
 * Canvas row 0 is the zenith, the middle of the canvas is the horizon
 * (the sphere's equator), and the bottom rows are below ground — so the
 * warm golden-hour band must sit at the horizon (stops ~0.45-0.55), not
 * at the bottom of the canvas, or the sky reads as plain daylight blue. */
function skyTexture() {
  return canvasTexture(16, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2e5f8a');
    grad.addColorStop(0.30, '#7fa8c9');
    grad.addColorStop(0.45, '#ffb347');
    grad.addColorStop(0.55, '#ff9a5a');
    grad.addColorStop(0.70, '#e88a4a');
    grad.addColorStop(1, '#c96a3a');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}

/** Soft round cloud sprite texture. */
function cloudTexture() {
  return canvasTexture(128, 64, (g) => {
    g.clearRect(0, 0, 128, 64);
    for (const [x, y, r] of [[40, 36, 22], [64, 28, 26], [90, 38, 20]]) {
      const grad = g.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
}

// ------------------------------------------------------------------ setup --
/**
 * Create the renderer for a canvas + city.
 * Returns { renderer, scene, camera, city, dynamic: Map, marker, lights,
 *           trafficLightMeshes, clouds, sun }.
 * Call syncWorld(gr, world, dt) every frame, then gr.renderer.render().
 */
export function createGameRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 120, 620);

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);

  // ---- sky dome + sun + clouds --------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xffd9a0, 2.6);
  sun.position.set(-180, 140, 120); // low western sun, golden hour
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -220; sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220; sun.shadow.camera.bottom = -220;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fb4d9, 0x8a6f4d, 0.9));
  const amb = new THREE.AmbientLight(0xffe0b3, 0.25);
  scene.add(amb);

  const clouds = [];
  const cloudTex = cloudTexture();
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.85, fog: false, depthWrite: false,
    }));
    s.position.set(-350 + Math.random() * 700, 120 + Math.random() * 60, -350 + Math.random() * 700);
    s.scale.set(120 + Math.random() * 80, 40 + Math.random() * 20, 1);
    scene.add(s);
    clouds.push(s);
  }

  buildStaticCity(scene, city);

  const gr = {
    renderer, scene, camera, city,
    dynamic: new Map(),      // id -> THREE.Group (cars, peds, player)
    pickups: new Map(),      // pickup object -> mesh
    marker: null,
    trafficLightMeshes: [],
    clouds, sun,
    camYaw: 0,               // mouse-look yaw offset
    camPitch: 0.25,
    _camPos: new THREE.Vector3(0, 10, 20),
    _camLook: new THREE.Vector3(),
    _tmp: new THREE.Vector3(),
  };
  buildMarker(gr);
  return gr;
}

// ------------------------------------------------------------ static city --
function buildStaticCity(scene, city) {
  const dummy = new THREE.Object3D();

  // ground (one textured plane for the whole map)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2),
    new THREE.MeshStandardMaterial({ map: groundTexture(city), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // sea plane west of the beach
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(120, WORLD_HALF * 2 + 120),
    new THREE.MeshStandardMaterial({ color: PALETTE.sea, roughness: 0.25, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-WORLD_HALF - 60, -0.4, 0);
  scene.add(sea);

  // pier deck
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(8, 1, 46),
    new THREE.MeshStandardMaterial({ color: 0x8a6d4b, roughness: 0.9 }));
  pier.position.set(city.pier.x, 0.6, city.pier.z);
  pier.castShadow = true; pier.receiveShadow = true;
  scene.add(pier);

  // ---- buildings: one InstancedMesh, per-instance colour + scale ----------
  const winTex = windowsTexture();
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0); // origin at the base, so scale.y = height
  const bMat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 });
  const buildings = new THREE.InstancedMesh(bGeo, bMat, city.buildings.length);
  const col = new THREE.Color();
  city.buildings.forEach((b, i) => {
    dummy.position.set(b.x, 0, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    buildings.setColorAt(i, col.setHex(b.color));
  });
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  scene.add(buildings);

  // ---- neon signs (emissive planes on building faces) ----------------------
  for (const n of city.neonSigns) {
    const mat = new THREE.MeshBasicMaterial({
      map: neonTexture(n.text, '#' + n.color.toString(16).padStart(6, '0')),
      transparent: true, side: THREE.DoubleSide,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), mat);
    sign.position.set(n.x, n.y, n.z);
    // Signs sit on their building's north face (z = b.z - d/2), so the
    // plane must face north (-z): unrotated it faces +z, into the
    // building, and the street side sees the text mirrored.
    sign.rotation.y = Math.PI + (n.angle || 0);
    scene.add(sign);
  }

  // ---- billboards ------------------------------------------------------------
  for (const b of city.billboards) {
    const mat = new THREE.MeshBasicMaterial({
      map: billboardTexture(b.text, '#' + b.color.toString(16).padStart(6, '0')),
      side: THREE.DoubleSide,
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), mat);
    board.position.set(b.x, 14, b.z);
    scene.add(board);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 14, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x444444 }));
    post.position.set(b.x, 7, b.z);
    scene.add(post);
  }

  // ---- palms: instanced trunks + instanced canopies --------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 6, 6);
  trunkGeo.translate(0, 3, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo,
    new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 1 }), city.palms.length);
  const leafGeo = new THREE.ConeGeometry(2.6, 3.2, 7);
  leafGeo.translate(0, 7.2, 0);
  const leaves = new THREE.InstancedMesh(leafGeo,
    new THREE.MeshStandardMaterial({ color: PALETTE.palmLeaf, roughness: 0.9 }), city.palms.length);
  city.palms.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.scale.setScalar(p.scale);
    dummy.rotation.set(0, p.x * 0.7, 0.06);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    leaves.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true;
  scene.add(trunks);
  scene.add(leaves);

  // ---- containers -------------------------------------------------------------
  if (city.containers.length) {
    const cGeo = new THREE.BoxGeometry(6, 2.6, 2.6);
    const conts = new THREE.InstancedMesh(cGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 }), city.containers.length);
    city.containers.forEach((c, i) => {
      dummy.position.set(c.x, 1.3, c.z);
      dummy.rotation.set(0, c.angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      conts.setMatrixAt(i, dummy.matrix);
      conts.setColorAt(i, col.setHex(c.color));
    });
    conts.castShadow = true;
    scene.add(conts);
  }

  // ---- dock crane -------------------------------------------------------------
  // One simple gantry crane over the M1 package yard (east edge), so the
  // docks read as a working port: two legs, a jib reaching west over the
  // yard, and a cable + hook hanging above the containers. The jib is
  // 14 m up, clear of any vehicle; the legs stand east of the package
  // marker, clear of the approach from the west.
  {
    const craneMat = new THREE.MeshStandardMaterial({
      color: 0xd35400, roughness: 0.6, metalness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x2c3e50, roughness: 0.7, metalness: 0.3 });
    const crane = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(1.2, 14, 1.2);
    for (const dz of [-3, 3]) {
      const leg = new THREE.Mesh(legGeo, craneMat);
      leg.position.set(0, 7, dz);
      leg.castShadow = true;
      crane.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 7.2), craneMat);
    beam.position.set(0, 14, 0);
    beam.castShadow = true;
    crane.add(beam);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 1), craneMat);
    jib.position.set(-8, 14.5, 0);
    jib.castShadow = true;
    crane.add(jib);
    const counterJib = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 1), craneMat);
    counterJib.position.set(5, 14.5, 0);
    crane.add(counterJib);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.12, 9, 0.12), darkMat);
    cable.position.set(-16, 9.5, 0);
    crane.add(cable);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.8), darkMat);
    hook.position.set(-16, 4.5, 0);
    crane.add(hook);
    crane.position.set(190, 0, 30);
    scene.add(crane);
  }

  // ---- market stalls ------------------------------------------------------------
  if (city.stalls.length) {
    const sGeo = new THREE.BoxGeometry(3.4, 2.2, 2.4);
    sGeo.translate(0, 1.1, 0);
    const stalls = new THREE.InstancedMesh(sGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9 }), city.stalls.length);
    const roofGeo = new THREE.ConeGeometry(2.8, 1.2, 4);
    roofGeo.translate(0, 2.8, 0);
    const roofs = new THREE.InstancedMesh(roofGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9 }), city.stalls.length);
    city.stalls.forEach((s, i) => {
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set(0, s.angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      stalls.setMatrixAt(i, dummy.matrix);
      roofs.setMatrixAt(i, dummy.matrix);
      stalls.setColorAt(i, col.setHex(s.color));
      roofs.setColorAt(i, col.setHex(s.color));
    });
    stalls.castShadow = true;
    scene.add(stalls);
    scene.add(roofs);
  }

  // ---- streetlights (instanced poles + emissive heads) ---------------------------
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo,
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.6 }),
    city.streetlights.length);
  city.streetlights.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poles);

  // traffic lights are individual (few) so their lamps can change colour
  return { dummy };
}

// ------------------------------------------------------------ dynamic objs --
/** Build a car mesh group from a vehicle state object. */
export function makeCarMesh(car) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: car.color, roughness: 0.35, metalness: 0.6,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 4.4), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1c2833, roughness: 0.15, metalness: 0.8 }));
  cabin.position.set(0, 1.1, -0.2);
  cabin.castShadow = true;
  g.add(cabin);
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  // headlights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const x of [-0.7, 0.7]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), lightMat);
    h.position.set(x, 0.6, 2.21);
    g.add(h);
  }
  if (car.type === 'police') {
    // SBPD light bar: red + blue, flashed by syncWorld()
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x222222 }));
    bar.position.set(0, 1.45, -0.2);
    g.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.28, 1.45, -0.2);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.28, 1.45, -0.2);
    g.add(blue);
    g.userData.lightRed = red;
    g.userData.lightBlue = blue;
    // white doors: paint the body two-tone via a white stripe box
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.3, 4.42),
      new THREE.MeshStandardMaterial({ color: 0xf4f6f7, roughness: 0.4 }));
    stripe.position.y = 0.62;
    g.add(stripe);
  }
  if (car.type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    sign.position.set(0, 1.48, -0.2);
    g.add(sign);
  }
  g.userData.bodyMat = bodyMat;
  return g;
}

/** Build a pedestrian mesh (simple capsule person). */
export function makePedMesh(ped) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: ped.color, roughness: 0.9 }));
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.8 }));
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);
  g.userData.body = body;
  return g;
}

/** Build the player mesh: Dario, dark jacket, white shirt. */
export function makePlayerMesh() {
  const g = new THREE.Group();
  const jacket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 1.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.85 }));
  jacket.position.y = 0.95;
  jacket.castShadow = true;
  g.add(jacket);
  const shirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xf4f6f7 }));
  shirt.position.set(0, 1.0, 0.3);
  g.add(shirt);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 }));
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }));
  hair.position.y = 1.76;
  g.add(hair);
  g.userData.body = jacket;
  return g;
}

// -------------------------------------------------------------- marker -----
function buildMarker(gr) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.14, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  g.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 24, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false,
    }));
  beam.position.y = 12;
  g.add(beam);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.7),
    new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  diamond.position.y = 4;
  g.add(diamond);
  g.userData.diamond = diamond;
  g.userData.ring = ring;
  g.visible = false;
  gr.scene.add(g);
  gr.marker = g;
}

/** Show / move the yellow mission marker. Pass null to hide it. */
export function setMarker(gr, x, z) {
  if (x === null || x === undefined) {
    gr.marker.visible = false;
    return;
  }
  gr.marker.visible = true;
  gr.marker.position.set(x, 0, z);
}

// ------------------------------------------------------------------ sync ---
/**
 * Sync every dynamic object with the world and render one frame.
 * Call once per animation frame from main.js.
 */
export function syncWorld(gr, world, dt) {
  const { scene } = gr;
  const now = world.time;

  // ---- player ---------------------------------------------------------------
  let playerMesh = gr.dynamic.get('player');
  if (!playerMesh) {
    playerMesh = makePlayerMesh();
    gr.dynamic.set('player', playerMesh);
    scene.add(playerMesh);
  }
  const p = world.player;
  playerMesh.visible = !p.inVehicle;
  if (!p.inVehicle) {
    playerMesh.position.set(p.x, 0, p.z);
    playerMesh.rotation.y = p.heading;
    // walk bob
    const bob = p.moving ? Math.sin(now * 11) * 0.05 : 0;
    playerMesh.position.y = bob;
    playerMesh.rotation.z = p.moving && p.running ? 0.08 : 0;
  }

  // ---- cars (traffic + parked + police) --------------------------------------
  const cars = world.vehicles.concat(world.police);
  const seen = new Set();
  for (const car of cars) {
    const key = `car-${car.id}`;
    seen.add(key);
    let mesh = gr.dynamic.get(key);
    if (!mesh) {
      mesh = makeCarMesh(car);
      gr.dynamic.set(key, mesh);
      scene.add(mesh);
    }
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.heading;
    // drift tilt + smoke flag on the body material
    mesh.rotation.z = (car.drift || 0) * (car.speed >= 0 ? 1 : -1) * 0.06;
    if (car.smoking) {
      mesh.userData.bodyMat.emissive.setHex(0x331111);
    }
    // police light bar flash
    if (car.type === 'police' && mesh.userData.lightRed) {
      const phase = Math.floor(now * 4) % 2 === 0;
      mesh.userData.lightRed.visible = phase;
      mesh.userData.lightBlue.visible = !phase;
    }
  }

  // ---- pedestrians --------------------------------------------------------------
  const peds = world.traffic.peds;
  peds.forEach((ped, i) => {
    const key = `ped-${i}`;
    let mesh = gr.dynamic.get(key);
    if (!mesh) {
      mesh = makePedMesh(ped);
      gr.dynamic.set(key, mesh);
      scene.add(mesh);
    }
    mesh.position.set(ped.x, 0, ped.z);
    mesh.rotation.y = ped.heading;
    mesh.visible = ped.state !== 'down';
    mesh.position.y = ped.state === 'flee'
      ? Math.abs(Math.sin(ped.bobPhase)) * 0.12
      : Math.abs(Math.sin(ped.bobPhase)) * 0.04;
    // waving arm: tilt the body when hailing a taxi
    mesh.rotation.z = ped.state === 'wave' ? Math.sin(now * 6) * 0.12 : 0;
  });

  // ---- cash pickups (spinning gold) ----------------------------------------------
  for (const pk of world.pickups) {
    if (pk.taken) {
      const old = gr.pickups.get(pk);
      if (old) { scene.remove(old); gr.pickups.delete(pk); }
      continue;
    }
    let mesh = gr.pickups.get(pk);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.5, 0.9),
        new THREE.MeshStandardMaterial({
          color: 0xffd23f, emissive: 0xaa8800, roughness: 0.3, metalness: 0.7,
        }));
      gr.pickups.set(pk, mesh);
      scene.add(mesh);
    }
    mesh.position.set(pk.x, 0.9 + Math.sin(now * 3 + pk.bobPhase) * 0.25, pk.z);
    mesh.rotation.y = now * 2 + pk.bobPhase;
  }

  // ---- traffic lights ------------------------------------------------------------
  if (!gr.trafficLightMeshes.length) {
    for (const l of gr.city.trafficLights) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.12, 5, 6),
        new THREE.MeshStandardMaterial({ color: 0x222222 }));
      pole.position.set(l.x + 7, 2.5, l.z + 7);
      scene.add(pole);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.1, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x111111 }));
      box.position.set(l.x + 7, 5.4, l.z + 7);
      scene.add(box);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
      lamp.position.set(l.x + 7, 5.7, l.z + 7);
      scene.add(lamp);
      gr.trafficLightMeshes.push({ light: l, lamp });
    }
  }
  for (const t of gr.trafficLightMeshes) {
    const state = lightState(t.light, now);
    t.lamp.material.color.setHex(state === 'green' ? 0x22ff66 : 0xff2222);
  }

  // ---- mission marker pulse --------------------------------------------------------
  if (gr.marker.visible) {
    const s = 1 + Math.sin(now * 4) * 0.12;
    gr.marker.userData.ring.scale.set(s, s, 1);
    gr.marker.userData.diamond.rotation.y = now * 1.5;
    gr.marker.userData.diamond.position.y = 4 + Math.sin(now * 2.5) * 0.5;
  }

  // ---- clouds drift ------------------------------------------------------------------
  for (const c of gr.clouds) {
    c.position.x += dt * 1.2;
    if (c.position.x > 400) c.position.x = -400;
  }

  // ---- camera -------------------------------------------------------------------------
  // NOTE: updateCamera takes (gr, world, input, dt); pass null for input
  // when no mouse-look snapshot is available (a bare dt in the input slot
  // used to turn the smoothing factor into NaN and freeze the camera).
  updateCamera(gr, world, null, dt);

  gr.renderer.render(scene, gr.camera);
}

/**
 * Third-person follow camera. On foot: over-shoulder, mouse-look yaw.
 * In a car: further back, higher, trailing the car's heading.
 * `lookDX` (px, from input) orbits the camera around the player on foot.
 */
export function updateCamera(gr, world, input, dt) {
  const p = world.player;
  // A staged shot (or the title orbit) pins the camera to a fixed pose:
  // the follow logic must not fight it.
  if (world.shotCamera) {
    const pose = world.shotCamera;
    gr.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    gr.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    gr._camPos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    return;
  }
  if (input && input.lookDX) gr.camYaw -= input.lookDX * 0.0028;

  const inCar = !!p.inVehicle;
  const dist = inCar ? CAMERA.carDistance : CAMERA.onFootDistance;
  const height = inCar ? CAMERA.carHeight : CAMERA.onFootHeight;

  // Camera yaw: behind the heading (car) or behind heading + mouse orbit (foot).
  const yaw = p.heading + Math.PI + (inCar ? 0 : gr.camYaw);
  const tx = p.x, tz = p.z;
  const wantX = tx + Math.sin(yaw) * dist;
  const wantZ = tz + Math.cos(yaw) * dist;
  const wantY = height;

  const step = typeof dt === 'number' ? dt : 0.016;
  const k = Math.min(1, CAMERA.lerp * step);
  gr._camPos.x += (wantX - gr._camPos.x) * k;
  gr._camPos.y += (wantY - gr._camPos.y) * k;
  gr._camPos.z += (wantZ - gr._camPos.z) * k;
  gr.camera.position.copy(gr._camPos);
  gr._camLook.set(tx, 1.4, tz);
  gr.camera.lookAt(gr._camLook);
}

/** Put the camera at an exact pose (used by ?shot= staging). */
export function setCameraPose(gr, x, y, z, lookX, lookY, lookZ) {
  gr._camPos.set(x, y, z);
  gr.camera.position.set(x, y, z);
  gr.camera.lookAt(lookX, lookY, lookZ);
}

/** Resize the renderer + camera to the window. */
export function resizeRenderer(gr) {
  gr.camera.aspect = window.innerWidth / window.innerHeight;
  gr.camera.updateProjectionMatrix();
  gr.renderer.setSize(window.innerWidth, window.innerHeight);
}

/** One-off render without a world step (title screen backdrop). */
export function renderOnce(gr) {
  gr.renderer.render(gr.scene, gr.camera);
}

export default createGameRenderer;
