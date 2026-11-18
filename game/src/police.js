// police.js — Solmar Bay Police Department (SBPD).
// Wanted stars 0-5, patrol/chase/roadblock behaviour, on-foot cops at 4-5
// stars, busted rules, heat decay. Per DESIGN.md:
//   1 star - 1 patrol car cruises to you
//   2 stars - 2 cars chase + ram
//   3 stars - 3 cars + roadblock attempts (+ on-foot cops at 4-5)
//   4-5 stars - more cars, faster (NO helicopter - scope cut)
// Busted: on foot, cop within 3 m for 2 s; in a car, speed < 2 m/s and a
// police car within 4 m for 3 s -> lose $200 (or all cash if less),
// respawn at the precinct, wanted 0.
// Escape: out of police sight + distance > 60 m for 15 s -> -1 star / 10 s.
//
// The module only talks to the game through the shared context G and the
// small adapter helpers main.js provides (G.getPlayerPos, G.getPlayerSpeed,
// G.isInCar, G.worldBlocked, G.busted, G.emit). It builds its own car
// meshes from G.THREE so it never depends on the vehicle module's internals.

const MAX_STARS = 5;
const BUST_FOOT_DIST = 3;
const BUST_FOOT_TIME = 2;
const BUST_CAR_DIST = 4;
const BUST_CAR_TIME = 3;
const SIGHT_RANGE = 60; // beyond this the player is "out of sight"
const DECAY_AFTER = 15; // seconds out of sight before decay starts
const DECAY_EVERY = 10; // seconds per -1 star while hidden

// Fleet size per wanted level (DESIGN.md response table).
function fleetSizeFor(wanted) {
  if (wanted <= 0) return 0;
  if (wanted === 1) return 1;
  if (wanted === 2) return 2;
  if (wanted === 3) return 3;
  if (wanted === 4) return 4;
  return 5;
}

function footCopsFor(wanted) {
  return wanted >= 5 ? 2 : wanted >= 4 ? 1 : 0;
}

function chaseSpeedFor(wanted) {
  return 24 + wanted * 2.4; // 1 star ~26 m/s, 5 stars ~36 m/s
}

