// minimap.js — Solmar Bay 160x160 north-up minimap (Worker B, v6 fresh)
// Contract: createMinimap(G) / drawMinimap(G)
// Roads, beach, player arrow (white), traffic (grey), police (blue/red flashing),
// mission marker (yellow pulsing), taxi (green), cash pickup (gold).
export function createMinimap(G) {
  let canvas = null;
  if (typeof document !== 'undefined') {
    canvas = document.getElementById('minimap');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'minimap';
      canvas.width = 160; canvas.height = 160;
      const root = document.getElementById('hud') || document.body;
      root.appendChild(canvas);
    }
  }
  const mm = { canvas, ctx: canvas ? canvas.getContext('2d') : null, _t: 0 };
  return mm;
}

export function drawMinimap(G) {
  const mm = G.minimap;
  if (!mm || !mm.ctx) return;
  const ctx = mm.ctx;
  const W = 160, H = 160;
  mm._t += 1 / 60;
  const t = mm._t;

  const B = (G.world && G.world.bounds) || { min: -200, max: 200 };
  const span = B.max - B.min;
  const sx = (x) => ((x - B.min) / span) * W;
  const sz = (z) => ((z - B.min) / span) * H;

  // Background: land.
  ctx.fillStyle = '#12233a';
  ctx.fillRect(0, 0, W, H);
  // Beach (west strip) + sea.
  ctx.fillStyle = '#c2a878';
  ctx.fillRect(0, 0, sx(-150) > 0 ? sx(-150) : 8, H);
  ctx.fillStyle = '#1d4e6b';
  ctx.fillRect(0, 0, 6, H);

  // Streets (grid).
  const lines = (G.world && G.world.streets) || [-175, -125, -75, -25, 25, 75, 125, 175];
  ctx.strokeStyle = '#3a4d63';
  ctx.lineWidth = 2;
  for (const L of lines) {
    ctx.beginPath(); ctx.moveTo(sx(L), 0); ctx.lineTo(sx(L), H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, sz(L)); ctx.lineTo(W, sz(L)); ctx.stroke();
  }

  const dot = (x, z, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2); ctx.fill();
  };

  // Cash pickups (gold), if the world has any.
  for (const c of (G.world && G.world.cashPickups) || []) dot(c.x, c.z, 2.5, '#ffd21f');

  // Taxi customer (green).
  const M = G.missions;
  if (M && M._taxi && M.marker && M.marker.label === 'taxi') dot(M.marker.x, M.marker.z, 3.5, '#37c978');

  // Mission marker (yellow, pulsing).
  if (M && M.marker) {
    const r = 4 + Math.sin(t * 5) * 1.5;
    ctx.strokeStyle = '#ffd21f';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(M.marker.x), sz(M.marker.z), r, 0, Math.PI * 2); ctx.stroke();
    dot(M.marker.x, M.marker.z, 2.5, '#ffd21f');
  }

  // Traffic (grey dots).
  for (const c of ((G.traffic && G.traffic.cars) || [])) dot(c.pos.x, c.pos.z, 2, '#9aa7b5');
  for (const c of ((G.traffic && G.traffic.parked) || [])) dot(c.pos.x, c.pos.z, 2, '#6b7a89');

  // Police (blue/red flashing).
  const flash = Math.floor(t * 4) % 2 === 0;
  for (const c of ((G.police && G.police.cars) || [])) {
    dot(c.pos.x, c.pos.z, 3, flash ? '#3b82f6' : '#ef4444');
  }

  // Player arrow (white), rotated by heading.
  const p = G.player;
  if (p && p.pos) {
    const h = p.car ? p.car.heading : (p.heading || 0);
    ctx.save();
    ctx.translate(sx(p.pos.x), sz(p.pos.z));
    ctx.rotate(h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Border.
  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
