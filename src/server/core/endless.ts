import { redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import type { EndlessTier } from '../../shared/api';
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
// variety. Difficulty is defined by par range + piece counts, the same levers
// the daily uses. Easy teaches with trap-free boards (requireAllPiecesUsed);
// Medium and Hard keep uniqueness + no-clutter but allow decoy misdirection.
// Hard is brutal-but-fair: always solvable, never literally impossible.
const ENDLESS_TIERS: Record<EndlessTier, ReadonlyArray<GenConfig>> = {
  easy: [
    { hoppers: 1, sliders: 1, blockers: 1, minPar: 2, maxPar: 4, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 0, blockers: 1, minPar: 2, maxPar: 5, requireAllPiecesUsed: true },
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 3, maxPar: 5, requireAllPiecesUsed: true },
  ],
  medium: [
    { hoppers: 2, sliders: 1, blockers: 2, minPar: 5, maxPar: 8 },
    { hoppers: 3, sliders: 1, blockers: 1, minPar: 5, maxPar: 8 },
    { hoppers: 2, sliders: 2, blockers: 1, minPar: 4, maxPar: 8 },
  ],
  hard: [
    { hoppers: 3, sliders: 2, blockers: 2, minPar: 7, maxPar: 12 },
    { hoppers: 3, sliders: 1, blockers: 2, minPar: 7, maxPar: 11 },
    { hoppers: 2, sliders: 2, blockers: 2, minPar: 6, maxPar: 11 },
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

/**
 * Generate a fresh puzzle for the requested tier. Tries the tier's shapes in a
 * random order, then falls back to the easy tier, then to a guaranteed board,
 * so this never returns null.
 */
export const generateEndlessPuzzle = (tier: EndlessTier): { board: Board; par: number } => {
  // The chosen tier first (shuffled for variety), then easy shapes as a safety
  // net so a request always resolves to a real, solver-verified board.
  const configs = [...shuffle(ENDLESS_TIERS[tier]), ...ENDLESS_TIERS.easy];
  for (const config of configs) {
    const generated = generate({
      width: 5,
      height: 5,
      attempts: 3000,
      seed: Math.floor(Math.random() * 0x7fffffff),
      requireUnique: true,
      rejectInert: true,
      ...config,
    });
    if (generated) return generated;
  }
  return { board: FALLBACK_BOARD, par: solve(FALLBACK_BOARD).par };
};

/** Record one endless solve for a user and return their new lifetime total. */
export const recordEndlessSolve = async (user: string): Promise<number> => {
  return await redis.incrBy(keys.endlessSolved(user), 1);
};

/** Read a user's lifetime endless solve count (0 if they have none). */
export const getEndlessSolved = async (user: string): Promise<number> => {
  const stored = await redis.get(keys.endlessSolved(user));
  if (!stored) return 0;
  const n = Number.parseInt(stored, 10);
  return Number.isFinite(n) ? n : 0;
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
 * Top each tier's pool up toward POOL_TARGET, generating at most `maxGenerate`
 * puzzles across all tiers in a single call (so one cron run is bounded). Once a
 * pool is full this generates nothing, so the cost is only paid when puzzles
 * have actually been consumed. Returns how many were added.
 */
export const refillEndlessPools = async (maxGenerate = 12): Promise<number> => {
  let budget = maxGenerate;
  let added = 0;
  for (const tier of ALL_TIERS) {
    if (budget <= 0) break;
    const have = await redis.hLen(keys.endlessPool(tier));
    let need = Math.min(POOL_TARGET - have, budget);
    while (need > 0) {
      const puzzle = generateEndlessPuzzle(tier);
      const id = String(await redis.incrBy(keys.endlessPoolSeq(tier), 1));
      await redis.hSet(keys.endlessPool(tier), { [id]: JSON.stringify(puzzle) });
      need -= 1;
      budget -= 1;
      added += 1;
    }
  }
  return added;
};
