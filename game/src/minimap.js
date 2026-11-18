// minimap.js — 2D canvas minimap, north-up.
//
// Covers HALF+30 (230 m) so the sea strip and the pier actually draw (at
// exactly HALF the sea fill was zero-width and the pier ran off-canvas).
// Streets from CONFIG.CITY.STREETS, buildings from state.colliders,
// player arrow rotated by (PI - yaw): forward = (sin, cos), so yaw 0
// (+z, south) points down the map and yaw PI (north) points up.

import { CONFIG } from './config.js';

const HALF = (CONFIG.CITY.HALF ?? 200) + 30; // 230 m
const SPAN = HALF * 2;

export function createMinimap(canvas) {
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return { draw() {} };

  function toMap(x, z, size) {
    return [((x + HALF) / SPAN) * size, ((z + HALF) / SPAN) * size];
  }

  return {
    draw(state) {
      if (!state) return;
      const size = canvas.width || 160;
      const s = size / SPAN; // px per metre
      const t = state.time ?? 0;
      const p = state.player || { x: 0, z: 0, yaw: 0 };

      // Sand base, then sea (x < -200) and land.
      ctx.fillStyle = '#c9b078';
      ctx.fillRect(0, 0, size, size);
      const [seaX] = toMap(-200, 0, size);
      ctx.fillStyle = '#1f7fa8';
      ctx.fillRect(0, 0, Math.max(0, seaX), size);
      ctx.fillStyle = '#26221e';
      ctx.fillRect(seaX, 0, size - seaX, size);

      // Pier (z = 48, reaching out into the sea).
      const [pierX0, pierY] = toMap(-232, 48, size);
      const [pierX1] = toMap(-200, 48, size);
      ctx.fillStyle = '#8a6f4d';
      ctx.fillRect(pierX0, pierY - 2.5 * s, Math.max(2, pierX1 - pierX0), 5 * s);

      // Streets: 12 m asphalt bands on the 48 m grid.
      ctx.fillStyle = '#3a3f46';
      for (const c of CONFIG.CITY.STREETS || []) {
        const [x0] = toMap(c, 0, size);
        ctx.fillRect(x0 - 6 * s, 0, 12 * s, size);
        const [, z0] = toMap(0, c, size);
        ctx.fillRect(0, z0 - 6 * s, size, 12 * s);
      }

      // Buildings from the collider AABBs.
      ctx.fillStyle = '#565b63';
      for (const b of state.colliders || []) {
        const [bx, bz] = toMap(b.minX, b.minZ, size);
        const [ex, ez] = toMap(b.maxX, b.maxZ, size);
        ctx.fillRect(bx, bz, Math.max(1, ex - bx), Math.max(1, ez - bz));
      }

      // Cash pickups (gold dots).
      ctx.fillStyle = '#ffd23d';
      for (const pk of state.pickups || []) {
        if (pk.taken) continue;
        const [x, y] = toMap(pk.x, pk.z, size);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Taxi marker (green, pulsing).
      if (state.taxiMarker) {
        const [x, y] = toMap(state.taxiMarker.x, state.taxiMarker.z, size);
        ctx.fillStyle = '#37d67a';
        ctx.beginPath();
        ctx.arc(x, y, 3 + Math.sin(t * 5) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mission marker (yellow, pulsing).
      if (state.mission && state.mission.marker) {
        const [x, y] = toMap(state.mission.marker.x, state.mission.marker.z, size);
        const r = 4 + Math.sin(t * 4) * 1.5;
        ctx.fillStyle = '#ffd23d';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff3c4';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Traffic (grey dots).
      ctx.fillStyle = '#c8ccd2';
      for (const car of state.cars || []) {
        if (car.isPolice) continue;
        const [x, y] = toMap(car.x, car.z, size);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }

      // Police (blue/red flashing, 2 Hz).
      const flashRed = Math.floor(t * 2) % 2 === 0;
      ctx.fillStyle = flashRed ? '#ff3b30' : '#3d8fff';
      for (const car of state.cars || []) {
        if (!car.isPolice) continue;
        const [x, y] = toMap(car.x, car.z, size);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const ped of state.peds || []) {
        if (!ped.isCop) continue;
        const [x, y] = toMap(ped.x, ped.z, size);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Player arrow (white), rotated by (PI - yaw).
      const [px, py] = toMap(p.x, p.z, size);
      const facing = p.onFoot ? p.yaw : p.car ? p.car.angle : p.yaw;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - (facing ?? 0));
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Border.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    },
  };
}
