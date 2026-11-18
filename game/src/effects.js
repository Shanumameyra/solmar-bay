// effects.js — particles, trauma-based camera shake, FOV kick.
//
// One pooled THREE.Points cloud (soft radial-gradient sprite, so dust reads
// as soft circles, not hard white squares). Inert when scene/THREE are
// null (node tests): same interface, every method a safe no-op.
// Shake follows the game-feel pattern: trauma^2, summed sines, real-time
// decay, camera OFFSET only — never the simulation.

const MAX_PARTICLES = 256;

const TYPES = {
  dust: { count: 10, color: [0.85, 0.75, 0.55], speed: 1.6, up: 0.4, life: 0.7, trauma: 0.05 },
  smoke: { count: 12, color: [0.45, 0.45, 0.48], speed: 1.2, up: 1.6, life: 1.1, trauma: 0.1 },
  sparks: { count: 14, color: [1.0, 0.8, 0.25], speed: 5.0, up: 2.0, life: 0.45, trauma: 0.2 },
  glint: { count: 10, color: [1.0, 0.85, 0.3], speed: 1.0, up: 1.2, life: 0.8, trauma: 0.05 },
  muzzle: { count: 6, color: [1.0, 0.65, 0.2], speed: 3.0, up: 0.5, life: 0.18, trauma: 0.12 },
  stars: { count: 8, color: [1.0, 0.9, 0.4], speed: 2.0, up: 1.0, life: 0.5, trauma: 0.15 },
};

function makeSpriteTexture(THREE) {
  try {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  } catch (e) {
    return null;
  }
}

