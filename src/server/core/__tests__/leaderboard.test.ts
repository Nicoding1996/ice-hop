import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  type SortedSetEntry = { readonly member: string; readonly score: number };
  type QueuedOperation = () => unknown;
  type PausedExec = {
    readonly key: string;
    readonly wait: Promise<void>;
    readonly reached: () => void;
  };

  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const sortedSets = new Map<string, Map<string, number>>();
  const versions = new Map<string, number>();
  let failedZAddKey: string | undefined;
  let failedHSetNxKey: string | undefined;
  let pausedExec: PausedExec | undefined;

  const bump = (key: string): void => {
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };

  const hashFor = (key: string): Map<string, string> => {
    const existing = hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };

  const sortedSetFor = (key: string): Map<string, number> => {
    const existing = sortedSets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    sortedSets.set(key, created);
    return created;
  };

  const rankedRows = (key: string): SortedSetEntry[] =>
    [...(sortedSets.get(key)?.entries() ?? [])]
      .map(([member, score]) => ({ member, score }))
      .sort((left, right) => left.score - right.score || left.member.localeCompare(right.member));

  const setValue = (key: string, value: string): string => {
    strings.set(key, value);
    bump(key);
    return 'OK';
  };

  const addSorted = (key: string, entry: SortedSetEntry): number => {
    const set = sortedSetFor(key);
    const previous = set.get(entry.member);
    const added = previous === undefined ? 1 : 0;
    if (previous !== entry.score) {
      set.set(entry.member, entry.score);
      bump(key);
    }
    return added;
  };

  const removeSorted = (key: string, members: readonly string[]): number => {
    const set = sortedSets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    if (removed > 0) bump(key);
    return removed;
  };

  const createTransaction = (watchedKeys: readonly string[]) => {
    const watchedVersions = watchedKeys.map((key) => versions.get(key) ?? 0);
    const operations: QueuedOperation[] = [];
    return {
      multi: vi.fn(async () => undefined),
      set: vi.fn(async (key: string, value: string) => {
        operations.push(() => setValue(key, value));
      }),
      zAdd: vi.fn(async (key: string, entry: SortedSetEntry) => {
        operations.push(() => addSorted(key, entry));
      }),
      zRem: vi.fn(async (key: string, members: readonly string[]) => {
        operations.push(() => removeSorted(key, members));
      }),
      unwatch: vi.fn(async () => undefined),
      discard: vi.fn(async () => {
        operations.length = 0;
      }),
      exec: vi.fn(async () => {
        const pause = pausedExec;
        if (pause && watchedKeys.includes(pause.key)) {
          pausedExec = undefined;
          pause.reached();
          await pause.wait;
        }
        const changed = watchedKeys.some(
          (key, index) => (versions.get(key) ?? 0) !== watchedVersions[index]
        );
        if (changed) return [];
        return operations.map((operation) => operation());
      }),
    };
  };

  const redis = {
    get: vi.fn(async (key: string) => strings.get(key)),
    set: vi.fn(async (key: string, value: string) => setValue(key, value)),
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hKeys: vi.fn(async (key: string) => [...(hashes.get(key)?.keys() ?? [])]),
    hSetNX: vi.fn(async (key: string, field: string, value: string) => {
      if (failedHSetNxKey === key) {
        failedHSetNxKey = undefined;
        throw new Error(`injected HSETNX failure for ${key}`);
      }
      const hash = hashFor(key);
      if (hash.has(field)) return 0;
      hash.set(field, value);
      bump(key);
      return 1;
    }),
    watch: vi.fn(async (...keys: string[]) => createTransaction(keys)),
    zAdd: vi.fn(async (key: string, entry: SortedSetEntry) => {
      if (failedZAddKey === key) {
        failedZAddKey = undefined;
        throw new Error(`injected ZADD failure for ${key}`);
      }
      return addSorted(key, entry);
    }),
    zCard: vi.fn(async (key: string) => sortedSets.get(key)?.size ?? 0),
    zRank: vi.fn(async (key: string, member: string) => {
      const rank = rankedRows(key).findIndex((row) => row.member === member);
      return rank >= 0 ? rank : undefined;
    }),
    zRange: vi.fn(async (key: string, start: number, stop: number) => {
      const rows = rankedRows(key);
      const first = start < 0 ? Math.max(0, rows.length + start) : start;
      const last = stop < 0 ? rows.length + stop : stop;
      if (first >= rows.length || last < first) return [];
      return rows.slice(first, last + 1);
    }),
    zRem: vi.fn(async (key: string, members: readonly string[]) =>
      removeSorted(key, members)
    ),
    zScore: vi.fn(async (key: string, member: string) => sortedSets.get(key)?.get(member)),
  };

  return {
    hashes,
    redis,
    strings,
    clear: () => {
      strings.clear();
      hashes.clear();
      sortedSets.clear();
      versions.clear();
      failedZAddKey = undefined;
      failedHSetNxKey = undefined;
      pausedExec = undefined;
    },
    failNextZAdd: (key: string) => {
      failedZAddKey = key;
    },
    failNextHSetNx: (key: string) => {
      failedHSetNxKey = key;
    },
    pauseNextExec: (key: string) => {
      let releaseWait = (): void => undefined;
      let markReached = (): void => undefined;
      const wait = new Promise<void>((resolve) => {
        releaseWait = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        markReached = resolve;
      });
      pausedExec = { key, wait, reached: markReached };
      return { reached, release: releaseWait };
    },
  };
});

