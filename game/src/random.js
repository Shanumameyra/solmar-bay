// Seeded RNG (mulberry32). ALL gameplay randomness flows through createRandom
// so a run with the same seed is fully reproducible (?seed=N fixes it).
// No Math.random() anywhere in game code.
// Hash a string seed (e.g. "?seed=solmar") into a uint32 for mulberry32,
// so text seeds are reproducible too.
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRandom(seed) {
  let state = (typeof seed === 'string' ? hashSeed(seed) : (seed >>> 0)) || 1;
  function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    // Re-seed in place, so a subsystem can restart its stream.
    reset(newSeed) {
      state = (typeof newSeed === 'string' ? hashSeed(newSeed) : (newSeed >>> 0)) || 1;
    },
    // Float in [lo, hi).
    range(lo, hi) { return lo + next() * (hi - lo); },
    // Integer in [0, n); 0 when n is not positive (never a negative index).
    int(n) { return n > 0 ? Math.floor(next() * n) : 0; },
    // Integer in [lo, hi] inclusive.
    intRange(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    // Random element of an array; undefined for an empty array.
    pick(arr) { return arr.length ? arr[Math.floor(next() * arr.length)] : undefined; },
    // True with probability p.
    chance(p) { return next() < p; },
    // Fisher-Yates shuffle of a copy.
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    },
    // Approximately normal (mean 0, sd 1) via Box-Muller; clamped to ±3.
    gauss() {
      const u1 = Math.max(1e-9, next());
      const u2 = next();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(-3, Math.min(3, g));
    },
  };
}
