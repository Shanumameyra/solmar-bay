// minimap.js — Solmar Bay minimap (160x160 canvas, north-up).
// Per DESIGN.md: streets, beach, player arrow (white), traffic (grey dots),
// police (blue/red flashing), mission marker (yellow pulsing), taxi
// customer (green), cash pickup (gold).
// Draws into a canvas it creates itself and mounts into the HUD's
// #minimap-wrap. Throttled to ~15 fps (cheap 2D draws, but no need for 60).
// Safe no-op stub when there is no document (Node tests).

const SIZE = 160;
const WORLD = 400; // world spans -200..+200 m on both axes
const STREETS = [-175, -125, -75, -25, 25, 75, 125, 175];

function stubMinimap() {
  return { update() {}, draw() {}, canvas: null };
}

export function createMinimap(G) {
  if (typeof document === 'undefined') return stubMinimap();

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.id = 'minimap-canvas';
  const mount = G && G.hud && G.hud.minimapWrap;
  if (mount) mount.appendChild(canvas);
  else document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let acc = 0;
  let flash = 0;

  function toMap(x, z) {
    return [
      ((x + WORLD / 2) / WORLD) * SIZE,
      ((z + WORLD / 2) / WORLD) * SIZE,
    ];
  }

  function playerPos() {
    if (G && typeof G.getPlayerPos === 'function') {
      const p = G.getPlayerPos();
      if (p) return p;
    }
    if (G && G.player && G.player.pos) return G.player.pos;
    return { x: 0, y: 0, z: 0 };
  }

  function drawBase() {
    // Land.
    ctx.fillStyle = '#2d3a2e';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Beach (west strip) + water.
    const [bx] = toMap(-200, 0);
    const [sx] = toMap(-175, 0);
    ctx.fillStyle = '#1d4e89';
    ctx.fillRect(0, 0, Math.max(0, bx + 8), SIZE);
    ctx.fillStyle = '#d9c27a';
    ctx.fillRect(Math.max(0, bx + 8), 0, Math.max(0, sx - bx - 8), SIZE);
    // Docks (east strip).
    const [dx] = toMap(165, 0);
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(dx, 0, SIZE - dx, SIZE);
    // Streets.
    ctx.strokeStyle = '#4a4a52';
    ctx.lineWidth = 2;
    for (const s of STREETS) {
      const [mx] = toMap(s, 0);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, SIZE);
      ctx.stroke();
      const [, mz] = toMap(0, s);
      ctx.beginPath();
      ctx.moveTo(0, mz);
      ctx.lineTo(SIZE, mz);
      ctx.stroke();
    }
    // Plaza.
    const [px, pz] = toMap(0, 0);
    ctx.fillStyle = '#6b5d3f';
    ctx.fillRect(px - 9, pz - 9, 18, 18);
  }

  function dot(x, z, r, color) {
    const [mx, mz] = toMap(x, z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx, mz, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    if (!G) return;
    flash += 0.016;
    drawBase();

    // Cash pickups (gold) — only if the world exposes them.
    const pickups = (G && G.cashPickups) || [];
    for (const pk of pickups) {
      if (!pk || pk.taken) continue;
      dot(pk.x, pk.z, 2.5, '#ffd700');
    }

    // Traffic (grey dots).
    const traffic = [];
    if (G && G.traffic && Array.isArray(G.traffic.cars)) traffic.push(...G.traffic.cars);
    if (G && Array.isArray(G.trafficCars)) traffic.push(...G.trafficCars);
    for (const car of traffic) {
      const pos = car.pos || car;
      if (pos && typeof pos.x === 'number') dot(pos.x, pos.z, 2, '#9aa0a6');
    }

    // Taxi customer (green).
    if (G.missions && G.missions.taxi && G.missions.taxi.active) {
      const t = G.missions.taxi;
      const pos = t.phase === 'pickup' ? t.customerPos : t.destPos;
      if (pos) dot(pos.x, pos.z, 3, '#22ff88');
    }

    // Mission marker (yellow pulsing).
    if (G.missions && typeof G.missions.markerPos === 'function') {
      const m = G.missions.markerPos();
      if (m) {
        const pulse = 3 + Math.sin(flash * 6) * 1.2;
        dot(m.x, m.z, pulse, '#ffd21f');
        const [mx, mz] = toMap(m.x, m.z);
        ctx.strokeStyle = '#ffd21f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx, mz, pulse + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Police (blue/red flashing).
    if (G.police && Array.isArray(G.police.cars)) {
      const red = Math.floor(flash * 4) % 2 === 0;
      for (const car of G.police.cars) {
        if (car && car.pos) dot(car.pos.x, car.pos.z, 3, red ? '#ff3333' : '#3388ff');
      }
    }
    if (G.police && Array.isArray(G.police.footCops)) {
      for (const cop of G.police.footCops) {
        if (cop && cop.pos) dot(cop.pos.x, cop.pos.z, 2.5, '#3388ff');
      }
    }

    // Player arrow (white), rotated by heading. North-up map, heading 0
    // faces +z (south on the map) so the arrow rotates by heading + PI.
    const p = playerPos();
    const [mx, mz] = toMap(p.x, p.z);
    const heading = (G && G.player && typeof G.player.heading === 'number')
      ? G.player.heading
      : 0;
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Border.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  }

  const api = {
    canvas,
    draw,
    update(dt) {
      acc += dt || 0.016;
      if (acc >= 1 / 15) {
        acc = 0;
        draw();
      }
    },
  };

  return api;
}
