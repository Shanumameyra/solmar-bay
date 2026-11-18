// audio.js — all WebAudio synth, no audio files.
//
// Engine hum (pitch by speed), two-tone siren when police are near, SFX
// (gunshot, punch, pickup, jingle, busted sting, door, honk, click,
// reload), and a slow Am–F–C–G chord pad. No-op without AudioContext
// (headless / node). M mutes. Starts only after a user gesture (main.js
// calls init() on the first pointer/key event).

const CHORDS = [
  [110.0, 130.81, 164.81], // Am
  [87.31, 110.0, 130.81], // F
  [130.81, 164.81, 196.0], // C
  [98.0, 123.47, 146.83], // G
];

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let padOsc = [];
  let padGain = null;
  let noiseBuf = null;
  let muted = false;
  let sirenPhase = 0;
  let chordIdx = 0;
  let chordT = 0;

  function tone(freq, dur, type, gain, when = 0, slideTo = null) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, gain, filterFreq) {
    if (!ctx || !noiseBuf) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq || 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const api = {
    get muted() {
      return muted;
    },

    init() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      const AC =
        typeof window !== 'undefined' &&
        (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      try {
        ctx = new AC();
      } catch (e) {
        ctx = null;
        return;
      }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ctx.destination);

      // Shared white-noise buffer for percussive SFX.
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // Engine: sawtooth through a lowpass, gain + pitch driven by update().
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 60;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 700;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();

      // Siren: square wave, two-tone by update().
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();

      // Music pad: three detuned triangles, one chord at a time.
      padGain = ctx.createGain();
      padGain.gain.value = 0.045;
      padGain.connect(master);
      padOsc = CHORDS[0].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.connect(padGain);
        o.start();
        return o;
      });
    },

    setMuted(b) {
      muted = !!b;
      if (master && ctx) {
        master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.02);
      }
    },

    // speed01: 0..1 of the car's top speed. Throttle reads input.keys —
    // the input object has no moveZ (that only exists on the translated
    // drive object), so KeyW/ArrowUp is the throttle signal.
    engine(speed01, throttle, onFoot) {
      if (!ctx || !engineOsc) return;
      const t = ctx.currentTime;
      const freq = 60 + clamp01(speed01) * 160 + (throttle ? 15 : 0);
      engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
      const g = onFoot ? 0 : 0.04 + clamp01(speed01) * 0.07;
      engineGain.gain.setTargetAtTime(muted ? 0 : g, t, 0.08);
    },

    sfx(name) {
      if (!ctx || muted) return;
      switch (name) {
        case 'gunshot':
          noise(0.14, 0.5, 2500);
          tone(120, 0.14, 'sine', 0.5, 0, 40);
          break;
        case 'punch':
          tone(180, 0.09, 'sine', 0.4, 0, 70);
          noise(0.06, 0.25, 900);
          break;
        case 'pickup':
          tone(880, 0.07, 'sine', 0.3);
          tone(1318, 0.1, 'sine', 0.3, 0.07);
          break;
        case 'jingle':
          tone(523.25, 0.12, 'triangle', 0.35);
          tone(659.25, 0.12, 'triangle', 0.35, 0.12);
          tone(783.99, 0.22, 'triangle', 0.35, 0.24);
          break;
        case 'busted':
          tone(220, 0.3, 'sawtooth', 0.25);
          tone(164.81, 0.45, 'sawtooth', 0.25, 0.28);
          break;
        case 'door':
          tone(200, 0.05, 'square', 0.2);
          noise(0.04, 0.15, 1200);
          break;
        case 'honk':
          tone(370, 0.25, 'sawtooth', 0.22);
          tone(466, 0.25, 'sawtooth', 0.22);
          break;
        case 'click':
          tone(1200, 0.03, 'square', 0.15);
          break;
        case 'reload':
          tone(900, 0.04, 'square', 0.18);
          tone(600, 0.04, 'square', 0.18, 0.12);
          break;
        default:
          break;
      }
    },

    update(dt, state, running, input) {
      if (!ctx) return;
      if (ctx.state === 'suspended' && running) ctx.resume().catch(() => {});
      const p = state.player || {};
      const top = p.car ? p.car.topSpeed || 38 : 8;
      const spd = p.car ? p.car.speed ?? 0 : p.speed ?? 0;
      const speed01 = clamp01(spd / top);
      // Engine pitch uses the car's own topSpeed (sports 46, truck 30),
      // not a hardcoded 38. On foot the engine is silent (gain 0) even
      // at a sprint — the walk speed is not a car speed.
      const throttle =
        !!input &&
        !!input.keys &&
        (input.keys.has('KeyW') || input.keys.has('ArrowUp'));
      api.engine(running ? speed01 : 0, throttle, !!p.onFoot);
      // Siren: two-tone, 0.5 s alternation, only when police are near.
      sirenPhase += dt;
      const wantSiren = running && (state.wanted ?? 0) > 0 && !!state.policeNear;
      if (sirenOsc && sirenGain) {
        const freq = Math.floor(sirenPhase / 0.5) % 2 === 0 ? 700 : 950;
        sirenOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.03);
        sirenGain.gain.setTargetAtTime(wantSiren && !muted ? 0.045 : 0, ctx.currentTime, 0.1);
      }
      // Music pad: Am–F–C–G, 8 s a chord.
      if (padOsc.length === 3 && running) {
        chordT += dt;
        if (chordT >= 8) {
          chordT = 0;
          chordIdx = (chordIdx + 1) % CHORDS.length;
          const chord = CHORDS[chordIdx];
          for (let i = 0; i < 3; i++) {
            padOsc[i].frequency.setTargetAtTime(chord[i], ctx.currentTime, 0.5);
          }
        }
      }
    },

    stopAll() {
      if (!ctx) return;
      if (engineGain) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      if (sirenGain) sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      api.stopMusic();
    },

    stopMusic() {
      if (!ctx || !padGain) return;
      padGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    },
  };
  return api;
}
