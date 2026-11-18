// Solmar Bay Police Department (SBPD) — wanted stars, pursuit, roadblocks, busts.
// Pure logic except createCopMesh, which builds a THREE group for a police car.
import { createCar, createCarMesh } from './vehicle.js';

const WANTED_COUNT = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
const DECAY_SIGHT_LOSS = 15; // seconds out of sight before stars start falling
const DECAY_STEP = 10; // seconds per -1 star once decay starts

export function createPolice() {
  return {
    stars: 0,
    heat: 0,
    cops: [],
    lastSeenT: 0,
    bustT: 0,
    decayT: 0,
    nextBlockerT: 0,
  };
}

function playerPos(S) {
  const p = S.player || {};
  if (p.pos) return { x: p.pos.x, z: p.pos.z };
  if (p.position) return { x: p.position.x, z: p.position.z };
  return { x: p.x || 0, z: p.z || 0 };
}

function playerHeading(S) {
  const p = S.player || {};
  return p.heading ?? p.h ?? p.angle ?? 0;
}

function playerSpeed(S) {
  const p = S.player || {};
  if (p.car && typeof p.car.speed === 'number') return Math.abs(p.car.speed);
  return Math.abs(p.speed ?? p.velocity ?? 0);
}

function inCar(S) {
  const p = S.player || {};
  return !!(p.inCar || p.car || p.driving);
}

// Snap a coordinate onto the nearest street line. Streets run every 50 m
// across the 400 m city, centred on 0.
function snapStreet(v) {
  return Math.max(-200, Math.min(200, Math.round(v / 50) * 50));
}

function spawnPosNear(S, i) {
  const pp = playerPos(S);
  const h = playerHeading(S);
  // Spawn on a street 45-75 m away, spread around the player by index.
  const angle = h + Math.PI + (i - 1) * 0.9;
  const dist = 50 + (i % 3) * 12;
  const x = snapStreet(pp.x + Math.sin(angle) * dist);
  const z = snapStreet(pp.z + Math.cos(angle) * dist);
  return { x, z };
}

function makeCop(S, x, z, heading) {
  // createCar takes an options object (vehicle.js); the police mesh is
  // built with the THREE namespace carried on S.THREE (set by main.js).
  const car = createCar({ x, z, heading, kind: 'police', color: '#f2f5f7' });
  car.kind = 'police';
  const cop = {
    car,
    mesh: null,
    x, z, heading,
    speed: 0,
    hp: 100,
    disabled: false,
    blocker: false,
    bustT: 0,
    flashT: 0,
  };
  try {
    cop.mesh = S.THREE ? createCopMesh(cop, S.THREE) : createCarMesh(car, S.THREE);
  } catch (e) {
    cop.mesh = null;
  }
  if (cop.mesh && S.scene && typeof S.scene.add === 'function') {
    try { S.scene.add(cop.mesh); } catch (e) { /* already added by factory */ }
  }
  return cop;
}

function removeCop(S, cop) {
  if (cop.mesh && S.scene && typeof S.scene.remove === 'function') {
    try { S.scene.remove(cop.mesh); } catch (e) { /* ignore */ }
  }
  const i = S.police.cops.indexOf(cop);
  if (i >= 0) S.police.cops.splice(i, 1);
}

export function addHeat(S, n) {
  const pol = S.police;
  if (!pol) return;
  pol.heat = Math.min(20, (pol.heat || 0) + n);
  pol.stars = Math.min(5, (pol.stars || 0) + n);
  pol.lastSeenT = S.time || 0;
  pol.decayT = 0;
  if (pol.stars > 0 && S.hud) {
    const msg = pol.stars >= 3
      ? `WANTED ${'★'.repeat(pol.stars)} — the SBPD is on you`
      : `WANTED ${'★'.repeat(pol.stars)}`;
    if (S.messages) S.messages.push({ text: msg, t: S.time || 0 });
  }
}

