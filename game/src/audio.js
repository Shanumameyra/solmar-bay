// Audio — everything is WebAudio synth, no files. Engine hum, two-tone
// siren, slow chord pad (Am–F–C–G), and one-shot SFX. Starts only after
// the first user gesture (autoplay policy).

const PAD_CHORDS = [
  [110.0, 130.81, 164.81], // Am: A2 C3 E3
  [87.31, 110.0, 130.81], // F:  F2 A2 C3
  [130.81, 164.81, 196.0], // C:  C3 E3 G3
  [98.0, 123.47, 146.83], // G:  G2 B2 D3
];
const CHORD_LEN = 8;

export function createAudio() {
  return {
    ctx: null,
    muted: false,
    started: false,
    engine: null,
    engineGain: null,
    siren: null,
    sirenGain: null,
    sirenPhase: 0,
    sirenT: 0,
    padNodes: [],
    padChord: -1,
    padT: 0,
  };
}

function playerSpeed(S) {
  const p = S.player || {};
  if (p.car && typeof p.car.speed === 'number') return Math.abs(p.car.speed);
  return Math.abs(p.speed ?? 0);
}

function throttleOf(S) {
  const input = S.input;
  if (!input) return 0;
  if (typeof input.throttle === 'number') return input.throttle;
  return 0;
}

export function ensureAudio(S) {
  const a = S.audio;
  if (!a || a.started) return;
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    a.ctx = ctx;
    a.started = true;
    // Engine: sawtooth through a lowpass, gain follows throttle.
    const eng = ctx.createOscillator();
    eng.type = 'sawtooth';
    eng.frequency.value = 70;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 500;
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    eng.connect(engFilter);
    engFilter.connect(engGain);
    engGain.connect(ctx.destination);
    eng.start();
    a.engine = eng;
    a.engineGain = engGain;
    // Siren: square wave, two tones alternated in updateAudio.
    const sir = ctx.createOscillator();
    sir.type = 'square';
    sir.frequency.value = 700;
    const sirGain = ctx.createGain();
    sirGain.gain.value = 0;
    sir.connect(sirGain);
    sirGain.connect(ctx.destination);
    sir.start();
    a.siren = sir;
    a.sirenGain = sirGain;
    startPad(a);
  } catch (e) {
    a.ctx = null;
    a.started = false;
  }
}

function startPad(a) {
  const ctx = a.ctx;
  if (!ctx) return;
  stopPad(a);
  a.padNodes = [];
  const chord = PAD_CHORDS[0];
  for (const freq of chord) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    a.padNodes.push({ osc, gain });
  }
  a.padChord = 0;
  a.padT = 0;
}

function stopPad(a) {
  for (const n of a.padNodes || []) {
    try { n.osc.stop(); } catch (e) { /* already stopped */ }
    try { n.osc.disconnect(); } catch (e) { /* ignore */ }
  }
  a.padNodes = [];
}

function retunePad(a, chordIndex) {
  const ctx = a.ctx;
  if (!ctx || !a.padNodes.length) return;
  const chord = PAD_CHORDS[chordIndex % PAD_CHORDS.length];
  const now = ctx.currentTime;
  a.padNodes.forEach((n, i) => {
    const target = chord[i % chord.length];
    try { n.osc.frequency.setTargetAtTime(target, now, 1.5); } catch (e) { /* ignore */ }
  });
  a.padChord = chordIndex % PAD_CHORDS.length;
}

