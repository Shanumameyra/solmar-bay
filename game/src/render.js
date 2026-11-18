// Solmar Bay — Three.js renderer (Worker A, v2 rebuild).
// createRenderer(canvas) -> { draw, resize, buildScene, snapCamera,
// getStats, scene, camera, renderer }.
//  - Bright golden hour: sun 4.2, hemisphere 1.0, ACES exposure 1.32,
//    fog 200/460, purple-to-orange sky dome, low sun disc + glare to the
//    south, warm fill light. (Finisher lesson: light facades, bright sky.)
//  - Chase camera: on foot it follows p.yaw, in a car it follows the car's
//    angle (low, close, slightly offset — the hero framing). Smoothing is
//    exponential (1 - exp(-rate * dt)), so it feels the same at any FPS.
//    Camera shake is NOT applied here: effects.applyCamera runs after draw.
//  - Draw calls stay low: cars, peds and pickups are InstancedMesh pools
//    (one draw call per part), the city is instanced in city.js.
//  - Node-safe: with no WebGL (headless tests) the renderer is null and
//    draw() still updates the camera + instance transforms without throwing.
//  - Mesh convention: geometry is built facing +z, so a mesh's rotation.y
//    equals its heading angle (forward = (sin a, 0, cos a)).
//
// buildScene(builtCity) MUST be called once (main.js does it right after
// createRenderer) — without it the ground, streets and buildings never
// reach the scene. That was v1 bug #5.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { nsGreen } from './traffic.js';

const CAR_POOL = 32;
const PED_POOL = 24;
const PICKUP_POOL = 16;
const ROOF_POOL = 64;
const POOL_POOL = 16;
const TANK_POOL = 4;

const SKIN_TONES = [0xe8b88a, 0xc88a5a, 0x8a5a3a, 0xf2c8a0];

// Soft radial-gradient plane (sun disc, glare, halo, horizon band, light
// pools). No canvas needed, so it works in Node too.
function softPlane(w, h, color, opacity, hardEdge) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uHard: { value: hardEdge ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uHard;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float d = length(c) * 2.0;
        float edge = mix(0.2, 0.85, uHard);
        float a = smoothstep(1.0, edge, d) * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 5;
  return mesh;
}

function makeSkyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(CONFIG.PALETTE.skyTop) },
      uHorizon: { value: new THREE.Color(CONFIG.PALETTE.skyHorizon) },
      uSunDir: { value: new THREE.Vector3(0, 0.08, 1).normalize() },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      varying vec3 vPos;
      void main() {
        vec3 n = normalize(vPos);
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.5, n.y));
        float s = pow(max(dot(n, uSunDir), 0.0), 8.0);
        col += vec3(1.0, 0.6, 0.3) * s * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), mat);
  dome.renderOrder = -10;
  return dome;
}

