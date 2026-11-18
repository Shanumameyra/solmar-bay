// audio.js — Solmar Bay all-synth WebAudio (Worker B, v6 fresh)
// Contract: createAudio(G) -> {unlock(), setMuted(m), engine(speed,throttle),
// siren(on), sfx(name), musicStart()}
// No audio files. Everything is guarded: no AudioContext until the first
// user gesture (autoplay policy), and every call is a no-op when muted/absent.
export function createAudio(G) {
  const A = {
    ctx: null,
    master: null,
    muted: !!(G.state && G.state.muted),
    _engineOsc: null,
    _engineGain: null,
    _engineFilter: null,
    _sirenOsc: null,
    _sirenGain: null,
    _sirenTimer: null,
    _sirenHigh: false,
    _musicTimer: null,
    _musicStep: 0,

    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.55;
          this.master.connect(this.ctx.destination);
          this._startEngineNodes();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* audio unavailable — stay silent */ }
    },

    setMuted(m) {
      this.muted = !!m;
      if (G.state) G.state.muted = this.muted;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
      }
    },

    _startEngineNodes() {
      if (!this.ctx) return;
      this._engineOsc = this.ctx.createOscillator();
      this._engineOsc.type = 'sawtooth';
      this._engineOsc.frequency.value = 60;
      this._engineFilter = this.ctx.createBiquadFilter();
      this._engineFilter.type = 'lowpass';
      this._engineFilter.frequency.value = 400;
      this._engineGain = this.ctx.createGain();
      this._engineGain.gain.value = 0;
      this._engineOsc.connect(this._engineFilter);
      this._engineFilter.connect(this._engineGain);
      this._engineGain.connect(this.master);
      this._engineOsc.start();
    },

    engine(speed, throttle) {
      if (!this.ctx || this.muted) return;
      try {
        const t = this.ctx.currentTime;
        const freq = 60 + Math.min(Math.abs(speed || 0), 46) * 3.5; // 60-220 Hz
        this._engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
        const g = (throttle ? 0.05 : 0.02) + Math.min(Math.abs(speed || 0) / 46, 1) * 0.05;
        this._engineGain.gain.setTargetAtTime(g, t, 0.1);
      } catch (e) { /* ignore */ }
    },

    siren(on) {
      if (!this.ctx) { if (!on) return; this.unlock(); if (!this.ctx) return; }
      try {
        if (on && !this._sirenOsc) {
          this._sirenOsc = this.ctx.createOscillator();
          this._sirenOsc.type = 'square';
          this._sirenOsc.frequency.value = 700;
          this._sirenGain = this.ctx.createGain();
          this._sirenGain.gain.value = 0.035;
          this._sirenOsc.connect(this._sirenGain);
          this._sirenGain.connect(this.master);
          this._sirenOsc.start();
          this._sirenTimer = setInterval(() => {
            if (!this._sirenOsc) return;
            this._sirenHigh = !this._sirenHigh;
            this._sirenOsc.frequency.value = this._sirenHigh ? 950 : 700;
          }, 450);
        } else if (!on && this._sirenOsc) {
          clearInterval(this._sirenTimer);
          this._sirenTimer = null;
          const osc = this._sirenOsc, g = this._sirenGain;
          this._sirenOsc = null; this._sirenGain = null;
          try { osc.stop(); } catch (e) { /* already stopped */ }
          try { g.disconnect(); osc.disconnect(); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    },

    _tone(freq, dur, type, gain, when) {
      if (!this.ctx) return;
      try {
        const t0 = this.ctx.currentTime + (when || 0);
        const o = this.ctx.createOscillator();
        o.type = type || 'sine';
        o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain || 0.15, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g); g.connect(this.master);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) { /* ignore */ }
    },

    _noise(dur, gain, filterFreq) {
      if (!this.ctx) return;
      try {
        const len = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
        const g = this.ctx.createGain();
        g.gain.value = gain || 0.3;
        src.connect(f); f.connect(g); g.connect(this.master);
        src.start();
      } catch (e) { /* ignore */ }
    },

    sfx(name) {
      if (!this.ctx || this.muted) return;
      try {
        switch (name) {
          case 'gunshot':
            this._noise(0.14, 0.4, 2500);
            this._tone(90, 0.12, 'sine', 0.3);
            break;
          case 'punch':
            this._noise(0.08, 0.25, 500);
            this._tone(140, 0.08, 'triangle', 0.2);
            break;
          case 'pickup':
            this._tone(880, 0.09, 'sine', 0.18);
            this._tone(1318, 0.12, 'sine', 0.15, 0.08);
            break;
          case 'jingle':
            this._tone(523, 0.14, 'triangle', 0.2);
            this._tone(659, 0.14, 'triangle', 0.2, 0.13);
            this._tone(784, 0.28, 'triangle', 0.22, 0.26);
            break;
          case 'busted':
            this._tone(392, 0.3, 'sawtooth', 0.16);
            this._tone(311, 0.5, 'sawtooth', 0.16, 0.28);
            break;
          case 'honk':
            this._tone(370, 0.28, 'square', 0.1);
            this._tone(466, 0.28, 'square', 0.1);
            break;
          case 'door':
            this._noise(0.05, 0.2, 900);
            this._tone(220, 0.05, 'square', 0.08);
            break;
          case 'crash':
            this._noise(0.25, 0.35, 800);
            this._tone(70, 0.2, 'sine', 0.3);
            break;
          case 'reload':
            this._tone(500, 0.05, 'square', 0.08);
            this._tone(700, 0.05, 'square', 0.08, 0.1);
            break;
          case 'click':
            this._tone(1200, 0.03, 'square', 0.06);
            break;
          default:
            this._tone(440, 0.08, 'sine', 0.1);
            break;
        }
      } catch (e) { /* ignore */ }
    },

    musicStart() {
      if (!this.ctx || this._musicTimer) return;
      // Slow pad: Am - F - C - G, one chord per 8 s, low gain.
      const chords = [
        [220.0, 261.63, 329.63], // Am
        [174.61, 220.0, 261.63], // F
        [261.63, 329.63, 392.0], // C
        [196.0, 246.94, 293.66], // G
      ];
      let idx = 0;
      const playChord = () => {
        if (!this.ctx || this.muted) { idx = (idx + 1) % chords.length; return; }
        try {
          const t0 = this.ctx.currentTime;
          for (const f of chords[idx]) {
            const o = this.ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.value = f / 2;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.linearRampToValueAtTime(0.035, t0 + 1.5);
            g.gain.setValueAtTime(0.035, t0 + 6);
            g.gain.linearRampToValueAtTime(0.0001, t0 + 8);
            o.connect(g); g.connect(this.master);
            o.start(t0); o.stop(t0 + 8.1);
          }
        } catch (e) { /* ignore */ }
        idx = (idx + 1) % chords.length;
      };
      playChord();
      this._musicTimer = setInterval(playChord, 8000);
    },
  };
  return A;
}
