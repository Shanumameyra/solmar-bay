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

function makeSkyTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2e4a7a');
  grad.addColorStop(0.45, '#7a6a9a');
  grad.addColorStop(0.62, '#ffb36b');
  grad.addColorStop(1, '#ff8a5a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const skyTex = makeSkyTexture();
  if (skyTex) scene.background = skyTex;
  else scene.background = new THREE.Color(PAL.SKY_HORIZON);
  scene.fog = new THREE.Fog(PAL.SKY_HORIZON, CONFIG.RENDER.FOG_NEAR, CONFIG.RENDER.FOG_FAR);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.RENDER.CAMERA_FOV,
    canvas.clientWidth / Math.max(1, canvas.clientHeight),
    CONFIG.RENDER.CAMERA_NEAR, CONFIG.RENDER.CAMERA_FAR,
  );

  // Golden-hour sun: low from the west, warm; only the sun casts shadows.
  const sun = new THREE.DirectionalLight(PAL.SUN, PAL.SUN_INTENSITY);
  sun.position.set(-160, 95, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(CONFIG.RENDER.SHADOW_MAP, CONFIG.RENDER.SHADOW_MAP);
  sun.shadow.camera.left = -230;
  sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230;
  sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PAL.HEMI_SKY, PAL.HEMI_GROUND, PAL.HEMI_INTENSITY));

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
  const carWheels = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 }), MAX_CARS * 4);
  const carBars = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0x000000 }), MAX_CARS * 2);
  carBody.castShadow = true;
  carCabin.castShadow = true;
  carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carCabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(carBody);
  scene.add(carCabin);
  scene.add(carWheels);
  scene.add(carBars);

  // ---- Instanced pedestrian meshes ----
  const MAX_PEDS = 32;
  const pedBody = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_PEDS);
  const pedHead = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.9 }), MAX_PEDS);
  const pedLegs = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.95 }), MAX_PEDS);
  pedBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedLegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pedBody);
  scene.add(pedHead);
  scene.add(pedLegs);

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
  const pBody = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x2a6fd8, roughness: 0.8 }));
  pBody.scale.set(0.55, 0.85, 0.32);
  pBody.position.y = 1.05;
  pBody.castShadow = true;
  const pHead = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.9 }));
  pHead.scale.set(0.34, 0.34, 0.34);
  pHead.position.y = 1.68;
  pHead.castShadow = true;
  const pLegs = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.95 }));
  pLegs.scale.set(0.45, 0.6, 0.28);
  pLegs.position.y = 0.32;
  playerGroup.add(pBody);
  playerGroup.add(pHead);
  playerGroup.add(pLegs);
  playerGroup.name = 'player';
  scene.add(playerGroup);

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
    carBody.count = n;
    carCabin.count = n;
    carWheels.count = n * 4;
    let barIdx = 0;
    const flash = Math.floor(time * 2.4) % 2 === 0;
    for (let i = 0; i < n; i += 1) {
      const car = cars[i];
      const yaw = car.angle;
      // Body: length runs along local Z, so rotation.y = angle faces it
      // along (sin angle, cos angle). It sits on the ground, height ~0.55.
      setInstance(carBody, i, car.x, 0.55, car.z, yaw, car.wid, 0.75, car.len);
      carBody.setColorAt(i, tmpColor.setHex(car.color));
      // Cabin: shorter, toward the rear half, dark glass.
      const cx = car.x - Math.sin(car.angle) * car.len * 0.08;
      const cz = car.z - Math.cos(car.angle) * car.len * 0.08;
      setInstance(carCabin, i, cx, 1.05, cz, yaw, car.wid * 0.86, 0.55, car.len * 0.5);
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
        setInstance(carWheels, i * 4 + w, car.x + corners[w][0], wy, car.z + corners[w][1], yaw, 0.3, 0.62, 0.62);
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
    }
    carBars.count = barIdx;
    carBody.instanceMatrix.needsUpdate = true;
    carCabin.instanceMatrix.needsUpdate = true;
    carWheels.instanceMatrix.needsUpdate = true;
    carBars.instanceMatrix.needsUpdate = true;
    if (carBody.instanceColor) carBody.instanceColor.needsUpdate = true;
    if (carBars.instanceColor) carBars.instanceColor.needsUpdate = true;
  }

  function syncPeds(state) {
    const peds = state.peds;
    const n = Math.min(peds.length, MAX_PEDS);
    pedBody.count = n;
    pedHead.count = n;
    pedLegs.count = n;
    for (let i = 0; i < n; i += 1) {
      const ped = peds[i];
      const yaw = ped.angle;
      const bob = ped.speed > 0.2 ? Math.abs(Math.sin(ped.bobPhase)) * 0.07 : 0;
      setInstance(pedBody, i, ped.x, 0.95 + bob, ped.z, yaw, 0.5, 0.8, 0.3);
      pedBody.setColorAt(i, tmpColor.setHex(ped.color));
      setInstance(pedHead, i, ped.x, 1.62 + bob, ped.z, yaw, 0.32, 0.32, 0.32);
      setInstance(pedLegs, i, ped.x, 0.35 + bob, ped.z, yaw, 0.42, 0.7, 0.26);
    }
    pedBody.instanceMatrix.needsUpdate = true;
    pedHead.instanceMatrix.needsUpdate = true;
    pedLegs.instanceMatrix.needsUpdate = true;
    if (pedBody.instanceColor) pedBody.instanceColor.needsUpdate = true;
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
    if (inCar) {
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
