// Solmar Bay — on-foot player: movement, enter/exit car, punch/shoot hooks.
// Logic is pure; the mesh builder takes THREE as a parameter.
import { CONFIG } from './config.js';
import { collidesWithBuildings, clampToCity } from './city.js';
import { updateCar } from './vehicle.js';
import { punch as punchNow, shoot as shootNow } from './combat.js';

export function createPlayer(spawn) {
  const s = spawn || { x: 0, z: 20, heading: 0 };
  return {
    x: s.x,
    z: s.z,
    heading: s.heading || 0,
    hp: CONFIG.PLAYER.hp,
    money: 150,
    weapon: 'fists',
    ammo: 0,
    onFoot: true,
    car: null,
    speed: 0,
    mesh: null,
  };
}

export function createPlayerMesh(player, THREE) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98a5a, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xff5a3a, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2e3d5a, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.24), pants);
  legs.position.y = 0.4;
  legs.castShadow = true;
  g.add(legs);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), shirt);
  body.position.y = 1.15;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  cap.position.y = 1.76;
  g.add(cap);

  // Simple arms so punches read visually.
  for (const sx of [-0.34, 0.34]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), shirt);
    arm.position.set(sx, 1.15, 0);
    g.add(arm);
  }

  g.position.set(player.x, 0, player.z);
  g.rotation.y = player.heading;
  player.mesh = g;
  return g;
}

function nearestCar(S, maxDist) {
  const cars = S.cars || S.parkedCars || [];
  let best = null;
  let bestD = maxDist;
  for (const c of cars) {
    const dx = c.x - S.player.x;
    const dz = c.z - S.player.z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function updatePlayer(S, dt) {
  const p = S.player;
  const input = S.input;
  if (!p || !input) return;

  // Mouse look: consume accumulated deltas, rotate the camera heading.
  if (input.mouseDX || input.mouseDY) {
    const m = input.mouseDX !== undefined ? input.mouseDX : 0;
    S.camHeading = (S.camHeading || 0) - m * 0.0025;
    if (typeof input.consumeMouse === 'function') input.consumeMouse();
    else {
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
  }
  const camH = S.camHeading !== undefined ? S.camHeading : p.heading;

  // Weapon state lives in combat (S.combat); mirror it here so the
  // on-foot punch/shoot paths and the HUD agree on one weapon.
  if (S.combat) {
    p.weapon = S.combat.weapon;
    p.ammo = S.combat.ammo;
  }

  // --- Driving ---
  if (!p.onFoot && p.car) {
    const ctl = {
      throttle: 0,
      steer: 0,
      handbrake: !!(input.keys && input.keys.ShiftLeft) || !!(input.keys && input.keys.ShiftRight),
    };
    if (input.keys.KeyW) ctl.throttle = 1;
    if (input.keys.KeyS) ctl.throttle = -1;
    if (input.keys.KeyA) ctl.steer = -1;
    if (input.keys.KeyD) ctl.steer = 1;
    updateCar(p.car, ctl, dt, S.city);
    p.x = p.car.x;
    p.z = p.car.z;
    p.heading = p.car.heading;
    p.speed = p.car.speed;
    S.camHeading = p.car.heading;
    if (input.keys.KeyH && S.audio && S.audio.honk) S.audio.honk();
    if (input.keys.KeyE && !updatePlayer._eHeld) {
      // Exit the car: step out to the side.
      p.onFoot = true;
      const side = p.heading + Math.PI / 2;
      p.x = p.car.x + Math.sin(side) * 2.2;
      p.z = p.car.z + Math.cos(side) * 2.2;
      p.speed = 0;
      p.car = null;
      S.camHeading = p.heading;
    }
    updatePlayer._eHeld = !!input.keys.KeyE;
    if (p.mesh) {
      p.mesh.visible = false;
    }
    return;
  }

  // --- On foot ---
  if (p.mesh) p.mesh.visible = true;
  updatePlayer._eHeld = updatePlayer._eHeld || false;

  let mx = 0;
  let mz = 0;
  if (input.keys.KeyW) { mx += Math.sin(camH); mz += Math.cos(camH); }
  if (input.keys.KeyS) { mx -= Math.sin(camH); mz -= Math.cos(camH); }
  if (input.keys.KeyA) { mx -= Math.cos(camH); mz += Math.sin(camH); }
  if (input.keys.KeyD) { mx += Math.cos(camH); mz -= Math.sin(camH); }
  const moving = mx !== 0 || mz !== 0;
  const running = !!(input.keys.ShiftLeft || input.keys.ShiftRight);
  const speed = running ? CONFIG.PLAYER.run : CONFIG.PLAYER.walk;
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    p.heading = Math.atan2(mx, mz);
    const nx = p.x + mx * speed * dt;
    const nz = p.z + mz * speed * dt;
    if (S.city) {
      if (!collidesWithBuildings(S.city, nx, p.z, 0.5)) p.x = nx;
      if (!collidesWithBuildings(S.city, p.x, nz, 0.5)) p.z = nz;
      const c = clampToCity(S.city, p.x, p.z);
      p.x = c.x;
      p.z = c.z;
    } else {
      p.x = nx;
      p.z = nz;
    }
    p.speed = speed;
  } else {
    p.speed = 0;
  }

  // E: enter the nearest car.
  if (input.keys.KeyE && !updatePlayer._eHeld) {
    const car = nearestCar(S, 3.5);
    if (car && !car.stalled) {
      p.car = car;
      p.onFoot = false;
      p.x = car.x;
      p.z = car.z;
      p.heading = car.heading;
      S.camHeading = car.heading;
      if (S.audio && S.audio.door) S.audio.door();
      if (S.save && S.save.stats) S.save.stats.carsStolen = (S.save.stats.carsStolen || 0) + 1;
    }
  }
  updatePlayer._eHeld = !!input.keys.KeyE;

  // F: punch via combat (exported function, not a method on S.combat).
  if (input.keys.KeyF) punchNow(S);

  // Left click: shoot via combat when armed.
  if (input.mouseDown && p.weapon === 'pistol') shootNow(S);

  if (p.mesh) {
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading;
  }
}
