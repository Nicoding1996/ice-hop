import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Move } from '../../../shared/game/types';

const redisState = vi.hoisted(() => {
  type QueuedOperation = () => unknown;

  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const versions = new Map<string, number>();
  let failedSetKey: string | undefined;

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

  const setValue = (key: string, value: string): string => {
    if (failedSetKey === key) {
      failedSetKey = undefined;
      throw new Error(`injected SET failure for ${key}`);
    }
    strings.set(key, value);
    bump(key);
    return 'OK';
  };

  const setHash = (key: string, values: Readonly<Record<string, string>>): number => {
    const hash = hashFor(key);
    let added = 0;
    let changed = false;
    for (const [field, value] of Object.entries(values)) {
      if (!hash.has(field)) added += 1;
      if (hash.get(field) !== value) {
        hash.set(field, value);
        changed = true;
      }
    }
    if (changed) bump(key);
    return added;
  };

  const setHashNx = (key: string, field: string, value: string): number => {
    const hash = hashFor(key);
    if (hash.has(field)) return 0;
    hash.set(field, value);
    bump(key);
    return 1;
  };

  const incrementHash = (key: string, field: string, increment: number): number => {
    const hash = hashFor(key);
    const previous = Number.parseInt(hash.get(field) ?? '0', 10);
    const next = previous + increment;
    hash.set(field, String(next));
    bump(key);
    return next;
  };

  const deleteHashFields = (key: string, fields: readonly string[]): number => {
    const hash = hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) {
      if (hash.delete(field)) removed += 1;
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
      expire: vi.fn(async (key: string) => {
        operations.push(() => {
          bump(key);
          return 1;
        });
      }),
      hSet: vi.fn(async (key: string, values: Readonly<Record<string, string>>) => {
        operations.push(() => setHash(key, values));
      }),
      hSetNX: vi.fn(async (key: string, field: string, value: string) => {
        operations.push(() => setHashNx(key, field, value));
      }),
      hDel: vi.fn(async (key: string, fields: readonly string[]) => {
        operations.push(() => deleteHashFields(key, fields));
      }),
      hIncrBy: vi.fn(async (key: string, field: string, increment: number) => {
        operations.push(() => incrementHash(key, field, increment));
      }),
      unwatch: vi.fn(async () => undefined),
      discard: vi.fn(async () => {
        operations.length = 0;
      }),
      exec: vi.fn(async () => {
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
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) {
        const removed = strings.delete(key) || hashes.delete(key);
        if (removed) bump(key);
      }
    }),
    expire: vi.fn(async (key: string) => {
      bump(key);
    }),
    watch: vi.fn(async (...keys: string[]) => createTransaction(keys)),
    hSetNX: vi.fn(async (key: string, field: string, value: string) =>
      setHashNx(key, field, value)
    ),
    hSet: vi.fn(async (key: string, values: Readonly<Record<string, string>>) =>
      setHash(key, values)
    ),
    hDel: vi.fn(async (key: string, fields: readonly string[]) =>
      deleteHashFields(key, fields)
    ),
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hGetAll: vi.fn(async (key: string) => Object.fromEntries(hashes.get(key) ?? [])),
    hKeys: vi.fn(async (key: string) => [...(hashes.get(key)?.keys() ?? [])]),
    hLen: vi.fn(async (key: string) => hashes.get(key)?.size ?? 0),
    hIncrBy: vi.fn(async (key: string, field: string, increment: number) =>
      incrementHash(key, field, increment)
    ),
  };

  return {
    strings,
    hashes,
    redis,
    clear: () => {
      strings.clear();
      hashes.clear();
      versions.clear();
      failedSetKey = undefined;
    },
    failNextSet: (key: string) => {
      failedSetKey = key;
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: redisState.redis }));

