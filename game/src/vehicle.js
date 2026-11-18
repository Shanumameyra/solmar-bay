// vehicle.js — Solmar Bay arcade car physics + car factory (Worker B, v6 fresh)
// Contract: createCar(G, opts) / updateCar(G, car, dt, driverInput) / damageCar(car, amt)
// Forward convention: heading h -> forward = (sin h, 0, cos h). Mesh faces +Z at h=0.
import * as THREE from '../vendor/three/three.module.min.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- collision helpers (defensive: world.colliders may be AABB or circle shaped) ---
function collidePoint(G, x, z, r) {
  const cols = G.world && G.world.colliders;
  if (!cols) return { x, z };
  for (const c of cols) {
    if (c.r !== undefined) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz), min = r + c.r;
      if (d < min && d > 1e-4) { const s = min / d; x = c.x + dx * s; z = c.z + dz * s; }
    } else {
      const minX = c.minX !== undefined ? c.minX : c.x - (c.hx !== undefined ? c.hx : (c.w || 0) / 2);
      const maxX = c.maxX !== undefined ? c.maxX : c.x + (c.hx !== undefined ? c.hx : (c.w || 0) / 2);
      const minZ = c.minZ !== undefined ? c.minZ : c.z - (c.hz !== undefined ? c.hz : (c.d || 0) / 2);
      const maxZ = c.maxZ !== undefined ? c.maxZ : c.z + (c.hz !== undefined ? c.hz : (c.d || 0) / 2);
      if (x > minX - r && x < maxX + r && z > minZ - r && z < maxZ + r) {
        const pl = x - (minX - r), pr = (maxX + r) - x;
        const pt = z - (minZ - r), pb = (maxZ + r) - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = minX - r; else if (m === pr) x = maxX + r;
        else if (m === pt) z = minZ - r; else z = maxZ + r;
        return { x, z, hit: true };
      }
    }
  }
  return { x, z, hit: false };
}

function carBodyMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35 });
}

export function createCar(G, opts = {}) {
  const o = opts || {};
  const sports = !!o.sports;
  const police = !!o.police;
  const taxi = !!o.taxi;
  const color = o.color !== undefined ? o.color
    : police ? 0xf2f5f7 : taxi ? 0xf7c948 : sports ? 0xf7d117 : 0x7a8a99;
  const group = new THREE.Group();

  // Body: low wide box + cabin box. Sports cars sit lower with a spoiler.
  const bodyMat = carBodyMaterial(color);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.2, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd4e8, metalness: 0.8, roughness: 0.15 });
  const bodyH = sports ? 0.55 : 0.7;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, bodyH, sports ? 4.3 : 4.0), bodyMat);
  body.position.y = sports ? 0.45 : 0.55;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, sports ? 1.9 : 2.1), glassMat);
  cabin.position.set(0, body.position.y + bodyH / 2 + 0.27, sports ? -0.2 : -0.15);
  cabin.castShadow = true;
  group.add(cabin);
  if (sports) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.35), darkMat);
    spoiler.position.set(0, 0.95, -2.0);
    group.add(spoiler);
  }
  if (police) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.18, 4.02),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.3, roughness: 0.4 }));
    stripe.position.y = 0.62;
    group.add(stripe);
  }
  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.position.set(wx, 0.36, wz);
    w.castShadow = true;
    group.add(w);
    wheels.push(w);
  }
  // Headlights / taillights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xfff2a0, emissiveIntensity: 0.9 });
  const tlMat = new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0xcc0000, emissiveIntensity: 0.7 });
  for (const sx of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.06), hlMat);
    hl.position.set(sx, 0.62, sports ? 2.16 : 2.01);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.06), tlMat);
    tl.position.set(sx, 0.62, sports ? -2.16 : -2.01);
    group.add(tl);
  }
  // Police light bar (red/blue, flashed by police.js via car.lightBar)
  let lightBar = null;
  if (police) {
    lightBar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 1.5 }));
    red.position.x = -0.32;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x0033ff, emissiveIntensity: 1.5 }));
    blue.position.x = 0.32;
    lightBar.add(red); lightBar.add(blue);
    lightBar.position.set(0, body.position.y + bodyH / 2 + 0.62, -0.15);
    lightBar.userData.red = red; lightBar.userData.blue = blue;
    group.add(lightBar);
  }

  const heading = o.heading !== undefined ? o.heading : 0;
  group.position.set(o.x || 0, 0, o.z || 0);
  group.rotation.y = heading;
  if (G.scene) G.scene.add(group);

  const car = {
    mesh: group,
    pos: group.position, // same Vector3 reference as mesh.position
    heading,
    speed: 0,
    hp: 100,
    sports,
    police,
    taxi,
    color,
    wheels,
    lightBar,
    stalled: false,
    parked: !!o.parked,
    owned: !!o.owned,
    missionCar: !!o.missionCar,
    radius: 2.3,
    smokeTimer: 0,
    _prevX: group.position.x,
    _prevZ: group.position.z,
  };
  return car;
}

