// Solmar Bay — effects (Worker B). Pooled particles + trauma screen shake +
// FOV kick. Juice only: shake moves the camera, never bodies or gameplay.
// THREE and the scene are injected (main.js passes them), so the pure math
// (trauma decay, shake) stays testable in Node with scene = null.
// The renderer draws the mission beacon + cash pickups itself; this file
// only owns particles and the camera feel. main.js calls update() once per
// frame and applyCamera() after renderer.draw (see render.js).

const POOL = 240;

const BURST_DEFS = {
  // Smoke / exhaust are light and warm now: dark grey read as gloom
  // against the bright golden-hour sky.
  smoke:   { count: 10, speed: 1.6, up: 1.4, life: 1.1, color: [0.62, 0.6, 0.58], size: 1.0, gravity: -0.4 },
  exhaust: { count: 4,  speed: 0.7, up: 0.8, life: 0.7, color: [0.42, 0.42, 0.45], size: 0.7, gravity: -0.2 },
  sparks:  { count: 16, speed: 5.0, up: 2.2, life: 0.5, color: [1.0, 0.75, 0.25], size: 0.6, gravity: -6.0 },
  flash:   { count: 8,  speed: 3.0, up: 0.5, life: 0.12, color: [1.0, 0.95, 0.6], size: 0.9, gravity: 0 },
  stars:   { count: 10, speed: 2.4, up: 1.8, life: 0.6, color: [0.6, 0.9, 1.0], size: 0.7, gravity: -2.0 },
  pickup:  { count: 12, speed: 1.8, up: 2.6, life: 0.7, color: [1.0, 0.85, 0.2], size: 0.7, gravity: -1.0 },
  // Sunlight glints: slow golden sparkles that drift up and hang in the
  // light (used for pickups / mission moments, never for damage).
  glint:   { count: 8,  speed: 0.6, up: 1.1, life: 1.4, color: [1.0, 0.9, 0.55], size: 0.8, gravity: -0.1 },
};