import { currentDailyPuzzleRef } from '../../../shared/daily';
import { todayUtc } from '../../../shared/date';
import {
  MAX_OUTSTANDING_ENDLESS_ISSUES,
  completeEndlessPuzzle,
  getDailyElapsed,
  getEndlessHint,
  issueDailyPlay,
  issueEndlessPuzzle,
  releaseEndlessIssue,
  reserveEndlessIssue,
} from '../completion';
import { syncAchievements } from '../achievements';
import { getEndlessStats } from '../endless';
import { keys } from '../keys';

const board: Board = {
  width: 3,
  height: 1,
  holes: [2],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
  ],
};
const solution: readonly Move[] = [{ pieceIndex: 0, kind: 'HOPPER', to: [2] }];

beforeEach(() => {
  redisState.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('server-authoritative Daily timing', () => {
  it('reuses the original issued play clock instead of allowing a reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
    const ref = currentDailyPuzzleRef('2026-08-05');

    const firstId = await issueDailyPlay('alice', ref);
    vi.setSystemTime(new Date('2026-08-05T12:05:00.000Z'));
    const repeatedId = await issueDailyPlay('alice', ref);

    expect(repeatedId).toBe(firstId);
    expect(await getDailyElapsed('alice', repeatedId, ref)).toBe(300_000);
  });

  it('keeps the exact puzzle capability valid across UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T23:59:30.000Z'));
    const ref = currentDailyPuzzleRef('2026-08-05');

    const playId = await issueDailyPlay('alice', ref);
    vi.setSystemTime(new Date('2026-08-06T00:00:30.000Z'));

    expect(await getDailyElapsed('alice', playId, ref)).toBe(60_000);
  });

  it('gives each guest an isolated bearer capability that survives midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T23:59:30.000Z'));
    const ref = currentDailyPuzzleRef('2026-08-05');
    const otherRef = currentDailyPuzzleRef('2026-08-06');

    const firstGuest = await issueDailyPlay('anon', ref);
    const secondGuest = await issueDailyPlay('anon', ref);
    vi.setSystemTime(new Date('2026-08-06T00:00:30.000Z'));

    expect(secondGuest).not.toBe(firstGuest);
    expect(firstGuest.startsWith('v1.')).toBe(true);
    expect(await getDailyElapsed('anon', firstGuest, ref)).toBe(60_000);
    expect(await getDailyElapsed('anon', firstGuest, otherRef)).toBeNull();
    expect(await getDailyElapsed('anon', `${firstGuest}x`, ref)).toBeNull();
    expect(redisState.hashes.get(keys.dailyGuestSecrets())?.size).toBe(1);
    expect(
      [...redisState.strings.keys()].some((key) => key.startsWith('daily:guest-play:'))
    ).toBe(false);
  });
});

