import { redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import type { EndlessTier, EndlessTierCounts } from '../../shared/api';
import { validateBoardStructure } from '../../shared/game/validation';
import { generateEndlessPoolPuzzle, isEndlessParInBand } from './endlessPolicy';
import { keys } from './keys';

/**
 * Endless mode: the "play more" loop after the daily. The player picks a tier
 * (Easy / Medium / Hard) and we hand back a freshly generated, solver-verified
 * puzzle from that bucket. Unlike the daily (deterministic per date), every
 * endless request is randomly seeded so the puzzles shuffle and never repeat in
 * a predictable order. A lifetime "solved" counter per user drives the
 * progression banner.
 */

// Tier shapes, par bands, static fallbacks, and the pool/request generators
// live in the pure endlessPolicy module so they stay unit-testable.
export { generateEndlessFallback } from './endlessPolicy';

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

/** Parse a non-negative integer stored in Redis (0 when missing/garbled). */
const readCount = async (key: string): Promise<number> => {
  const stored = await redis.get(key);
  if (!stored) return 0;
  const n = Number.parseInt(stored, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

type EndlessBaseline = {
  readonly solved: number;
  readonly byTier: EndlessTierCounts;
};

const baselineProperty = (value: object, key: string): unknown => Reflect.get(value, key);
const isBaselineObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;
const readBaselineCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const parseEndlessBaseline = (raw: string | undefined): EndlessBaseline | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isBaselineObject(value)) return null;
    const byTierValue = baselineProperty(value, 'byTier');
    if (!isBaselineObject(byTierValue)) return null;
    const solved = readBaselineCount(baselineProperty(value, 'solved'));
    const easy = readBaselineCount(baselineProperty(byTierValue, 'easy'));
    const medium = readBaselineCount(baselineProperty(byTierValue, 'medium'));
    const hard = readBaselineCount(baselineProperty(byTierValue, 'hard'));
    if (solved === null || easy === null || medium === null || hard === null) return null;
    return { solved, byTier: { easy, medium, hard } };
  } catch {
    return null;
  }
};

const ledgerEntryIsAtPar = (raw: string): boolean => {
  try {
    const value: unknown = JSON.parse(raw);
    return isBaselineObject(value) && baselineProperty(value, 'atPar') === true;
  } catch {
    return false;
  }
};

/**
 * Read atomic Hard-at-par metadata, repairing the short-lived rollout state in
 * which the permanent ledger committed before the old standalone flag write.
 * A checked ledger cardinality avoids rescanning unchanged negative histories.
 */
export const getEndlessHardAtPar = async (user: string): Promise<boolean> => {
  if (user === 'anon') return false;
  const metaKey = keys.endlessLedgerMeta(user);
  const hardLedgerKey = keys.endlessLedger(user, 'hard');
  const [rawState, rawCheckedCount, legacyFlag, hardCount] = await Promise.all([
    redis.hGet(metaKey, 'hardAtPar'),
    redis.hGet(metaKey, 'hardAtParCheckedCount'),
    redis.get(keys.endlessHardAtPar(user)),
    redis.hLen(hardLedgerKey),
  ]);
  if (rawState === '1' || legacyFlag === '1') {
    if (rawState !== '1') await redis.hSet(metaKey, { hardAtPar: '1' });
    return true;
  }

  const checkedCount = rawCheckedCount ? Number.parseInt(rawCheckedCount, 10) : -1;
  if (rawState === '0' && checkedCount === hardCount) return false;

  const entries = await redis.hGetAll(hardLedgerKey);
  const hardAtPar = Object.values(entries).some(ledgerEntryIsAtPar);
  await redis.hSet(metaKey, {
    hardAtPar: hardAtPar ? '1' : '0',
    hardAtParCheckedCount: String(hardCount),
  });
  return hardAtPar;
};

/**
 * Atomically capture the old counter values once. All new completions live in
 * append-only per-tier ledgers, so retries can derive and repair exact totals.
 */
