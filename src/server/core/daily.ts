import { redis } from '@devvit/web/server';
import {
  CURRENT_DAILY_SCHEMA,
  LEGACY_DAILY_SCHEMA,
  currentDailyPuzzleRef,
  dailyPuzzleId,
  parseDailyPuzzleId,
  type DailyPuzzleRef,
} from '../../shared/daily';
import type { Board } from '../../shared/game/types';
import { validateBoardStructure } from '../../shared/game/validation';
import { generate, type GenOptions } from '../../shared/solver/generator';
import { seedFromDate } from '../../shared/date';
import {
  DAILY_FALLBACKS,
  DAILY_LADDERS,
  dailyTierForDate,
  type DailyGenConfig,
} from './dailyPolicy';
import { keys } from './keys';
import { trackTelemetry } from './telemetry';

export type DailyPuzzle = {
  readonly id: string;
  readonly ref: DailyPuzzleRef;
  readonly date: string;
  readonly board: Board;
  readonly par: number;
};

type StoredDailyPuzzle = {
  readonly date: string;
  readonly board: Board;
  readonly par: number;
};

type GeneratedDaily = {
  readonly board: Board;
  readonly par: number;
  readonly pass: 'designed' | 'relaxed' | 'fast' | 'fallback';
};

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const parseStoredDaily = (raw: string, ref: DailyPuzzleRef): DailyPuzzle | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const date = property(value, 'date');
    const par = property(value, 'par');
    const structure = validateBoardStructure(property(value, 'board'));
    if (
      date !== ref.date ||
      typeof par !== 'number' ||
      !Number.isSafeInteger(par) ||
      par < 1 ||
      !structure.ok
    ) {
      return null;
    }
    return {
      id: dailyPuzzleId(ref),
      ref,
      date,
      board: structure.board,
      par,
    };
  } catch {
    return null;
  }
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

/**
 * Generate a daily through a bounded quality cascade. Every pass uses only the
 * selected weekday tier's shapes and par band:
 *   1. designed: unique optimal line and no inert clutter;
 *   2. relaxed: no inert clutter without the expensive uniqueness proof;
 *   3. fast: quality gates off, but still inside the same par band;
 *   4. fallback: a known solver-verified board in that exact band.
 *
 * This preserves the request-safe deadline without ever relabeling an Easy
 * board as Medium/Hard or reducing the par floor below four.
 */
const generateDaily = (date: string): GeneratedDaily => {
  const seed = seedFromDate(date);
  const tier = dailyTierForDate(date);
  const configs = DAILY_LADDERS[tier];

  const designed = runPass(configs, seed, 2500, {
    requireUnique: true,
    rejectInert: true,
    attempts: 3000,
    maxStates: 30_000,
  });
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

  const fallback = DAILY_FALLBACKS[tier];
  return { ...fallback, pass: 'fallback' };
};

/**
 * Resolve one canonical puzzle identity for a UTC date across schema rollouts.
 * A materialized legacy board wins the first migration claim so an already
 * published post and every in-app "today" entry point stay in one competition.
 */
export const getCanonicalDailyRef = async (date: string): Promise<DailyPuzzleRef> => {
  const identityKey = keys.dailyPuzzleIdentities();
  const existingRaw = await redis.hGet(identityKey, date);
  if (existingRaw) {
    const existing = parseDailyPuzzleId(existingRaw);
    if (!existing || existing.date !== date) {
      throw new Error(`Canonical daily identity for ${date} is invalid.`);
    }
    return existing;
  }

  const legacyRef: DailyPuzzleRef = { schema: LEGACY_DAILY_SCHEMA, date };
  const legacyBoard = await redis.get(keys.dailyPuzzle(legacyRef));
  const candidate = legacyBoard ? legacyRef : currentDailyPuzzleRef(date);
  const candidateId = dailyPuzzleId(candidate);
  const added = Boolean(await redis.hSetNX(identityKey, date, candidateId));
  if (added) return candidate;

  const winnerRaw = await redis.hGet(identityKey, date);
  const winner = parseDailyPuzzleId(winnerRaw);
  if (!winner || winner.date !== date) {
    throw new Error(`Canonical daily identity for ${date} was not saved.`);
  }
  return winner;
};

