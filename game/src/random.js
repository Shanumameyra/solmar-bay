// Seeded RNG (mulberry32). ALL gameplay randomness goes through this so a
// world built from a seed is deterministic: same seed, same city, same
// traffic, same shots. Math.random is never used by Worker A modules.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash -> uint32 seed. Lets callers seed from a name.
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRandom(seed) {
  let next = mulberry32(seed);
  return {
    // Raw [0, 1).
    next() {
      return next();
    },
    // Float in [lo, hi).
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },
    // Integer in [0, n). Guards against non-positive n (returns 0).
    int(n) {
      if (!(n > 0)) return 0;
      return Math.floor(next() * n);
    },
    // Integer in [lo, hi] inclusive.
    intRange(lo, hi) {
      if (!(hi >= lo)) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    // Random element; undefined for an empty array.
    pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(next() * arr.length)];
    },
    // True with probability p.
    chance(p) {
      return next() < p;
    },
    // Shuffled copy (Fisher-Yates); the input is untouched.
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
      }
      return a;
    },
    // Standard-normal sample (Box-Muller).
    gauss() {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // Re-seed this generator in place (lets a world reset deterministically).
    reset(s) {
      next = mulberry32(s);
    },
  };
}