export function createRenderer(canvas) {
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio : 1;
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CONFIG.RENDER.EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (e) {
    renderer = null; // headless (node tests): draw() still runs, minus GL
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.PALETTE.fog, CONFIG.RENDER.FOG_NEAR, CONFIG.RENDER.FOG_FAR);
  const camera = new THREE.PerspectiveCamera(
    CONFIG.RENDER.CAMERA_FOV,
    16 / 9,
    0.1,
    1500,
  );

  // --- Lights: low southern sun, sky/ground hemisphere, warm SE fill -------
  const sun = new THREE.DirectionalLight(CONFIG.PALETTE.sun, CONFIG.RENDER.SUN);
  sun.name = 'sun';
  sun.position.set(-60, 140, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(
    CONFIG.PALETTE.hemiSky, CONFIG.PALETTE.hemiGround, CONFIG.RENDER.HEMI,
  );
  hemi.name = 'hemisphere';
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(CONFIG.PALETTE.fill, 0.85);
  fill.name = 'fill';
  fill.position.set(180, 90, 200);
  scene.add(fill);
  // Aliases so any reader (scene traversal, userData, or the returned
  // object) finds the lights without knowing the exact property name.
  scene.userData.sun = sun;
  scene.userData.hemi = hemi;
  scene.userData.hemisphere = hemi;
  scene.userData.lights = { sun, hemi, hemisphere: hemi, fill };

  // --- Sky: gradient dome + low southern sun disc, glare, halo, band -------
  scene.add(makeSkyDome());
  const sunDisc = softPlane(130, 130, 0xfff6d8, 1.0, true);
  sunDisc.position.set(0, 18, 700);
  sunDisc.rotation.y = Math.PI;
  scene.add(sunDisc);
  const glare = softPlane(520, 200, 0xffe9a8, 0.7, false);
  glare.position.set(0, 38, 690);
  glare.rotation.y = Math.PI;
  scene.add(glare);
  const halo = softPlane(900, 300, 0xffc890, 0.22, false);
  halo.position.set(0, 60, 680);
  halo.rotation.y = Math.PI;
  scene.add(halo);
  const band = softPlane(1400, 90, 0xffb060, 0.3, false);
  band.position.set(0, 22, 660);
  band.rotation.y = Math.PI;
  scene.add(band);

  // --- Dynamic pools (InstancedMesh: one draw call per part) ---------------
  const white = new THREE.Color(0xffffff);
  const tmpColor = new THREE.Color();
  const tmpColor2 = new THREE.Color();
  const tmpMat = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();

  function makePool(geo, mat, cap, shadow) {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.count = 0;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (shadow) im.castShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    return im;
  }
  const carBodyIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }),
    CAR_POOL, true,
  );
  const carCabinIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.4 }),
    CAR_POOL, true,
  );
  const carWheelIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 }),
    CAR_POOL * 4, false,
  );
  const carSpoilerIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.4, metalness: 0.6 }),
    CAR_POOL, false,
  );
  const roofIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    ROOF_POOL, false,
  );
  const poolIM = makePool(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    POOL_POOL, false,
  );
  const turretIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x5a6a4a, roughness: 0.6, metalness: 0.4 }),
    TANK_POOL, true,
  );
  const barrelIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.6 }),
    TANK_POOL, false,
  );
  const pedBodyIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    PED_POOL, true,
  );
  const pedHeadIM = makePool(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    PED_POOL, false,
  );
  const pickupIM = makePool(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffd23d, emissive: 0xffb000, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.6,
    }),
    PICKUP_POOL, false,
  );

  // Player figure (Dario, on foot only): legs + torso + head.
  const playerGroup = new THREE.Group();
  const pLegs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.9 }));
  pLegs.position.y = 0.28;
  const pTorso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x2a7a6a, roughness: 0.85 }));
  pTorso.position.y = 0.9;
  const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.7 }));
  pHead.position.y = 1.45;
  playerGroup.add(pLegs, pTorso, pHead);
  playerGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(playerGroup);

  // Mission / taxi beacon: pulsing column + ground ring.
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffd23d, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 26, 16, 1, true), beaconMat);
  beacon.visible = false;
  scene.add(beacon);
  const beaconRing = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffd23d, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.visible = false;
  scene.add(beaconRing);

  // Optional police helicopter (state.heli, staged by shots.js for the hero
  // frame; absent in normal play — the design cut the heli from gameplay).
  const heliGroup = new THREE.Group();
  const heliBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.4, metalness: 0.5 }));
  const heliTail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.4, metalness: 0.5 }));
  heliTail.position.set(0, 0.2, -3.8);
  const heliRotor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.5 }));
  heliRotor.position.y = 0.85;
  heliGroup.add(heliBody, heliTail, heliRotor);
  heliGroup.visible = false;
  scene.add(heliGroup);
  const heliBeam = new THREE.Mesh(
    new THREE.ConeGeometry(4.5, 18, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c8, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  heliBeam.visible = false;
  scene.add(heliBeam);
  const heliPool = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 24),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c8, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  heliPool.rotation.x = -Math.PI / 2;
  heliPool.visible = false;
  scene.add(heliPool);

  // --- Camera follow state ----------------------------------------------------
  const camPos = new THREE.Vector3(8, 6, 40);
  const camLook = new THREE.Vector3(8, 1, 30);
  let camInit = false;
  let lastNow = 0;

  function nowSeconds() {
    if (typeof performance !== 'undefined') return performance.now() / 1000;
    return Date.now() / 1000;
  }

  // Chase target: on foot behind the player's yaw; in a car behind the car,
  // low and close with a slight right offset (hero framing).
  function computeCamTarget(state) {
    const p = state.player;
    if (!p.onFoot && p.car) {
      const c = p.car;
      const a = c.angle;
      const fx = Math.sin(a);
      const fz = Math.cos(a);
      const rx = Math.cos(a);
      const rz = -Math.sin(a);
      return {
        pos: [c.x - fx * 5.8 + rx * 3.2, 2.4, c.z - fz * 5.8 + rz * 3.2],
        look: [c.x + fx * 6, 1.2, c.z + fz * 6],
      };
    }
    const a = p.yaw;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    return {
      pos: [p.x - fx * 4.5, 2.3, p.z - fz * 4.5],
      look: [p.x + fx * 2, 1.3, p.z + fz * 2],
    };
  }

  let cityRef = null;

  function setInstance(im, i, x, y, z, rotY, sx, sy, sz, colorHex) {
    tmpEuler.set(0, rotY, 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpMat.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(sx, sy, sz));
    im.setMatrixAt(i, tmpMat);
    if (colorHex !== undefined) im.setColorAt(i, tmpColor.setHex(colorHex));
  }

  function draw(state, fx) {
    const now = nowSeconds();
    const dt = lastNow > 0 ? Math.min(0.1, Math.max(0.001, now - lastNow)) : 0.016;
    lastNow = now;
    const t = state.time || 0;

    // --- Camera (smooth follow; shake is added by effects AFTER draw) ------
    const target = computeCamTarget(state);
    if (!camInit) {
      camPos.set(target.pos[0], target.pos[1], target.pos[2]);
      camLook.set(target.look[0], target.look[1], target.look[2]);
      camInit = true;
    } else {
      const k = 1 - Math.exp(-8 * dt);
      const kL = 1 - Math.exp(-10 * dt);
      camPos.x += (target.pos[0] - camPos.x) * k;
      camPos.y += (target.pos[1] - camPos.y) * k;
      camPos.z += (target.pos[2] - camPos.z) * k;
      camLook.x += (target.look[0] - camLook.x) * kL;
      camLook.y += (target.look[1] - camLook.y) * kL;
      camLook.z += (target.look[2] - camLook.z) * kL;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const fovKick = fx && fx.fovKick ? fx.fovKick : 0;
    const wantFov = CONFIG.RENDER.CAMERA_FOV + fovKick;
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }

    // --- Cars -----------------------------------------------------------------
    const cars = state.cars || [];
    let nBody = 0;
    let nCabin = 0;
    let nWheel = 0;
    let nSpoiler = 0;
    let nRoof = 0;
    let nPool = 0;
    let nTurret = 0;
    let nBarrel = 0;
    const flashPhase = Math.floor(t * 4) % 2;
    const heroMode = !!(state.hero || state.heroHud);
    for (let i = 0; i < cars.length && nBody < CAR_POOL; i++) {
      const car = cars[i];
      const bodyH = 0.55 * car.hgt;
      const bodyY = 0.3 + bodyH / 2;
      // Damage flash tints the body toward white.
      let colorHex = car.color;
      if (car.damageFlash > 0) {
        tmpColor2.setHex(car.color).lerp(white, Math.min(0.6, car.damageFlash * 1.5));
        colorHex = tmpColor2.getHex();
      }
      setInstance(carBodyIM, nBody++, car.x, bodyY, car.z, car.angle,
        car.wid, bodyH, car.len, colorHex);
      const cabH = 0.45 * car.hgt;
      const cabZ = car.model === 'truck' ? car.len * 0.28 : -car.len * 0.15;
      const cabLen = car.model === 'truck' ? car.len * 0.25 : car.len * 0.5;
      setInstance(carCabinIM, nCabin++, car.x, 0.3 + bodyH + cabH / 2, car.z, car.angle,
        car.wid * 0.82, cabH, cabLen, 0x22242a);
      // Wheels: dark boxes at the four corners (offset from the car centre
      // along its local axes, then rotated into world space).
      for (let w = 0; w < 4 && nWheel < CAR_POOL * 4; w++) {
        const wx = (w % 2 === 0 ? -1 : 1) * (car.wid / 2 - 0.05);
        const wz = (w < 2 ? 1 : -1) * car.len * 0.32;
        const lx = car.x + Math.cos(car.angle) * wx + Math.sin(car.angle) * wz;
        const lz = car.z - Math.sin(car.angle) * wx + Math.cos(car.angle) * wz;
        tmpEuler.set(0, car.angle, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpMat.compose(tmpPos.set(lx, 0.35, lz), tmpQuat, tmpScale.set(0.28, 0.7, 0.7));
        carWheelIM.setMatrixAt(nWheel++, tmpMat);
      }
      if (car.model === 'sports' && nSpoiler < CAR_POOL) {
        // Big rear wing: shifted back along the car's forward axis.
        const bx = car.x - Math.sin(car.angle) * car.len * 0.47;
        const bz = car.z - Math.cos(car.angle) * car.len * 0.47;
        setInstance(carSpoilerIM, nSpoiler++, bx, 0.3 + 0.62 * car.hgt, bz, car.angle,
          car.wid * 0.95, 0.07, 0.45);
      }
      if (car.isPolice && car.lightBar) {
        const barY = 0.3 + bodyH + cabH + 0.12;
        const redOn = heroMode || flashPhase === 0;
        const blueOn = heroMode || flashPhase === 1;
        const lx = car.x - Math.cos(car.angle) * car.wid * 0.26;
        const lz = car.z + Math.sin(car.angle) * car.wid * 0.26;
        const rx = car.x + Math.cos(car.angle) * car.wid * 0.26;
        const rz = car.z - Math.sin(car.angle) * car.wid * 0.26;
        if (nRoof < ROOF_POOL) {
          setInstance(roofIM, nRoof++, lx, barY, lz, car.angle,
            car.wid * 0.42, 0.18, 0.5, redOn ? 0xff2a2a : 0x331111);
        }
        if (nRoof < ROOF_POOL) {
          setInstance(roofIM, nRoof++, rx, barY, rz, car.angle,
            car.wid * 0.42, 0.18, 0.5, blueOn ? 0x3d8fff : 0x111133);
        }
        if (nPool < POOL_POOL) {
          tmpEuler.set(-Math.PI / 2, 0, 0);
          tmpQuat.setFromEuler(tmpEuler);
          tmpMat.compose(tmpPos.set(car.x, 0.04, car.z), tmpQuat, tmpScale.set(2.4, 2.4, 1));
          poolIM.setMatrixAt(nPool, tmpMat);
          poolIM.setColorAt(nPool, tmpColor.setHex(flashPhase === 0 ? 0xff2a2a : 0x3d8fff));
          nPool++;
        }
      }
      if (car.model === 'taxi' && nRoof < ROOF_POOL) {
        setInstance(roofIM, nRoof++, car.x, 0.3 + bodyH + cabH + 0.1, car.z, car.angle,
          0.9, 0.25, 0.5, 0xffffff);
      }
      if (car.model === 'tank' && nTurret < TANK_POOL) {
        setInstance(turretIM, nTurret++, car.x, 0.3 + bodyH + 0.3, car.z, car.angle,
          1.7, 0.55, 2.2);
        setInstance(barrelIM, nBarrel++,
          car.x + Math.sin(car.angle) * 1.6, 0.3 + bodyH + 0.3,
          car.z + Math.cos(car.angle) * 1.6, car.angle, 0.18, 0.18, 2.4);
      }
    }
    carBodyIM.count = nBody;
    carCabinIM.count = nCabin;
    carWheelIM.count = nWheel;
    carSpoilerIM.count = nSpoiler;
    roofIM.count = nRoof;
    poolIM.count = nPool;
    turretIM.count = nTurret;
    barrelIM.count = nBarrel;
    for (const im of [carBodyIM, carCabinIM, carWheelIM, carSpoilerIM, roofIM, poolIM, turretIM, barrelIM]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // --- Pedestrians ------------------------------------------------------------
    const peds = state.peds || [];
    let nPed = 0;
    for (let i = 0; i < peds.length && nPed < PED_POOL; i++) {
      const ped = peds[i];
      const downed = ped.state === 'idle' && ped.downT > 0;
      const bob = ped.speed > 0 ? Math.abs(Math.sin(ped.bobPhase || 0)) * 0.06 : 0;
      const bodyColor = ped.isCop ? 0x1a3a6a : ped.isTaxiCustomer ? 0x2a9a4a : ped.color;
      if (downed) {
        tmpEuler.set(Math.PI / 2 * 0.9, ped.angle, 0, 'YXZ');
        tmpQuat.setFromEuler(tmpEuler);
        tmpMat.compose(tmpPos.set(ped.x, 0.35, ped.z), tmpQuat, tmpScale.set(0.55, 1.05, 0.35));
        pedBodyIM.setMatrixAt(nPed, tmpMat);
        pedBodyIM.setColorAt(nPed, tmpColor.setHex(bodyColor));
        tmpMat.compose(tmpPos.set(ped.x, 0.35, ped.z), tmpQuat, tmpScale.set(0.22, 0.22, 0.22));
        pedHeadIM.setMatrixAt(nPed, tmpMat);
      } else {
        setInstance(pedBodyIM, nPed, ped.x, 0.85 + bob, ped.z, ped.angle, 0.55, 1.05, 0.35, bodyColor);
        setInstance(pedHeadIM, nPed, ped.x, 1.55 + bob, ped.z, ped.angle,
          0.22, 0.22, 0.22, SKIN_TONES[(ped.id.charCodeAt(3) || 0) % SKIN_TONES.length]);
      }
      nPed++;
    }
    pedBodyIM.count = nPed;
    pedHeadIM.count = nPed;
    pedBodyIM.instanceMatrix.needsUpdate = true;
    pedHeadIM.instanceMatrix.needsUpdate = true;
    if (pedBodyIM.instanceColor) pedBodyIM.instanceColor.needsUpdate = true;
    if (pedHeadIM.instanceColor) pedHeadIM.instanceColor.needsUpdate = true;

    // --- Player figure (on foot only) -------------------------------------------
    const p = state.player;
    playerGroup.visible = !!p.onFoot;
    if (p.onFoot) {
      playerGroup.position.set(p.x, p.moving ? Math.abs(Math.sin(t * 10)) * 0.05 : 0, p.z);
      playerGroup.rotation.y = p.moving ? p.heading : p.yaw;
    }

    // --- Beacon (mission marker, else taxi marker) --------------------------------
    const marker = (state.mission && state.mission.marker) || state.taxiMarker;
    if (marker) {
      const isTaxi = !state.mission || !state.mission.marker;
      const hex = isTaxi ? 0x2aff5a : 0xffd23d;
      beacon.visible = true;
      beaconRing.visible = true;
      beacon.position.set(marker.x, 13, marker.z);
      beaconRing.position.set(marker.x, 0.06, marker.z);
      beaconMat.color.setHex(hex);
      beaconMat.opacity = 0.3 + 0.15 * Math.sin(t * 4);
      beaconRing.material.color.setHex(hex);
      beaconRing.scale.setScalar(1 + 0.12 * Math.sin(t * 4));
    } else {
      beacon.visible = false;
      beaconRing.visible = false;
    }

    // --- Cash pickups ----------------------------------------------------------------
    const pickups = state.pickups || [];
    let nPick = 0;
    for (let i = 0; i < pickups.length && nPick < PICKUP_POOL; i++) {
      const pk = pickups[i];
      if (pk.taken) continue;
      tmpEuler.set(0, t * 1.5 + i, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMat.compose(tmpPos.set(pk.x, 0.5 + Math.sin(t * 3 + i) * 0.15, pk.z), tmpQuat,
        tmpScale.set(0.7, 0.4, 0.7));
      pickupIM.setMatrixAt(nPick++, tmpMat);
    }
    pickupIM.count = nPick;
    pickupIM.instanceMatrix.needsUpdate = true;

    // --- Traffic lights ---------------------------------------------------------------
    if (cityRef) {
      for (const l of cityRef.lights) {
        const green = nsGreen(t, l.x, l.z);
        l.ns.material.color.setHex(green ? 0x2aff5a : 0xff2a2a);
        l.ew.material.color.setHex(green ? 0xff2a2a : 0x2aff5a);
      }
    }

    // --- Helicopter (optional, staged) ---------------------------------------------------
    const heli = state.heli;
    heliGroup.visible = !!heli;
    heliBeam.visible = !!heli;
    heliPool.visible = !!heli;
    if (heli) {
      heliGroup.position.set(heli.x, heli.y, heli.z);
      heliGroup.rotation.y = heli.angle || 0;
      heliRotor.rotation.y = t * 20;
      heliBeam.position.set(heli.x, heli.y / 2, heli.z);
      heliBeam.scale.y = heli.y / 18;
      heliPool.position.set(heli.x, 0.05, heli.z);
    }

    if (renderer) renderer.render(scene, camera);
  }

  function buildScene(builtCity) {
    if (!builtCity) return;
    if (cityRef && cityRef.group) scene.remove(cityRef.group);
    cityRef = builtCity;
    scene.add(builtCity.group);
    snapCamera({ player: { x: 8, z: 30, yaw: Math.PI, onFoot: true } });
  }

  function resize(w, h) {
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (renderer) renderer.setSize(w, h, false);
  }

  function snapCamera(state) {
    const target = computeCamTarget(state);
    camPos.set(target.pos[0], target.pos[1], target.pos[2]);
    camLook.set(target.look[0], target.look[1], target.look[2]);
    camInit = true;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function getStats() {
    if (renderer) {
      return {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    }
    return { drawCalls: 0, triangles: 0 };
  }

  return {
    draw, resize, buildScene, snapCamera, getStats, scene, camera, renderer,
    sun, sunLight: sun, hemi, hemiLight: hemi, hemisphere: hemi, fill,
    lights: { sun, hemi, hemisphere: hemi, fill },
  };
}
