import { redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import type { EndlessTier, EndlessTierCounts } from '../../shared/api';
import { generate } from '../../shared/solver/generator';
import { solve } from '../../shared/solver/solver';
import { keys } from './keys';

/**
 * Endless mode: the "play more" loop after the daily. The player picks a tier
 * (Easy / Medium / Hard) and we hand back a freshly generated, solver-verified
 * puzzle from that bucket. Unlike the daily (deterministic per date), every
 * endless request is randomly seeded so the puzzles shuffle and never repeat in
 * a predictable order. A lifetime "solved" counter per user drives the
 * progression banner.
 */

type GenConfig = {
  hoppers: number;
  sliders: number;
  blockers: number;
  minPar: number;
  maxPar: number;
  /** Easy keeps every piece on the path (no traps); harder tiers allow decoys. */
  requireAllPiecesUsed?: boolean;
};

// Always-solvable fallback so an endless request can never come back empty.
const FALLBACK_BOARD: Board = {
  width: 5,
  height: 5,
  holes: [2],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
  ],
};

// Each tier offers several board "shapes"; we shuffle them per request for
// variety. Difficulty is set by par (solution length) + piece counts, the same
// levers the daily uses, with NON-OVERLAPPING par bands so a tier's label means
// something: Easy par 2-4, Medium par 5-7, Hard par 8-11. Easy teaches with
// trap-free boards (requireAllPiecesUsed); Medium/Hard keep the no-clutter gate,
// allow decoy misdirection, and add a near-unique gate (see generateEndlessPuzzle)
// so harder boards feel designed, not just long. Hard leans on piece-heavy
// 3-hopper shapes so par 8-11 is reliably reachable on a 5x5. Every tier stays
// solvable.
const ENDLESS_TIERS: Record<EndlessTier, ReadonlyArray<GenConfig>> = {
  easy: [
    { hoppers: 1, sliders: 1, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 0, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
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

const shuffle = <T>(arr: ReadonlyArray<T>): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
};

const fallbackResult = (): { board: Board; par: number } => ({
  board: FALLBACK_BOARD,
  par: solve(FALLBACK_BOARD, { maxStates: 5_000 }).par,
});

/**
 * Quality generation for the POOL (off the request path: the scheduler cron and
 * the install warm-up). Keeps the no-clutter gate and, for Medium/Hard, adds a
 * near-unique gate (at most 2 optimal solutions): left ungated, ~60% of Medium
 * and ~84% of Hard boards have 3+ optimal lines, which play as "long but mushy"
 * rather than designed. Easy stays ungated - its requireAllPiecesUsed gate
 * already keeps it clean, and gating short boards mostly just costs yield. Full
 * uniqueness (exactly 1) was measured too strict here: it dropped Medium yield
 * ~38% (fall-through to easy + trivial fallback) and made Hard far slower, so
 * "<=2" is the sweet spot. The gate runs the solver's solution-counter, so it is
 * only affordable because this is the off-request pool path. Bounds attempts +
 * solver budget so a run stays quick; tries the tier's shapes shuffled, then easy
 * as a safety net.
 */
export const generateEndlessPuzzle = (tier: EndlessTier): { board: Board; par: number } => {
  const configs = [...shuffle(ENDLESS_TIERS[tier]), ...ENDLESS_TIERS.easy];
  // Easy: no uniqueness gate (protect yield). Medium/Hard: allow at most 2
  // optimal solutions so the board has a real intended line, not a mush of equals.
  const maxOptimalSolutions = tier === 'easy' ? undefined : 2;
  for (const config of configs) {
    const generated = generate({
      width: 5,
      height: 5,
      requireUnique: false,
      rejectInert: true,
      maxStates: 40_000,
      ...config,
      ...(maxOptimalSolutions === undefined ? {} : { maxOptimalSolutions }),
      attempts: 500,
      seed: Math.floor(Math.random() * 0x7fffffff),
    });
    if (generated) return generated;
  }
  return fallbackResult();
};

/**
 * Fast, bounded generation for the REQUEST path when the pool is momentarily
 * empty. Drops every quality gate and uses a small attempt budget + a tight
 * solver cap so it always returns in well under a second (worst case the
 * guaranteed board), trading a little polish for never hanging the player. The
 * pool supplies the nicer puzzles; this only guarantees the request never stalls.
 */
export const generateEndlessFallback = (tier: EndlessTier): { board: Board; par: number } => {
  const configs = [...shuffle(ENDLESS_TIERS[tier]), ...ENDLESS_TIERS.easy];
  for (const config of configs) {
    const generated = generate({
      width: 5,
      height: 5,
      ...config,
      requireUnique: false,
      rejectInert: false,
      requireAllPiecesUsed: false,
      maxStates: 15_000,
      attempts: 150,
      seed: Math.floor(Math.random() * 0x7fffffff),
    });
    if (generated) return generated;
  }
  return fallbackResult();
};

/** Parse a non-negative integer stored in Redis (0 when missing/garbled). */
const readCount = async (key: string): Promise<number> => {
  const stored = await redis.get(key);
  if (!stored) return 0;
  const n = Number.parseInt(stored, 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Record one endless solve for a user: bump both the lifetime total and the
 * per-tier counter, then return the fresh stats (total + per-tier split). The
 * total stays authoritative for the in-game banner; the split drives the
 * tier-select labels.
 */
export const recordEndlessSolve = async (
  user: string,
  tier: EndlessTier
): Promise<{ solved: number; byTier: EndlessTierCounts }> => {
  await Promise.all([
    redis.incrBy(keys.endlessSolved(user), 1),
    redis.incrBy(keys.endlessSolvedTier(user, tier), 1),
  ]);
  return getEndlessStats(user);
};

/** Read a user's lifetime endless solve count (0 if they have none). */
export const getEndlessSolved = async (user: string): Promise<number> =>
  readCount(keys.endlessSolved(user));

/** Read a user's endless stats: the lifetime total plus the per-tier split.
 *  (For pre-existing players the per-tier counts start at 0 and accrue from
 *  here, so they may not sum to the older total - the total stays the headline.) */
export const getEndlessStats = async (
  user: string
): Promise<{ solved: number; byTier: EndlessTierCounts }> => {
  const [solved, easy, medium, hard] = await Promise.all([
    readCount(keys.endlessSolved(user)),
    readCount(keys.endlessSolvedTier(user, 'easy')),
    readCount(keys.endlessSolvedTier(user, 'medium')),
    readCount(keys.endlessSolvedTier(user, 'hard')),
  ]);
  return { solved, byTier: { easy, medium, hard } };
};

// --- Pre-generated pool ---
// Generating a graded puzzle on the fly is the slow part of an endless request.
// To keep requests fast we keep a small pre-generated pool per tier in Redis
// (a hash of id -> JSON) and just pop one per request. The pool is refilled off
// the request path (a scheduler cron + a warm-up on install). On-the-fly
// generation stays as the fallback when a pool is momentarily empty, so endless
// is never broken - the worst case is simply the old (slower) behaviour.

const POOL_TARGET = 12;
const ALL_TIERS: ReadonlyArray<EndlessTier> = ['easy', 'medium', 'hard'];

/**
 * Pop one pre-generated puzzle from a tier's pool, or null when it is empty (the
 * caller then generates one on the fly). A random field is taken so concurrent
 * players rarely get the same board.
 */
export const popPooledPuzzle = async (
  tier: EndlessTier
): Promise<{ board: Board; par: number } | null> => {
  const poolKey = keys.endlessPool(tier);
  const fields = await redis.hKeys(poolKey);
  if (fields.length === 0) return null;
  const field = fields[Math.floor(Math.random() * fields.length)];
  const json = await redis.hGet(poolKey, field);
  await redis.hDel(poolKey, [field]);
  if (!json) return null;
  try {
    const parsed: { board: Board; par: number } = JSON.parse(json);
    if (!parsed || !parsed.board || typeof parsed.par !== 'number') return null;
    return { board: parsed.board, par: parsed.par };
  } catch {
    return null;
  }
};

/**
 * Per-run cap on how many puzzles to add to each tier in one refill call. Hard
 * runs the near-unique solver gate and costs several times as much per puzzle as
 * Easy/Medium, so it makes fewer per run to keep a single cron invocation short;
 * the pool target (POOL_TARGET) is unchanged, Hard just refills over more runs.
 * Each puzzle is persisted as it is generated, so even a run cut short by a
 * platform timeout keeps its progress and the next run simply continues.
 */
const PER_RUN_CAP: Record<EndlessTier, number> = { easy: 4, medium: 3, hard: 2 };

/**
 * Top each tier's pool up toward POOL_TARGET, adding at most PER_RUN_CAP[tier]
 * puzzles per tier in a single call (so one cron run stays bounded). Once a pool
 * is full this generates nothing for it, so the cost is only paid when puzzles
 * have actually been consumed. Returns how many were added.
 */
export const refillEndlessPools = async (): Promise<number> => {
  let added = 0;
  for (const tier of ALL_TIERS) {
    const have = await redis.hLen(keys.endlessPool(tier));
    let need = Math.min(POOL_TARGET - have, PER_RUN_CAP[tier]);
    while (need > 0) {
      const puzzle = generateEndlessPuzzle(tier);
      const id = String(await redis.incrBy(keys.endlessPoolSeq(tier), 1));
      await redis.hSet(keys.endlessPool(tier), { [id]: JSON.stringify(puzzle) });
      need -= 1;
      added += 1;
    }
  }
  return added;
};