export function updateAudio(S, dt) {
  const a = S.audio;
  if (!a || !a.ctx || a.muted) {
    if (a && a.engineGain) a.engineGain.gain.value = 0;
    if (a && a.sirenGain) a.sirenGain.gain.value = 0;
    return;
  }
  if (a.ctx.state === 'suspended') {
    a.ctx.resume().catch(() => {});
  }
  // Engine pitch 60-220 Hz by speed, gain by throttle.
  const speed = playerSpeed(S);
  const freq = 60 + Math.min(1, speed / 38) * 160;
  if (a.engine) {
    try { a.engine.frequency.setTargetAtTime(freq, a.ctx.currentTime, 0.05); } catch (e) { /* ignore */ }
  }
  if (a.engineGain) {
    const g = S.mode === 'play' || S.mode === 'shot' ? 0.02 + throttleOf(S) * 0.05 : 0.015;
    try { a.engineGain.gain.setTargetAtTime(g, a.ctx.currentTime, 0.1); } catch (e) { /* ignore */ }
  }
  // Siren only when police are near.
  let policeNear = false;
  const pp = S.player || {};
  const px = pp.pos?.x ?? pp.position?.x ?? pp.x ?? 0;
  const pz = pp.pos?.z ?? pp.position?.z ?? pp.z ?? 0;
  for (const cop of S.police?.cops || []) {
    if (cop.disabled) continue;
    if (Math.hypot((cop.x ?? 0) - px, (cop.z ?? 0) - pz) < 55) { policeNear = true; break; }
  }
  if (a.siren && a.sirenGain) {
    if (policeNear && (S.police?.stars || 0) > 0) {
      a.sirenT += dt;
      if (a.sirenT >= 0.5) {
        a.sirenT = 0;
        a.sirenPhase = 1 - a.sirenPhase;
        const f = a.sirenPhase === 0 ? 700 : 950;
        try { a.siren.frequency.setTargetAtTime(f, a.ctx.currentTime, 0.02); } catch (e) { /* ignore */ }
      }
      try { a.sirenGain.gain.setTargetAtTime(0.03, a.ctx.currentTime, 0.1); } catch (e) { /* ignore */ }
    } else {
      try { a.sirenGain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.1); } catch (e) { /* ignore */ }
    }
  }
  // Slow chord pad: one chord every 8 s.
  a.padT += dt;
  if (a.padT >= CHORD_LEN) {
    a.padT = 0;
    retunePad(a, (a.padChord + 1) % PAD_CHORDS.length);
  }
}

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function blip(ctx, freq, dur, type, gainVal, when) {
  const osc = ctx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + (when || 0);
  gain.gain.setValueAtTime(gainVal, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function sfx(S, name) {
  const a = S.audio;
  if (!a || !a.ctx || a.muted) return;
  const ctx = a.ctx;
  try {
    if (name === 'gunshot') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.18);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start();
      blip(ctx, 90, 0.15, 'sine', 0.4);
    } else if (name === 'punch') {
      blip(ctx, 140, 0.12, 'sine', 0.35);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.08);
      const gain = ctx.createGain();
      gain.gain.value = 0.25;
      src.connect(gain); gain.connect(ctx.destination);
      src.start();
    } else if (name === 'pickup') {
      blip(ctx, 880, 0.12, 'sine', 0.25);
      blip(ctx, 1318, 0.18, 'sine', 0.25, 0.08);
    } else if (name === 'jingle') {
      blip(ctx, 523, 0.15, 'triangle', 0.25);
      blip(ctx, 659, 0.15, 'triangle', 0.25, 0.12);
      blip(ctx, 784, 0.3, 'triangle', 0.3, 0.24);
    } else if (name === 'busted') {
      blip(ctx, 220, 0.4, 'sawtooth', 0.25);
      blip(ctx, 174, 0.6, 'sawtooth', 0.25, 0.35);
    } else if (name === 'click') {
      blip(ctx, 1200, 0.04, 'square', 0.15);
    } else if (name === 'door') {
      blip(ctx, 300, 0.06, 'square', 0.2);
      blip(ctx, 180, 0.08, 'square', 0.15, 0.05);
    } else if (name === 'honk') {
      blip(ctx, 370, 0.35, 'square', 0.18);
      blip(ctx, 466, 0.35, 'square', 0.18);
    }
  } catch (e) {
    // Audio must never break gameplay.
  }
}

export function toggleMute(S) {
  const a = S.audio;
  if (!a) return false;
  a.muted = !a.muted;
  if (a.ctx) {
    if (a.muted && a.engineGain) a.engineGain.gain.value = 0;
    if (a.muted && a.sirenGain) a.sirenGain.gain.value = 0;
  }
  return a.muted;
}