export function createPolice(G) {
  const THREE = G && G.THREE;
  const scene = G && G.scene;
  const hasGL = !!(THREE && scene);

  const cars = []; // { mesh, group, lightL, lightR, pos, heading, speed,
  //   mode: 'cruise'|'chase'|'roadblock'|'leaving', stuck, ramCooldown,
  //   damageCooldown, flash }
  const footCops = []; // { mesh, pos, heading, speed, bustTimer }
  let lastSeenAt = -1e9;
  let decayAcc = 0;
  let bustTimer = 0;
  let roadblockAt = 0;
  let flashPhase = 0;

  // --- helpers ------------------------------------------------------------
  function playerPos() {
    if (G && typeof G.getPlayerPos === 'function') {
      const p = G.getPlayerPos();
      if (p) return p;
    }
    if (G && G.player && G.player.pos) return G.player.pos;
    return { x: 0, y: 0, z: 0 };
  }

  function playerSpeed() {
    if (G && typeof G.getPlayerSpeed === 'function') return G.getPlayerSpeed() || 0;
    if (G && G.player && typeof G.player.speed === 'number') return G.player.speed;
    return 0;
  }

  function playerInCar() {
    if (G && typeof G.isInCar === 'function') return !!G.isInCar();
    if (G && G.player) return !!G.player.inCar;
    return false;
  }

  function blocked(x, z) {
    if (G && typeof G.worldBlocked === 'function') {
      try {
        return !!G.worldBlocked(x, z);
      } catch (_err) {
        return false;
      }
    }
    return false;
  }

  function dist2(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function angleTo(fromX, fromZ, toX, toZ) {
    return Math.atan2(toX - fromX, toZ - fromZ);
  }

  function turnToward(cur, target, maxStep) {
    let d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (d > maxStep) return cur + maxStep;
    if (d < -maxStep) return cur - maxStep;
    return target;
  }

  // --- meshes ---------------------------------------------------------------
  function buildCarMesh() {
    const group = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1c4ed8, roughness: 0.4, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.4), white);
    body.position.y = 0.55;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), dark);
    cabin.position.set(0, 1.05, -0.2);
    cabin.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.18, 4.42), blue);
    stripe.position.y = 0.62;
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.3), dark);
    barBase.position.set(0, 1.36, -0.2);
    const lightL = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.16, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 1 }),
    );
    lightL.position.set(-0.28, 1.44, -0.2);
    const lightR = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.16, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x0044ff, emissiveIntensity: 1 }),
    );
    lightR.position.set(0.28, 1.44, -0.2);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.36, wz);
      group.add(w);
    }
    group.add(body, cabin, stripe, barBase, lightL, lightR);
    return { group, lightL, lightR };
  }

  function buildFootCopMesh() {
    const group = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), navy);
    body.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
    head.position.y = 1.72;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.24, 0.12, 10), navy);
    cap.position.y = 1.86;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.3), navy);
    legs.position.y = 0.35;
    group.add(body, head, cap, legs);
    return { group };
  }

  function spawnPositionNear(px, pz, minR, maxR) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      if (Math.abs(x) > 195 || Math.abs(z) > 195) continue;
      if (!blocked(x, z)) return { x, z };
    }
    return { x: px + 45, z: pz };
  }

  function addCar(x, z, mode) {
    if (!hasGL) {
      cars.push({
        mesh: null, group: null, lightL: null, lightR: null,
        pos: { x, y: 0, z }, heading: 0, speed: 0,
        mode: mode || 'chase', stuck: 0, ramCooldown: 0, damageCooldown: 0, flash: 0,
      });
      return cars[cars.length - 1];
    }
    const { group, lightL, lightR } = buildCarMesh();
    group.position.set(x, 0, z);
    scene.add(group);
    const car = {
      mesh: group, group, lightL, lightR,
      pos: group.position, heading: Math.random() * Math.PI * 2, speed: 0,
      mode: mode || 'chase', stuck: 0, ramCooldown: 0, damageCooldown: 0, flash: 0,
    };
    cars.push(car);
    return car;
  }

  function removeCar(car) {
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    if (hasGL && car.group) scene.remove(car.group);
  }

  function addFootCop(x, z) {
    if (!hasGL) {
      footCops.push({ mesh: null, pos: { x, y: 0, z }, heading: 0, speed: 0, bustTimer: 0 });
      return footCops[footCops.length - 1];
    }
    const { group } = buildFootCopMesh();
    group.position.set(x, 0, z);
    scene.add(group);
    const cop = { mesh: group, pos: group.position, heading: 0, speed: 0, bustTimer: 0 };
    footCops.push(cop);
    return cop;
  }

  function removeFootCop(cop) {
    const i = footCops.indexOf(cop);
    if (i >= 0) footCops.splice(i, 1);
    if (hasGL && cop.mesh) scene.remove(cop.mesh);
  }

  function syncFleet() {
    const wanted = (G && G.wanted) || 0;
    const wantCars = fleetSizeFor(wanted);
    const p = playerPos();
    while (cars.length < wantCars) {
      const sp = spawnPositionNear(p.x, p.z, 40, 60);
      addCar(sp.x, sp.z, wanted >= 2 ? 'chase' : 'cruise');
    }
    while (cars.length > wantCars) {
      // Retire the farthest car first (it "gives up" off-screen).
      let far = cars[0];
      let farD = -1;
      for (const c of cars) {
        const d = dist2(c.pos.x, c.pos.z, p.x, p.z);
        if (d > farD) { farD = d; far = c; }
      }
      removeCar(far);
    }
    const wantFoot = footCopsFor(wanted);
    while (footCops.length < wantFoot) {
      const sp = spawnPositionNear(p.x, p.z, 12, 20);
      addFootCop(sp.x, sp.z);
    }
    while (footCops.length > wantFoot) removeFootCop(footCops[footCops.length - 1]);
  }

  function nearestCarDist() {
    const p = playerPos();
    let best = Infinity;
    for (const c of cars) best = Math.min(best, dist2(c.pos.x, c.pos.z, p.x, p.z));
    for (const c of footCops) best = Math.min(best, dist2(c.pos.x, c.pos.z, p.x, p.z));
    return best;
  }

  const api = {
    get cars() {
      return cars;
    },
    get footCops() {
      return footCops;
    },
    get count() {
      return cars.length + footCops.length;
    },

    get wanted() {
      return (G && G.wanted) || 0;
    },

    // Raise heat. Caps at 5 stars. Spawns the matching fleet immediately
    // and tells the player through the HUD feed.
    addHeat(n, reason) {
      if (!G) return 0;
      const before = G.wanted || 0;
      G.wanted = Math.max(0, Math.min(MAX_STARS, before + (n || 0)));
      if (G.wanted > before) {
        lastSeenAt = G.time || 0;
        decayAcc = 0;
        syncFleet();
        if (G.hud && typeof G.hud.toast === 'function') {
          const stars = '★'.repeat(G.wanted);
          G.hud.toast(`WANTED ${stars} — the SBPD is on you`, 'wanted');
        }
        if (G.audio) G.audio.sfx('siren-blip');
      }
      if (G.emit) G.emit('wanted', { wanted: G.wanted, reason: reason || 'heat' });
      return G.wanted;
    },

    setWanted(n, reason) {
      if (!G) return 0;
      const before = G.wanted || 0;
      G.wanted = Math.max(0, Math.min(MAX_STARS, Math.floor(n || 0)));
      if (G.wanted !== before) {
        if (G.wanted > 0) {
          lastSeenAt = G.time || 0;
          decayAcc = 0;
        }
        syncFleet();
        if (G.emit) G.emit('wanted', { wanted: G.wanted, reason: reason || 'set' });
      }
      return G.wanted;
    },

    // Drop all heat (mission fail retry, respawn, cheat-free reset).
    clearWanted() {
      if (!G) return;
      G.wanted = 0;
      decayAcc = 0;
      bustTimer = 0;
      syncFleet();
    },

    // Spawn one police car at an exact spot (shots staging, M3 start).
    spawnCarAt(x, z, mode) {
      const car = addCar(x, z, mode || 'chase');
      return car;
    },

    // Force N cars into chase mode right now (M3 "The Getaway", shot 3).
    forceChase(n) {
      const p = playerPos();
      while (cars.length < n) {
        const sp = spawnPositionNear(p.x, p.z, 25, 40);
        addCar(sp.x, sp.z, 'chase');
      }
      for (const c of cars) c.mode = 'chase';
      lastSeenAt = G.time || 0;
    },

    nearestDist: nearestCarDist,

    // Remove every police unit from the world (mission reset / new game).
    clear() {
      while (cars.length) removeCar(cars[0]);
      while (footCops.length) removeFootCop(footCops[0]);
      bustTimer = 0;
      decayAcc = 0;
    },

    update(dt) {
      if (!G) return;
      const step = Math.min(dt || 0.016, 0.05);
      const t = G.time || 0;
      const wanted = G.wanted || 0;
      const p = playerPos();
      const pSpeed = playerSpeed();
      const inCar = playerInCar();

      // Light-bar flash (alternating red/blue, ~4 Hz).
      flashPhase += step;
      const redOn = Math.floor(flashPhase * 4) % 2 === 0;
      for (const c of cars) {
        if (c.lightL) c.lightL.material.emissiveIntensity = redOn ? 2.2 : 0.25;
        if (c.lightR) c.lightR.material.emissiveIntensity = redOn ? 0.25 : 2.2;
      }

      if (wanted <= 0) {
        if (cars.length || footCops.length) syncFleet();
        bustTimer = 0;
        return;
      }

      syncFleet();

      // --- sight / decay ---
      const near = nearestCarDist();
      if (near <= SIGHT_RANGE) {
        lastSeenAt = t;
        decayAcc = 0;
      } else if (t - lastSeenAt >= DECAY_AFTER) {
        decayAcc += step;
        if (decayAcc >= DECAY_EVERY) {
          decayAcc = 0;
          G.wanted = Math.max(0, wanted - 1);
          if (G.wanted === 0 && G.hud) G.hud.toast('You lost the cops. Heat is off.', 'info');
          syncFleet();
        }
      }

      // --- roadblocks at 3+ stars: every ~25 s a car parks across the
      // road ahead of the player. ---
      if (wanted >= 3 && t - roadblockAt > 25) {
        roadblockAt = t;
        const heading = (G.player && typeof G.player.heading === 'number') ? G.player.heading : 0;
        const ax = p.x + Math.sin(heading) * 55;
        const az = p.z + Math.cos(heading) * 55;
        if (Math.abs(ax) < 190 && Math.abs(az) < 190 && !blocked(ax, az)) {
          const rb = addCar(ax, az, 'roadblock');
          rb.heading = heading + Math.PI / 2;
          if (G.hud) G.hud.toast('Roadblock ahead!', 'wanted');
        }
      }

      // --- police cars ---
      const chaseSpeed = chaseSpeedFor(wanted);
      for (const car of [...cars]) {
        car.ramCooldown = Math.max(0, car.ramCooldown - step);
        car.damageCooldown = Math.max(0, car.damageCooldown - step);
        const d = dist2(car.pos.x, car.pos.z, p.x, p.z);

        if (car.mode === 'roadblock') {
          // Parked across the road; leaves when the player gets far away.
          if (d > 80) {
            car.mode = 'chase';
          } else {
            car.speed = 0;
            if (hasGL && car.group) {
              car.group.position.set(car.pos.x, 0, car.pos.z);
              car.group.rotation.y = car.heading;
            }
            continue;
          }
        }

        if (car.mode === 'cruise' && wanted >= 2) car.mode = 'chase';

        const targetSpeed = car.mode === 'chase' ? chaseSpeed : 16;
        const wantHeading = angleTo(car.pos.x, car.pos.z, p.x, p.z);
        const turnRate = car.mode === 'chase' ? 2.6 : 1.6;
        car.heading = turnToward(car.heading, wantHeading, turnRate * step);

        // Simple obstacle probe: if the cell ahead is blocked, swing away.
        const aheadX = car.pos.x + Math.sin(car.heading) * 6;
        const aheadZ = car.pos.z + Math.cos(car.heading) * 6;
        if (blocked(aheadX, aheadZ)) {
          const leftX = car.pos.x + Math.sin(car.heading - 0.9) * 6;
          const leftZ = car.pos.z + Math.cos(car.heading - 0.9) * 6;
          const rightX = car.pos.x + Math.sin(car.heading + 0.9) * 6;
          const rightZ = car.pos.z + Math.cos(car.heading + 0.9) * 6;
          car.heading += blocked(leftX, leftZ) ? 0.9 : -0.9;
          if (blocked(rightX, rightZ) && blocked(leftX, leftZ)) car.speed *= 0.5;
        }

        car.speed += (targetSpeed - car.speed) * Math.min(1, 1.4 * step);
        if (d < 3.5 && car.mode === 'chase') {
          // Ram: shove the player and damage their car (or the player).
          if (car.ramCooldown <= 0) {
            car.ramCooldown = 1.2;
            if (G.effects) G.effects.sparks(p.x, 1, p.z, 8);
            if (G.effects) G.effects.shake(0.35);
            if (G.audio) G.audio.sfx('crash');
            if (inCar && typeof G.damagePlayerVehicle === 'function') {
              G.damagePlayerVehicle(6);
            } else if (!inCar && G.combat) {
              G.combat.damagePlayer(8, 'ram');
            }
          }
          car.speed = Math.max(4, car.speed * 0.55);
        }

        car.pos.x += Math.sin(car.heading) * car.speed * step;
        car.pos.z += Math.cos(car.heading) * car.speed * step;
        // Stay inside the city.
        car.pos.x = Math.max(-198, Math.min(198, car.pos.x));
        car.pos.z = Math.max(-198, Math.min(198, car.pos.z));
        if (hasGL && car.group) {
          car.group.position.set(car.pos.x, 0, car.pos.z);
          car.group.rotation.y = car.heading;
        }
      }

      // --- on-foot cops (4-5 stars): run the player down ---
      for (const cop of [...footCops]) {
        const d = dist2(cop.pos.x, cop.pos.z, p.x, p.z);
        const wantHeading = angleTo(cop.pos.x, cop.pos.z, p.x, p.z);
        cop.heading = turnToward(cop.heading, wantHeading, 4 * step);
        cop.speed = 7.5;
        cop.pos.x += Math.sin(cop.heading) * cop.speed * step;
        cop.pos.z += Math.cos(cop.heading) * cop.speed * step;
        if (hasGL && cop.mesh) {
          cop.mesh.position.set(cop.pos.x, 0, cop.pos.z);
          cop.mesh.rotation.y = cop.heading;
        }
        if (d < 2.2 && !inCar) {
          if (G.combat) G.combat.damagePlayer(6 * step * 2, 'cop');
        }
      }

      // --- busted check ---
      const bustDist = inCar ? BUST_CAR_DIST : BUST_FOOT_DIST;
      const bustTime = inCar ? BUST_CAR_TIME : BUST_FOOT_TIME;
      const canBust = inCar ? pSpeed < 2 : true;
      if (near <= bustDist && canBust) {
        bustTimer += step;
        if (bustTimer >= bustTime) {
          bustTimer = 0;
          if (typeof G.busted === 'function') G.busted();
        }
      } else {
        bustTimer = Math.max(0, bustTimer - step * 2);
      }
    },
  };

  return api;
}
