import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const hashFor = (key: string): Map<string, string> => {
    const existing = hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };
  const redis = {
    get: vi.fn(async (key: string) => strings.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return 'OK';
    }),
    expire: vi.fn(async () => undefined),
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hGetAll: vi.fn(async (key: string) => Object.fromEntries(hashes.get(key) ?? [])),
    hSet: vi.fn(async (key: string, values: Record<string, string>) => {
      const hash = hashFor(key);
      for (const [field, value] of Object.entries(values)) hash.set(field, value);
      return Object.keys(values).length;
    }),
    hSetNX: vi.fn(async (key: string, field: string, value: string) => {
      const hash = hashFor(key);
      if (hash.has(field)) return 0;
      hash.set(field, value);
      return 1;
    }),
    hDel: vi.fn(async (key: string, fields: readonly string[]) => {
      let removed = 0;
      for (const field of fields) if (hashes.get(key)?.delete(field)) removed += 1;
      return removed;
    }),
    hIncrBy: vi.fn(async (key: string, field: string, by: number) => {
      const hash = hashFor(key);
      const next = Number(hash.get(field) ?? '0') + by;
      hash.set(field, String(next));
      return next;
    }),
  };
  return {
    redis,
    strings,
    hashes,
    clear: () => {
      strings.clear();
      hashes.clear();
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: redisState.redis }));

// A fixed seed makes the job pick the same board for two dates of one tier
// unless it excludes the first, so repeat checks are actually exercised.
vi.mock('../../../shared/solver/random', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/solver/random')>()),
  randomSeed: () => 42,
}));

import { currentDailyPuzzleRef, dailyPuzzleId } from '../../../shared/daily';
import { addDays, dailyPuzzleDate, todayUtc } from '../../../shared/date';
import { boardFingerprintId } from '../../../shared/game/symmetry';
import { getDailyPuzzle, prepareUpcomingDailies } from '../daily';
import {
  DAILY_PREPARE_POLICY,
  dailyTierForDate,
  generateDesignedDaily,
  isDailyParInBand,
  parsePreparedDaily,
} from '../dailyPolicy';
import { keys } from '../keys';

const preparedHash = (): Map<string, string> =>
  redisState.hashes.get(keys.dailyPrepared()) ?? new Map<string, string>();

const designedEntry = (date: string, seed: number, policy = DAILY_PREPARE_POLICY): string => {
  const designed = generateDesignedDaily(date, { deadlineMs: 15_000, seed });
  if (!designed) throw new Error(`No designed Daily for ${date}`);
  return JSON.stringify({ date, board: designed.board, par: designed.par, policy });
};

beforeEach(() => {
  redisState.clear();
  vi.clearAllMocks();
});

describe('week-ahead Daily job', () => {
  it('prepares the next seven Dailies once, each in its band and all different', async () => {
    const now = new Date();
    const today = dailyPuzzleDate(now);
    await expect(prepareUpcomingDailies(60_000, now)).resolves.toEqual({
      prepared: 7,
      ready: 7,
      upcoming: 7,
    });
    const entries = preparedHash();
    const dates = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1));
    expect([...entries.keys()].sort()).toEqual(dates);
    const ids = new Set<string>();
    for (const date of dates) {
      const entry = parsePreparedDaily(entries.get(date), date);
      expect(entry).not.toBeNull();
      if (!entry) continue;
      expect(isDailyParInBand(dailyTierForDate(date), entry.par)).toBe(true);
      ids.add(boardFingerprintId(entry.board));
    }
    expect(ids.size).toBe(7);

    const before = new Map(entries);
    await expect(prepareUpcomingDailies(60_000, now)).resolves.toEqual({
      prepared: 0,
      ready: 7,
      upcoming: 7,
    });
    expect(preparedHash()).toEqual(before);
  }, 120_000);

  it('skips dates that already have a puzzle and replaces stale or outdated entries', async () => {
    const now = new Date();
    const today = dailyPuzzleDate(now);
    const created = addDays(today, 1);
    const outdated = addDays(today, 2);
    const stale = addDays(today, -1);
    await redisState.redis.hSetNX(
      keys.dailyPuzzleCreations(),
      dailyPuzzleId(currentDailyPuzzleRef(created)),
      '{}'
    );
    await redisState.redis.hSet(keys.dailyPrepared(), {
      [stale]: designedEntry(stale, 1),
      [outdated]: designedEntry(outdated, 2, DAILY_PREPARE_POLICY - 1),
    });

    await expect(prepareUpcomingDailies(60_000, now)).resolves.toEqual({
      prepared: 6,
      ready: 7,
      upcoming: 7,
    });
    const entries = preparedHash();
    expect(entries.has(stale)).toBe(false);
    expect(entries.has(created)).toBe(false);
    expect(parsePreparedDaily(entries.get(outdated), outdated)).not.toBeNull();
  }, 120_000);

  it('does not repeat a Daily published in the last two months', async () => {
    const now = new Date();
    const today = dailyPuzzleDate(now);
    const first = addDays(today, 1);
    // What the job would make for its first date with no history.
    const expected = generateDesignedDaily(first, { deadlineMs: 15_000, seed: 42 });
    expect(expected).not.toBeNull();
    if (!expected) return;
    // The same puzzle went out three weeks ago.
    const published = addDays(today, -21);
    const ref = currentDailyPuzzleRef(published);
    await redisState.redis.hSetNX(keys.dailyPuzzleIdentities(), published, dailyPuzzleId(ref));
    await redisState.redis.set(
      keys.dailyPuzzle(ref),
      JSON.stringify({ date: published, board: expected.board, par: expected.par })
    );

    await prepareUpcomingDailies(60_000, now);
    const entry = parsePreparedDaily(preparedHash().get(first), first);
    expect(entry).not.toBeNull();
    expect(entry && boardFingerprintId(entry.board)).not.toBe(boardFingerprintId(expected.board));
  }, 120_000);

  it('makes nothing when a run has no time left', async () => {
    await expect(prepareUpcomingDailies(0, new Date())).resolves.toEqual({
      prepared: 0,
      ready: 0,
      upcoming: 7,
    });
  });
});

describe('creating a Daily from its prepared puzzle', () => {
  it("uses today's prepared puzzle, then removes the entry", async () => {
    const today = dailyPuzzleDate();
    const raw = designedEntry(today, 3);
    const entry = parsePreparedDaily(raw, today);
    expect(entry).not.toBeNull();
    await redisState.redis.hSet(keys.dailyPrepared(), { [today]: raw });

    const puzzle = await getDailyPuzzle(currentDailyPuzzleRef(today));
    expect(puzzle.board).toEqual(entry?.board);
    expect(puzzle.par).toBe(entry?.par);
    expect(preparedHash().has(today)).toBe(false);
    const counters = redisState.hashes.get(keys.telemetryDay(todayUtc()));
    expect(counters?.get('daily:generated:pass:prepared')).toBe('1');
  }, 60_000);

  it('refuses to create an upcoming Daily early and leaves its prepared puzzle alone', async () => {
    const upcoming = addDays(dailyPuzzleDate(), 2);
    const raw = designedEntry(upcoming, 4);
    await redisState.redis.hSet(keys.dailyPrepared(), { [upcoming]: raw });

    await expect(getDailyPuzzle(currentDailyPuzzleRef(upcoming))).rejects.toThrow('not out yet');
    expect(preparedHash().get(upcoming)).toBe(raw);
    const field = dailyPuzzleId(currentDailyPuzzleRef(upcoming));
    expect(redisState.hashes.get(keys.dailyPuzzleCreations())?.has(field) ?? false).toBe(false);
  }, 60_000);
});