export function updateCar(G, car, dt, driverInput) {
  const inp = driverInput || {};
  const throttle = inp.throttle ? 1 : 0;
  const braking = !!inp.brake;
  const steer = clamp(inp.steer || 0, -1, 1);
  const handbrake = !!inp.handbrake;

  if (car.stalled) {
    // Dead car: coast to a stop, puff smoke.
    car.speed *= Math.max(0, 1 - 2.5 * dt);
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
    car.smokeTimer -= dt;
    if (car.smokeTimer <= 0 && G.effects) {
      G.effects.spawnSmoke(car.pos.x, car.pos.z);
      car.smokeTimer = 0.25;
    }
  } else {
    const top = car.sports ? 46 : 38;
    if (throttle) car.speed += 12 * dt;
    if (braking) {
      if (car.speed > 0.5) car.speed -= 20 * dt; // brake
      else car.speed -= 10 * dt; // reverse
      if (car.speed < -10) car.speed = -10;
    }
    if (!throttle && !braking) car.speed *= Math.max(0, 1 - 0.6 * dt); // rolling drag
    if (handbrake) {
      car.speed *= Math.max(0, 1 - 2.2 * dt);
      if (Math.abs(car.speed) > 6 && G.effects) {
        G.effects.spawnSmoke(car.pos.x - Math.sin(car.heading) * 1.5, car.pos.z - Math.cos(car.heading) * 1.5);
      }
    }
    if (car.speed > top) car.speed = top;
    // Steering authority shrinks with speed; no turn when (almost) stationary.
    const spd = Math.abs(car.speed);
    const authority = clamp(spd / 6, 0, 1) * (1 - Math.min(spd / 50, 0.6));
    let turn = steer * authority * 2.1 * dt * (car.speed >= 0 ? 1 : -1);
    if (handbrake && spd > 6) turn *= 1.8; // drift: sharper yaw
    car.heading += turn;
  }

  // Integrate.
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let nx = car.pos.x + fx * car.speed * dt;
  let nz = car.pos.z + fz * car.speed * dt;

  // World bounds (city ~400x400).
  const B = (G.world && G.world.bounds) || { min: -200, max: 200 };
  nx = clamp(nx, B.min + 2, B.max - 2);
  nz = clamp(nz, B.min + 2, B.max - 2);

  // Building / prop collision: push out; hard hits damage the car.
  const res = collidePoint(G, nx, nz, car.radius);
  if (res.hit && Math.abs(car.speed) > 8) {
    damageCar(car, Math.round((Math.abs(car.speed) - 8) * 1.5));
    if (G.effects) G.effects.spawnSparks(res.x, res.z);
    if (G.audio) G.audio.sfx('crash');
    car.speed *= -0.25; // bounce back
  }
  nx = res.x; nz = res.z;

  // Car-vs-car collision (player + traffic + police + parked).
  const others = [];
  if (G.vehicles) others.push(...G.vehicles);
  if (G.traffic) { others.push(...(G.traffic.cars || []), ...(G.traffic.parked || [])); }
  if (G.police) others.push(...(G.police.cars || []));
  for (const o of others) {
    if (o === car || !o.pos) continue;
    const dx = nx - o.pos.x, dz = nz - o.pos.z;
    const d = Math.hypot(dx, dz), min = car.radius + (o.radius || 2.3);
    if (d < min && d > 1e-4) {
      const overlap = min - d;
      const ux = dx / d, uz = dz / d;
      // Push BOTH cars apart (half each) + a lateral nudge so a head-on pair
      // slides past instead of vibrating in place forever.
      nx += ux * overlap * 0.5; nz += uz * overlap * 0.5;
      o.pos.x -= ux * overlap * 0.5; o.pos.z -= uz * overlap * 0.5;
      const side = 0.35 * overlap;
      nx += -uz * side; nz += ux * side;
      o.pos.x += uz * side; o.pos.z -= ux * side;
      if (o.mesh) o.mesh.position.set(o.pos.x, 0, o.pos.z);
      // Approach speed along the separation normal (only true closing counts).
      const cvx = Math.sin(car.heading) * car.speed, cvz = Math.cos(car.heading) * car.speed;
      const ovx = Math.sin(o.heading || 0) * (o.speed || 0), ovz = Math.cos(o.heading || 0) * (o.speed || 0);
      const closing = -((cvx - ovx) * ux + (cvz - ovz) * uz);
      if (closing > 6) {
        damageCar(car, Math.round((closing - 6) * 1.2));
        if (typeof o.hp === 'number') damageCar(o, Math.round((closing - 6) * 1.2));
        if (G.effects) G.effects.spawnSparks(nx, nz);
        if (G.audio) G.audio.sfx('crash');
        car.speed *= 0.5;
      } else if (closing > 3) {
        car.speed *= Math.max(0.5, 1 - closing * 0.04);
      }
    }
  }

  car.pos.x = nx; car.pos.z = nz;
  car.mesh.position.set(nx, 0, nz);
  car.mesh.rotation.y = car.heading;

  // Wheel spin.
  const spin = (car.speed * dt) / 0.36;
  for (const w of car.wheels) w.rotation.x += spin;

  // Engine sound for the player's car.
  if (G.audio && car === (G.player && G.player.car)) {
    G.audio.engine(Math.abs(car.speed), throttle);
  }
}

export function damageCar(car, amt) {
  if (!car || car.stalled) return;
  car.hp -= amt;
  if (car.hp <= 0) {
    car.hp = 0;
    car.stalled = true;
    car.speed = Math.min(car.speed, 5);
  }
}