describe('server-authoritative Endless completion', () => {
  it('atomically makes a server-hinted issue ineligible for progression', async () => {
    const issueId = await issueEndlessPuzzle('alice', 'easy', board, 1);
    const hint = await getEndlessHint('alice', issueId, []);
    const retryHint = await getEndlessHint('alice', issueId, []);
    expect(hint).toEqual({ ok: true, move: solution[0] });
    expect(retryHint).toEqual(hint);

    const completion = await completeEndlessPuzzle('alice', issueId, solution);
    expect(completion).toEqual({
      ok: false,
      reason: 'A hinted puzzle does not count toward progression.',
    });
    expect(await redisState.redis.hLen(keys.endlessLedger('alice', 'easy'))).toBe(0);
  });

  it('counts an unhinted issue once across idempotent retries', async () => {
    const issueId = await issueEndlessPuzzle('alice', 'medium', board, 1);
    const first = await completeEndlessPuzzle('alice', issueId, solution);
    const retry = await completeEndlessPuzzle('alice', issueId, solution);

    expect(first.ok && first.result.counted).toBe(true);
    expect(first.ok && first.result.solved).toBe(1);
    expect(first.ok && first.result.byTier.medium).toBe(1);
    expect(retry.ok && retry.result.counted).toBe(false);
    expect(retry.ok && retry.result.solved).toBe(1);
    expect(await redisState.redis.hLen(keys.endlessLedger('alice', 'medium'))).toBe(1);
  });

  it('repairs a completed resolution that predates its permanent ledger write', async () => {
    const issueId = await issueEndlessPuzzle('alice', 'easy', board, 1);
    await redisState.redis.hSetNX(
      keys.endlessResolutions('alice', todayUtc()),
      issueId,
      'completed'
    );

    const repaired = await completeEndlessPuzzle('alice', issueId, solution);

    expect(repaired.ok && repaired.result.counted).toBe(true);
    expect(repaired.ok && repaired.result.solved).toBe(1);
    expect(await redisState.redis.hLen(keys.endlessLedger('alice', 'easy'))).toBe(1);
  });

  it('repairs Hard-at-par achievement evidence from the permanent ledger alone', async () => {
    const issueId = await issueEndlessPuzzle('alice', 'hard', board, 1);
    await redisState.redis.hSetNX(
      keys.endlessResolutions('alice', todayUtc()),
      issueId,
      'completed'
    );
    await redisState.redis.hSetNX(
      keys.endlessLedger('alice', 'hard'),
      issueId,
      JSON.stringify({ completedAt: Date.now(), atPar: true })
    );

    const counts = await getEndlessStats('alice');
    const achievements = await syncAchievements('alice', counts);

    expect(counts).toEqual({ solved: 1, byTier: { easy: 0, medium: 0, hard: 1 } });
    expect(
      achievements.progress.find((achievement) => achievement.id === 'cold-logic')?.unlocked
    ).toBe(true);
    expect(
      redisState.hashes.get(keys.endlessLedgerMeta('alice'))?.get('hardAtPar')
    ).toBe('1');
  });

  it('caps unfinished issue records and keeps a released completion retryable', async () => {
    const issueIds: string[] = [];
    for (let index = 0; index < MAX_OUTSTANDING_ENDLESS_ISSUES; index++) {
      issueIds.push(await issueEndlessPuzzle('alice', 'easy', board, 1));
    }

    await expect(issueEndlessPuzzle('alice', 'easy', board, 1)).rejects.toThrow(
      'Too many unfinished Endless puzzles'
    );
    expect(await redisState.redis.hLen(keys.endlessIssues('alice'))).toBe(
      MAX_OUTSTANDING_ENDLESS_ISSUES
    );

    const completed = await completeEndlessPuzzle('alice', issueIds[0], solution);
    expect(completed.ok && completed.result.counted).toBe(true);
    expect(await redisState.redis.hLen(keys.endlessIssues('alice'))).toBe(
      MAX_OUTSTANDING_ENDLESS_ISSUES - 1
    );

    await issueEndlessPuzzle('alice', 'easy', board, 1);
    const retry = await completeEndlessPuzzle('alice', issueIds[0], solution);
    expect(retry.ok && retry.result.counted).toBe(false);
    expect(retry.ok && retry.result.solved).toBe(1);
  });

  it('reserves capacity before board selection and releases abandoned slots', async () => {
    const reservation = await reserveEndlessIssue('alice');
    expect(await redisState.redis.hLen(keys.endlessIssues('alice'))).toBe(1);

    await releaseEndlessIssue('alice', reservation);
    expect(await redisState.redis.hLen(keys.endlessIssues('alice'))).toBe(0);
  });

  it('evicts individually aged abandoned issues even while the hash stays active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T00:00:00.000Z'));
    for (let index = 0; index < MAX_OUTSTANDING_ENDLESS_ISSUES; index++) {
      await issueEndlessPuzzle('alice', 'easy', board, 1);
    }

    vi.setSystemTime(new Date('2026-08-05T07:00:00.000Z'));
    await reserveEndlessIssue('alice');

    expect(await redisState.redis.hLen(keys.endlessIssues('alice'))).toBe(1);
  });
});
