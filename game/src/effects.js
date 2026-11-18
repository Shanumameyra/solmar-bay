// effects.js — Solmar Bay particle effects (Worker B, v6 fresh)
// Contract: createEffects(G) -> {spawnSmoke(x,z), spawnSparks(x,z), muzzle(x,z,dir), update(dt)}
// Small pooled meshes, no per-frame allocation in the hot loop beyond reuse.
import * as THREE from '../vendor/three/three.module.min.js';

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(200,200,200,0.85)');
  g.addColorStop(0.6, 'rgba(140,140,140,0.4)');
  g.addColorStop(1, 'rgba(120,120,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createEffects(G) {
  const scene = G.scene;
  let smokeTex = null;
  try { smokeTex = makeSmokeTexture(); } catch (e) { smokeTex = null; }

  const pool = []; // {mesh, life, maxLife, grow, kind}
  const MAX = 48;

  function getSlot(kind) {
    for (const p of pool) if (!p.active) return p;
    if (pool.length >= MAX) return null;
    const p = { active: false, mesh: null, life: 0, maxLife: 1, grow: 1, kind };
    pool.push(p);
    return p;
  }

  const E = {
    _pool: pool,
    spawnSmoke(x, z) {
      if (!scene) return;
      const p = getSlot('smoke');
      if (!p) return;
      if (!p.mesh) {
        const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.7, depthWrite: false });
        p.mesh = new THREE.Sprite(mat);
        p.mesh.scale.set(1.5, 1.5, 1);
        scene.add(p.mesh);
      }
      p.mesh.position.set(x, 1.2, z);
      p.mesh.material.opacity = 0.7;
      p.mesh.scale.set(1.2, 1.2, 1);
      p.life = 0; p.maxLife = 1.1; p.grow = 1.6; p.active = true;
    },
    spawnSparks(x, z) {
      if (!scene) return;
      const p = getSlot('spark');
      if (!p) return;
      if (!p.mesh) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffc93c });
        p.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), mat);
        scene.add(p.mesh);
      }
      p.mesh.position.set(x, 0.8, z);
      p.mesh.visible = true;
      p.life = 0; p.maxLife = 0.35; p.grow = 0.4; p.active = true;
    },
    muzzle(x, z, dir) {
      if (!scene) return;
      const p = getSlot('muzzle');
      if (!p) return;
      if (!p.mesh) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95 });
        p.mesh = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 8), mat);
        p.mesh.rotation.x = Math.PI / 2;
        scene.add(p.mesh);
      }
      p.mesh.position.set(x, 1.1, z);
      p.mesh.rotation.z = 0;
      p.mesh.rotation.y = dir || 0;
      p.mesh.visible = true;
      p.life = 0; p.maxLife = 0.09; p.grow = 0.2; p.active = true;
    },
    update(dt) {
      for (const p of pool) {
        if (!p.active || !p.mesh) continue;
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          p.mesh.visible = false;
          continue;
        }
        const k = p.life / p.maxLife;
        if (p.kind === 'smoke') {
          p.mesh.position.y += dt * 1.4;
          const s = 1.2 + k * p.grow * 2;
          p.mesh.scale.set(s, s, 1);
          p.mesh.material.opacity = 0.7 * (1 - k);
        } else if (p.kind === 'spark') {
          p.mesh.scale.setScalar(Math.max(0.05, 1 - k));
          p.mesh.position.y += dt * 0.5;
        }
      }
    },
  };
  return E;
}
