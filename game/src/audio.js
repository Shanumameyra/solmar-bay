// audio.js — Solmar Bay audio: all WebAudio synth, no audio files.
// Per DESIGN.md: engine osc (pitch by speed), two-tone siren, SFX
// (gunshot, punch, pickup, mission jingle, busted sting, car door, honk),
// slow chord-pad music (Am-F-C-G, 8 s per chord), M mute.
// Audio starts only after the first user gesture (autoplay policy), so
// init() must be called from a gesture handler (startGame / first click).
// Every method is a safe no-op until init() succeeds, so the game never
// crashes on a browser without WebAudio.

export function createAudio(G) {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineFilter = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let sirenHigh = false;
  let sirenOn = false;
  let noiseBuf = null;
  let musicTimer = null;
  let musicChord = 0;
  let musicNodes = [];
  let started = false;
  let muted = !!(G && G.muted);

  // Am - F - C - G, as frequency sets (Hz). Slow pad, low gain.
  const CHORDS = [
    [110.0, 164.81, 220.0, 261.63], // Am  (A2 E3 A3 C4)
    [87.31, 174.61, 220.0, 261.63], // F   (F2 F3 A3 C4)
    [130.81, 196.0, 261.63, 329.63], // C  (C3 G3 C4 E4)
    [98.0, 196.0, 246.94, 293.66], // G   (G2 G3 B3 D4)
  ];
  const CHORD_SECONDS = 8;

  function makeNoiseBuffer() {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function startMusic() {
    if (!ctx || musicTimer !== null) return;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.05;
    musicGain.connect(master);
    const playChord = () => {
      stopChordNodes();
      const freqs = CHORDS[musicChord % CHORDS.length];
      musicChord += 1;
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.0;
        osc.connect(g);
        g.connect(musicGain);
        g.gain.linearRampToValueAtTime(0.35, now() + 2.0);
        osc.start();
        musicNodes.push(osc, g);
      }
    };
    playChord();
    musicTimer = setInterval(playChord, CHORD_SECONDS * 1000);
  }

  function stopChordNodes() {
    for (const node of musicNodes) {
      try {
        if (node.stop) node.stop();
      } catch (_err) { /* already stopped */ }
      try {
        node.disconnect();
      } catch (_err) { /* already disconnected */ }
    }
    musicNodes = [];
  }

  function stopMusic() {
    if (musicTimer !== null) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    stopChordNodes();
    if (musicGain) {
      try {
        musicGain.disconnect();
      } catch (_err) { /* ignore */ }
      musicGain = null;
    }
  }

  function startEngine() {
    if (!ctx || engineOsc) return;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineOsc2.frequency.value = 30;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 400;
    engineFilter.Q.value = 1.2;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();
  }

  function startSiren() {
    if (!ctx || sirenOsc) return;
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'square';
    sirenOsc.frequency.value = 700;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0.0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
  }

  // Short one-shot helpers -------------------------------------------------
  function blip(freq, dur, type, vol, when = 0) {
    if (!ctx) return;
    const t = now() + when;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol == null ? 0.2 : vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noiseBurst(dur, vol, filterFreq, type = 'lowpass', when = 0) {
    if (!ctx) return;
    const t = now() + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  const api = {
    get ready() {
      return started;
    },
    get isMuted() {
      return muted;
    },

    // Call from a user gesture. Safe to call repeatedly; only the first
    // call builds the graph. Returns true when audio is live.
    init() {
      if (started) {
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        return true;
      }
      try {
        const AC =
          typeof window !== 'undefined' &&
          (window.AudioContext || window.webkitAudioContext);
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.9;
        master.connect(ctx.destination);
        noiseBuf = makeNoiseBuffer();
        startEngine();
        startSiren();
        startMusic();
        started = true;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return true;
      } catch (_err) {
        ctx = null;
        return false;
      }
    },

    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    setMuted(m) {
      muted = !!m;
      if (G) G.muted = muted;
      if (master) master.gain.value = muted ? 0 : 0.9;
    },

    toggleMute() {
      api.setMuted(!muted);
      return muted;
    },

    // Per-frame: engine pitch follows speed (60-220 Hz), siren follows
    // police proximity. speed in m/s, throttle 0..1, policeNear 0..1.
    update(_dt, speed, throttle, policeNear) {
      if (!ctx || !started) return;
      if (engineOsc && engineGain) {
        const s = Math.max(0, speed || 0);
        const freq = 60 + Math.min(1, s / 46) * 160;
        engineOsc.frequency.setTargetAtTime(freq, now(), 0.08);
        engineOsc2.frequency.setTargetAtTime(freq * 0.5, now(), 0.08);
        engineFilter.frequency.setTargetAtTime(300 + (throttle || 0) * 900, now(), 0.1);
        const target = (throttle || 0) > 0.02 || s > 1 ? 0.05 + (throttle || 0) * 0.06 : 0.02;
        engineGain.gain.setTargetAtTime(muted ? 0 : target, now(), 0.1);
      }
      if (sirenOsc && sirenGain) {
        const want = (policeNear || 0) > 0.02;
        if (want && !sirenOn) {
          sirenOn = true;
          sirenTimer = 0;
          sirenHigh = false;
        } else if (!want && sirenOn) {
          sirenOn = false;
        }
        if (sirenOn) {
          sirenTimer += _dt || 0.016;
          if (sirenTimer >= 0.5) {
            sirenTimer = 0;
            sirenHigh = !sirenHigh;
            sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 700, now(), 0.02);
          }
          const vol = 0.045 * Math.min(1, policeNear);
          sirenGain.gain.setTargetAtTime(muted ? 0 : vol, now(), 0.1);
        } else {
          sirenGain.gain.setTargetAtTime(0, now(), 0.1);
        }
      }
    },

    // Named SFX. Unknown names are ignored (never throw).
    sfx(name) {
      if (!ctx || !started || muted) return;
      switch (name) {
        case 'gunshot':
          noiseBurst(0.12, 0.5, 1800, 'lowpass');
          blip(120, 0.1, 'sine', 0.35);
          break;
        case 'punch':
          noiseBurst(0.09, 0.35, 300, 'lowpass');
          break;
        case 'pickup':
          blip(880, 0.09, 'sine', 0.25);
          blip(1318, 0.12, 'sine', 0.25, 0.07);
          break;
        case 'door':
          blip(220, 0.05, 'square', 0.15);
          noiseBurst(0.05, 0.2, 900, 'bandpass');
          break;
        case 'honk':
          blip(370, 0.25, 'square', 0.18);
          blip(466, 0.25, 'square', 0.18);
          break;
        case 'reload':
          blip(500, 0.05, 'square', 0.12);
          blip(350, 0.05, 'square', 0.12, 0.12);
          break;
        case 'click':
          blip(1200, 0.03, 'square', 0.1);
          break;
        case 'crash':
          noiseBurst(0.25, 0.4, 500, 'lowpass');
          break;
        case 'siren-blip':
          blip(950, 0.15, 'square', 0.12);
          break;
        case 'heal':
          blip(523, 0.1, 'sine', 0.2);
          blip(784, 0.14, 'sine', 0.2, 0.09);
          break;
        case 'cash':
          blip(1046, 0.08, 'sine', 0.22);
          blip(1568, 0.14, 'sine', 0.22, 0.06);
          break;
        default:
          break;
      }
    },

    // 3-note mission jingle (C-E-G up).
    jingle() {
      if (!ctx || !started || muted) return;
      blip(523.25, 0.16, 'triangle', 0.25);
      blip(659.25, 0.16, 'triangle', 0.25, 0.14);
      blip(783.99, 0.3, 'triangle', 0.28, 0.28);
    },

    // 2-note busted sting (down).
    sting() {
      if (!ctx || !started || muted) return;
      blip(311.13, 0.35, 'sawtooth', 0.2);
      blip(233.08, 0.55, 'sawtooth', 0.22, 0.3);
    },

    // Wasted sting (low, slower).
    wastedSting() {
      if (!ctx || !started || muted) return;
      blip(220, 0.4, 'sawtooth', 0.2);
      blip(164.81, 0.7, 'sawtooth', 0.22, 0.35);
    },

    phoneRing() {
      if (!ctx || !started || muted) return;
      blip(1396, 0.12, 'sine', 0.16);
      blip(1396, 0.12, 'sine', 0.16, 0.22);
    },

    dispose() {
      stopMusic();
      if (ctx) {
        ctx.close().catch(() => {});
        ctx = null;
      }
      started = false;
      engineOsc = engineOsc2 = engineFilter = engineGain = null;
      sirenOsc = sirenGain = null;
    },
  };

  return api;
}