const redditState = vi.hoisted(() => ({
  setUserFlair: vi.fn(async () => undefined),
}));

vi.mock('@devvit/web/server', () => ({
  context: { subredditName: 'ice_hop_dev' },
  reddit: redditState,
  redis: redisState.redis,
}));

import { currentDailyPuzzleRef } from '../../../shared/daily';
import { leaderboardScore } from '../../../shared/scoring';
import { keys } from '../keys';
import { getBestDailySolve, recordSolve } from '../leaderboard';

beforeEach(() => {
  redisState.clear();
  vi.clearAllMocks();
});

describe('retry-safe Daily progression', () => {
  it('never claims a date when score candidate persistence fails first', async () => {
    const ref = currentDailyPuzzleRef('2026-08-05');
    await redisState.redis.zAdd(keys.allTimeLeaderboard(), { member: 'alice', score: 4 });
    await redisState.redis.set(
      keys.streak('alice'),
      JSON.stringify({ count: 4, lastDate: '2026-08-04' })
    );
    redisState.failNextZAdd(keys.dailyBestCandidates(ref, 'alice'));

    await expect(recordSolve(ref, 'alice', 5, 5, 900)).rejects.toThrow(
      'injected ZADD failure'
    );
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.get(ref.date)).toBeUndefined();
    expect(await getBestDailySolve(ref, 'alice')).toBeNull();

    const retry = await recordSolve(ref, 'alice', 5, 5, 900);
    const repeatedRetry = await recordSolve(ref, 'alice', 5, 5, 900);

    expect(retry).toMatchObject({ streak: 5, firstSolve: true, bestMoves: 5 });
    expect(repeatedRetry).toMatchObject({ streak: 5, firstSolve: false, bestMoves: 5 });
    expect(await redisState.redis.zScore(keys.allTimeLeaderboard(), 'alice')).toBe(5);
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.size).toBe(1);
    expect(redisState.strings.get(keys.streak('alice'))).toBe(
      JSON.stringify({ count: 5, lastDate: '2026-08-05' })
    );
  });

  it('repairs a missing date claim from durable candidate evidence', async () => {
    const ref = currentDailyPuzzleRef('2026-08-05');
    redisState.failNextHSetNx(keys.dailyProgress('alice'));

    await expect(recordSolve(ref, 'alice', 5, 5, 900)).rejects.toThrow(
      'injected HSETNX failure'
    );
    expect(await getBestDailySolve(ref, 'alice')).toEqual({
      moves: 5,
      timeMs: 900,
      stars: 3,
    });
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.get(ref.date)).toBeUndefined();

    const repaired = await recordSolve(ref, 'alice', 5, 5, 900);
    expect(repaired).toMatchObject({ streak: 1, firstSolve: true, bestMoves: 5 });
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.get(ref.date)).toBe(
      'v6:2026-08-05'
    );
    expect(await redisState.redis.zScore(keys.allTimeLeaderboard(), 'alice')).toBe(1);
  });

  it('keeps baseline-backed legacy retries out of the new date ledger', async () => {
    const ref = currentDailyPuzzleRef('2026-08-05');
    const legacyRecord = { moves: 5, timeMs: 900, stars: 3 };
    redisState.strings.set(keys.solve(ref, 'alice'), JSON.stringify(legacyRecord));
    await redisState.redis.zAdd(keys.allTimeLeaderboard(), { member: 'alice', score: 1 });
    await redisState.redis.set(
      keys.streak('alice'),
      JSON.stringify({ count: 1, lastDate: ref.date })
    );

    const firstReplay = await recordSolve(ref, 'alice', 5, 5, 900);
    const lostResponseRetry = await recordSolve(ref, 'alice', 5, 5, 900);

    expect(firstReplay.firstSolve).toBe(false);
    expect(lostResponseRetry.firstSolve).toBe(false);
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.get(ref.date)).toBeUndefined();
    expect(await redisState.redis.zScore(keys.allTimeLeaderboard(), 'alice')).toBe(1);
    expect(redisState.strings.get(keys.streak('alice'))).toBe(
      JSON.stringify({ count: 1, lastDate: ref.date })
    );
  });

  it('retries a stale one-date projection after a second date is claimed', async () => {
    const firstRef = currentDailyPuzzleRef('2026-08-05');
    const secondRef = currentDailyPuzzleRef('2026-08-06');
    const pause = redisState.pauseNextExec(keys.dailyProgress('alice'));

    const firstSolve = recordSolve(firstRef, 'alice', 5, 5, 900);
    await pause.reached;
    const secondSolve = await recordSolve(secondRef, 'alice', 5, 5, 800);
    pause.release();
    const firstResult = await firstSolve;

    expect(firstResult.streak).toBe(2);
    expect(secondSolve.streak).toBe(2);
    expect(await redisState.redis.zScore(keys.allTimeLeaderboard(), 'alice')).toBe(2);
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.size).toBe(2);
    expect(redisState.strings.get(keys.streak('alice'))).toBe(
      JSON.stringify({ count: 2, lastDate: '2026-08-06' })
    );
  });
});

describe('bounded Daily best-score convergence', () => {
  it('aborts a stale worse publisher and keeps one better candidate', async () => {
    const ref = currentDailyPuzzleRef('2026-08-06');
    const candidateKey = keys.dailyBestCandidates(ref, 'alice');
    const pause = redisState.pauseNextExec(candidateKey);

    const worseSolve = recordSolve(ref, 'alice', 5, 7, 400);
    await pause.reached;
    const betterSolve = await recordSolve(ref, 'alice', 5, 5, 800);
    pause.release();
    const worseResult = await worseSolve;

    expect(betterSolve.bestMoves).toBe(5);
    expect(worseResult.bestMoves).toBe(5);
    expect(await getBestDailySolve(ref, 'alice')).toEqual({
      moves: 5,
      timeMs: 800,
      stars: 3,
    });
    expect(await redisState.redis.zCard(candidateKey)).toBe(1);
    expect(await redisState.redis.zScore(keys.dailyLeaderboard(ref), 'alice')).toBe(
      leaderboardScore(5, 800)
    );
    expect(await redisState.redis.zScore(keys.allTimeLeaderboard(), 'alice')).toBe(1);
    expect(redisState.hashes.get(keys.dailyProgress('alice'))?.size).toBe(1);
  });
});
