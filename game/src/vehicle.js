// Solmar Bay — vehicles: arcade driving, damage, meshes. Logic is pure;
// mesh builders take THREE as a parameter so this module stays three-free.
import { CONFIG } from './config.js';
import { collidesWithBuildings } from './city.js';

export const CAR_COLORS = [
  '#c94a3a', '#3a7ac9', '#d8a03a', '#3a9e6a', '#e8e4da',
  '#2e2e34', '#7a5ac9', '#e86aa0', '#4ad8d0', '#f2f2f2',
];

let _nextId = 1;

export function createCar(options = {}) {
  const kind = options.kind || 'sedan';
  return {
    id: options.id !== undefined ? options.id : _nextId++,
    kind,
    x: options.x || 0,
    z: options.z || 0,
    heading: options.heading || 0,
    speed: options.speed || 0,
    hp: CONFIG.CAR.hp,
    color: options.color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    mesh: null,
    smoke: false,
    stalled: false,
  };
}

export function createCarMesh(car, THREE) {
  const g = new THREE.Group();
  const bodyColor = car.kind === 'police' ? 0xffffff : new THREE.Color(car.color);
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.25, metalness: 0.6 });

  const long = car.kind === 'truck' ? 5.4 : car.kind === 'sports' ? 4.4 : 4.2;
  const wide = car.kind === 'truck' ? 2.2 : 1.9;

  const body = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.65, long), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.85, 0.55, long * 0.45), darkMat);
  cabin.position.set(0, 1.12, -long * 0.06);
  cabin.castShadow = true;
  g.add(cabin);

  if (car.kind === 'police') {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(wide + 0.02, 0.2, long * 0.9),
      new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.5 })
    );
    stripe.position.y = 0.62;
    g.add(stripe);
  }

  if (car.kind === 'sports') {
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(wide * 0.9, 0.08, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.5 })
    );
    spoiler.position.set(0, 1.05, -long / 2 + 0.2);
    g.add(spoiler);
  }

  if (car.kind === 'police') {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.16, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 })
    );
    red.position.x = -0.35;
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.16, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 2 })
    );
    blue.position.x = 0.35;
    bar.add(red);
    bar.add(blue);
    bar.position.y = 1.5;
    bar.name = 'lightbar';
    g.add(bar);
  }

  // Headlights.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffedb0, emissiveIntensity: 1.2 });
  for (const sx of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), lightMat);
    hl.position.set(sx, 0.62, long / 2 + 0.02);
    g.add(hl);
  }

  // 4 wheels (cylinders rotated so the axis is across the car).
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheelPos = [
    [-wide / 2, long / 2 - 0.8],
    [wide / 2, long / 2 - 0.8],
    [-wide / 2, -long / 2 + 0.8],
    [wide / 2, -long / 2 + 0.8],
  ];
  for (const [wx, wz] of wheelPos) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.36, wz);
    w.castShadow = true;
    g.add(w);
  }

  g.position.set(car.x, 0, car.z);
  g.rotation.y = car.heading;
  car.mesh = g;
  return g;
}

export function updateCar(car, ctl, dt, city) {
  if (!car || car.stalled) return;
  const C = CONFIG.CAR;
  const top = car.kind === 'sports' ? C.sportsTop : C.top;

  // Steering scales down with speed so high-speed turns stay controllable.
  const speedFactor = 1 / (1 + Math.abs(car.speed) * 0.045);
  const steer = (ctl.steer || 0) * C.steerMax * speedFactor;
  if (Math.abs(car.speed) > 0.3) {
    car.heading += steer * (car.speed / top) * 2.4 * dt * (car.speed < 0 ? -1 : 1);
  }

  if (ctl.throttle > 0) {
    car.speed += C.accel * ctl.throttle * dt;
  } else if (ctl.throttle < 0) {
    if (car.speed > 0.5) car.speed -= C.brake * dt; // braking
    else car.speed -= C.reverse * dt; // reversing (throttle is negative)
    if (car.speed < -C.reverse) car.speed = -C.reverse;
  } else {
    // Rolling drag.
    car.speed -= car.speed * 0.6 * dt;
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }
  if (ctl.handbrake) {
    car.speed -= car.speed * 2.2 * dt;
    car.heading += steer * 0.9 * dt * (car.speed >= 0 ? 1 : -1);
  }
  if (car.speed > top) car.speed = top;

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let nx = car.x + fx * car.speed * dt;
  let nz = car.z + fz * car.speed * dt;

  if (city) {
    if (collidesWithBuildings(city, nx, nz, 1.6)) {
      // Stop and slide: keep the axis that is still free.
      const slideX = !collidesWithBuildings(city, nx, car.z, 1.6);
      const slideZ = !collidesWithBuildings(city, car.x, nz, 1.6);
      if (slideX) car.x = nx;
      if (slideZ) car.z = nz;
      if (Math.abs(car.speed) > 6) damageCar(car, Math.abs(car.speed) * 0.9);
      car.speed *= 0.35;
      nx = car.x;
      nz = car.z;
    } else {
      car.x = nx;
      car.z = nz;
    }
    const half = city.size / 2 - 3;
    car.x = Math.max(-half, Math.min(half, car.x));
    car.z = Math.max(-half, Math.min(half, car.z));
  } else {
    car.x = nx;
    car.z = nz;
  }

  if (car.mesh) {
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
  }
}

export function damageCar(car, amount) {
  if (!car || car.stalled) return;
  car.hp -= amount;
  if (car.hp <= 40) car.smoke = true;
  if (car.hp <= 0) {
    car.hp = 0;
    car.stalled = true;
    car.speed = 0;
  }
}
