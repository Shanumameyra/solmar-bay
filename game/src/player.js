// SOLMAR BAY — player on foot (v6, fresh write)
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function createPlayer(G) {
  const player = {
    pos: new THREE.Vector3(CONFIG.spawn.x, 0, CONFIG.spawn.z),
    heading: Math.PI,
    speed: 0,
    hp: 100,
    inCar: null,
    mesh: null,
    _walkPhase: 0,
  };

  // Simple stylised Dario: yellow shirt, dark trousers, cap.
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0xe8b13c, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8a2e2e, roughness: 0.85 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), shirt);
  torso.position.y = 1.12;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
  head.position.y = 1.72;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.44), capMat);
  cap.position.y = 1.88;
  group.add(cap);
  for (const sx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.22), pants);
    leg.position.set(sx, 0.38, 0);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), shirt);
    arm.position.set(sx * 1.9, 1.12, 0);
    group.add(arm);
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  group.position.copy(player.pos);
  group.rotation.y = player.heading;
  G.scene.add(group);
  player.mesh = group;
  return player;
}

export function updatePlayer(G, dt) {
  const player = G.player;
  if (!player) return;
  const mesh = player.mesh;
  if (mesh) mesh.visible = !player.inCar;
  // Driving is handled by the vehicle module; on foot only here.
  if (player.inCar) {
    player.speed = 0;
    return;
  }
  const input = G.input;
  const world = G.world;
  if (!input || !world) return;

  const yaw = G.camYaw !== undefined ? G.camYaw : player.heading;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = -Math.cos(yaw);
  const rz = Math.sin(yaw);

  let mx = 0;
  let mz = 0;
  if (input.isDown('KeyW') || input.isDown('ArrowUp')) { mx += fx; mz += fz; }
  if (input.isDown('KeyS') || input.isDown('ArrowDown')) { mx -= fx; mz -= fz; }
  if (input.isDown('KeyD') || input.isDown('ArrowRight')) { mx += rx; mz += rz; }
  if (input.isDown('KeyA') || input.isDown('ArrowLeft')) { mx -= rx; mz -= rz; }

  const moving = mx !== 0 || mz !== 0;
  const run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  const speed = run ? CONFIG.runSpeed : CONFIG.walkSpeed;
  player.speed = moving ? speed : 0;

  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    const step = speed * dt;
    const nx = player.pos.x + mx * step;
    const nz = player.pos.z + mz * step;
    const r = 0.6;
    if (!world.isBlocked(nx, nz, r)) {
      player.pos.x = nx;
      player.pos.z = nz;
    } else if (!world.isBlocked(nx, player.pos.z, r)) {
      player.pos.x = nx; // slide along x
    } else if (!world.isBlocked(player.pos.x, nz, r)) {
      player.pos.z = nz; // slide along z
    }
    const clamped = world.clampToWorld(player.pos.x, player.pos.z);
    player.pos.x = clamped.x;
    player.pos.z = clamped.z;
    const targetHeading = Math.atan2(mx, mz);
    player.heading = lerpAngle(player.heading, targetHeading, Math.min(1, dt * 12));
    player._walkPhase += speed * dt * 1.6;
  }

  if (mesh) {
    mesh.position.copy(player.pos);
    mesh.position.y = moving ? Math.abs(Math.sin(player._walkPhase)) * 0.06 : 0;
    mesh.rotation.y = player.heading;
  }
}
