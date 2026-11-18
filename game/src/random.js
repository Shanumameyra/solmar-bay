// Solmar Bay — deterministic RNG helpers. Pure module, no imports.

// mulberry32: small fast seeded PRNG. Returns a function yielding [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function int(rng, min, max) {
  // min inclusive, max exclusive.
  return min + Math.floor(rng() * (max - min));
}

export function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
