import type { EndlessTier } from '../../shared/api';
import type { Board } from '../../shared/game/types';
import { boardFingerprintId } from '../../shared/game/symmetry';
import { generate } from '../../shared/solver/generator';
import { randomSeed } from '../../shared/solver/random';
import { generateReverse } from '../../shared/solver/reverse';

/**
 * Pure Endless generation policy (no Redis), kept beside endless.ts the same
 * way dailyPolicy.ts sits beside daily.ts so the tier rules are unit-testable.
 */

export type EndlessPuzzle = { readonly board: Board; readonly par: number };

type EndlessGenConfig = {
  readonly hoppers: number;
  readonly sliders: number;
  readonly blockers: number;
  readonly minPar: number;
  readonly maxPar: number;
  /** Easy keeps every piece on the path (no traps); harder tiers allow decoys. */
  readonly requireAllPiecesUsed?: boolean;
};

// Each tier offers several board "shapes"; we shuffle them per request for
// variety. Difficulty is set by par (solution length) + piece counts, the same
// levers the daily uses, with NON-OVERLAPPING par bands so a tier's label means
// something: Easy par 2-4, Medium par 5-7, Hard par 8-11. Easy teaches with
// trap-free boards (requireAllPiecesUsed); Medium/Hard keep the no-clutter gate,
// allow decoy misdirection, and add a near-unique gate in the pool pass so
// harder boards feel designed, not just long. Every tier stays solvable.
//
// Easy's small mixes allow few puzzles (about 70 for 2 penguins + 1 rock, 180
// for 1 penguin + 1 seal + 1 rock, counting mirrored copies as one), so Easy
// also offers four-piece mixes, estimated from samples at about 500-1,400
// puzzles each.
export const ENDLESS_TIERS: Readonly<Record<EndlessTier, readonly EndlessGenConfig[]>> = {
  easy: [
    { hoppers: 1, sliders: 1, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 0, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 0, blockers: 2, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 1, sliders: 1, blockers: 2, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 1, sliders: 2, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 3, sliders: 0, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
  ],
  medium: [
    { hoppers: 2, sliders: 1, blockers: 2, minPar: 5, maxPar: 7 },
    { hoppers: 3, sliders: 1, blockers: 1, minPar: 5, maxPar: 7 },
    { hoppers: 2, sliders: 2, blockers: 1, minPar: 5, maxPar: 7 },
  ],
  hard: [
    { hoppers: 3, sliders: 1, blockers: 2, minPar: 8, maxPar: 11 },
    { hoppers: 3, sliders: 2, blockers: 1, minPar: 8, maxPar: 11 },
    { hoppers: 2, sliders: 2, blockers: 2, minPar: 8, maxPar: 11 },
  ],
};

/**
 * Solver-verified, in-band last-resort boards. Several per tier so a cascade
 * miss never serves one identical board over and over (a single Easy board used
 * to appear for roughly one in seven pool-empty requests). Easy boards keep
 * every piece on the optimal path, like generated Easy boards.
 */
export const ENDLESS_FALLBACKS: Readonly<Record<EndlessTier, readonly EndlessPuzzle[]>> = {
  easy: [
    {
      par: 3,
      board: {
        width: 5,
        height: 5,
        holes: [24],
        pieces: [
          { kind: 'SLIDER', cells: [13, 18], orient: 'V' },
          { kind: 'BLOCKER', cells: [21] },
          { kind: 'HOPPER', cells: [20] },
        ],
      },
    },
    {
      par: 4,
      board: {
        width: 5,
        height: 5,
        holes: [0, 5],
        pieces: [
          { kind: 'BLOCKER', cells: [16] },
          { kind: 'HOPPER', cells: [20] },
          { kind: 'HOPPER', cells: [17] },
        ],
      },
    },
    {
      par: 4,
      board: {
        width: 5,
        height: 5,
        holes: [8, 23],
        pieces: [
          { kind: 'SLIDER', cells: [12, 13], orient: 'H' },
          { kind: 'BLOCKER', cells: [17] },
          { kind: 'HOPPER', cells: [16] },
          { kind: 'HOPPER', cells: [18] },
        ],
      },
    },
    {
      par: 2,
      board: {
        width: 5,
        height: 5,
        holes: [4],
        pieces: [
          { kind: 'SLIDER', cells: [13, 18], orient: 'V' },
          { kind: 'BLOCKER', cells: [2] },
          { kind: 'HOPPER', cells: [1] },
        ],
      },
    },
    {
      par: 4,
      board: {
        width: 5,
        height: 5,
        holes: [18, 19],
        pieces: [
          { kind: 'BLOCKER', cells: [10] },
          { kind: 'HOPPER', cells: [5] },
          { kind: 'HOPPER', cells: [16] },
        ],
      },
    },
    {
      par: 4,
      board: {
        width: 5,
        height: 5,
        holes: [9, 12],
        pieces: [
          { kind: 'SLIDER', cells: [3, 8], orient: 'V' },
          { kind: 'BLOCKER', cells: [14] },
          { kind: 'HOPPER', cells: [2] },
          { kind: 'HOPPER', cells: [19] },
        ],
      },
    },
  ],
  medium: [
    {
      par: 6,
      board: {
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
      },
    },
    {
      par: 7,
      board: {
        width: 5,
        height: 5,
        holes: [10, 14],
        pieces: [
          { kind: 'SLIDER', cells: [17, 18], orient: 'H' },
          { kind: 'BLOCKER', cells: [13] },
          { kind: 'BLOCKER', cells: [21] },
          { kind: 'HOPPER', cells: [11] },
          { kind: 'HOPPER', cells: [20] },
        ],
      },
    },
    {
      par: 5,
      board: {
        width: 5,
        height: 5,
        holes: [10, 11, 12],
        pieces: [
          { kind: 'SLIDER', cells: [7, 8], orient: 'H' },
          { kind: 'BLOCKER', cells: [1] },
          { kind: 'HOPPER', cells: [4] },
          { kind: 'HOPPER', cells: [14] },
          { kind: 'HOPPER', cells: [3] },
        ],
      },
    },
    {
      par: 6,
      board: {
        width: 5,
        height: 5,
        holes: [6, 21],
        pieces: [
          { kind: 'SLIDER', cells: [12, 17], orient: 'V' },
          { kind: 'SLIDER', cells: [7, 8], orient: 'H' },
          { kind: 'BLOCKER', cells: [16] },
          { kind: 'HOPPER', cells: [3] },
          { kind: 'HOPPER', cells: [14] },
        ],
      },
    },
  ],
  hard: [
    {
      par: 9,
      board: {
        width: 5,
        height: 5,
        holes: [14, 23, 24],
        pieces: [
          { kind: 'SLIDER', cells: [7, 12], orient: 'V' },
          { kind: 'BLOCKER', cells: [15] },
          { kind: 'BLOCKER', cells: [16] },
          { kind: 'HOPPER', cells: [1] },
          { kind: 'HOPPER', cells: [8] },
          { kind: 'HOPPER', cells: [13] },
        ],
      },
    },
    {
      par: 10,
      board: {
        width: 5,
        height: 5,
        holes: [8, 16, 21],
        pieces: [
          { kind: 'SLIDER', cells: [2, 7], orient: 'V' },
          { kind: 'BLOCKER', cells: [11] },
          { kind: 'BLOCKER', cells: [23] },
          { kind: 'HOPPER', cells: [20] },
          { kind: 'HOPPER', cells: [18] },
          { kind: 'HOPPER', cells: [1] },
        ],
      },
    },
    {
      par: 11,
      board: {
        width: 5,
        height: 5,
        holes: [8, 10, 15],
        pieces: [
          { kind: 'SLIDER', cells: [2, 7], orient: 'V' },
          { kind: 'SLIDER', cells: [6, 11], orient: 'V' },
          { kind: 'BLOCKER', cells: [22] },
          { kind: 'HOPPER', cells: [13] },
          { kind: 'HOPPER', cells: [20] },
          { kind: 'HOPPER', cells: [19] },
        ],
      },
    },
    {
      par: 11,
      board: {
        width: 5,
        height: 5,
        holes: [0, 7],
        pieces: [
          { kind: 'SLIDER', cells: [21, 22], orient: 'H' },
          { kind: 'SLIDER', cells: [15, 16], orient: 'H' },
          { kind: 'BLOCKER', cells: [6] },
          { kind: 'BLOCKER', cells: [18] },
          { kind: 'HOPPER', cells: [10] },
          { kind: 'HOPPER', cells: [8] },
        ],
      },
    },
  ],
};

const shuffle = <T>(items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
};

/** Each tier's par band, derived from its configs (single source of truth). */
export const endlessParBand = (tier: EndlessTier): { readonly min: number; readonly max: number } => {
  const configs = ENDLESS_TIERS[tier];
  return {
    min: Math.min(...configs.map((config) => config.minPar)),
    max: Math.max(...configs.map((config) => config.maxPar)),
  };
};

export const isEndlessParInBand = (tier: EndlessTier, par: number): boolean => {
  const band = endlessParBand(tier);
  return par >= band.min && par <= band.max;
};

/**
 * A random verified static board for the tier (never the same one forever),
 * preferring boards not in `exclude` while any remain.
 */
export const endlessStaticFallback = (
  tier: EndlessTier,
  exclude?: ReadonlySet<string>
): EndlessPuzzle => {
  const boards = ENDLESS_FALLBACKS[tier];
  const unseen = exclude ? boards.filter((board) => !exclude.has(endlessPuzzleId(board))) : boards;
  const choices = unseen.length > 0 ? unseen : boards;
  return choices[Math.floor(Math.random() * choices.length)] ?? boards[0];
};

/** Request-path budget for a quality board when the pool can't serve one. */
const REQUEST_QUALITY_MS = 1200;

/**
 * Request-path cap on positions mapped per layout. The largest Hard layouts
 * map about 18,000 positions in about a second; this skips roughly the
 * biggest tenth of them so a player isn't kept waiting. Background generation
 * uses the generator's larger default cap.
 */
const REQUEST_MAX_POSITIONS = 10_000;

/**
 * Quality generation (the pool's rules) built in reverse, trying the tier's
 * mixes one layout at a time in random order until `deadline`. Boards whose
 * fingerprint id is in `exclude` (already seen) are never returned.
 */
const generateEndlessQuality = (
  tier: EndlessTier,
  deadline: number,
  exclude?: ReadonlySet<string>,
  maxStates?: number
): EndlessPuzzle | null => {
  const configs = ENDLESS_TIERS[tier];
  const maxOptimalSolutions = tier === 'easy' ? undefined : 2;
  let order = shuffle(configs);
  for (let round = 0; Date.now() < deadline; round++) {
    if (round > 0 && round % order.length === 0) order = shuffle(configs);
    const config = order[round % order.length];
    if (!config) return null;
    const generated = generateReverse({
      ...config,
      rejectInert: true,
      ...(maxOptimalSolutions === undefined ? {} : { maxOptimalSolutions }),
      ...(exclude ? { exclude } : {}),
      ...(maxStates === undefined ? {} : { maxStates }),
      attempts: 1,
      seed: randomSeed(),
    });
    if (generated) return { board: generated.board, par: generated.par };
  }
  return null;
};

/**
 * Bounded generation for the REQUEST path when the pool is momentarily empty
 * or holds only boards this player has seen. It tries the pool's own quality
 * rules for about a second, then the old gate-light random pass, then a static
 * board, so it always answers quickly. Every step skips boards in `exclude`;
 * only the static step repeats one, and only when every static board is in it.
 */
export const generateEndlessFallback = (
  tier: EndlessTier,
  exclude?: ReadonlySet<string>
): EndlessPuzzle =>
  generateEndlessQuality(tier, Date.now() + REQUEST_QUALITY_MS, exclude, REQUEST_MAX_POSITIONS) ??
  generateEndlessFast(tier, exclude) ??
  endlessStaticFallback(tier, exclude);

/** The fast in-band pass shared by the request path and pool salvage. */
const generateEndlessFast = (
  tier: EndlessTier,
  exclude?: ReadonlySet<string>
): EndlessPuzzle | null => {
  for (const config of shuffle(ENDLESS_TIERS[tier])) {
    const generated =
      tier === 'easy'
        ? generate({
            width: 5,
            height: 5,
            ...config,
            requireUnique: false,
            rejectInert: true,
            maxStates: 15_000,
            attempts: 2000,
            seed: randomSeed(),
          })
        : generate({
            width: 5,
            height: 5,
            ...config,
            requireUnique: false,
            rejectInert: false,
            requireAllPiecesUsed: false,
            maxStates: 15_000,
            attempts: 150,
            seed: randomSeed(),
          });
    if (generated && !exclude?.has(endlessPuzzleId(generated))) return generated;
  }
  return null;
};

/** Quality pool generation gets this long before it settles for a fast board. */
const POOL_QUALITY_MS = 8000;

/**
 * Quality generation for the POOL (off the request path: the scheduler cron and
 * the install warm-up). Keeps the no-clutter gate and, for Medium/Hard, a
 * near-unique gate (at most 2 optimal solutions). Only the tier's OWN shapes are
 * tried, so a pool never holds an easier tier's board. Boards are built in
 * reverse (Hard used to take about 8s each by random placement, with spikes
 * near 20s; reverse building takes well under a second). If the quality pass
 * misses while time remains, the fast generator salvages an in-band board.
 * Static fallback boards are never pooled, so the pool cannot fill with repeats.
 *
 * `deadlineMs` bounds the work. Returns null once the budget is spent so a
 * refill run can stop cleanly and let the next run continue.
 */
export const generateEndlessPoolPuzzle = (
  tier: EndlessTier,
  deadlineMs: number = Number.POSITIVE_INFINITY
): EndlessPuzzle | null => {
  const deadline = Date.now() + deadlineMs;
  const quality = generateEndlessQuality(tier, Math.min(deadline, Date.now() + POOL_QUALITY_MS));
  if (quality) return quality;
  if (deadline - Date.now() <= 0) return null;
  return generateEndlessFast(tier);
};

/** Pool and seen-list id for a puzzle: mirrored/rotated copies share it. */
export const endlessPuzzleId = (puzzle: EndlessPuzzle): string =>
  boardFingerprintId(puzzle.board);