const getEndlessBaseline = async (user: string): Promise<EndlessBaseline> => {
  const metaKey = keys.endlessLedgerMeta(user);
  const existing = parseEndlessBaseline(await redis.hGet(metaKey, 'baseline'));
  if (existing) return existing;

  const [solved, easy, medium, hard] = await Promise.all([
    readCount(keys.endlessSolved(user)),
    readCount(keys.endlessSolvedTier(user, 'easy')),
    readCount(keys.endlessSolvedTier(user, 'medium')),
    readCount(keys.endlessSolvedTier(user, 'hard')),
  ]);
  const candidate: EndlessBaseline = { solved, byTier: { easy, medium, hard } };
  const raw = JSON.stringify(candidate);
  const added = Boolean(await redis.hSetNX(metaKey, 'baseline', raw));
  if (added) return candidate;
  const winner = parseEndlessBaseline(await redis.hGet(metaKey, 'baseline'));
  if (!winner) throw new Error('Endless progression baseline is invalid.');
  return winner;
};

/** Read a user's lifetime endless solve count (0 for guests or missing data). */
export const getEndlessSolved = async (user: string): Promise<number> =>
  (await getEndlessStats(user)).solved;

/** Read baseline + authoritative ledgers without touching shared guest Redis keys. */
export const getEndlessStats = async (
  user: string
): Promise<{ solved: number; byTier: EndlessTierCounts }> => {
  if (user === 'anon') return { solved: 0, byTier: { easy: 0, medium: 0, hard: 0 } };

  const [baseline, easyAdded, mediumAdded, hardAdded] = await Promise.all([
    getEndlessBaseline(user),
    redis.hLen(keys.endlessLedger(user, 'easy')),
    redis.hLen(keys.endlessLedger(user, 'medium')),
    redis.hLen(keys.endlessLedger(user, 'hard')),
  ]);
  const byTier = {
    easy: baseline.byTier.easy + easyAdded,
    medium: baseline.byTier.medium + mediumAdded,
    hard: baseline.byTier.hard + hardAdded,
  };
  return {
    solved: baseline.solved + easyAdded + mediumAdded + hardAdded,
    byTier,
  };
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
    const pooled = parsePooledPuzzle(json);
    // Stale, malformed, or out-of-band entries are dropped, never served.
    if (pooled && isEndlessParInBand(tier, pooled.par)) return pooled;
  }
  return null;
};

/** Parse one stored pool entry; Redis contents are untrusted at this boundary. */
const parsePooledPuzzle = (json: string): { board: Board; par: number } | null => {
  try {
    const value: unknown = JSON.parse(json);
    if (!isBaselineObject(value)) return null;
    const par = baselineProperty(value, 'par');
    const structure = validateBoardStructure(baselineProperty(value, 'board'));
    if (typeof par !== 'number' || !Number.isSafeInteger(par) || !structure.ok) return null;
    return { board: structure.board, par };
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

/** Default wall-clock budget for one refill run (the cron fires every 5 min). */
const REFILL_BUDGET_MS = 20_000;

/**
 * Top each tier's pool up toward POOL_TARGET, adding at most PER_RUN_CAP[tier]
 * puzzles per tier in a single call. Generation stops once `budgetMs` is spent
 * (a single Hard puzzle measured up to ~18s), so one run stays bounded and the
 * next run continues where this one stopped. Once a pool is full this generates
 * nothing for it. Returns how many were added.
 */
export const refillEndlessPools = async (budgetMs: number = REFILL_BUDGET_MS): Promise<number> => {
  const deadline = Date.now() + budgetMs;
  let added = 0;
  for (const tier of ALL_TIERS) {
    const have = await redis.hLen(keys.endlessPool(tier));
    let need = Math.min(POOL_TARGET - have, PER_RUN_CAP[tier]);
    while (need > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return added;
      const puzzle = generateEndlessPoolPuzzle(tier, remaining);
      if (!puzzle) return added;
      const id = String(await redis.incrBy(keys.endlessPoolSeq(tier), 1));
      await redis.hSet(keys.endlessPool(tier), { [id]: JSON.stringify(puzzle) });
      need -= 1;
      added += 1;
    }
  }
  return added;
};
