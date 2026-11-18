// Effects — lightweight particle bursts: smoke, sparks, muzzle flashes,
// tire smoke. Particles are small THREE meshes that fade and die.
import * as THREE from 'three';

const SHARED_GEO = new THREE.BoxGeometry(1, 1, 1);

export function createEffects(scene) {
  return { list: [], scene: scene || null };
}

function addParticle(S, pos, vel, life, size, color, opacity) {
  const fx = S.effects;
  if (!fx) return null;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opacity ?? 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(SHARED_GEO, mat);
  mesh.position.set(pos.x, pos.y ?? 1, pos.z);
  mesh.scale.setScalar(size);
  const scene = fx.scene || S.scene;
  if (scene && typeof scene.add === 'function') scene.add(mesh);
  const p = {
    pos: { x: pos.x, y: pos.y ?? 1, z: pos.z },
    vel: { x: vel.x || 0, y: vel.y || 0, z: vel.z || 0 },
    life,
    maxLife: life,
    size,
    color,
    mesh,
    gravity: 0,
  };
  fx.list.push(p);
  return p;
}

function rand(S, a, b) {
  const r = S.rng || Math.random;
  return a + r() * (b - a);
}

export function spawnSmoke(S, pos) {
  for (let i = 0; i < 10; i++) {
    const p = addParticle(
      S,
      { x: pos.x + rand(S, -0.4, 0.4), y: (pos.y ?? 1) + rand(S, 0, 0.5), z: pos.z + rand(S, -0.4, 0.4) },
      { x: rand(S, -0.6, 0.6), y: rand(S, 0.8, 1.8), z: rand(S, -0.6, 0.6) },
      rand(S, 0.9, 1.6),
      rand(S, 0.25, 0.6),
      0x222222,
      0.75,
    );
    if (p) p.gravity = 0.4; // smoke drifts up, slows its fall
  }
}

export function spawnSparks(S, pos) {
  for (let i = 0; i < 12; i++) {
    const a = rand(S, 0, Math.PI * 2);
    const sp = rand(S, 2, 6);
    const p = addParticle(
      S,
      { x: pos.x, y: pos.y ?? 1.2, z: pos.z },
      { x: Math.sin(a) * sp, y: rand(S, 1, 4), z: Math.cos(a) * sp },
      rand(S, 0.25, 0.6),
      rand(S, 0.08, 0.18),
      0xffc93c,
      1,
    );
    if (p) p.gravity = -6;
  }
}

export function muzzleFlash(S, pos, dir) {
  const d = dir || { x: 0, y: 0, z: 1 };
  const p = addParticle(
    S,
    { x: pos.x + d.x * 0.4, y: pos.y ?? 1.3, z: pos.z + d.z * 0.4 },
    { x: d.x * 3, y: 0, z: d.z * 3 },
    0.09,
    0.55,
    0xffe27a,
    1,
  );
  if (p) p.gravity = 0;
  for (let i = 0; i < 4; i++) {
    const sp = addParticle(
      S,
      { x: pos.x, y: pos.y ?? 1.3, z: pos.z },
      { x: d.x * rand(S, 2, 5) + rand(S, -1, 1), y: rand(S, -0.5, 1), z: d.z * rand(S, 2, 5) + rand(S, -1, 1) },
      0.12,
      0.12,
      0xffb020,
      1,
    );
    if (sp) sp.gravity = 0;
  }
}

export function tireSmoke(S, car) {
  if (!car) return;
  const x = car.x ?? car.pos?.x ?? 0;
  const z = car.z ?? car.pos?.z ?? 0;
  const y = 0.3;
  const p = addParticle(
    S,
    { x: x + rand(S, -0.5, 0.5), y, z: z + rand(S, -0.5, 0.5) },
    { x: rand(S, -0.4, 0.4), y: rand(S, 0.5, 1), z: rand(S, -0.4, 0.4) },
    rand(S, 0.5, 0.9),
    rand(S, 0.3, 0.55),
    0x888888,
    0.6,
  );
  if (p) p.gravity = 0.5;
}

export function updateEffects(S, dt) {
  const fx = S.effects;
  if (!fx) return;
  const scene = fx.scene || S.scene;
  for (let i = fx.list.length - 1; i >= 0; i--) {
    const p = fx.list[i];
    p.life -= dt;
    if (p.life <= 0) {
      if (scene && p.mesh) {
        try { scene.remove(p.mesh); } catch (e) { /* ignore */ }
      }
      if (p.mesh && p.mesh.material) {
        try { p.mesh.material.dispose(); } catch (e) { /* ignore */ }
      }
      fx.list.splice(i, 1);
      continue;
    }
    p.vel.y += (p.gravity || 0) * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    const frac = p.life / p.maxLife;
    p.mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
    p.mesh.scale.setScalar(Math.max(0.01, p.size * (1.6 - frac * 0.6)));
    if (p.mesh.material) p.mesh.material.opacity = Math.max(0, frac) * 0.9;
  }
}
