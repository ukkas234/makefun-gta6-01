// Seeded RNG (mulberry32): the same seed gives the same city, which is what makes
// the screenshot scenes repeatable. Pure functions, no browser needed.

/**
 * mulberry32(seed) → function returning a float in [0, 1).
 * Accepts any integer seed; the state is kept in a closure.
 */
export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Alias matching the kit starter's name. */
export const createRandom = mulberry32;

/** Float in [min, max). */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  return Math.floor(range(rng, min, max + 1));
}

/** Float in [min, max) from a raw rng function; same as range, shorter name. */
export function rand(rng, min, max) {
  return range(rng, min, max);
}

/** Random element of a non-empty array. */
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

/** Alias of pick. */
export const choice = pick;

/** True with probability p (0..1). */
export function chance(rng, p) {
  return rng() < p;
}

/** In-place Fisher–Yates shuffle; returns the same array. */
export function shuffle(rng, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

/** Deterministic string hash → 32-bit int, for seeding per-variant layouts. */
export function hashSeed(str) {
  let h = 2166136261 | 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
