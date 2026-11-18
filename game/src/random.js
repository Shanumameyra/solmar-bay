// random.js — Solmar Bay: deterministic seeded randomness.
// Every random choice in the city, traffic and spawns comes from a seeded
// generator, so the same seed always builds the same city (screenshots are
// reproducible: ?shot=1..4&seed=7). No Math.random() anywhere in the game
// logic — use createRng(seed) and pass it down.

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash -> 32-bit seed, so names like 'solmar-bay' seed too. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Full-featured seeded RNG.
 *   const rng = createRng(7);
 *   rng.range(0, 100)  // float in [min, max)
 *   rng.int(1, 6)      // integer in [min, max] inclusive
 *   rng.pick(['a','b']) // one element
 *   rng.chance(0.25)   // true 25% of the time
 *   rng.shuffle(arr)    // new shuffled copy
 * Accepts a number or a string seed.
 */
export function createRng(seed) {
  const next = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
  return {
    next,
    /** Float in [min, max). */
    range(min, max) { return min + (max - min) * next(); },
    /** Integer in [min, max] inclusive. */
    int(min, max) { return Math.floor(min + (max - min + 1) * next()); },
    /** One element of an array (undefined for an empty array). */
    pick(arr) { return arr.length ? arr[Math.floor(next() * arr.length)] : undefined; },
    /** True with probability p (0..1). */
    chance(p) { return next() < p; },
    /** New array with the elements shuffled (Fisher-Yates). */
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    },
    /** Pick n distinct elements. */
    sample(arr, n) { return this.shuffle(arr).slice(0, Math.min(n, arr.length)); },
    /** Approximately normal value, mean 0, stddev 1 (Box-Muller). */
    gaussian() {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    },
    /** Random angle in radians, 0..2PI. */
    angle() { return next() * Math.PI * 2; },
  };
}

/** Convenience: one-off seeded float without keeping an RNG around. */
export function seededFloat(seed, salt = 0) {
  return mulberry32((seed >>> 0) + (salt * 2654435761 >>> 0))();
}

export default createRng;