function nearestCopDist(S) {
  const pp = playerPos(S);
  let best = Infinity;
  for (const cop of S.police.cops) {
    if (cop.disabled) continue;
    const dx = (cop.x ?? cop.car?.x ?? 0) - pp.x;
    const dz = (cop.z ?? cop.car?.z ?? 0) - pp.z;
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

function flashLightBar(cop, t) {
  if (!cop.mesh || !cop.mesh.userData) return;
  const on = Math.floor(t * 2) % 2 === 0;
  const red = cop.mesh.userData.lightRed;
  const blue = cop.mesh.userData.lightBlue;
  if (red && red.material) red.material.emissiveIntensity = on ? 2.2 : 0.15;
  if (blue && blue.material) blue.material.emissiveIntensity = on ? 0.15 : 2.2;
  if (red) red.visible = true;
  if (blue) blue.visible = true;
}

export function updatePolice(S, dt) {
  const pol = S.police;
  if (!pol) return;
  const pp = playerPos(S);
  const t = S.time || 0;

  // --- desired strength ---
  const want = WANTED_COUNT[Math.max(0, Math.min(5, pol.stars || 0))] || 0;
  const active = pol.cops.filter((c) => !c.disabled);
  while (active.length < want) {
    const i = pol.cops.length;
    const sp = spawnPosNear(S, i);
    const heading = Math.atan2(pp.x - sp.x, pp.z - sp.z);
    const cop = makeCop(S, sp.x, sp.z, heading);
    pol.cops.push(cop);
    active.push(cop);
  }
  while (pol.cops.length > want && pol.stars === 0) {
    // No wanted level: stand the extra cars down.
    removeCop(S, pol.cops[pol.cops.length - 1]);
  }
  // If stars dropped, trim disabled/extra cops gradually.
  if (pol.cops.length > want) {
    const extra = pol.cops.filter((c) => !c.disabled).slice(want);
    for (const c of extra) removeCop(S, c);
  }

  // --- sight / decay ---
  const near = nearestCopDist(S);
  const seen = pol.stars > 0 && near < 60;
  if (seen) {
    pol.lastSeenT = t;
    pol.decayT = 0;
  } else if (pol.stars > 0 && t - (pol.lastSeenT || 0) > DECAY_SIGHT_LOSS) {
    pol.decayT += dt;
    if (pol.decayT >= DECAY_STEP) {
      pol.decayT = 0;
      pol.stars = Math.max(0, pol.stars - 1);
      pol.heat = Math.max(0, (pol.heat || 0) - 1);
      if (S.messages) S.messages.push({ text: 'Heat cooling off…', t });
    }
  }

  // --- roadblock: at 3+ stars one cop gets ahead of the player ---
  if (pol.stars >= 3 && t >= (pol.nextBlockerT || 0)) {
    pol.nextBlockerT = t + 9;
    const chasers = pol.cops.filter((c) => !c.disabled && !c.blocker);
    const current = pol.cops.find((c) => c.blocker);
    if (current) current.blocker = false;
    if (chasers.length > 0) {
      const pick = chasers[Math.floor(S.rng ? S.rng() * chasers.length : 0) % chasers.length];
      pick.blocker = true;
    }
  }

  const h = playerHeading(S);
  const speed = playerSpeed(S);
  let busted = false;

  for (const cop of [...pol.cops]) {
    if (cop.disabled) {
      flashLightBar(cop, t);
      continue;
    }
    const cx = cop.car?.x ?? cop.x;
    const cz = cop.car?.z ?? cop.z;
    const dx = pp.x - cx;
    const dz = pp.z - cz;
    const dist = Math.hypot(dx, dz) || 0.001;
    const targetHeading = Math.atan2(dx, dz);

    if (cop.blocker && pol.stars >= 3) {
      // Drive to a point 26 m ahead of the player and sit across the road.
      const tx = pp.x + Math.sin(h) * 26;
      const tz = pp.z + Math.cos(h) * 26;
      const bx = tx - cx;
      const bz = tz - cz;
      const bd = Math.hypot(bx, bz) || 0.001;
      cop.heading = Math.atan2(bx, bz);
      const top = pol.stars >= 4 ? 34 : 30;
      cop.speed = Math.min(top, cop.speed + 14 * dt);
      if (bd > 2) {
        cop.x = cx + Math.sin(cop.heading) * cop.speed * dt;
        cop.z = cz + Math.cos(cop.heading) * cop.speed * dt;
      } else {
        cop.speed = 0;
        // Sit sideways across the road.
        cop.heading = h + Math.PI / 2;
      }
    } else {
      // Chase: steer toward the player, faster and more aggressive at 4-5 stars.
      let dh = targetHeading - cop.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const turn = (pol.stars >= 4 ? 3.2 : 2.4) * dt;
      cop.heading += Math.max(-turn, Math.min(turn, dh));
      const top = pol.stars >= 5 ? 40 : pol.stars >= 4 ? 36 : pol.stars >= 2 ? 31 : 27;
      const wantSpeed = dist > 12 ? top : top * 0.7;
      cop.speed += (wantSpeed - cop.speed) * Math.min(1, 1.6 * dt);
      cop.x = cx + Math.sin(cop.heading) * cop.speed * dt;
      cop.z = cz + Math.cos(cop.heading) * cop.speed * dt;
      // Ram: shove the player's car when contact is made.
      if (dist < 5 && S.player && S.player.car) {
        const car = S.player.car;
        if (typeof car.x === 'number') {
          car.x += (dx / dist) * 2.2 * dt * 10 * 0.1;
          car.z += (dz / dist) * 2.2 * dt * 10 * 0.1;
        }
        if (S.effects && typeof S.effects.spawnSparks === 'function') {
          // Sparks are spawned by the caller-facing helper below.
        }
      }
    }

    // Sync the vehicle object and its mesh.
    if (cop.car) {
      cop.car.x = cop.x;
      cop.car.z = cop.z;
      cop.car.heading = cop.heading;
      cop.car.speed = cop.speed;
    }
    if (cop.mesh) {
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.heading;
    }
    flashLightBar(cop, t);

    // --- busted check ---
    const ndx = pp.x - cop.x;
    const ndz = pp.z - cop.z;
    const nd = Math.hypot(ndx, ndz);
    if (pol.stars > 0) {
      if (!inCar(S) && nd < 3) {
        cop.bustT += dt;
        if (cop.bustT >= 2) busted = true;
      } else if (inCar(S) && speed < 2 && nd < 4) {
        cop.bustT += dt;
        if (cop.bustT >= 3) busted = true;
      } else {
        cop.bustT = Math.max(0, cop.bustT - dt * 2);
      }
    }
  }

  if (busted && typeof S.onBusted === 'function') {
    pol.bustT = 0;
    for (const c of pol.cops) c.bustT = 0;
    S.onBusted();
  }
}

// Build a police car mesh: white body, blue stripe, red/blue light bar.
// `THREE` is passed in so this module stays the only place that needs it here.
export function createCopMesh(cop, THREE) {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.35, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.6, metalness: 0.2 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1445c8, roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.15, metalness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.4), white);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.55, 2.1), glass);
  cabin.position.set(0, 1.1, -0.25);
  group.add(cabin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.16, 4.42), blue);
  stripe.position.y = 0.62;
  group.add(stripe);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
  for (const [wx, wz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
  }
  // Light bar: red left, blue right, flashing via emissive intensity.
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.34), dark);
  barBase.position.set(0, 1.45, -0.25);
  group.add(barBase);
  const redMat = new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0xff2222, emissiveIntensity: 2 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x1122aa, emissive: 0x2244ff, emissiveIntensity: 0.2 });
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), redMat);
  red.position.set(-0.28, 1.55, -0.25);
  group.add(red);
  const blueLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), blueMat);
  blueLight.position.set(0.28, 1.55, -0.25);
  group.add(blueLight);
  group.userData.lightRed = red;
  group.userData.lightBlue = blueLight;
  group.userData.cop = cop || null;
  return group;
}
