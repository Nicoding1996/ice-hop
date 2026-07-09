import { redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import { generate, type GenOptions } from '../../shared/solver/generator';
import { solve } from '../../shared/solver/solver';
import { seedFromDate } from '../../shared/date';
import { keys } from './keys';

export type DailyPuzzle = {
  readonly date: string;
  readonly board: Board;
  readonly par: number;
};

// Real, solver-verified last-resort board (par 6), reached only if every
// generation pass below somehow misses within its time budget - effectively
// never. It is a proper puzzle, not a trivial one, so even the worst case is a
// legitimate daily rather than something that reads as broken.
const FALLBACK_BOARD: Board = {
  width: 5,
  height: 5,
  holes: [13, 14],
  pieces: [
    { kind: 'SLIDER', cells: [7, 12], orient: 'V' },
    { kind: 'BLOCKER', cells: [15] },
    { kind: 'BLOCKER', cells: [16] },
    { kind: 'HOPPER', cells: [1] },
    { kind: 'HOPPER', cells: [8] },
  ],
};

type GenConfig = {
  hoppers: number;
  sliders: number;
  blockers: number;
  minPar: number;
  maxPar: number;
  /** Easy tiers keep every piece on the solution path (no decoys); harder tiers
   *  leave this off so the generator can include tempting wrong moves. */
  requireAllPiecesUsed?: boolean;
};

// Difficulty ramps across the week like a daily crossword: Mon/Tue easy,
// Wed-Fri medium, weekends hard. Higher tiers add more penguins and seals
// (up to 3 penguins / 2 seals, like Jump In') and allow decoy pieces for
// misdirection. Every accepted board is solvable, has a single optimal
// solution, and contains no inert clutter (the solver guarantees all three).
const LADDERS: ReadonlyArray<ReadonlyArray<GenConfig>> = [
  [
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 3, maxPar: 6, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 0, blockers: 2, minPar: 2, maxPar: 5, requireAllPiecesUsed: true },
    { hoppers: 1, sliders: 1, blockers: 1, minPar: 2, maxPar: 5, requireAllPiecesUsed: true },
  ],
  [
    { hoppers: 3, sliders: 1, blockers: 1, minPar: 4, maxPar: 8 },
    { hoppers: 2, sliders: 1, blockers: 2, minPar: 4, maxPar: 8 },
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 3, maxPar: 7 },
  ],
  [
    { hoppers: 3, sliders: 2, blockers: 2, minPar: 5, maxPar: 10 },
    { hoppers: 3, sliders: 1, blockers: 2, minPar: 5, maxPar: 9 },
    { hoppers: 2, sliders: 2, blockers: 2, minPar: 4, maxPar: 9 },
  ],
];

const tierForDate = (date: string): number => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return 2; // weekend: hard
  if (day === 1 || day === 2) return 0; // Mon/Tue: easy
  return 1; // Wed-Fri: medium
};

/**
 * One pass over a list of configs that shares a SINGLE wall-clock budget across
 * them, so the pass can never exceed `totalMs` no matter how expensive an
 * individual attempt gets (proving uniqueness can be very costly on some
 * boards). Returns the first board found, or null if the budget elapses first.
 */
const runPass = (
  configs: ReadonlyArray<GenConfig>,
  baseSeed: number,
  totalMs: number,
  common: Partial<GenOptions>
): { board: Board; par: number } | null => {
  const deadline = Date.now() + totalMs;
  for (let i = 0; i < configs.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const generated = generate({
      width: 5,
      height: 5,
      seed: baseSeed + i,
      deadlineMs: remaining,
      ...common,
      ...configs[i],
    });
    if (generated) return generated;
  }
  return null;
};

/**
 * Generate the day's puzzle as a bounded cascade so a cache-miss `/api/init` can
 * NEVER hang - the bug that failed app review as "puzzle would not load". The
 * old single pass ran up to ~15k uniqueness-gated attempts and measured 10-24s
 * on unlucky seeds, past the client's 12s fetch timeout (and likely the server
 * limit). Each pass here shares a hard wall-clock budget and degrades
 * gracefully:
 *   1. designed - single optimal solution + no clutter (the ideal daily);
 *   2. relaxed  - drop the costly uniqueness proof, keep the no-clutter gate;
 *   3. fast     - all gates off and the par floor dropped to 2, so a real
 *                 solvable in-tier board is found near-instantly.
 * Worst case (all three passes elapse) stays ~5s, comfortably inside the client
 * timeout, and the result is always a real, solver-verified board. Still
 * deterministic per date (each pass is seeded from the date).
 */
const generateDaily = (date: string): { board: Board; par: number } => {
  const seed = seedFromDate(date);
  const tier = tierForDate(date);
  // The day's tier first, then the easy tier as extra shapes to try.
  const configs = [...LADDERS[tier], ...LADDERS[0]];

  const designed = runPass(configs, seed, 2500, {
    requireUnique: true,
    rejectInert: true,
    attempts: 3000,
    maxStates: 30_000,
  });
  if (designed) return designed;

  const relaxed = runPass(configs, seed + 10_000, 1500, {
    rejectInert: true,
    attempts: 1500,
    maxStates: 20_000,
  });
  if (relaxed) return relaxed;

  // Last resort: gates off and the par floor dropped to 2 so a solvable in-tier
  // board is found almost immediately. Keeps the daily a real puzzle.
  const fastConfigs = configs.map((c) => ({ ...c, minPar: 2, requireAllPiecesUsed: false }));
  const fast = runPass(fastConfigs, seed + 20_000, 1500, {
    attempts: 3000,
    maxStates: 15_000,
  });
  if (fast) return fast;

  return { board: FALLBACK_BOARD, par: solve(FALLBACK_BOARD).par };
};

/**
 * Returns the day's puzzle, creating it on first access. The daily is always
 * freshly generated by the solver-backed generator, with difficulty tiered by
 * the day of week (see `tierForDate`). Community-submitted puzzles are a
 * separate, on-demand stream (see `ugc.ts`) and are not used as the daily.
 */
export const getOrCreateDailyPuzzle = async (date: string): Promise<DailyPuzzle> => {
  const stored = await redis.get(keys.dailyPuzzle(date));
  if (stored) {
    const parsed: DailyPuzzle = JSON.parse(stored);
    return parsed;
  }

  const generated = generateDaily(date);
  const puzzle: DailyPuzzle = { date, board: generated.board, par: generated.par };

  await redis.set(keys.dailyPuzzle(date), JSON.stringify(puzzle));
  return puzzle;
};