/**
 * Load an immutable daily puzzle. Schema 5 is read-only: if its historical
 * cache is missing, failing closed is safer than showing an old post a newly
 * generated board under old solve and leaderboard records.
 */
export const getDailyPuzzle = async (ref: DailyPuzzleRef): Promise<DailyPuzzle> => {
  const storageKey = keys.dailyPuzzle(ref);
  const stored = await redis.get(storageKey);
  if (stored) {
    const parsed = parseStoredDaily(stored, ref);
    if (!parsed) throw new Error(`Stored daily puzzle ${dailyPuzzleId(ref)} is invalid.`);
    return parsed;
  }

  if (ref.schema !== CURRENT_DAILY_SCHEMA) {
    throw new Error('This archived daily puzzle is no longer available.');
  }

  // The creation hash is the atomic winner when concurrent cold requests both
  // generate a candidate. It also repairs the materialized daily:<schema>:<date>
  // key if a prior request failed between the claim and the SET.
  const creationKey = keys.dailyPuzzleCreations();
  const field = dailyPuzzleId(ref);
  const claimedRaw = await redis.hGet(creationKey, field);
  if (claimedRaw) {
    const claimedPuzzle = parseStoredDaily(claimedRaw, ref);
    if (!claimedPuzzle) throw new Error(`Daily creation record ${field} is invalid.`);
    await redis.set(storageKey, claimedRaw);
    return claimedPuzzle;
  }

  const generated = generateDaily(ref.date);
  const storedPuzzle: StoredDailyPuzzle = {
    date: ref.date,
    board: generated.board,
    par: generated.par,
  };
  const candidateRaw = JSON.stringify(storedPuzzle);
  const wonCreation = Boolean(
    await redis.hSetNX(creationKey, field, candidateRaw)
  );
  const winnerRaw = wonCreation
    ? candidateRaw
    : await redis.hGet(creationKey, field);
  if (!winnerRaw) throw new Error(`Daily creation record ${field} was not saved.`);

  const winner = parseStoredDaily(winnerRaw, ref);
  if (!winner) throw new Error(`Daily creation record ${field} is invalid.`);
  await redis.set(storageKey, winnerRaw);

  if (wonCreation) {
    const tier = dailyTierForDate(ref.date);
    await Promise.all([
      trackTelemetry(`daily:generated:tier:${tier}`),
      trackTelemetry(`daily:generated:pass:${generated.pass}`),
      trackTelemetry(`daily:generated:par:${generated.par}`),
    ]);
  }
  return winner;
};

/** Return the canonical published puzzle for a calendar date, creating it if needed. */
export const getOrCreateDailyPuzzle = async (date: string): Promise<DailyPuzzle> =>
  getDailyPuzzle(await getCanonicalDailyRef(date));

/**
 * Read-only canonical identity for a date. Unlike getCanonicalDailyRef it never
 * claims an identity, so reads such as "yesterday's leaderboard" cannot start a
 * competition for a date that never had a puzzle.
 */
export const findCanonicalDailyRef = async (date: string): Promise<DailyPuzzleRef | null> => {
  const raw = await redis.hGet(keys.dailyPuzzleIdentities(), date);
  const ref = raw ? parseDailyPuzzleId(raw) : null;
  return ref && ref.date === date ? ref : null;
};

/**
 * Read-only lookup of an already materialized Daily puzzle. Unlike
 * getDailyPuzzle it never generates or claims a board, so request-supplied
 * puzzle ids (leaderboard reads) cannot trigger generation work.
 */
export const findDailyPuzzle = async (ref: DailyPuzzleRef): Promise<DailyPuzzle | null> => {
  const stored = await redis.get(keys.dailyPuzzle(ref));
  if (stored) return parseStoredDaily(stored, ref);
  const claimed = await redis.hGet(keys.dailyPuzzleCreations(), dailyPuzzleId(ref));
  return claimed ? parseStoredDaily(claimed, ref) : null;
};
