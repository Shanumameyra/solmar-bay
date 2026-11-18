// Solmar Bay — renderer, city meshes, camera. Imports three.js.
import * as THREE from 'three';
import { CONFIG } from './config.js';

function canvasTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(1280, 720, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffb36b);
  scene.fog = new THREE.Fog(0xf2a56b, 120, 380);

  const camera = new THREE.PerspectiveCamera(62, 1280 / 720, 0.1, 900);
  camera.position.set(0, 12, 30);

  // Low golden-hour sun from the west, warm.
  const sun = new THREE.DirectionalLight(0xffc27a, 2.6);
  sun.position.set(-120, 55, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xffd9a8, 0x4a5a6a, 0.9);
  scene.add(hemi);

  // Big warm sky dome (gradient via vertex colors on a sphere, back side).
  const skyGeo = new THREE.SphereGeometry(420, 16, 12);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xff9e57,
    side: THREE.BackSide,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.y = 0;
  scene.add(sky);

  return { scene, camera, sun, hemi };
}

function buildingWindowTexture() {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#d8d2c8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a4a5a';
    for (let y = 8; y < h - 8; y += 22) {
      for (let x = 8; x < w - 8; x += 18) {
        const lit = Math.random() < 0.35;
        ctx.fillStyle = lit ? '#ffd98a' : '#2e3d4d';
        ctx.fillRect(x, y, 10, 14);
      }
    }
  }, 128, 256);
}

function billboardTexture(text) {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#20242e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }, 512, 256);
}

function neonTexture(text, color) {
  return canvasTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillText(text, w / 2, h / 2);
    ctx.fillText(text, w / 2, h / 2);
  }, 512, 128);
}

