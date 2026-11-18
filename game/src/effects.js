// effects.js — Solmar Bay visual effects: pooled THREE sprites.
// Muzzle flash, smoke, sparks, tire smoke, pickup sparkles, skid marks and
// camera shake. One shared pool, no per-frame allocation in the hot loop:
// particles are reused, vectors are reused. Procedural radial texture
// (canvas-generated), no image files.
//
// Needs G.THREE and G.scene (set by main.js before createEffects runs).
// If THREE/scene is missing the module still constructs and every method
// becomes a safe no-op, so logic tests can run without a renderer.

const MAX_PARTICLES = 220;
const MAX_SKIDS = 40;

function makeGlowTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function createEffects(G) {
  const THREE = G && G.THREE;
  const scene = G && G.scene;
  const hasGL = !!(THREE && scene && typeof document !== 'undefined');

  let texture = null;
  const pool = [];
  const skids = [];
  let shakeAmount = 0;
  let shakeTime = 0;

  // Reused scratch vectors (no per-frame allocation).
  const tmpV = hasGL ? new THREE.Vector3() : null;

  if (hasGL) {
    texture = makeGlowTexture(THREE);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.scale.set(1, 1, 1);
      scene.add(sprite);
      pool.push({
        sprite,
        mat,
        life: 0,
        maxLife: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        grow: 0,
        fade: 1,
        gravity: 0,
        active: false,
      });
    }
  }

  function spawn(x, y, z, opts) {
    if (!hasGL) return null;
    for (const p of pool) {
      if (p.active) continue;
      p.active = true;
      p.life = 0;
      p.maxLife = opts.life || 0.6;
      p.vx = opts.vx || 0;
      p.vy = opts.vy || 0;
      p.vz = opts.vz || 0;
      p.grow = opts.grow || 0;
      p.fade = opts.fade == null ? 1 : opts.fade;
      p.gravity = opts.gravity || 0;
      p.sprite.visible = true;
      p.sprite.position.set(x, y, z);
      const s = opts.size || 1;
      p.sprite.scale.set(s, s, 1);
      p.mat.color.setHex(opts.color == null ? 0xffffff : opts.color);
      p.mat.opacity = opts.opacity == null ? 0.9 : opts.opacity;
      p.sprite.renderOrder = 5;
      return p;
    }
    return null;
  }

  function burst(x, y, z, opts) {
    if (!hasGL) return;
    const count = opts.count || 8;
    const speed = opts.speed || 3;
    const up = opts.up == null ? 1.5 : opts.up;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      spawn(x, y, z, {
        vx: Math.cos(a) * r,
        vy: (Math.random() - 0.3) * up,
        vz: Math.sin(a) * r,
        life: 0.3 + Math.random() * (opts.life || 0.5),
        size: (opts.size || 0.6) * (0.6 + Math.random() * 0.8),
        color: opts.color,
        opacity: opts.opacity,
        grow: opts.grow || 0,
        gravity: opts.gravity == null ? -2 : opts.gravity,
      });
    }
  }

  const api = {
    get activeCount() {
      let n = 0;
      for (const p of pool) if (p.active) n += 1;
      return n;
    },

    update(dt) {
      if (!hasGL) return;
      const step = Math.min(dt || 0.016, 0.05);
      for (const p of pool) {
        if (!p.active) continue;
        p.life += step;
        if (p.life >= p.maxLife) {
          p.active = false;
          p.sprite.visible = false;
          p.mat.opacity = 0;
          continue;
        }
        const t = p.life / p.maxLife;
        p.vy += p.gravity * step;
        p.sprite.position.x += p.vx * step;
        p.sprite.position.y += p.vy * step;
        p.sprite.position.z += p.vz * step;
        if (p.grow) {
          const s = p.sprite.scale.x + p.grow * step;
          p.sprite.scale.set(s, s, 1);
        }
        p.mat.opacity = (1 - t) * p.fade;
      }
      for (let i = skids.length - 1; i >= 0; i--) {
        const s = skids[i];
        s.life += step;
        if (s.life > s.maxLife) {
          scene.remove(s.mesh);
          s.mesh.geometry.dispose();
          s.mesh.material.dispose();
          skids.splice(i, 1);
        } else {
          s.mesh.material.opacity = 0.55 * (1 - s.life / s.maxLife);
        }
      }
      if (shakeTime > 0) {
        shakeTime -= step;
        if (shakeTime <= 0) shakeAmount = 0;
      }
    },

    // Bright yellow-orange flash at a gun barrel.
    muzzle(x, y, z, dirX, dirZ) {
      if (!hasGL) return;
      spawn(x, y, z, { life: 0.09, size: 1.6, color: 0xffcc33, opacity: 1 });
      spawn(x + (dirX || 0) * 0.5, y, z + (dirZ || 0) * 0.5, {
        life: 0.07, size: 0.9, color: 0xff9933, opacity: 0.95,
      });
      burst(x, y, z, { count: 4, speed: 4, size: 0.35, color: 0xffaa22, life: 0.25 });
    },

    // Grey-black smoke column (damaged car, handbrake drift).
    smoke(x, y, z, big) {
      if (!hasGL) return;
      spawn(x, y, z, {
        vx: (Math.random() - 0.5) * 0.6,
        vy: 1.2 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.6,
        life: big ? 1.6 : 0.9,
        size: big ? 1.8 : 1.0,
        color: big ? 0x222222 : 0x777777,
        opacity: 0.55,
        grow: big ? 2.2 : 1.2,
        gravity: 0.4,
      });
    },

    // Orange sparks (collision, bullet impact).
    sparks(x, y, z, count) {
      burst(x, y, z, {
        count: count || 10,
        speed: 5,
        up: 2.5,
        size: 0.3,
        color: 0xffb347,
        life: 0.4,
        gravity: -6,
      });
    },

    // White-grey puff behind a drifting / accelerating tyre.
    tireSmoke(x, y, z) {
      if (!hasGL) return;
      spawn(x, y + 0.15, z, {
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.5,
        vz: (Math.random() - 0.5) * 0.5,
        life: 0.7,
        size: 0.7,
        color: 0xbbbbbb,
        opacity: 0.5,
        grow: 1.6,
      });
    },

    // Gold sparkle for cash pickups / mission marker pulses.
    sparkle(x, y, z, color) {
      burst(x, y, z, {
        count: 6,
        speed: 1.2,
        up: 2.2,
        size: 0.4,
        color: color == null ? 0xffd700 : color,
        life: 0.6,
        gravity: -1,
      });
    },

    // Small red hit marker on a damaged target.
    hitPuff(x, y, z) {
      burst(x, y, z, {
        count: 5, speed: 2, size: 0.4, color: 0xff5555, life: 0.3, gravity: -1,
      });
    },

    // Green heal puff.
    healPuff(x, y, z) {
      burst(x, y, z, {
        count: 8, speed: 1.5, up: 2.5, size: 0.45, color: 0x66ff88, life: 0.6,
        gravity: 1,
      });
    },

    // Dark skid strip on the road. yaw = heading of the car.
    skid(x, y, z, yaw) {
      if (!hasGL) return;
      if (skids.length >= MAX_SKIDS) {
        const old = skids.shift();
        scene.remove(old.mesh);
        old.mesh.geometry.dispose();
        old.mesh.material.dispose();
      }
      const geo = new THREE.PlaneGeometry(0.35, 1.4);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -yaw;
      mesh.position.set(x, y + 0.02, z);
      mesh.renderOrder = 2;
      scene.add(mesh);
      skids.push({ mesh, life: 0, maxLife: 6 });
    },

    // Camera shake: main.js reads shakeOffset() each frame and adds it to
    // the camera position. Amount decays over ~0.35 s.
    shake(amount) {
      shakeAmount = Math.max(shakeAmount, amount || 0.3);
      shakeTime = 0.35;
    },

    shakeOffset() {
      if (!hasGL || shakeTime <= 0 || shakeAmount <= 0) return null;
      const a = shakeAmount * (shakeTime / 0.35);
      tmpV.set(
        (Math.random() - 0.5) * a,
        (Math.random() - 0.5) * a * 0.6,
        (Math.random() - 0.5) * a,
      );
      return tmpV;
    },

    // Remove every live particle / skid (mission reset, respawn).
    clear() {
      if (!hasGL) return;
      for (const p of pool) {
        p.active = false;
        p.sprite.visible = false;
        p.mat.opacity = 0;
      }
      for (const s of skids) {
        scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
      }
      skids.length = 0;
      shakeAmount = 0;
      shakeTime = 0;
    },
  };

  return api;
}
