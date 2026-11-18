// Minimap — 160×160 north-up canvas: streets, beach, player arrow,
// traffic dots, police blips, mission marker, taxi customer, cash pickups.

const SIZE = 160;
const WORLD = 400; // city is ~400×400 m
const SCALE = SIZE / WORLD;

export function createMinimap() {
  const canvas = typeof document !== 'undefined' ? document.getElementById('minimap') : null;
  const ctx = canvas ? canvas.getContext('2d') : null;
  return { canvas, ctx, size: SIZE };
}

function toMap(x, z) {
  return { x: (x + WORLD / 2) * SCALE, y: (z + WORLD / 2) * SCALE };
}

function playerPos(S) {
  const p = S.player || {};
  if (p.pos) return { x: p.pos.x, z: p.pos.z, heading: p.heading ?? p.h ?? 0 };
  if (p.position) return { x: p.position.x, z: p.position.z, heading: p.heading ?? p.h ?? 0 };
  return { x: p.x || 0, z: p.z || 0, heading: p.heading ?? p.h ?? 0 };
}

function dot(ctx, x, z, r, color) {
  const m = toMap(x, z);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawMinimap(S) {
  const mm = S.minimap;
  if (!mm || !mm.ctx) return;
  const ctx = mm.ctx;
  const t = S.time || 0;

  // Background: land, then the beach strip on the west edge.
  ctx.fillStyle = '#1d2b33';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#c9a86a';
  ctx.fillRect(0, 0, 14, SIZE);
  ctx.fillStyle = '#2e6f8e';
  ctx.fillRect(0, 0, 6, SIZE);

  // Streets: grid every 50 m.
  ctx.strokeStyle = '#4a5a63';
  ctx.lineWidth = 3;
  for (let v = -200; v <= 200; v += 50) {
    const a = toMap(v, -200);
    const b = toMap(v, 200);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = toMap(-200, v);
    const d = toMap(200, v);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  // City border.
  ctx.strokeStyle = '#6b7d86';
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);

  // Cash pickups (gold).
  for (const pk of S.missions?.pickups || []) {
    if (!pk.taken) dot(ctx, pk.x, pk.z, 2.5, '#ffd23f');
  }

  // Traffic (grey dots).
  for (const car of S.trafficCars || []) {
    dot(ctx, car.x ?? 0, car.z ?? 0, 2, '#9aa5ab');
  }
  for (const car of S.parkedCars || []) {
    if (car.marked) dot(ctx, car.x ?? 0, car.z ?? 0, 3, '#f7d117');
  }

  // Taxi customer (green).
  const tx = S.missions?.taxi;
  if (tx && tx.state === 'pickup' && tx.customer) {
    dot(ctx, tx.customer.x, tx.customer.z, 3.5, '#37d67a');
  }

  // Mission marker (pulsing yellow).
  const marker = S.missions?.marker;
  if (marker) {
    const pulse = 4 + Math.sin(t * 5) * 1.5;
    dot(ctx, marker.x, marker.z, pulse, '#ffe14d');
    const m = toMap(marker.x, marker.z);
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(m.x, m.y, pulse + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Police (blue/red flashing).
  const flashRed = Math.floor(t * 2) % 2 === 0;
  for (const cop of S.police?.cops || []) {
    if (cop.disabled) continue;
    dot(ctx, cop.x ?? cop.car?.x ?? 0, cop.z ?? cop.car?.z ?? 0, 3, flashRed ? '#ff4444' : '#4488ff');
  }

  // Player arrow (white, rotated to heading). North is up: heading 0
  // points south (+z), so the arrow angle on canvas is heading + PI.
  const pp = playerPos(S);
  const m = toMap(pp.x, pp.z);
  const a = (pp.heading || 0) + Math.PI;
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(-a);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.5, 5);
  ctx.lineTo(-4.5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
