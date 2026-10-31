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
import { addDays, dailyPuzzleDate } from '../../shared/date';
import { boardFingerprintId } from '../../shared/game/symmetry';
import { randomSeed } from '../../shared/solver/random';
import {
  DAILY_PREPARE_POLICY,
  dailyTierForDate,
  generateDailyOnDemand,
  generateDesignedDaily,
  parsePreparedDaily,
  upcomingDailyDates,
  type DailyPass,
  type PreparedDaily,
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

  // A date's puzzle is created only once its day has arrived, so no request
  // can make (or reveal) an upcoming Daily early.
  if (ref.date > latestOpenDailyDate()) {
    throw new Error('This daily puzzle is not out yet.');
  }
  // The week-ahead job normally has this date ready; generate on the request
  // path only when it does not.
  const prepared = await readPreparedDaily(ref.date);
  const generated: { board: Board; par: number; pass: DailyPass } = prepared
    ? { board: prepared.board, par: prepared.par, pass: 'prepared' }
    : generateDailyOnDemand(ref.date);
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
  // Whichever request won, this date now has its permanent puzzle.
  if (prepared) await redis.hDel(keys.dailyPrepared(), [ref.date]);

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
 * Lead time that still counts as "the date has arrived": the 12:00 UTC post
 * job may be delivered a few minutes early (see the daily-puzzle scheduler).
 */
const DAILY_EARLY_MS = 5 * 60_000;

/** The newest puzzle date that may be created (and so shown) right now. */
const latestOpenDailyDate = (): string =>
  dailyPuzzleDate(new Date(Date.now() + DAILY_EARLY_MS));

/** The week-ahead job's puzzle for `date`, if a valid one is waiting. */
const readPreparedDaily = async (date: string): Promise<PreparedDaily | null> => {
  try {
    return parsePreparedDaily(await redis.hGet(keys.dailyPrepared(), date), date);
  } catch (error) {
    console.error(`Prepared daily read failed for ${date}: ${error}`);
    return null;
  }
};

/** How far back published Dailies count as "recent" when avoiding repeats. */
const RECENT_DAILY_DAYS = 60;

/** Fingerprint ids of the published Dailies from the last RECENT_DAILY_DAYS days. */
const recentDailyFingerprints = async (today: string): Promise<string[]> => {
  const dates = Array.from({ length: RECENT_DAILY_DAYS }, (_, index) => addDays(today, -index));
  const boards = await Promise.all(
    dates.map(async (date) => {
      const ref = await findCanonicalDailyRef(date);
      return ref ? (await findDailyPuzzle(ref))?.board : undefined;
    })
  );
  return boards.flatMap((board) => (board ? [boardFingerprintId(board)] : []));
};

/** Default work per week-ahead job run; Devvit allows 30s per request. */
const PREPARE_BUDGET_MS = 15_000;

export type PrepareResult = {
  /** Puzzles made in this run. */
  readonly prepared: number;
  /** Upcoming dates that have a puzzle ready after this run. */
  readonly ready: number;
  readonly upcoming: number;
};

/**
 * Keep the next DAILY_PREPARE_DAYS Dailies ready, earliest first, using the
 * strict rules with plenty of time instead of a few seconds on the request
 * path. Each puzzle is saved as soon as it is made, so a run cut short keeps
 * its progress and the next run continues. A prepared puzzle never repeats
 * another prepared one or a Daily from the last RECENT_DAILY_DAYS days,
 * counting mirrored and rotated copies.
 */
export const prepareUpcomingDailies = async (
  budgetMs: number = PREPARE_BUDGET_MS,
  now: Date = new Date()
): Promise<PrepareResult> => {
  const deadline = Date.now() + budgetMs;
  const today = dailyPuzzleDate(now);
  const upcoming = upcomingDailyDates(today);
  const preparedKey = keys.dailyPrepared();
  const stored = await redis.hGetAll(preparedKey);

  const ready = new Map<string, PreparedDaily>();
  const discard: string[] = [];
  for (const [date, raw] of Object.entries(stored)) {
    // Today's entry stays until today's puzzle is created and consumes it.
    if (date < today) {
      discard.push(date);
      continue;
    }
    const parsed = parsePreparedDaily(raw, date);
    if (parsed) ready.set(date, parsed);
    else discard.push(date);
  }
  if (discard.length > 0) await redis.hDel(preparedKey, discard);

  const missing: string[] = [];
  const created = new Set<string>();
  for (const date of upcoming) {
    if (ready.has(date)) continue;
    // A date that already has its permanent puzzle needs nothing prepared.
    const record = await redis.hGet(
      keys.dailyPuzzleCreations(),
      dailyPuzzleId(currentDailyPuzzleRef(date))
    );
    if (record) created.add(date);
    else missing.push(date);
  }
  let prepared = 0;
  if (missing.length > 0) {
    const exclude = new Set<string>([
      ...(await recentDailyFingerprints(today)),
      ...[...ready.values()].map((entry) => boardFingerprintId(entry.board)),
    ]);
    for (const date of missing) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const generated = generateDesignedDaily(date, {
        deadlineMs: remaining,
        exclude,
        seed: randomSeed(),
      });
      if (!generated) break;
      const entry: PreparedDaily = {
        date,
        board: generated.board,
        par: generated.par,
        policy: DAILY_PREPARE_POLICY,
      };
      if (await redis.hSetNX(preparedKey, date, JSON.stringify(entry))) {
        prepared += 1;
        ready.set(date, entry);
        exclude.add(boardFingerprintId(entry.board));
      }
    }
  }
  return {
    prepared,
    ready: upcoming.filter((date) => ready.has(date) || created.has(date)).length,
    upcoming: upcoming.length,
  };
};

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
