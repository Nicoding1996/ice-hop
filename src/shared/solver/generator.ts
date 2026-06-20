import type { Board, Piece } from '../game/types';
import { solve } from './solver';

export type GenOptions = {
  width?: number;
  height?: number;
  hoppers?: number;
  sliders?: number;
  blockers?: number;
  minPar?: number;
  maxPar?: number;
  attempts?: number;
  /** Seed for deterministic generation (e.g. the daily date). */
  seed?: number;
};

export type Generated = { readonly board: Board; readonly par: number };

/** Small deterministic PRNG so a given seed always yields the same puzzle. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffled = (n: number, rng: () => number): number[] => {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
};

/**
 * Generate a solvable puzzle by random placement + solver verification.
 * Returns null if no board in the requested par range is found within the
 * attempt budget. Every returned board is guaranteed solvable (the solver
 * confirms it) and not pre-solved (holes are distinct from hopper starts).
 */
export const generate = (opts: GenOptions = {}): Generated | null => {
  const width = opts.width ?? 5;
  const height = opts.height ?? 5;
  const hoppers = opts.hoppers ?? 2;
  const sliders = opts.sliders ?? 1;
  const blockers = opts.blockers ?? 2;
  const minPar = opts.minPar ?? 3;
  const maxPar = opts.maxPar ?? 12;
  const attempts = opts.attempts ?? 500;
  const rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 0x7fffffff));
  const cellCount = width * height;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const bag = shuffled(cellCount, rng);
    const used = new Array<boolean>(cellCount).fill(false);
    let cursor = 0;
    const takeFree = (): number => {
      while (cursor < cellCount && used[bag[cursor]]) cursor++;
      if (cursor >= cellCount) return -1;
      const cell = bag[cursor];
      cursor++;
      used[cell] = true;
      return cell;
    };

    const pieces: Piece[] = [];
    let ok = true;

    for (let s = 0; s < sliders && ok; s++) {
      const c = takeFree();
      if (c < 0) {
        ok = false;
        break;
      }
      const col = c % width;
      const right = c + 1;
      const down = c + width;
      const canH = col <= width - 2 && !used[right];
      const canV = down < cellCount && !used[down];
      const preferH = rng() < 0.5;
      if (canH && (preferH || !canV)) {
        used[right] = true;
        pieces.push({ kind: 'SLIDER', cells: [c, right], orient: 'H' });
      } else if (canV) {
        used[down] = true;
        pieces.push({ kind: 'SLIDER', cells: [c, down], orient: 'V' });
      } else {
        ok = false;
      }
    }
    if (!ok) continue;

    for (let b = 0; b < blockers && ok; b++) {
      const c = takeFree();
      if (c < 0) {
        ok = false;
        break;
      }
      pieces.push({ kind: 'BLOCKER', cells: [c] });
    }
    if (!ok) continue;

    for (let h = 0; h < hoppers && ok; h++) {
      const c = takeFree();
      if (c < 0) {
        ok = false;
        break;
      }
      pieces.push({ kind: 'HOPPER', cells: [c] });
    }
    if (!ok) continue;

    const holes: number[] = [];
    for (let k = 0; k < hoppers; k++) {
      const c = takeFree();
      if (c < 0) {
        ok = false;
        break;
      }
      holes.push(c);
    }
    if (!ok || holes.length < hoppers) continue;

    const board: Board = { width, height, holes: holes.sort((a, b) => a - b), pieces };
    const res = solve(board, { maxStates: 60_000 });
    if (res.solvable && res.par >= minPar && res.par <= maxPar) {
      return { board, par: res.par };
    }
  }

  return null;
};
