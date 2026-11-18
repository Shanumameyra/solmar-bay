// Solmar Bay — ambient traffic cars + pedestrians. Logic is pure;
// mesh builders take THREE as a parameter.
import { CONFIG } from './config.js';
import { mulberry32, range, int, choice } from './random.js';
import { createCar, createCarMesh, updateCar } from './vehicle.js';
import { collidesWithBuildings } from './city.js';

// Traffic-light cycle: 20 s period, NS green for the first 10 s.
export function lightState(t) {
  return (t % 20) < 10 ? 'green' : 'red';
}

function streetLines(city) {
  const half = city.size / 2;
  const pitch = city.size / city.blocks;
  const lines = [];
  for (let k = 1; k < city.blocks; k++) {
    lines.push(-half + k * pitch);
  }
  return lines;
}

function makeRoute(rng, city) {
  // A rectangular loop around one city block, on street lines.
  const lines = streetLines(city);
  const x0 = choice(rng, lines);
  const x1 = choice(rng, lines.filter((v) => Math.abs(v - x0) > 40));
  const z0 = choice(rng, lines);
  const z1 = choice(rng, lines.filter((v) => Math.abs(v - z0) > 40));
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const za = Math.min(z0, z1);
  const zb = Math.max(z0, z1);
  return [
    { x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb },
  ];
}

export function createTraffic(city, rngInput) {
  const rng = rngInput || mulberry32(city.seed || 7);
  const cars = [];
  for (let i = 0; i < CONFIG.TRAFFIC_COUNT; i++) {
    const route = makeRoute(rng, city);
    const start = route[0];
    const car = createCar({
      kind: rng() < 0.15 ? 'taxi' : (rng() < 0.12 ? 'truck' : 'sedan'),
      x: start.x,
      z: start.z,
      heading: 0,
      color: undefined,
    });
    car.route = route;
    car.wp = 1;
    car.cruise = range(rng, 7, 11);
    car.wait = 0;
    car.honkCooldown = 0;
    cars.push(car);
  }

  const peds = [];
  const pedColors = ['#e8e4da', '#3a7ac9', '#c94a3a', '#d8a03a', '#3a9e6a', '#7a5ac9'];
  for (let i = 0; i < CONFIG.PED_COUNT; i++) {
    const x = range(rng, -180, 180);
    const z = range(rng, -180, 180);
    peds.push({
      x,
      z,
      heading: range(rng, 0, Math.PI * 2),
      speed: range(rng, 1, 1.8),
      state: 'walk',
      mesh: null,
      color: choice(rng, pedColors),
      wanderT: range(rng, 2, 6),
      fleeT: 0,
    });
  }
  return { cars, peds };
}

export function createTrafficMeshes(traffic, THREE) {
  for (const car of traffic.cars) {
    createCarMesh(car, THREE);
  }
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.8 });
  for (const ped of traffic.peds) {
    const g = new THREE.Group();
    const shirt = new THREE.MeshStandardMaterial({ color: ped.color, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.28), shirt);
    body.position.y = 1.1;
    body.castShadow = true;
    g.add(body);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.22), new THREE.MeshStandardMaterial({ color: 0x2e2e34 }));
    legs.position.y = 0.38;
    g.add(legs);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
    head.position.y = 1.68;
    g.add(head);
    g.position.set(ped.x, 0, ped.z);
    g.rotation.y = ped.heading;
    ped.mesh = g;
  }
  return traffic;
}

function nearestAhead(car, others, maxDist) {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let best = maxDist;
  for (const o of others) {
    if (o === car) continue;
    const dx = o.x - car.x;
    const dz = o.z - car.z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (along > 0 && along < best && side < 2.5) best = along;
  }
  return best;
}

export function updateTraffic(S, dt) {
  const cars = S.trafficCars || (S.traffic && S.traffic.cars) || [];
  const peds = S.peds || (S.traffic && S.traffic.peds) || [];
  const t = S.time || 0;
  const light = lightState(t);

  for (const car of cars) {
    if (!car.route || !car.route.length) continue;
    if (car.honkCooldown > 0) car.honkCooldown -= dt;

    // Waypoint steering.
    const wp = car.route[car.wp % car.route.length];
    const dx = wp.x - car.x;
    const dz = wp.z - car.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) {
      car.wp = (car.wp + 1) % car.route.length;
      continue;
    }
    const targetH = Math.atan2(dx, dz);
    let dh = targetH - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, dh * 2));

    // Stop at red lights near intersections, yield to the player car ahead.
    let throttle = 1;
    const ahead = nearestAhead(car, cars, 12);
    const playerCar = S.player && S.player.car;
    let playerAhead = Infinity;
    if (playerCar && playerCar !== car) {
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const pdx = playerCar.x - car.x;
      const pdz = playerCar.z - car.z;
      const along = pdx * fx + pdz * fz;
      const side = Math.abs(pdx * fz - pdz * fx);
      if (along > 0 && along < 12 && side < 3) playerAhead = along;
    }
    const blocked = Math.min(ahead, playerAhead);
    if (blocked < 8) {
      throttle = 0;
      if (blocked < 5 && car.honkCooldown <= 0) {
        car.honkCooldown = 4;
        if (S.audio && S.audio.honk) S.audio.honk();
      }
    }
    // Red light: stop when close to an intersection centre line.
    if (light === 'red') {
      const nearX = Math.abs(car.x % 50) < 6 || Math.abs(car.x % 50) > 44;
      const nearZ = Math.abs(car.z % 50) < 6 || Math.abs(car.z % 50) > 44;
      if ((nearX || nearZ) && Math.abs(dh) < 0.6) throttle = 0;
    }

    const ctl = { throttle, steer, handbrake: false };
    // Cap traffic speed at its cruise speed.
    const before = car.speed;
    updateCar(car, ctl, dt, S.city);
    if (car.speed > car.cruise) car.speed = car.cruise;
    if (throttle === 0 && car.speed > 0.5) car.speed = Math.max(0, car.speed - 14 * dt);
    void before;
  }

  for (const ped of peds) {
    if (ped.fleeT > 0) {
      ped.fleeT -= dt;
      ped.state = 'flee';
    } else if (ped.state === 'flee') {
      ped.state = 'walk';
    }
    // Flee from a fast-approaching player car.
    const pc = S.player && S.player.car;
    if (pc && Math.abs(pc.speed) > 8) {
      const d = Math.hypot(pc.x - ped.x, pc.z - ped.z);
      if (d < 10) {
        ped.state = 'flee';
        ped.fleeT = 2;
        ped.heading = Math.atan2(ped.x - pc.x, ped.z - pc.z);
      }
    }
    const speed = ped.state === 'flee' ? 5.5 : ped.speed;
    ped.wanderT -= dt;
    if (ped.wanderT <= 0 && ped.state !== 'flee') {
      ped.wanderT = range(Math.random, 2, 6);
      ped.heading += range(Math.random, -1.2, 1.2);
    }
    let nx = ped.x + Math.sin(ped.heading) * speed * dt;
    let nz = ped.z + Math.cos(ped.heading) * speed * dt;
    if (S.city) {
      if (collidesWithBuildings(S.city, nx, nz, 0.6)) {
        ped.heading += Math.PI / 2;
        nx = ped.x;
        nz = ped.z;
      }
      const half = S.city.size / 2 - 3;
      nx = Math.max(-half, Math.min(half, nx));
      nz = Math.max(-half, Math.min(half, nz));
    }
    ped.x = nx;
    ped.z = nz;
    if (ped.mesh) {
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.heading;
    }
  }
}
