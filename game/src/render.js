// SOLMAR BAY — renderer + camera (v6, fresh write)
import * as THREE from '../vendor/three/three.module.min.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  return renderer;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(0, 4, 70);
  return camera;
}

const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export function updateCamera(G, dt) {
  if (G.camYaw === undefined) {
    G.camYaw = Math.PI; // face north (-z), toward the cafe from spawn
    G.camPitch = 0.12;
  }
  const input = G.input;
  if (input) {
    G.camYaw -= (input.mouseDX || 0) * 0.0026;
    G.camPitch = Math.max(-0.05, Math.min(0.55, G.camPitch + (input.mouseDY || 0) * 0.002));
    input.mouseDX = 0;
    input.mouseDY = 0;
  }

  // Keep renderer + aspect in sync with the canvas size.
  const canvas = G.renderer ? G.renderer.domElement : null;
  if (canvas) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (G.camera.aspect !== w / h) {
      G.camera.aspect = w / h;
      G.camera.updateProjectionMatrix();
      G.renderer.setSize(w, h, false);
    }
  }

  const player = G.player;
  if (!player) return;
  const car = player.inCar;
  const cam = G.camera;

  if (car) {
    // Chase cam: low and close behind the car.
    const heading = car.heading !== undefined ? car.heading : 0;
    const pos = car.pos || car.position || player.pos;
    G.camYaw = heading;
    _fwd.set(Math.sin(heading), 0, Math.cos(heading));
    _desired.copy(pos).addScaledVector(_fwd, -8).add(_lookAt.set(0, 3.2, 0));
    const k = 1 - Math.exp(-6 * dt);
    cam.position.lerp(_desired, k);
    _lookAt.copy(pos).addScaledVector(_fwd, 6);
    _lookAt.y += 1.2;
    cam.lookAt(_lookAt);
  } else {
    // Over-shoulder cam on foot.
    const yaw = G.camYaw;
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    _right.set(-Math.cos(yaw), 0, Math.sin(yaw));
    _desired.copy(player.pos).addScaledVector(_fwd, -4.6).addScaledVector(_right, 0.9);
    _desired.y = player.pos.y + 2.3 + G.camPitch * 2;
    const k = 1 - Math.exp(-10 * dt);
    cam.position.lerp(_desired, k);
    _lookAt.copy(player.pos).addScaledVector(_fwd, 3);
    _lookAt.y = player.pos.y + 1.5;
    cam.lookAt(_lookAt);
  }
}
