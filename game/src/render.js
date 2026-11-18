// SOLMAR BAY — the renderer. Three.js scene: golden-hour sun + hemisphere
// light, gradient sky + fog, a smoothed chase camera (over-shoulder on foot,
// behind the car while driving), and instanced meshes for every repeated
// thing (buildings live in city.js; here: cars, peds, the player, lights,
// cash pickups, the mission beacon).
// Angle convention (shared with Worker B): forward = (sin angle, cos angle);
// a mesh whose length runs along local Z uses rotation.y = angle.
// Draw-call budget: cars 4 + peds 3 + player 4 + pickups 1 + beacon 1 +
// city ~25 = well under 60.
// draw(state, fx): main.js calls it once per frame with the effects object
// (or null in the screenshot path). Camera smoothing uses a fixed 1/60 s
// step — the loop runs at display rate, so the smoothing rate is steady.
// No per-frame allocations in the hot loop: matrices and vectors are reused.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { nsGreen } from './traffic.js';

const PAL = CONFIG.PALETTE;

// Soft peach/pink sunset gradient: violet overhead, magenta mid-sky,
// peach-orange at the horizon — the #1 entry's warm haze, not a hard
// orange band. The warm band sits at ~50-68% (the horizon on screen /
// the sphere's equator), so the sky reads peach at eye level.
function sunsetStops(grad) {
  grad.addColorStop(0, '#4a2560');
  grad.addColorStop(0.22, '#7a2f6e');
  grad.addColorStop(0.38, '#c95a7e');
  grad.addColorStop(0.5, '#ff8a5c');
  grad.addColorStop(0.68, '#ffa87a');
  grad.addColorStop(1, '#ffd9a8');
}

function makeSkyTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  sunsetStops(grad);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 250, 230, 1)');
  grad.addColorStop(0.25, 'rgba(255, 230, 170, 0.85)');
  grad.addColorStop(0.55, 'rgba(255, 200, 120, 0.28)');
  grad.addColorStop(1, 'rgba(255, 200, 120, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft puffy cloud: several overlapping white blobs.
function makeCloudTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const blobs = [
    [70, 80, 42], [120, 62, 52], [175, 78, 44], [100, 88, 36], [150, 90, 34],
  ];
  for (const [x, y, r] of blobs) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255, 250, 240, 0.85)');
    grad.addColorStop(0.6, 'rgba(255, 246, 230, 0.45)');
    grad.addColorStop(1, 'rgba(255, 246, 230, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The visible sun: a pale white-yellow glare at the END of the road
// (dead centre, south, very low, almost touching the horizon) — NOT a
// big round disc. The #1 entry's sun is a bright bloom that whitens the
// road and sky in the middle of the frame.
function makeSunSprite() {
  const tex = makeGlowTexture();
  if (!tex) return null;
  const mat = new THREE.SpriteMaterial({
    map: tex, color: 0xfff6d8, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(-190, 30, 700);
  sprite.scale.set(110, 110, 1);
  sprite.name = 'sun-disc';
  return sprite;
}

// Sun glare at the end of the road: a wide, low, warm halo straight south
// (the boulevard runs south), so driving down the beach runs into the
// sunset glow like the #1 entry's shot. Additive, fog-free, sky dressing
// only — strong enough to whiten the road and sky in the middle.
function makeGlareSprite() {
  const tex = makeGlowTexture();
  if (!tex) return null;
  const mat = new THREE.SpriteMaterial({
    map: tex, color: 0xff9a4d, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(-190, 55, 700);
  sprite.scale.set(520, 240, 1);
  sprite.name = 'sun-glare';
  return sprite;
}

// A few static clouds (fixed positions = deterministic screenshots).
function makeClouds() {
  const tex = makeCloudTexture();
  if (!tex) return [];
  const spots = [
    { x: -350, y: 300, z: -350, s: 260 },
    { x: 100, y: 330, z: -420, s: 300 },
    { x: 380, y: 280, z: -200, s: 220 },
    { x: -80, y: 310, z: 420, s: 280 },
    { x: 420, y: 320, z: 300, s: 240 },
  ];
  return spots.map((p, i) => {
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffc0a8, transparent: true, opacity: 0.55,
      depthWrite: false, fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(p.x, p.y, p.z);
    sprite.scale.set(p.s, p.s * 0.45, 1);
    sprite.name = `cloud-${i}`;
    return sprite;
  });
}

// Image-based lighting: a procedural sunset environment (sky dome +
// sun + warm ground) baked once through PMREM. Every MeshStandardMaterial
// picks up soft sky reflections, so shadowed faces stop reading as flat
// black and car paint / glass look like real materials. Guarded by the
// caller (try/catch) so a headless failure never breaks the game.
function makeEnvironment(renderer) {
  if (typeof document === 'undefined') return null;
  const envScene = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  sunsetStops(grad);
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
  );
  envScene.add(sky);
  // Sun: a bright sphere in the light direction (drives the highlights) —
  // low in the south, at the end of the boulevard, like the visible sun.
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(9, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
  );
  sun.position.set(0, 18, 50);
  envScene.add(sun);
  // Warm ground below, so downward-facing reflections are warm, not black.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(90, 16),
    new THREE.MeshBasicMaterial({ color: 0x7a5a48 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -5;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  return envRT.texture;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure 1.25: the environment map now lifts the shadows, so a touch
  // less exposure keeps the highlights from blowing out (was 1.3).
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const skyTex = makeSkyTexture();
  if (skyTex) scene.background = skyTex;
  else scene.background = new THREE.Color(PAL.SKY_HORIZON);
  scene.fog = new THREE.Fog(PAL.FOG, CONFIG.RENDER.FOG_NEAR, CONFIG.RENDER.FOG_FAR);

  // Image-based lighting (see makeEnvironment): soft sky reflections on
  // every standard material. Guarded — if PMREM fails the game still runs
  // on direct + hemisphere light alone.
  try {
    const envTex = makeEnvironment(renderer);
    if (envTex) scene.environment = envTex;
  } catch (e) { /* no environment map; direct + hemisphere light only */ }

  const camera = new THREE.PerspectiveCamera(
    CONFIG.RENDER.CAMERA_FOV,
    canvas.clientWidth / Math.max(1, canvas.clientHeight),
    CONFIG.RENDER.CAMERA_NEAR, CONFIG.RENDER.CAMERA_FAR,
  );

  // Sunset sun: low in the south, warm; only the sun casts shadows.
  // South (was north-west) so the hero shot — driving south down the
  // beach — runs toward the sunset at the end of the road, with the
  // beachfront buildings on the left and the sea + palms on the right,
  // like the #1 entry. The environment map + hemisphere light keep the
  // shadowed side from going black. Shadow far raised to cover the whole
  // city from here.
  const sun = new THREE.DirectionalLight(PAL.SUN, PAL.SUN_INTENSITY);
  sun.position.set(-190, 55, 350);
  sun.castShadow = true;
  // Warm fill from the north-west (no shadow): lifts the camera-facing
  // facades + the GT's rear, which the low southern sun leaves in shade,
  // so the pastel buildings read bright like the reference instead of dark.
  const fill = new THREE.DirectionalLight(0xffc0a8, 0.8);
  fill.position.set(-150, 150, -200);
  scene.add(fill);
  sun.shadow.mapSize.set(CONFIG.RENDER.SHADOW_MAP, CONFIG.RENDER.SHADOW_MAP);
  sun.shadow.camera.left = -230;
  sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230;
  sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PAL.HEMI_SKY, PAL.HEMI_GROUND, PAL.HEMI_INTENSITY));

  // Visible sun disc + soft clouds, so the sky reads as a real golden-hour
  // sky instead of a flat gradient.
  const sunSprite = makeSunSprite();
  if (sunSprite) scene.add(sunSprite);
  const glareSprite = makeGlareSprite();
  if (glareSprite) scene.add(glareSprite);
  for (const cloud of makeClouds()) scene.add(cloud);

  // ---- Reused scratch objects (no per-frame allocation) ----
  const dummy = new THREE.Object3D();
  const camPos = new THREE.Vector3(0, 30, 60);
  const camTarget = new THREE.Vector3(0, 0, 0);
  const desiredPos = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const fwd = new THREE.Vector3();
  let snapped = false;

  // ---- Instanced car meshes (one set for every car in the world) ----
  const MAX_CARS = 32;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const carBody = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.55 }), MAX_CARS);
  const carCabin = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0x1a2432, roughness: 0.15, metalness: 0.4 }), MAX_CARS);
  // ---- Car wheels / hubs / lights: ROUND, not boxes ----
  // Wheels are cylinders (axis pre-rotated to X, so the round faces point
  // sideways) and lights are flattened spheres (sleek ovals). A box wheel
  // or a square headlight is what made every car read as a toy block.
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  wheelGeo.rotateZ(Math.PI / 2); // cylinder axis Y -> X (wheel axle)
  const carWheels = new THREE.InstancedMesh(wheelGeo,
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 }), MAX_CARS * 4);
  const hubGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const carHub = new THREE.InstancedMesh(hubGeo,
    new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.9 }), MAX_CARS * 4);
  const lightGeo = new THREE.SphereGeometry(0.5, 10, 6);
  const carHead = new THREE.InstancedMesh(lightGeo,
    new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe9b0, emissiveIntensity: 1.4, roughness: 0.3 }), MAX_CARS * 2);
  const carTail = new THREE.InstancedMesh(lightGeo,
    new THREE.MeshStandardMaterial({ color: 0xff2d2d, emissive: 0xff1a1a, emissiveIntensity: 1.6, roughness: 0.3 }), MAX_CARS * 2);
  const carBars = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0x000000 }), MAX_CARS * 2);
  carBody.castShadow = true;
  carCabin.castShadow = true;
  carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carCabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carTail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carHub.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(carBody);
  scene.add(carCabin);
  scene.add(carWheels);
  scene.add(carBars);
  scene.add(carHead);
  scene.add(carTail);
  scene.add(carHub);

  // ---- The Vespera GT: a dedicated smooth red coupe (NOT a box) ----
  // The hero sports car is built from an extruded side-profile (long hood,
  // flowing roofline, fastback tail) with bevelled edges, a separate dark
  // glasshouse, round wheels, oval lights, a full-width LED tail bar and
  // a subtle lip spoiler. One car only (the M2 beach car), so a single
  // Group is enough; syncCars positions it and skips the box meshes.
  const gtGroup = new THREE.Group();
  function extrudeCarProfile(buildShape, width) {
    const geo = new THREE.ExtrudeGeometry(buildShape(), {
      depth: width, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07,
      bevelSegments: 2, steps: 1,
    });
    geo.rotateY(-Math.PI / 2); // shape X (length) -> local Z (front +Z)
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
    return geo;
  }
  const gtBodyGeo = extrudeCarProfile(() => {
    const s = new THREE.Shape();
    s.moveTo(2.05, 0.18);
    s.quadraticCurveTo(2.15, 0.42, 1.95, 0.55); // nose
    s.quadraticCurveTo(1.4, 0.66, 0.85, 0.70);  // long hood
    s.lineTo(-1.85, 0.68);                       // beltline / rear deck
    s.quadraticCurveTo(-2.08, 0.60, -2.05, 0.30); // tail
    s.lineTo(2.05, 0.18);                        // underbody
    return s;
  }, 1.7);
  const gtGlassGeo = extrudeCarProfile(() => {
    const s = new THREE.Shape();
    s.moveTo(0.85, 0.68);                          // windshield base
    s.quadraticCurveTo(0.55, 0.95, 0.15, 1.02);   // windshield
    s.quadraticCurveTo(-0.4, 1.05, -0.85, 0.96);  // flowing roof
    s.quadraticCurveTo(-1.5, 0.82, -1.90, 0.66);  // fastback
    s.lineTo(0.85, 0.68);                          // beltline
    return s;
  }, 1.5);
  const gtPaint = new THREE.MeshStandardMaterial({
    color: CONFIG.CAR_MODELS.sports.color, roughness: 0.28, metalness: 0.65,
  });
  const gtBodyMesh = new THREE.Mesh(gtBodyGeo, gtPaint);
  gtBodyMesh.castShadow = true;
  const gtGlassMesh = new THREE.Mesh(gtGlassGeo,
    new THREE.MeshStandardMaterial({ color: 0x141c28, roughness: 0.12, metalness: 0.5 }));
  gtGroup.add(gtBodyMesh);
  gtGroup.add(gtGlassMesh);
  // Round wheels + silver hubs (cylinders, axis along X).
  const gtTireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  gtTireGeo.rotateZ(Math.PI / 2);
  const gtHubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 12);
  gtHubGeo.rotateZ(Math.PI / 2);
  const gtTireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const gtHubMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.3, metalness: 0.85 });
  for (const [wx, wz] of [[-0.83, 1.35], [0.83, 1.35], [-0.83, -1.35], [0.83, -1.35]]) {
    const tire = new THREE.Mesh(gtTireGeo, gtTireMat);
    tire.position.set(wx, 0.34, wz);
    tire.castShadow = true;
    const hub = new THREE.Mesh(gtHubGeo, gtHubMat);
    hub.position.set(wx, 0.34, wz);
    gtGroup.add(tire);
    gtGroup.add(hub);
  }
  // Oval headlights (warm white, emissive) + full-width LED tail bar.
  const gtLightGeo = new THREE.SphereGeometry(0.5, 10, 6);
  const gtHeadMat = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe9b0, emissiveIntensity: 1.4, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(gtLightGeo, gtHeadMat);
    hl.scale.set(0.32, 0.16, 0.12);
    hl.position.set(0.58 * side, 0.52, 2.02);
    gtGroup.add(hl);
  }
  const gtTailGeo = new THREE.CapsuleGeometry(0.06, 1.4, 3, 8);
  gtTailGeo.rotateZ(Math.PI / 2); // capsule axis -> X (across the tail)
  const gtTail = new THREE.Mesh(gtTailGeo,
    new THREE.MeshStandardMaterial({ color: 0xff2d2d, emissive: 0xff1a1a, emissiveIntensity: 1.6, roughness: 0.3 }));
  gtTail.position.set(0, 0.60, -2.06);
  gtGroup.add(gtTail);
  // A BIG BLACK rear wing (blade on two tall struts), wider + higher than
  // the body-colour wing — the #1 entry's VESPERA GT wears a large black
  // spoiler over the fastback tail, and the black reads against the pink.
  const gtWingMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.7 });
  const gtLip = new THREE.Mesh(boxGeo, gtWingMat);
  gtLip.scale.set(2.2, 0.08, 0.6);
  gtLip.position.set(0, 1.05, -1.95);
  gtLip.rotation.x = -0.10;
  const gtGrille = new THREE.Mesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.4 }));
  gtGrille.scale.set(1.3, 0.14, 0.06);
  gtGrille.position.set(0, 0.32, 2.08);
  gtGroup.add(gtLip);
  const gtStrutMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.5 });
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(boxGeo, gtStrutMat);
    strut.scale.set(0.09, 0.45, 0.2);
    strut.position.set(0.65 * side, 0.85, -1.95);
    gtGroup.add(strut);
  }
  gtGroup.add(gtGrille);
  const gtMirrorGeo = new THREE.SphereGeometry(0.07, 12, 8);
  const gtMirrorMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.5 });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(gtMirrorGeo, gtMirrorMat);
    m.scale.set(1, 0.7, 1.4);
    m.position.set(0.98 * side, 0.82, 0.75);
    gtGroup.add(m);
    const skirt = new THREE.Mesh(boxGeo,
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.4 }));
    skirt.scale.set(0.06, 0.09, 3.4);
    skirt.position.set(0.92 * side, 0.20, 0);
    gtGroup.add(skirt);
  }
  // Shoulder character lines (thin darker-magenta strips along each flank)
  // + a front splitter — body lines that keep the flanks from reading flat.
  const gtLineMat = new THREE.MeshStandardMaterial({ color: 0x8f1450, roughness: 0.35, metalness: 0.6 });
  for (const side of [-1, 1]) {
    const gline = new THREE.Mesh(boxGeo, gtLineMat);
    gline.scale.set(0.03, 0.04, 3.1);
    gline.position.set(0.93 * side, 0.56, 0);
    gtGroup.add(gline);
  }
  const gtSplitter = new THREE.Mesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.4 }));
  gtSplitter.scale.set(1.6, 0.07, 0.3);
  gtSplitter.position.set(0, 0.16, 2.02);
  gtGroup.add(gtSplitter);
  gtGroup.visible = false;
  gtGroup.name = 'vespera-gt';
  scene.add(gtGroup);

  // ---- Instanced pedestrian meshes (SMOOTH, not boxes) ----
  // Rounded torsos (capsules), sphere heads, capsule legs and a hair cap
  // — pedestrians must read as people, not toy blocks. Colours vary per
  // ped (ped.color) so the crowd is not monotonous.
  const MAX_PEDS = 32;
  const pedBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.5, 0.5, 3, 8),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_PEDS);
  const pedHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.9 }), MAX_PEDS);
  const pedLegs = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.5, 0.5, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.95 }), MAX_PEDS);
  pedBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedLegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pedBody);
  scene.add(pedHead);
  scene.add(pedLegs);

  // Ped hair: a dark cap on every head (colour varies per ped).
  const HAIR_COLORS = [0x1a1a1a, 0x3a2a1a, 0x6a4a2a, 0x8a8a8a, 0x2a2a3a];
  const pedHair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 6),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }), MAX_PEDS);
  pedHair.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pedHair);

  // ---- Cash pickups (gold bundles, bobbing + spinning) + mission beacon ----
  const MAX_PICKUPS = 8;
  const pickupMesh = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0xffd23d, roughness: 0.3, metalness: 0.6, emissive: 0x664400 }), MAX_PICKUPS);
  pickupMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pickupMesh);
  const beaconGeo = new THREE.CylinderGeometry(1.1, 1.1, 40, 12, 1, true);
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffd23d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.visible = false;
  scene.add(beacon);

  // ---- The player (one small group, hidden while driving) ----
  const playerGroup = new THREE.Group();
  // Jason Duval (GTA 6): capsules + spheres, NOT boxes — a rounded
  // athletic torso, a sphere head, a flattened hair cap, a thin stubble
  // arc. Light skin, short dark hair, light stubble, white tank top,
  // blue jeans. (CJ/Grove bandana removed — the MC is Jason, not CJ.)
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.75 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.8 });
  const jeansMat = new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: 0.95 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.95 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
  // Athletic torso: a capsule, wider than deep (muscular, not a slab).
  const pBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.42, 4, 12), tankMat);
  pBody.scale.set(1.35, 1, 0.72);
  pBody.position.y = 1.08;
  pBody.castShadow = true;
  // Head: a smooth sphere.
  const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 12), skinMat);
  pHead.position.y = 1.66;
  pHead.castShadow = true;
  // Short dark crop: a flattened sphere cap on top of the head.
  const pHair = new THREE.Mesh(new THREE.SphereGeometry(0.20, 18, 10), hairMat);
  pHair.scale.set(1, 0.55, 1);
  pHair.position.y = 1.78;
  // Light stubble: a thin, flattened dark sphere on the lower face.
  const pBeard = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), hairMat);
  pBeard.scale.set(1, 0.55, 0.55);
  pBeard.position.set(0, 1.57, 0.10);
  // Arms: bare (tank top) capsules hanging at the sides, slightly out.
  const pArmGeo = new THREE.CapsuleGeometry(0.085, 0.42, 3, 10);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(pArmGeo, skinMat);
    arm.position.set(0.34 * side, 1.05, 0);
    arm.rotation.z = -0.12 * side;
    arm.castShadow = true;
    playerGroup.add(arm);
  }
  // Legs: two jean capsules (not one slab).
  const pLegGeo = new THREE.CapsuleGeometry(0.11, 0.44, 3, 10);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(pLegGeo, jeansMat);
    leg.position.set(0.13 * side, 0.48, 0);
    leg.castShadow = true;
    playerGroup.add(leg);
  }
  // White sneakers: rounded (flattened spheres), slightly forward.
  const pShoeGeo = new THREE.SphereGeometry(0.5, 12, 8);
  for (const side of [-1, 1]) {
    const shoe = new THREE.Mesh(pShoeGeo, shoeMat);
    shoe.scale.set(0.26, 0.13, 0.46);
    shoe.position.set(0.13 * side, 0.07, 0.06);
    playerGroup.add(shoe);
  }
  playerGroup.add(pBody);
  playerGroup.add(pHead);
  playerGroup.add(pHair);
  playerGroup.add(pBeard);
  playerGroup.name = 'player';
  scene.add(playerGroup);

  // ---- The tank (military pursuit, wanted 4+) ----
  // One group: dark track base with ROUND road wheels, olive hull with a
  // sloped glacis plate, a ROUND turret (cylinder + dome hatch) and a
  // long cannon with a muzzle brake. A box turret and a bare track base
  // are what made it read as a toy block. Follows the first kind==='tank'
  // car in state.cars; hidden otherwise.
  const tankGroup = new THREE.Group();
  const tankTracks = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }));
  tankTracks.scale.set(2.8, 0.8, 4.6);
  tankTracks.position.y = 0.4;
  tankTracks.castShadow = true;
  // Road wheels: 5 round wheels per side, breaking up the track slab.
  const tankWheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 12);
  tankWheelGeo.rotateZ(Math.PI / 2);
  const tankWheelMat = new THREE.MeshStandardMaterial({ color: 0x2e2a22, roughness: 0.9, metalness: 0.3 });
  for (const side of [-1, 1]) {
    for (let w = 0; w < 5; w += 1) {
      const wheel = new THREE.Mesh(tankWheelGeo, tankWheelMat);
      wheel.position.set(1.42 * side, 0.4, -1.8 + w * 0.9);
      tankGroup.add(wheel);
    }
  }
  const tankHull = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.7, metalness: 0.2 }));
  tankHull.scale.set(2.4, 1.0, 4.4);
  tankHull.position.y = 1.0;
  tankHull.castShadow = true;
  // Sloped glacis plate on the front (angled armour, not a flat face).
  const tankGlacis = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.7, metalness: 0.2 }));
  tankGlacis.scale.set(2.4, 0.9, 0.18);
  tankGlacis.position.set(0, 0.95, 2.2);
  tankGlacis.rotation.x = -0.5;
  tankGlacis.castShadow = true;
  // ROUND turret: a low wide cylinder + a dome hatch on top.
  const tankTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.55, 16),
    new THREE.MeshStandardMaterial({ color: 0x55604a, roughness: 0.7, metalness: 0.2 }));
  tankTurret.position.set(0, 1.75, -0.3);
  tankTurret.castShadow = true;
  const tankHatch = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.22, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.7, metalness: 0.2 }));
  tankHatch.position.set(0, 2.1, -0.3);
  tankHatch.castShadow = true;
  // Long cannon with a muzzle brake (wider tip).
  const tankBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.1, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }));
  tankBarrel.rotation.x = Math.PI / 2;
  tankBarrel.position.set(0, 1.8, 2.1);
  tankBarrel.castShadow = true;
  const tankMuzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }));
  tankMuzzle.rotation.x = Math.PI / 2;
  tankMuzzle.position.set(0, 1.8, 3.6);
  tankMuzzle.castShadow = true;
  tankGroup.add(tankTracks);
  tankGroup.add(tankHull);
  tankGroup.add(tankGlacis);
  tankGroup.add(tankTurret);
  tankGroup.add(tankHatch);
  tankGroup.add(tankBarrel);
  tankGroup.add(tankMuzzle);
  tankGroup.visible = false;
  tankGroup.name = 'tank';
  scene.add(tankGroup);

  // ---- The pursuit helicopter (wanted 3+) ----
  // Dark fuselage + spinning main rotor, with a spotlight beam (additive
  // cone) and a glowing pool on the road below. Follows the player.
  const heliGroup = new THREE.Group();
  const heliBody = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.3 }));
  heliBody.scale.set(2.2, 1.6, 5.5);
  const heliRotor = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.5 }));
  heliRotor.scale.set(11, 0.12, 0.5);
  heliRotor.position.y = 1.0;
  const heliBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 6.5, 18, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  );
  heliBeam.position.y = -9;
  const heliPool = new THREE.Mesh(
    new THREE.CircleGeometry(6.5, 24),
    new THREE.MeshBasicMaterial({ map: makeGlowTexture(), color: 0xfff2cc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  heliPool.rotation.x = -Math.PI / 2;
  heliPool.position.y = -17.9;
  heliGroup.add(heliBody);
  heliGroup.add(heliRotor);
  heliGroup.add(heliBeam);
  heliGroup.add(heliPool);
  heliGroup.visible = false;
  heliGroup.name = 'heli';
  scene.add(heliGroup);

  let city = null;

  function buildScene(builtCity) {
    city = builtCity;
    scene.add(city.group);
  }

  function resize(width, height) {
    const w = width || canvas.clientWidth || 1280;
    const h = height || canvas.clientHeight || 720;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // Compose one instance matrix: position (x, y, z), yaw, scale.
  function setInstance(mesh, i, x, y, z, yaw, sx, sy, sz) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  function syncCars(state, time) {
    const cars = state.cars;
    const n = Math.min(cars.length, MAX_CARS);
    let ci = 0; // instance index (a tank in the list must not shift it)
    let barIdx = 0;
    let headIdx = 0;
    let tailIdx = 0;
    let hubIdx = 0;
    const flash = Math.floor(time * 2.4) % 2 === 0;
    gtGroup.visible = false;
    for (let i = 0; i < n; i += 1) {
      const car = cars[i];
      // The tank has its own group (see syncTank); the instanced car
      // meshes skip it so it never renders as a box car.
      if (car.kind === 'tank') continue;
      // The Vespera GT renders from its own smooth group (extruded coupe),
      // never from the box instanced meshes.
      if (car.kind === 'sports') {
        gtGroup.visible = true;
        gtGroup.position.set(car.x, 0, car.z);
        gtGroup.rotation.y = car.angle;
        continue;
      }
      const yaw = car.angle;
      const bodyY = 0.55;
      const bodyH = 0.75;
      setInstance(carBody, ci, car.x, bodyY, car.z, yaw, car.wid, bodyH, car.len);
      carBody.setColorAt(ci, tmpColor.setHex(car.color));
      // Cabin: a dark glass box, set slightly back.
      const cabLen = car.len * 0.5;
      const cabH = 0.55;
      const cabY = 1.05;
      const cabBack = car.len * 0.08;
      const cx = car.x - Math.sin(car.angle) * cabBack;
      const cz = car.z - Math.cos(car.angle) * cabBack;
      setInstance(carCabin, ci, cx, cabY, cz, yaw, car.wid * 0.86, cabH, cabLen);
      // Wheels: 4 corners. Forward = (sin, cos); right = (-cos, sin).
      const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
      const rx = -fz, rz = fx;
      const wy = 0.32;
      const corners = [
        [fx * car.len * 0.32 + rx * car.wid * 0.48, fz * car.len * 0.32 + rz * car.wid * 0.48],
        [fx * car.len * 0.32 - rx * car.wid * 0.48, fz * car.len * 0.32 - rz * car.wid * 0.48],
        [-fx * car.len * 0.32 + rx * car.wid * 0.48, -fz * car.len * 0.32 + rz * car.wid * 0.48],
        [-fx * car.len * 0.32 - rx * car.wid * 0.48, -fz * car.len * 0.32 - rz * car.wid * 0.48],
      ];
      for (let w = 0; w < 4; w += 1) {
        setInstance(carWheels, ci * 4 + w, car.x + corners[w][0], wy, car.z + corners[w][1], yaw, 0.3, 0.62, 0.62);
        // Hubcap: a silver slab slightly wider than the wheel.
        setInstance(carHub, hubIdx, car.x + corners[w][0], wy, car.z + corners[w][1], yaw, 0.34, 0.42, 0.42);
        hubIdx += 1;
      }
      // Headlights (front corners) + taillights (rear corners).
      const fwdX = fx * car.len * 0.5, fwdZ = fz * car.len * 0.5;
      const ly = 0.62;
      for (const side of [-1, 1]) {
        setInstance(carHead, headIdx, car.x + fwdX + rx * car.wid * 0.32 * side, ly, car.z + fwdZ + rz * car.wid * 0.32 * side, yaw, 0.35, 0.18, 0.1);
        headIdx += 1;
        setInstance(carTail, tailIdx, car.x - fwdX + rx * car.wid * 0.32 * side, ly, car.z - fwdZ + rz * car.wid * 0.32 * side, yaw, 0.35, 0.16, 0.1);
        tailIdx += 1;
      }
      // Police light bar: two flashing boxes on the roof.
      if (car.isPolice) {
        const bx = car.x - Math.sin(car.angle) * car.len * 0.05;
        const bz = car.z - Math.cos(car.angle) * car.len * 0.05;
        setInstance(carBars, barIdx, bx - rx * 0.35, 1.42, bz - rz * 0.35, yaw, 0.5, 0.22, 0.3);
        carBars.setColorAt(barIdx, tmpColor.setHex(flash ? 0xff2d4a : 0x222244));
        barIdx += 1;
        setInstance(carBars, barIdx, bx + rx * 0.35, 1.42, bz + rz * 0.35, yaw, 0.5, 0.22, 0.3);
        carBars.setColorAt(barIdx, tmpColor.setHex(flash ? 0x222244 : 0x2d7dff));
        barIdx += 1;
      }
      ci += 1;
    }
    carBody.count = ci;
    carCabin.count = ci;
    carWheels.count = ci * 4;
    carBars.count = barIdx;
    carHead.count = headIdx;
    carTail.count = tailIdx;
    carHub.count = hubIdx;
    carBody.instanceMatrix.needsUpdate = true;
    carCabin.instanceMatrix.needsUpdate = true;
    carWheels.instanceMatrix.needsUpdate = true;
    carBars.instanceMatrix.needsUpdate = true;
    carHead.instanceMatrix.needsUpdate = true;
    carTail.instanceMatrix.needsUpdate = true;
    carHub.instanceMatrix.needsUpdate = true;
    if (carBody.instanceColor) carBody.instanceColor.needsUpdate = true;
    if (carBars.instanceColor) carBars.instanceColor.needsUpdate = true;
  }

  function syncPeds(state) {
    const peds = state.peds;
    const n = Math.min(peds.length, MAX_PEDS);
    pedBody.count = n;
    pedHead.count = n;
    pedLegs.count = n;
    pedHair.count = n;
    for (let i = 0; i < n; i += 1) {
      const ped = peds[i];
      const yaw = ped.angle;
      const bob = ped.speed > 0.2 ? Math.abs(Math.sin(ped.bobPhase)) * 0.07 : 0;
      setInstance(pedBody, i, ped.x, 0.95 + bob, ped.z, yaw, 0.5, 0.8, 0.3);
      pedBody.setColorAt(i, tmpColor.setHex(ped.color));
      setInstance(pedHead, i, ped.x, 1.62 + bob, ped.z, yaw, 0.32, 0.32, 0.32);
      setInstance(pedLegs, i, ped.x, 0.35 + bob, ped.z, yaw, 0.42, 0.7, 0.26);
      setInstance(pedHair, i, ped.x, 1.82 + bob, ped.z, yaw, 0.34, 0.12, 0.34);
      pedHair.setColorAt(i, tmpColor.setHex(HAIR_COLORS[i % HAIR_COLORS.length]));
    }
    pedBody.instanceMatrix.needsUpdate = true;
    pedHead.instanceMatrix.needsUpdate = true;
    pedLegs.instanceMatrix.needsUpdate = true;
    pedHair.instanceMatrix.needsUpdate = true;
    if (pedBody.instanceColor) pedBody.instanceColor.needsUpdate = true;
    if (pedHair.instanceColor) pedHair.instanceColor.needsUpdate = true;
  }

  // The tank follows the first kind==='tank' car (a police unit); hidden
  // when there is no tank in the world.
  function syncTank(state) {
    const tank = (state.cars || []).find((c) => c.kind === 'tank');
    if (!tank) { tankGroup.visible = false; return; }
    tankGroup.visible = true;
    tankGroup.position.set(tank.x, 0, tank.z);
    tankGroup.rotation.y = tank.angle;
  }

  // The pursuit helicopter hovers ahead of the player at 3+ stars, its
  // spotlight beam landing on the road in front of the car. Low (18 m) and
  // 30 m ahead, so the fuselage + rotor sit inside the chase camera's
  // frame (a high heli is above the frame — only its beam would show).
  // The rotor spin is a pure function of time, so staged shots stay
  // deterministic.
  function syncHeli(state, time) {
    if ((state.wanted || 0) < 3) { heliGroup.visible = false; return; }
    heliGroup.visible = true;
    const p = state.player;
    const fx = p.car ? Math.sin(p.car.angle) : Math.sin(p.yaw || 0);
    const fz = p.car ? Math.cos(p.car.angle) : Math.cos(p.yaw || 0);
    // Hero shot: FAR + SMALL (55 m ahead, 22 m up, scale 1.0) — the #1
    // entry's heli is a dark silhouette high above the horizon, NOT a
    // big object. The beam is rescaled so it still reaches the road
    // (height = alt, pool at ground level), whatever the altitude.
    const ahead = state.heroCam ? 55 : 30;
    const alt = state.heroCam ? 22 : 18;
    heliBody.scale.set(2.2, 1.6, 5.5);
    heliRotor.scale.set(11, 0.12, 0.5);
    heliRotor.position.y = 1.0;
    heliBeam.scale.y = alt / 18;
    heliBeam.position.y = -alt / 2;
    heliPool.position.y = -(alt - 0.1);
    heliGroup.position.set(p.x + fx * ahead, alt, p.z + fz * ahead);
    heliGroup.rotation.y = Math.atan2(fx, fz);
    heliRotor.rotation.y = time * 15;
  }

  function syncLights(time) {
    if (!city || !city.lights || !city.lights.heads) return;
    const heads = city.lights.heads;
    const positions = city.lights.positions;
    for (let i = 0; i < positions.length; i += 1) {
      const green = nsGreen(time, positions[i].x, positions[i].z);
      heads.setColorAt(i, tmpColor.setHex(green ? 0x39ff88 : 0xff2d4a));
    }
    heads.instanceColor.needsUpdate = true;
  }

  function syncPickups(state, time) {
    const pickups = (state.pickups || []).filter((pk) => !pk.taken);
    const n = Math.min(pickups.length, MAX_PICKUPS);
    pickupMesh.count = n;
    for (let i = 0; i < n; i += 1) {
      const pk = pickups[i];
      const bob = 0.7 + Math.sin(time * 2 + i * 1.7) * 0.15;
      setInstance(pickupMesh, i, pk.x, bob, pk.z, time * 1.2 + i, 0.7, 0.45, 0.7);
    }
    pickupMesh.instanceMatrix.needsUpdate = true;
    // Mission / taxi beacon: a pulsing column of light over the marker.
    const marker = (state.mission && state.mission.marker) || state.taxiMarker || null;
    if (marker) {
      beacon.visible = true;
      beacon.position.set(marker.x, 20, marker.z);
      beaconMat.opacity = 0.2 + 0.15 * Math.sin(time * 3);
    } else {
      beacon.visible = false;
    }
  }

  // Camera: exponential smoothing at a fixed 1/60 s step (draw runs once per
  // frame), look-ahead, snap on teleport. `fx` is the effects object from
  // main.js (its fovKick is applied); camera shake is applied by
  // effects.applyCamera AFTER draw, not here.
  function updateCamera(state, fx) {
    const dt = 1 / 60;
    const p = state.player;
    const inCar = !!p.car;
    let tx, tz, tyaw;
    if (inCar) {
      tx = p.car.x; tz = p.car.z; tyaw = p.car.angle;
    } else {
      tx = p.x; tz = p.z; tyaw = p.yaw;
    }
    // One convention: forward = (sin angle, cos angle). On foot the camera
    // looks where the mouse points (yaw); in the car it looks where the car
    // points (angle). Pitch tilts the look target up/down.
    fwd.set(Math.sin(tyaw), 0, Math.cos(tyaw));
    if (inCar && state.heroCam) {
      // Hero shot: LOW + CLOSE rear 3/4 chase cam (the #1 entry's angle)
      // — back 6.5 m, out 3.5 m to the right, 2.6 m up, looking 6 m ahead
      // of the car — so the GT fills the centre-bottom of the frame, the
      // asphalt fills the bottom third, and the horizon sits mid-frame.
      const rx = -fwd.z, rz = fwd.x; // right = (-cos, sin)
      desiredPos.set(tx - fwd.x * 6.5 + rx * 3.5, 2.6, tz - fwd.z * 6.5 + rz * 3.5);
      desiredTarget.set(tx + fwd.x * 6, 2.0, tz + fwd.z * 6);
    } else if (inCar) {
      desiredPos.set(tx - fwd.x * 9.5, 4.4, tz - fwd.z * 9.5);
      desiredTarget.set(tx + fwd.x * 9, 1.4, tz + fwd.z * 9);
    } else {
      desiredPos.set(tx - fwd.x * 4.6, 2.6 + p.pitch * 0.5, tz - fwd.z * 4.6);
      desiredTarget.set(tx + fwd.x * 4, Math.max(0.2, 1.3 + p.pitch * 2), tz + fwd.z * 4);
    }
    const rate = 6;
    const t = 1 - Math.exp(-rate * dt);
    if (!snapped) {
      camPos.copy(desiredPos);
      camTarget.copy(desiredTarget);
      snapped = true;
    } else {
      camPos.lerp(desiredPos, t);
      camTarget.lerp(desiredTarget, t);
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    const speedRatio = inCar ? Math.min(1, Math.abs(p.car.speed) / p.car.topSpeed) : 0;
    const targetFov = CONFIG.RENDER.CAMERA_FOV + speedRatio * 8 + (fx && fx.fovKick ? fx.fovKick : 0);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, 5 * dt);
      camera.updateProjectionMatrix();
    }
  }

  function snapCamera() { snapped = false; }

  function draw(state, fx) {
    syncCars(state, state.time);
    syncPeds(state);
    syncTank(state);
    syncHeli(state, state.time);
    syncLights(state.time);
    syncPickups(state, state.time);
    const p = state.player;
    if (p.onFoot) {
      playerGroup.visible = true;
      playerGroup.position.set(p.x, 0, p.z);
      playerGroup.rotation.y = p.heading;
    } else {
      playerGroup.visible = false;
    }
    updateCamera(state, fx);
    renderer.render(scene, camera);
  }

  function getStats() {
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  }

  resize();
  return { draw, resize, buildScene, snapCamera, getStats, scene, camera, renderer };
}
