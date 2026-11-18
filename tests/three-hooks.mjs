// Node module-customization hooks for the selftest: the bare specifier
// 'three' (imported by game/src/effects.js and game/src/render.js) is
// answered with a small in-memory stub, so pure-logic modules can be
// imported in Node with no browser and no real WebGL. Only the surface
// the game actually touches is stubbed; every method is a no-op or a
// plain data holder, and nothing renders.
const STUB = `
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
export class Quaternion { constructor() {} }
export class Matrix4 {
  compose() { return this; }
}
export class Color {
  constructor(v = 0) { this.value = v; }
  set(v) { this.value = v; return this; }
}
export class BoxGeometry { constructor() {} }
export class SphereGeometry { constructor() {} }
export class CylinderGeometry { constructor() {} }
export class ConeGeometry { constructor() {} }
export class PlaneGeometry { constructor() {} }
export class CircleGeometry { constructor() {} }
export class MeshStandardMaterial {
  constructor(p = {}) { Object.assign(this, p); this.emissiveIntensity = p.emissiveIntensity ?? 0; }
}
export class MeshBasicMaterial {
  constructor(p = {}) { Object.assign(this, p); this.opacity = p.opacity ?? 1; }
}
export class CanvasTexture {
  constructor() { this.colorSpace = null; }
}
export class Group {
  constructor() {
    this.children = []; this.position = new Vector3(); this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = new Vector3(1, 1, 1); this.visible = true; this.userData = {}; this.name = '';
  }
  add(c) { this.children.push(c); return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return this; }
}
export class Mesh {
  constructor(geo, mat) {
    this.geometry = geo; this.material = mat || new MeshBasicMaterial();
    this.position = new Vector3(); this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = new Vector3(1, 1, 1); this.visible = true; this.userData = {};
    this.castShadow = false; this.receiveShadow = false;
  }
}
export class InstancedMesh extends Mesh {
  constructor(geo, mat, count) {
    super(geo, mat); this.count = count;
    this.instanceMatrix = { needsUpdate: false };
    this.instanceColor = { needsUpdate: false };
  }
  setMatrixAt() {}
  setColorAt() {}
}
export class Fog { constructor(color, near, far) { this.color = color; this.near = near; this.far = far; } }
export class Scene extends Group {
  constructor() { super(); this.background = null; this.fog = null; }
}
export class PerspectiveCamera {
  constructor(fov, aspect, near, far) {
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    this.position = new Vector3();
  }
  lookAt() {}
  updateProjectionMatrix() {}
}
export class DirectionalLight {
  constructor(color, intensity) {
    this.color = color; this.intensity = intensity; this.position = new Vector3();
    this.castShadow = false;
    this.shadow = { mapSize: { set() {} }, camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 }, bias: 0 };
    this.target = new Group();
  }
}
export class HemisphereLight { constructor() {} }
export class WebGLRenderer {
  constructor() { this.domElement = { clientWidth: 1280, clientHeight: 720 }; this.shadowMap = {}; }
  setSize() {}
  setPixelRatio() {}
  render() {}
}
export const PCFSoftShadowMap = 1;
export const SRGBColorSpace = 'srgb';
export const ACESFilmicToneMapping = 1;
export const BackSide = 2;
export default { Vector3, Group, Mesh };
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: 'three-stub:///three.mjs', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'three-stub:///three.mjs') {
    return { format: 'module', shortCircuit: true, source: STUB };
  }
  return nextLoad(url, context);
}