export function createEffects(scene, THREE) {
  const enabled = !!(scene && THREE);
  const api = {
    trauma: 0,
    decay: 1.2,
    maxOffset: { x: 0.5, y: 0.35 },
    maxRoll: 0.06,
    strength: 1,
    fovKick: 0,
    _t: 0,
    _baseFov: null,
    _lastOffset: { x: 0, y: 0, roll: 0 },
    _points: null,
    _geo: null,
    _pos: null,
    _col: null,
    _vel: null,
    _life: null,
    _maxLife: null,
    _cursor: 0,
  };

  if (enabled) {
    api._pos = new Float32Array(MAX_PARTICLES * 3);
    api._col = new Float32Array(MAX_PARTICLES * 3);
    api._vel = new Float32Array(MAX_PARTICLES * 3);
    api._life = new Float32Array(MAX_PARTICLES);
    api._maxLife = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) api._pos[i * 3 + 1] = -999;
    api._geo = new THREE.BufferGeometry();
    api._geo.setAttribute('position', new THREE.BufferAttribute(api._pos, 3));
    api._geo.setAttribute('color', new THREE.BufferAttribute(api._col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.7,
      map: makeSpriteTexture(THREE),
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
    });
    api._points = new THREE.Points(api._geo, mat);
    api._points.frustumCulled = false;
    scene.add(api._points);
  }

  api._spawn = function _spawn(type, x, y, z, opts) {
    if (!enabled) return;
    const def = TYPES[type] || TYPES.dust;
    const count = (opts && opts.count) || def.count;
    for (let n = 0; n < count; n++) {
      const i = api._cursor;
      api._cursor = (api._cursor + 1) % MAX_PARTICLES;
      const spread = (opts && opts.spread) || 0.6;
      api._pos[i * 3] = x + (Math.random() * 2 - 1) * spread;
      api._pos[i * 3 + 1] = y + (Math.random() * 2 - 1) * spread * 0.6;
      api._pos[i * 3 + 2] = z + (Math.random() * 2 - 1) * spread;
      const a = Math.random() * Math.PI * 2;
      const sp = def.speed * (0.4 + Math.random() * 0.8);
      api._vel[i * 3] = Math.cos(a) * sp;
      api._vel[i * 3 + 1] = def.up * (0.5 + Math.random());
      api._vel[i * 3 + 2] = Math.sin(a) * sp;
      api._col[i * 3] = def.color[0];
      api._col[i * 3 + 1] = def.color[1];
      api._col[i * 3 + 2] = def.color[2];
      api._life[i] = api._maxLife[i] = def.life * (0.7 + Math.random() * 0.6);
    }
    if (api._geo) {
      api._geo.attributes.position.needsUpdate = true;
      api._geo.attributes.color.needsUpdate = true;
    }
  };

  api.burst = function burst(type, x, y, z, opts) {
    if (!enabled) return;
    api._spawn(type, x, y ?? 1, z, opts);
    const def = TYPES[type];
    if (def) api.addTrauma(def.trauma);
  };

  api.addTrauma = function addTrauma(n) {
    api.trauma = Math.min(1, Math.max(0, api.trauma + n));
  };

  // One call per event tier: small (pickup), medium (hit), large (death).
  api.feedback = function feedback(kind, x, y, z) {
    if (!enabled) return;
    if (kind === 'hit') {
      api.burst('sparks', x, y ?? 1.4, z);
      api.addTrauma(0.35);
    } else if (kind === 'pickup') {
      api.burst('glint', x, y ?? 1.2, z);
      api.addTrauma(0.1);
    } else if (kind === 'death') {
      api.burst('smoke', x, y ?? 1.5, z, { count: 24 });
      api.addTrauma(1.0);
    } else if (kind === 'shot') {
      api.burst('muzzle', x, y ?? 1.4, z);
      api.addTrauma(0.15);
    } else if (kind === 'busted') {
      api.burst('smoke', x, y ?? 1.5, z);
      api.addTrauma(0.3);
    } else if (kind === 'land') {
      api.burst('dust', x, y ?? 0.3, z);
      api.addTrauma(0.2);
    }
  };

  api.update = function update(dt) {
    // Trauma / FOV decay is pure math, not scene work: it runs even when
    // the particle cloud is inert (headless tests), so trauma added in a
    // test actually fades instead of sticking at its peak forever.
    api.trauma = Math.max(0, api.trauma - api.decay * dt);
    api.fovKick *= Math.exp(-4 * dt);
    if (Math.abs(api.fovKick) < 0.01) api.fovKick = 0;
    if (!enabled) return;
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (api._life[i] <= 0) continue;
      any = true;
      api._life[i] -= dt;
      if (api._life[i] <= 0) {
        api._pos[i * 3 + 1] = -999;
        continue;
      }
      api._vel[i * 3 + 1] -= 2.5 * dt;
      api._pos[i * 3] += api._vel[i * 3] * dt;
      api._pos[i * 3 + 1] += api._vel[i * 3 + 1] * dt;
      api._pos[i * 3 + 2] += api._vel[i * 3 + 2] * dt;
      // Fade by shrinking toward the ground colour: dim the vertex colour.
      const f = api._life[i] / api._maxLife[i];
      api._col[i * 3] *= 0.985 + 0.015 * f;
      api._col[i * 3 + 1] *= 0.985 + 0.015 * f;
      api._col[i * 3 + 2] *= 0.985 + 0.015 * f;
    }
    if (any && api._geo) api._geo.attributes.position.needsUpdate = true;
  };

  // Camera offset only — the renderer sets the base transform every frame
  // before this runs, so the shake never accumulates. FOV kick widens the
  // lens briefly at speed / on impacts.
  api.applyCamera = function applyCamera(camera, dt) {
    // The offset is pure math too: compute + return it even when the
    // particle cloud is inert, so a headless caller still gets the offset
    // it applied (and can assert on it). Without a camera there is
    // nothing to move, but the offset is still the honest answer.
    api._t += (dt ?? 0.016) * 30;
    const shake = api.trauma * api.trauma * api.strength;
    const ox = api.maxOffset.x * shake * Math.sin(api._t * 1.7);
    const oy = api.maxOffset.y * shake * Math.sin(api._t * 2.3);
    const roll = api.maxRoll * shake * Math.sin(api._t * 1.1);
    api._lastOffset = { x: ox, y: oy, roll };
    if (!camera) return { ...api._lastOffset };
    if (shake > 0.0001) {
      camera.position.x += ox;
      camera.position.y += oy;
      camera.rotation.z += roll;
    }
    if (api._baseFov == null) api._baseFov = camera.fov;
    const wantFov = api._baseFov + api.fovKick;
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov;
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
    }
    return { ...api._lastOffset };
  };

  api.getCameraOffset = function getCameraOffset() {
    return { ...api._lastOffset };
  };

  return api;
}