export function buildCityMeshes(scene, city, THREE_NS) {
  const T = THREE_NS || THREE;
  const group = new T.Group();
  group.name = 'city';
  const C = CONFIG.COLORS;

  // Ground: dark asphalt base, then sand strip on the west edge.
  const ground = new T.Mesh(
    new T.PlaneGeometry(city.size, city.size),
    new T.MeshStandardMaterial({ color: C.road, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const sand = new T.Mesh(
    new T.PlaneGeometry(28, city.size),
    new T.MeshStandardMaterial({ color: C.sand, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-186, 0.02, 0);
  sand.receiveShadow = true;
  group.add(sand);

  // Sea plane just beyond the beach (west).
  const sea = new T.Mesh(
    new T.PlaneGeometry(120, city.size),
    new T.MeshStandardMaterial({ color: C.sea, roughness: 0.35, metalness: 0.1 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-260, 0.01, 0);
  group.add(sea);

  // Sidewalk strips along every street line: thin lighter planes.
  const walkMat = new T.MeshStandardMaterial({ color: C.sidewalk, roughness: 1 });
  for (const s of city.streets) {
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    const horizontal = Math.abs(s.z2 - s.z1) < 0.01;
    const strip = new T.Mesh(new T.PlaneGeometry(horizontal ? len : 15, horizontal ? 15 : len), walkMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set((s.x1 + s.x2) / 2, 0.03, (s.z1 + s.z2) / 2);
    strip.receiveShadow = true;
    group.add(strip);
  }

  // Plaza disc.
  const plaza = new T.Mesh(
    new T.CircleGeometry(city.plaza.r, 32),
    new T.MeshStandardMaterial({ color: 0xc9b48a, roughness: 1 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(city.plaza.x, 0.04, city.plaza.z);
  plaza.receiveShadow = true;
  group.add(plaza);

  // Buildings as one InstancedMesh with per-instance pastel color.
  const winTex = buildingWindowTexture();
  const boxGeo = new T.BoxGeometry(1, 1, 1);
  const boxMat = new T.MeshStandardMaterial({ map: winTex, roughness: 0.85 });
  const inst = new T.InstancedMesh(boxGeo, boxMat, Math.max(1, city.buildings.length));
  const m4 = new T.Matrix4();
  const quat = new T.Quaternion();
  const pos = new T.Vector3();
  const scl = new T.Vector3();
  const col = new T.Color();
  city.buildings.forEach((b, i) => {
    pos.set(b.x, b.h / 2, b.z);
    scl.set(b.w, b.h, b.d);
    m4.compose(pos, quat, scl);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.set(b.color));
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // Palms: instanced trunk + instanced frond cone.
  const trunkGeo = new T.CylinderGeometry(0.18, 0.3, 6, 6);
  const trunkMat = new T.MeshStandardMaterial({ color: C.palmTrunk, roughness: 1 });
  const trunks = new T.InstancedMesh(trunkGeo, trunkMat, Math.max(1, city.palms.length));
  const leafGeo = new T.ConeGeometry(2.6, 3.2, 7);
  const leafMat = new T.MeshStandardMaterial({ color: C.palmLeaf, roughness: 1 });
  const leaves = new T.InstancedMesh(leafGeo, leafMat, Math.max(1, city.palms.length));
  city.palms.forEach((p, i) => {
    pos.set(p.x, 3 * p.s, p.z);
    scl.set(p.s, p.s, p.s);
    m4.compose(pos, quat, scl);
    trunks.setMatrixAt(i, m4);
    pos.set(p.x, 6.4 * p.s, p.z);
    m4.compose(pos, quat, scl);
    leaves.setMatrixAt(i, m4);
  });
  trunks.castShadow = true;
  leaves.castShadow = true;
  group.add(trunks);
  group.add(leaves);

  // Street lamps: pole + glowing head.
  const poleGeo = new T.CylinderGeometry(0.09, 0.12, 5.5, 6);
  const poleMat = new T.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7, metalness: 0.4 });
  const poles = new T.InstancedMesh(poleGeo, poleMat, Math.max(1, city.lamps.length));
  const headGeo = new T.SphereGeometry(0.28, 8, 6);
  const headMat = new T.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc25a, emissiveIntensity: 1.4 });
  const heads = new T.InstancedMesh(headGeo, headMat, Math.max(1, city.lamps.length));
  city.lamps.forEach((l, i) => {
    pos.set(l.x, 2.75, l.z);
    scl.set(1, 1, 1);
    m4.compose(pos, quat, scl);
    poles.setMatrixAt(i, m4);
    pos.set(l.x, 5.6, l.z);
    m4.compose(pos, quat, scl);
    heads.setMatrixAt(i, m4);
  });
  group.add(poles);
  group.add(heads);

  // Market stalls: box + striped awning plane.
  for (const s of city.stalls) {
    const stall = new T.Group();
    const base = new T.Mesh(
      new T.BoxGeometry(3, 1.4, 2.4),
      new T.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 })
    );
    base.position.y = 0.7;
    base.castShadow = true;
    stall.add(base);
    const awn = new T.Mesh(
      new T.BoxGeometry(3.4, 0.12, 2.8),
      new T.MeshStandardMaterial({ color: s.color, roughness: 0.9 })
    );
    awn.position.y = 2.1;
    stall.add(awn);
    stall.position.set(s.x, 0, s.z);
    stall.rotation.y = s.rot;
    group.add(stall);
  }

  // Containers at the docks.
  const contGeo = new T.BoxGeometry(12, 2.6, 2.6);
  for (const c of city.containers) {
    const box = new T.Mesh(contGeo, new T.MeshStandardMaterial({ color: c.color, roughness: 0.85, metalness: 0.2 }));
    box.position.set(c.x, 1.3, c.z);
    box.rotation.y = c.rot;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
  }

  // Cranes: simple mast + jib.
  for (const cr of city.cranes) {
    const crane = new T.Group();
    const mast = new T.Mesh(
      new T.BoxGeometry(1.6, 26, 1.6),
      new T.MeshStandardMaterial({ color: 0xd8a03a, roughness: 0.8 })
    );
    mast.position.y = 13;
    mast.castShadow = true;
    crane.add(mast);
    const jib = new T.Mesh(
      new T.BoxGeometry(22, 1.2, 1.2),
      new T.MeshStandardMaterial({ color: 0xd8a03a, roughness: 0.8 })
    );
    jib.position.set(8, 25, 0);
    crane.add(jib);
    crane.position.set(cr.x, 0, cr.z);
    group.add(crane);
  }

  // Pier: wooden deck stretching west into the sea.
  const pierDeck = new T.Mesh(
    new T.BoxGeometry(city.pier.l, 0.5, city.pier.w),
    new T.MeshStandardMaterial({ color: 0x9a7a52, roughness: 1 })
  );
  pierDeck.position.set(city.pier.x - city.pier.l / 2 + 10, 0.6, city.pier.z);
  pierDeck.castShadow = true;
  group.add(pierDeck);

  // Billboards with canvas textures.
  for (const b of city.billboards) {
    const board = new T.Mesh(
      new T.PlaneGeometry(16, 8),
      new T.MeshStandardMaterial({ map: billboardTexture(b.text), roughness: 0.9 })
    );
    board.position.set(b.x, 9, b.z);
    board.rotation.y = b.rot;
    group.add(board);
    const post = new T.Mesh(
      new T.BoxGeometry(0.8, 9, 0.8),
      new T.MeshStandardMaterial({ color: 0x3a3f46 })
    );
    post.position.set(b.x, 4.5, b.z);
    group.add(post);
  }

  // Neon signs on downtown buildings (emissive planes, original text).
  const neonTexts = ["ROSA'S", 'PIER 9', 'SOLMAR', 'TACOS', 'HOTEL LUNA'];
  const downtown = city.buildings.filter((b) => b.district === 'Downtown').slice(0, 5);
  downtown.forEach((b, i) => {
    const color = C.neon[i % C.neon.length];
    const sign = new T.Mesh(
      new T.PlaneGeometry(12, 3),
      new T.MeshBasicMaterial({ map: neonTexture(neonTexts[i % neonTexts.length], color), transparent: true, fog: false })
    );
    sign.position.set(b.x, Math.min(b.h - 2, 30), b.z + b.d / 2 + 0.15);
    group.add(sign);
  });

  scene.add(group);
  return group;
}

const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function updateCamera(camera, S, dt) {
  const t = S.time || 0;
  // Staged shots must be framed on the very first frame (the shot is
  // declared ready after two frames), so snap the camera in shot mode.
  const snap = S.mode === 'shot';
  if (S.mode === 'title' || (S.mode === 'shot' && S.shot === 2)) {
    // Title screen (and the title shot): slow orbit around the plaza.
    const a = t * 0.05;
    _camPos.set(Math.cos(a) * 55, 26, Math.sin(a) * 55);
    if (snap) camera.position.copy(_camPos);
    else camera.position.lerp(_camPos, Math.min(1, dt * 2));
    camera.lookAt(0, 4, 0);
    return;
  }
  const p = S.player;
  if (!p) return;
  if (p.car) {
    // Chase camera behind the car.
    const h = p.car.heading;
    _fwd.set(Math.sin(h), 0, Math.cos(h));
    _camPos.set(p.car.x - _fwd.x * 11, 5.2, p.car.z - _fwd.z * 11);
    if (snap) camera.position.copy(_camPos);
    else camera.position.lerp(_camPos, Math.min(1, dt * 5));
    _camTarget.set(p.car.x + _fwd.x * 8, 2, p.car.z + _fwd.z * 8);
    camera.lookAt(_camTarget);
  } else {
    // Over-shoulder on foot.
    const h = S.camHeading !== undefined ? S.camHeading : p.heading;
    _fwd.set(Math.sin(h), 0, Math.cos(h));
    _camPos.set(p.x - _fwd.x * 4.5, 3.1, p.z - _fwd.z * 4.5);
    if (snap) camera.position.copy(_camPos);
    else camera.position.lerp(_camPos, Math.min(1, dt * 6));
    _camTarget.set(p.x + _fwd.x * 6, 1.6, p.z + _fwd.z * 6);
    camera.lookAt(_camTarget);
  }
}

export function resize(renderer, camera) {
  const w = renderer.domElement.clientWidth || 1280;
  const h = renderer.domElement.clientHeight || 720;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
