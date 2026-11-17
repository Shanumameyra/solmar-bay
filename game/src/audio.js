// Solmar Bay — audio (Worker B). WebAudio synthesis only, no audio files.
// Engine hum (pitch by speed), two-tone siren, gunshot, punch, pickup blip,
// mission jingle, busted sting, door click, honk, and a slow Am-F-C-G pad.
// Everything starts only after the first user gesture (autoplay policy).
// Safe no-op when AudioContext is unavailable (headless / tests).

const MUSIC_CHORDS = [
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
];
const CHORD_LEN = 8; // seconds per chord

export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    musicGain: null,
    engineOsc: null,
    engineGain: null,
    engineFilter: null,
    sirenOsc: null,
    sirenGain: null,
    sirenTimer: 0,
    sirenHigh: false,
    noiseBuf: null,
    muted: false,
    musicOn: false,
    musicChord: 0,
    musicNextAt: 0,
    started: false,

    init() {
      if (this.started) return true;
      const AC = typeof window !== 'undefined'
        && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      try {
        this.ctx = new AC();
      } catch (e) {
        return false;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(ctx.destination);
      // Shared noise buffer (1 s white noise) for gunshots / impacts.
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Engine: sawtooth through a lowpass, pitch follows speed.
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 60;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      // Siren: square wave, alternates 700 / 950 Hz.
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'square';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      // Music pad bus.
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0.05;
      this.musicGain.connect(this.master);
      this.started = true;
      return true;
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    setMuted(m) {
      this.muted = !!m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
      }
    },

    // --- continuous voices, called every frame from main.js ---
    // onFoot silences the engine entirely (no idle hum while walking).
    engine(speed01, throttle, onFoot) {
      if (!this.started) return;
      const t = this.ctx.currentTime;
      const freq = 60 + speed01 * 160 + (throttle ? 18 : 0);
      this.engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
      const gain = onFoot ? 0 : 0.015 + speed01 * 0.05 + (throttle ? 0.012 : 0);
      this.engineGain.gain.setTargetAtTime(gain, t, 0.1);
    },

    // Silence every continuous voice (pause / title screen).
    stopAll() {
      if (!this.started) return;
      const t = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(0, t, 0.05);
      this.sirenGain.gain.setTargetAtTime(0, t, 0.05);
    },

    siren(on, dt) {
      if (!this.started) return;
      const t = this.ctx.currentTime;
      if (!on) {
        this.sirenGain.gain.setTargetAtTime(0, t, 0.1);
        return;
      }
      this.sirenTimer -= dt;
      if (this.sirenTimer <= 0) {
        this.sirenTimer = 0.5;
        this.sirenHigh = !this.sirenHigh;
        this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 950 : 700, t, 0.02);
      }
      this.sirenGain.gain.setTargetAtTime(0.028, t, 0.1);
    },

    // --- one-shot SFX ---
    blip(freq, dur, type, vol, slideTo) {
      if (!this.started) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    noise(dur, vol, filterFreq, type) {
      if (!this.started) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = type || 'lowpass';
      f.frequency.value = filterFreq || 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.02);
    },

    sfx(name) {
      if (!this.started) return;
      switch (name) {
        case 'gunshot':
          this.noise(0.14, 0.4, 2600, 'highpass');
          this.blip(160, 0.12, 'sine', 0.35, 55);
          break;
        case 'punch':
          this.noise(0.09, 0.3, 500);
          this.blip(120, 0.1, 'sine', 0.3, 60);
          break;
        case 'pickup':
          this.blip(880, 0.09, 'sine', 0.2);
          this.blip(1320, 0.12, 'sine', 0.16);
          break;
        case 'cash':
          this.blip(1046, 0.08, 'triangle', 0.2);
          this.blip(1568, 0.14, 'triangle', 0.18);
          break;
        case 'jingle': // mission complete: 3 ascending notes
          this.blip(523.25, 0.16, 'triangle', 0.22);
          setTimeout(() => this.blip(659.25, 0.16, 'triangle', 0.22), 140);
          setTimeout(() => this.blip(783.99, 0.3, 'triangle', 0.24), 280);
          break;
        case 'busted':
          this.blip(392, 0.25, 'square', 0.16, 370);
          setTimeout(() => this.blip(311, 0.4, 'square', 0.16, 294), 220);
          break;
        case 'door':
          this.noise(0.05, 0.18, 900);
          break;
        case 'honk':
          this.blip(370, 0.28, 'square', 0.12);
          this.blip(466, 0.28, 'square', 0.1);
          break;
        case 'click':
          this.blip(1200, 0.05, 'sine', 0.12);
          break;
        case 'heal':
          this.blip(660, 0.12, 'sine', 0.18, 990);
          break;
        case 'wasted':
          this.blip(220, 0.5, 'sawtooth', 0.18, 110);
          break;
        default:
          break;
      }
    },

    // --- music pad: schedule one chord at a time, 8 s each ---
    startMusic() {
      if (!this.started || this.musicOn) return;
      this.musicOn = true;
      this.musicChord = 0;
      this.musicNextAt = this.ctx.currentTime + 0.1;
    },

    stopMusic() {
      this.musicOn = false;
    },

    update(dt, state, running, input) {
      if (!this.started) return;
      // Engine hum: pitch follows the car's speed, silent on foot and
      // silent when the game is not running (title / pause). Throttle is
      // W held (input.keys) — the input object has no moveZ field.
      const p = state && state.player;
      const inCar = !!(p && p.car);
      const speed = inCar ? Math.abs(p.car.speed || 0) : 0;
      const speed01 = inCar ? Math.min(1, speed / 38) : 0;
      const throttle = !!(input && input.keys && (input.keys.has('KeyW') || input.keys.has('ArrowUp')));
      this.engine(running ? speed01 : 0, throttle, !inCar || !running);
      const policeNear = state && state.policeNear === true;
      this.siren(policeNear && running, dt);
      if (this.musicOn && this.ctx.currentTime >= this.musicNextAt - 0.5) {
        const chord = MUSIC_CHORDS[this.musicChord % MUSIC_CHORDS.length];
        const t = Math.max(this.ctx.currentTime, this.musicNextAt);
        for (const freq of chord) {
          const o = this.ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = freq;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.5, t + 1.5);
          g.gain.setValueAtTime(0.5, t + CHORD_LEN - 1.5);
          g.gain.linearRampToValueAtTime(0.0001, t + CHORD_LEN);
          o.connect(g);
          g.connect(this.musicGain);
          o.start(t);
          o.stop(t + CHORD_LEN + 0.1);
        }
        this.musicChord += 1;
        this.musicNextAt = t + CHORD_LEN;
      }
    },
  };
  return audio;
}
