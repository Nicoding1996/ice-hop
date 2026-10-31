import type { Board } from '../../shared/game/types';
import { isDailyDate } from '../../shared/daily';
import { addDays } from '../../shared/date';
import { validateBoardStructure } from '../../shared/game/validation';
import { generate, type GenOptions } from '../../shared/solver/generator';
import { randomSeed } from '../../shared/solver/random';
import { generateReverse } from '../../shared/solver/reverse';
import { solve } from '../../shared/solver/solver';

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

/**
 * Which generation pass produced a Daily (recorded in telemetry): `prepared`
 * by the week-ahead job, or one of the request-path cascade passes.
 */
export type DailyPass = 'prepared' | 'designed' | 'relaxed' | 'fast' | 'fallback';

export type GeneratedDaily = {
  readonly board: Board;
  readonly par: number;
  readonly pass: DailyPass;
};

/**
 * One pass over a list of configs that shares a single wall-clock budget across
 * them. Expensive uniqueness checks therefore cannot make a cache-miss request
 * exceed the whole pass budget.
 */
const runPass = (
  configs: readonly DailyGenConfig[],
  baseSeed: number,
  totalMs: number,
  common: Partial<GenOptions>
): { board: Board; par: number } | null => {
  const deadline = Date.now() + totalMs;
  for (let index = 0; index < configs.length; index++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const generated = generate({
      width: 5,
      height: 5,
      seed: baseSeed + index,
      deadlineMs: remaining,
      ...common,
      ...configs[index],
    });
    if (generated) return generated;
  }
  return null;
};

/** Upcoming Daily dates the week-ahead job keeps ready, starting tomorrow. */
export const DAILY_PREPARE_DAYS = 7;

/**
 * Rules version of prepared, not yet published Dailies. Entries made under a
 * different version are discarded and prepared again, so bump this whenever
 * the strict rules below change.
 */
export const DAILY_PREPARE_POLICY = 1;

/**
 * Highest allowed "3-star luck": the chance that random moves finish within
 * par + 1 moves, which still earns 3 stars. Easy stays gentle; Medium and Hard
 * should take real thought for 3 stars.
 */
export const DAILY_MAX_THREE_STAR_LUCK: Readonly<Record<DailyTier, number>> = {
  easy: 0.05,
  medium: 0.01,
  hard: 0.01,
};

export type DesignedDailyOptions = {
  /** Stop starting new layouts after this many milliseconds. */
  readonly deadlineMs: number;
  /** Fingerprint ids (boardFingerprintId) of recent Dailies not to repeat. */
  readonly exclude?: ReadonlySet<string>;
  /**
   * Random by default. The code is public, so a seed derived from the date
   * would let anyone compute an upcoming Daily; the benchmark passes one to be
   * repeatable.
   */
  readonly seed?: number;
  /** Positions mapped per layout before it is skipped (request paths cap this). */
  readonly maxStates?: number;
};

/**
 * The strict Daily rules, built by reverse generation: exactly one best
 * solution, no clutter (Easy: every piece used), low 3-star luck, the weekday
 * tier's piece mixes and par band, and no repeat of an excluded puzzle. Mixes
 * take turns one layout at a time so a slow one cannot use the whole budget.
 * Returns null when the budget runs out first.
 */
export const generateDesignedDaily = (
  date: string,
  options: DesignedDailyOptions
): { readonly board: Board; readonly par: number } | null => {
  const tier = dailyTierForDate(date);
  const configs = DAILY_LADDERS[tier];
  const deadline = Date.now() + options.deadlineMs;
  const seed = options.seed ?? randomSeed();
  for (let round = 0; Date.now() < deadline; round++) {
    const config = configs[round % configs.length];
    if (!config) return null;
    const generated = generateReverse({
      ...config,
      maxOptimalSolutions: 1,
      rejectInert: true,
      maxThreeStarLuck: DAILY_MAX_THREE_STAR_LUCK[tier],
      ...(options.exclude ? { exclude: options.exclude } : {}),
      ...(options.maxStates === undefined ? {} : { maxStates: options.maxStates }),
      attempts: 1,
      seed: (seed + Math.imul(round, 0x9e3779b1)) >>> 0,
    });
    if (generated) return { board: generated.board, par: generated.par };
  }
  return null;
};

/** The puzzle dates the week-ahead job fills: tomorrow through a week ahead. */
export const upcomingDailyDates = (today: string): string[] =>
  Array.from({ length: DAILY_PREPARE_DAYS }, (_, index) => addDays(today, index + 1));

export type PreparedDaily = {
  readonly date: string;
  readonly board: Board;
  readonly par: number;
  readonly policy: number;
};

const preparedProperty = (value: object, key: string): unknown => Reflect.get(value, key);

/**
 * Parse a prepared Daily from Redis (untrusted at this boundary). It is used
 * only when it is for `date`, was made under the current rules, and the shared
 * solver confirms its par inside the weekday band.
 */
export const parsePreparedDaily = (
  raw: string | undefined,
  date: string
): PreparedDaily | null => {
  if (!raw || !isDailyDate(date)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const par = preparedProperty(value, 'par');
    const structure = validateBoardStructure(preparedProperty(value, 'board'));
    if (
      preparedProperty(value, 'date') !== date ||
      preparedProperty(value, 'policy') !== DAILY_PREPARE_POLICY ||
      typeof par !== 'number' ||
      !Number.isSafeInteger(par) ||
      !structure.ok ||
      !isDailyParInBand(dailyTierForDate(date), par)
    ) {
      return null;
    }
    const check = solve(structure.board, { maxStates: 400_000 });
    if (!check.solvable || check.par !== par) return null;
    return { date, board: structure.board, par, policy: DAILY_PREPARE_POLICY };
  } catch {
    return null;
  }
};

/**
 * Generate a daily on the request path through a bounded quality cascade,
 * used only when the week-ahead job has no prepared puzzle for the date.
 * Every pass uses only the selected weekday tier's shapes and par band:
 *   1. designed: the strict prepared-Daily rules, built in reverse;
 *   2. relaxed: no inert clutter without the expensive uniqueness proof;
 *   3. fast: quality gates off, but still inside the same par band;
 *   4. fallback: a known solver-verified board in that exact band.
 *
 * This preserves the request-safe deadline without ever relabeling an Easy
 * board as Medium/Hard or reducing the par floor below four.
 */
export const generateDailyOnDemand = (date: string, seed: number = randomSeed()): GeneratedDaily => {
  const tier = dailyTierForDate(date);
  const configs = DAILY_LADDERS[tier];

  // The week-ahead job's strict rules (without its repeat check), built in
  // reverse, which usually meets them within a second for every tier. The
  // position cap bounds one layout's work on the request path; the largest
  // Daily layouts measured map about 15,000 positions in under a second.
  const designed = generateDesignedDaily(date, { deadlineMs: 2500, seed, maxStates: 20_000 });
  if (designed) return { ...designed, pass: 'designed' };

  const relaxed = runPass(configs, seed + 10_000, 1500, {
    rejectInert: true,
    attempts: 1500,
    maxStates: 20_000,
  });
  if (relaxed) return { ...relaxed, pass: 'relaxed' };

  const fastConfigs = configs.map((config) => ({
    ...config,
    requireAllPiecesUsed: false,
  }));
  const fast = runPass(fastConfigs, seed + 20_000, 1500, {
    requireUnique: false,
    rejectInert: false,
    attempts: 3000,
    maxStates: 15_000,
  });
  if (fast) return { ...fast, pass: 'fast' };

  return { ...DAILY_FALLBACKS[tier], pass: 'fallback' };
};