// Soft round sprite for particles: hard square points read as a glitch
// (white blocks plastered on the hero car). A radial-gradient canvas
// texture makes smoke/dust read as a cloud. Browser-only: only called
// when a scene exists (the Node smoke test passes scene = null).
function makeSoftSprite() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export function createEffects(scene, THREE) {
  const fx = {
    trauma: 0,
    decay: 1.2,
    maxOffset: 14, // pixels of shake at trauma 1
    maxRoll: 0.02, // radians
    strength: 1.0,
    fovKick: 0,
    _t: 0,
    _cursor: 0,
    _points: null,
    _geo: null,
    _positions: null,
    _colors: null,
    _vel: null,
    _life: null,
    _maxLife: null,
    _gravities: null,
  };

  if (scene && THREE) {
    const positions = new Float32Array(POOL * 3);
    const colors = new Float32Array(POOL * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const softTex = new THREE.CanvasTexture(makeSoftSprite());
    const mat = new THREE.PointsMaterial({ size: 0.45, map: softTex, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.name = 'fx-particles';
    scene.add(points);
    fx._points = points;
    fx._geo = geo;
    fx._positions = positions;
    fx._colors = colors;
    fx._vel = new Float32Array(POOL * 3);
    fx._life = new Float32Array(POOL);
    fx._maxLife = new Float32Array(POOL);
    fx._gravities = new Float32Array(POOL);
    for (let i = 0; i < POOL; i++) fx._positions[i * 3 + 1] = -100;
  } else {
    // Node / headless: keep the math arrays so burst/update still run.
    fx._positions = new Float32Array(POOL * 3);
    fx._colors = new Float32Array(POOL * 3);
    fx._vel = new Float32Array(POOL * 3);
    fx._life = new Float32Array(POOL);
    fx._maxLife = new Float32Array(POOL);
    fx._gravities = new Float32Array(POOL);
    for (let i = 0; i < POOL; i++) fx._positions[i * 3 + 1] = -100;
  }

  fx.update = function update(dt) {
    fx._t += dt;
    if (fx.trauma > 0) fx.trauma = Math.max(0, fx.trauma - fx.decay * dt);
    if (fx.fovKick !== 0) fx.fovKick += (0 - fx.fovKick) * Math.min(1, 4 * dt);
    if (Math.abs(fx.fovKick) < 0.05) fx.fovKick = 0;
    if (!fx._life) return;
    let alive = 0;
    for (let i = 0; i < POOL; i++) {
      if (fx._life[i] <= 0) continue;
      alive++;
      fx._life[i] -= dt;
      const ix = i * 3;
      if (fx._life[i] <= 0) {
        fx._positions[ix + 1] = -100;
        continue;
      }
      fx._vel[ix + 1] += fx._gravities[i] * dt;
      fx._positions[ix] += fx._vel[ix] * dt;
      fx._positions[ix + 1] += fx._vel[ix + 1] * dt;
      fx._positions[ix + 2] += fx._vel[ix + 2] * dt;
    }
    if (fx._geo && alive > 0) {
      fx._geo.attributes.position.needsUpdate = true;
      fx._geo.attributes.color.needsUpdate = true;
    }
  };

  fx.burst = function burst(type, x, y, z, opts) {
    const def = BURST_DEFS[type] || BURST_DEFS.smoke;
    const count = (opts && opts.count) || def.count;
    const spread = (opts && opts.spread) || 1;
    for (let n = 0; n < count; n++) {
      const i = fx._cursor;
      fx._cursor = (fx._cursor + 1) % POOL;
      const ix = i * 3;
      fx._positions[ix] = x + (Math.random() - 0.5) * 0.4;
      fx._positions[ix + 1] = y;
      fx._positions[ix + 2] = z + (Math.random() - 0.5) * 0.4;
      const a = Math.random() * Math.PI * 2;
      const sp = def.speed * (0.4 + Math.random() * 0.8) * spread;
      fx._vel[ix] = Math.cos(a) * sp;
      fx._vel[ix + 1] = def.up * (0.5 + Math.random() * 0.8);
      fx._vel[ix + 2] = Math.sin(a) * sp;
      fx._colors[ix] = def.color[0];
      fx._colors[ix + 1] = def.color[1];
      fx._colors[ix + 2] = def.color[2];
      fx._life[i] = def.life * (0.7 + Math.random() * 0.6);
      fx._maxLife[i] = fx._life[i];
      fx._gravities[i] = def.gravity;
    }
    if (fx._geo) fx._geo.attributes.position.needsUpdate = true;
  };

  fx.addTrauma = function addTrauma(amount) {
    fx.trauma = Math.min(1, fx.trauma + amount);
  };

  // Tiered feedback bundles: one call for a game moment.
  fx.feedback = function feedback(kind, x, y, z) {
    if (kind === 'hit') {
      fx.addTrauma(0.35);
      fx.burst('sparks', x, y, z);
    } else if (kind === 'punch') {
      fx.addTrauma(0.12);
      fx.burst('stars', x, y, z);
    } else if (kind === 'explosion') {
      fx.addTrauma(0.7);
      fx.fovKick = 4;
      fx.burst('smoke', x, y, z, { count: 24 });
      fx.burst('sparks', x, y, z, { count: 20 });
    } else if (kind === 'pickup') {
      fx.burst('pickup', x, y, z);
      fx.burst('glint', x, y, z);
    } else if (kind === 'glint') {
      fx.burst('glint', x, y, z);
    } else if (kind === 'crash') {
      fx.addTrauma(0.5);
      fx.burst('smoke', x, y, z, { count: 16 });
      fx.burst('sparks', x, y, z, { count: 12 });
    }
  };

  // Trauma shake: sum of sines, deterministic in time. Called AFTER
  // renderer.draw (the renderer places the camera first). Returns the offset
  // applied, so tests can assert on it.
  fx.applyCamera = function applyCamera(camera, dt) {
    if (!camera) return { x: 0, y: 0, roll: 0 };
    const s = fx.trauma * fx.trauma * fx.strength;
    if (s <= 0.001) return { x: 0, y: 0, roll: 0 };
    const t = fx._t * 47;
    const ox = (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * fx.maxOffset * s;
    const oy = (Math.cos(t * 1.7) + Math.sin(t * 2.9) * 0.5) * fx.maxOffset * s;
    const roll = Math.sin(t * 1.3) * fx.maxRoll * s;
    camera.position.x += ox * 0.01;
    camera.position.y += oy * 0.01;
    camera.rotation.z += roll;
    return { x: ox, y: oy, roll };
  };

  fx.getCameraOffset = function getCameraOffset() {
    const s = fx.trauma * fx.trauma * fx.strength;
    if (s <= 0.001) return { x: 0, y: 0, roll: 0 };
    const t = fx._t * 47;
    return {
      x: (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * fx.maxOffset * s,
      y: (Math.cos(t * 1.7) + Math.sin(t * 2.9) * 0.5) * fx.maxOffset * s,
      roll: Math.sin(t * 1.3) * fx.maxRoll * s,
    };
  };

  return fx;
}
