import type { Board } from '../../shared/game/types';

export type DailyTier = 'easy' | 'medium' | 'hard';

export type DailyGenConfig = {
  readonly hoppers: number;
  readonly sliders: number;
  readonly blockers: number;
  readonly minPar: number;
  readonly maxPar: number;
  /** Easy boards keep every piece on the intended path; later tiers allow decoys. */
  readonly requireAllPiecesUsed?: boolean;
};

type DailyFallback = {
  readonly board: Board;
  readonly par: number;
};

/**
 * Non-overlapping daily bands aligned with difficultyFromPar. Monday/Tuesday
 * begin at par 4 rather than serving tutorial-length boards, Wednesday-Friday
 * occupy the Medium band, and weekends stay in the Hard band.
 */
export const DAILY_LADDERS: Readonly<Record<DailyTier, readonly DailyGenConfig[]>> = {
  easy: [
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 4, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 0, blockers: 2, minPar: 4, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 1, sliders: 1, blockers: 1, minPar: 4, maxPar: 4, requireAllPiecesUsed: true },
  ],
  medium: [
    { hoppers: 3, sliders: 1, blockers: 1, minPar: 5, maxPar: 7 },
    { hoppers: 2, sliders: 1, blockers: 2, minPar: 5, maxPar: 7 },
    { hoppers: 2, sliders: 2, blockers: 1, minPar: 5, maxPar: 7 },
  ],
  hard: [
    { hoppers: 3, sliders: 2, blockers: 2, minPar: 8, maxPar: 11 },
    { hoppers: 3, sliders: 1, blockers: 2, minPar: 8, maxPar: 11 },
    { hoppers: 2, sliders: 2, blockers: 2, minPar: 8, maxPar: 11 },
  ],
};

/**
 * Solver-verified last-resort boards for each band. Generation is bounded by a
 * request-safe deadline, so these guarantee both availability and an honest
 * weekday difficulty label when all seeded attempts miss their band.
 */
export const DAILY_FALLBACKS: Readonly<Record<DailyTier, DailyFallback>> = {
  easy: {
    par: 4,
    board: {
      width: 5,
      height: 5,
      holes: [1, 2],
      pieces: [
        { kind: 'BLOCKER', cells: [9] },
        { kind: 'BLOCKER', cells: [19] },
        { kind: 'HOPPER', cells: [3] },
        { kind: 'HOPPER', cells: [24] },
      ],
    },
  },
  medium: {
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
  hard: {
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
};

export const dailyTierForDate = (date: string): DailyTier => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (Number.isNaN(day)) throw new Error('Invalid daily puzzle date.');
  if (day === 0 || day === 6) return 'hard';
  if (day === 1 || day === 2) return 'easy';
  return 'medium';
};

export const dailyParBand = (tier: DailyTier): { readonly min: number; readonly max: number } => {
  const configs = DAILY_LADDERS[tier];
  return {
    min: Math.min(...configs.map((config) => config.minPar)),
    max: Math.max(...configs.map((config) => config.maxPar)),
  };
};

export const isDailyParInBand = (tier: DailyTier, par: number): boolean => {
  const band = dailyParBand(tier);
  return par >= band.min && par <= band.max;
};
