import { redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import type { EndlessTier, EndlessTierCounts } from '../../shared/api';
import { generate } from '../../shared/solver/generator';
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

// Always-solvable, IN-BAND last-resort board for each tier so an endless
// request can never come back empty AND never leaks a trivially easy puzzle into
// Medium/Hard. These are solver-generated boards whose par sits inside the
// tier's band (easy 2, medium 6, hard 9). They are only reached if the generator
// fails to find a board within its budget (effectively never); the previous code
// shared a single par-1 board here, which - together with the easy-config
// fall-through below - is what let par 1-4 puzzles appear on Medium/Hard.
const TIER_FALLBACK: Record<EndlessTier, { board: Board; par: number }> = {
  easy: {
    par: 2,
    board: {
      width: 5,
      height: 5,
      holes: [9, 14],
      pieces: [
        { kind: 'BLOCKER', cells: [18] },
        { kind: 'HOPPER', cells: [24] },
        { kind: 'HOPPER', cells: [19] },
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

const fallbackResult = (tier: EndlessTier): { board: Board; par: number } => TIER_FALLBACK[tier];

/**
 * Each tier's par band, derived from its configs (single source of truth). Used
 * to reject any board - freshly generated OR popped from the pool - whose par
 * sits outside the tier, so a tier label always means what it says.
 */
const TIER_PAR: Record<EndlessTier, { min: number; max: number }> = {
  easy: parBandOf('easy'),
  medium: parBandOf('medium'),
  hard: parBandOf('hard'),
};

function parBandOf(tier: EndlessTier): { min: number; max: number } {
  const configs = ENDLESS_TIERS[tier];
  return {
    min: Math.min(...configs.map((c) => c.minPar)),
    max: Math.max(...configs.map((c) => c.maxPar)),
  };
}

const inBand = (tier: EndlessTier, par: number): boolean =>
  par >= TIER_PAR[tier].min && par <= TIER_PAR[tier].max;

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
 * solver budget so a run stays quick; tries only the tier's OWN shapes (shuffled)
 * and, if the gated pass is unlucky within budget, salvages an in-band board via
 * the fast generator for the same tier - it never drops to an easier tier.
 */
export const generateEndlessPuzzle = (tier: EndlessTier): { board: Board; par: number } => {
  // Only ever use the requested tier's own shapes - NEVER fall through to an
  // easier tier's shapes, which is what leaked par 2-4 boards into Medium/Hard.
  // `generate` guarantees the returned par is inside the config's [minPar,maxPar],
  // so every board produced here is in-band for the tier.
  const configs = shuffle(ENDLESS_TIERS[tier]);
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
  // The gated pass was unlucky within budget. Keep the pool IN-BAND (correct
  // difficulty) by dropping to the fast, gate-off generator for the SAME tier
  // rather than to easy shapes - a slightly less "designed" board of the right
  // difficulty beats a trivial one under the wrong label.
  return generateEndlessFallback(tier);
};

/**
 * Fast, bounded generation for the REQUEST path when the pool is momentarily
 * empty. Drops every quality gate and uses a small attempt budget + a tight
 * solver cap so it always returns in well under a second (worst case the
 * guaranteed board), trading a little polish for never hanging the player. The
 * pool supplies the nicer puzzles; this only guarantees the request never stalls.
 */
export const generateEndlessFallback = (tier: EndlessTier): { board: Board; par: number } => {
  // Same rule as the pool: the tier's own shapes only, so a momentarily empty
  // pool can never serve an easier tier's puzzle. Gates off + a small budget so
  // it returns fast; `generate` still enforces the tier's par band on every hit.
  const configs = shuffle(ENDLESS_TIERS[tier]);
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
  // Guaranteed IN-BAND board for this tier (see TIER_FALLBACK). Reached only if
  // ~450 random attempts all missed the band - effectively never - and even then
  // the player still gets a puzzle of the RIGHT difficulty for their tier.
  return fallbackResult(tier);
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
 * caller then generates one on the fly). Fields are tried in random order so
 * concurrent players rarely get the same board. Any entry whose par falls
 * outside the tier band - e.g. a stale board left by an older build before the
 * band was enforced - is dropped (deleted) and skipped, so the pool self-heals
 * and never serves a too-easy puzzle under a Medium/Hard label.
 */
export const popPooledPuzzle = async (
  tier: EndlessTier
): Promise<{ board: Board; par: number } | null> => {
  const poolKey = keys.endlessPool(tier);
  const fields = await redis.hKeys(poolKey);
  if (fields.length === 0) return null;
  // Bounded scan: in the healthy steady state the first random field is valid
  // and returned (deleting just it, as before); the extra tries only matter
  // while draining contaminated entries left by an older build.
  for (const field of shuffle(fields).slice(0, 8)) {
    const json = await redis.hGet(poolKey, field);
    await redis.hDel(poolKey, [field]);
    if (!json) continue;
    try {
      const parsed: { board: Board; par: number } = JSON.parse(json);
      if (!parsed || !parsed.board || typeof parsed.par !== 'number') continue;
      if (!inBand(tier, parsed.par)) continue; // stale/out-of-band -> drop it
      return { board: parsed.board, par: parsed.par };
    } catch {
      continue;
    }
  }
  return null;
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
