// Small deterministic randomness helpers for puzzle generation. Pure TS.

/** Small deterministic PRNG so a given seed always yields the same sequence. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** The integers 0..n-1 in random order (Fisher-Yates). */
export const shuffledIndices = (n: number, rng: () => number): number[] => {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
};

/** A fresh 31-bit seed for generation that does not need to be repeatable. */
export const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
