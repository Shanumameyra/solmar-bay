// Solmar Bay — minimap (Worker B). 2D canvas, north-up, fixed orientation.
// Streets, beach + water, city blocks, player arrow, traffic (grey), police
// (blue/red flashing), mission marker (yellow pulsing), taxi (green),
// cash pickups (gold). The map covers ~460x460 m centred on 0,0 (the city
// plus a strip of sea to the west); north is -z (top of the canvas). No
// rotation — the map stays readable while driving.
// Colliders are {minX,maxX,minZ,maxZ} (city.js); streets are
// CONFIG.CITY.STREETS (48 m grid). Forward = (sin(angle), cos(angle)), so
// the player arrow rotates by (PI - yaw) from the up-pointing triangle.

import { CONFIG } from './config.js';

// The map covers a little more than the city (HALF + 30) so the sea
// (x < -200) and the pier (x -212) are actually visible: at exactly HALF
// the sea fill was zero-width and the pier line ran off-canvas.
const WORLD = CONFIG.CITY.HALF + 30; // 230
const STREETS = CONFIG.CITY.STREETS;

export function createMinimap(canvas) {
  const ctx = canvas ? canvas.getContext('2d') : null;
  const size = canvas ? canvas.width : 160;

  const minimap = {
    draw(state) {
      if (!ctx || !state || !state.player) return;
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const S = size;
      const toX = (x) => ((x + WORLD) / (WORLD * 2)) * S;
      const toY = (z) => ((z + WORLD) / (WORLD * 2)) * S;

      // Land + water + beach (west edge): sea x < -200, sand -200..-168.
      ctx.fillStyle = '#0e1420';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#0b3d66'; // sea
      ctx.fillRect(0, 0, toX(-200), S);
      ctx.fillStyle = '#c2a878'; // sand
      ctx.fillRect(toX(-200), 0, toX(-168) - toX(-200), S);
      // City blocks (from colliders) — subtle, so streets read as gaps.
      ctx.fillStyle = '#232a38';
      const colliders = state.colliders || [];
      for (const b of colliders) {
        ctx.fillRect(toX(b.minX), toY(b.minZ), Math.max(1, toX(b.maxX) - toX(b.minX)), Math.max(1, toY(b.maxZ) - toY(b.minZ)));
      }
      // Streets: grid lines on the street centrelines.
      ctx.strokeStyle = '#3a4356';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const g of STREETS) {
        ctx.moveTo(toX(g), 0);
        ctx.lineTo(toX(g), S);
        ctx.moveTo(0, toY(g));
        ctx.lineTo(S, toY(g));
      }
      ctx.stroke();
      // Pier (west, thin line into the sea).
      ctx.strokeStyle = '#8a6d4b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(toX(-200), toY(48));
      ctx.lineTo(toX(-210), toY(48));
      ctx.stroke();

      // Cash pickups (gold dots).
      const pickups = state.pickups || [];
      ctx.fillStyle = '#ffd23d';
      for (const pk of pickups) {
        if (pk.taken) continue;
        ctx.beginPath();
        ctx.arc(toX(pk.x), toY(pk.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Taxi customer / destination (green).
      if (state.taxiMarker) {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(toX(state.taxiMarker.x), toY(state.taxiMarker.z), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Mission marker (yellow, pulsing ring).
      const marker = (state.mission && state.mission.marker) || null;
      if (marker && state.mission.phase === 'active') {
        const pulse = 5 + 2.5 * Math.sin(t * 4);
        ctx.strokeStyle = '#ffd23d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(toX(marker.x), toY(marker.z), pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffd23d';
        ctx.beginPath();
        ctx.arc(toX(marker.x), toY(marker.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Traffic cars (grey dots).
      ctx.fillStyle = '#9aa3b2';
      for (const c of state.cars || []) {
        if (c.isPolice || c.driver === 'player') continue;
        ctx.beginPath();
        ctx.arc(toX(c.x), toY(c.z), 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Police (blue/red flashing).
      const flashRed = Math.floor(t * 2) % 2 === 0;
      ctx.fillStyle = flashRed ? '#ff3b30' : '#2f6bff';
      for (const c of state.cars || []) {
        if (!c.isPolice) continue;
        ctx.beginPath();
        ctx.arc(toX(c.x), toY(c.z), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of state.peds || []) {
        if (!p.isCop) continue;
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player arrow (white). Forward is (sin(yaw), cos(yaw)) in world xz;
      // on canvas (+x right, +y down) that is angle (PI - yaw) from up.
      const px = toX(state.player.x);
      const py = toY(state.player.z);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('N', S - 12, 12);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - (state.player.yaw || 0));
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0e1420';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // Player car outline when driving (white ring).
      if (state.player.inCar) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  };
  return minimap;
}
