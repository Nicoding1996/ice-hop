import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Move } from '../../../shared/game/types';

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
  let pausedExec: PausedExec | undefined;
  let failedExecKey: string | undefined;
  let failedExecCount = 0;

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
    const next = Number.parseInt(hash.get(field) ?? '0', 10) + increment;
    hash.set(field, String(next));
    bump(key);
    return next;
  };

  const createTransaction = (watchedKeys: readonly string[]) => {
    const watchedVersions = watchedKeys.map((key) => versions.get(key) ?? 0);
    const operations: QueuedOperation[] = [];
    return {
      multi: vi.fn(async () => undefined),
      zAdd: vi.fn(async (key: string, entry: SortedSetEntry) => {
        operations.push(() => addSorted(key, entry));
      }),
      zRem: vi.fn(async (key: string, members: readonly string[]) => {
        operations.push(() => removeSorted(key, members));
      }),
      hSet: vi.fn(async (key: string, values: Readonly<Record<string, string>>) => {
        operations.push(() => setHash(key, values));
      }),
      hSetNX: vi.fn(async (key: string, field: string, value: string) => {
        operations.push(() => setHashNx(key, field, value));
      }),
      hIncrBy: vi.fn(async (key: string, field: string, increment: number) => {
        operations.push(() => incrementHash(key, field, increment));
      }),
      expire: vi.fn(async (key: string) => {
        operations.push(() => {
          bump(key);
          return 1;
        });
      }),
      unwatch: vi.fn(async () => undefined),
      exec: vi.fn(async () => {
        if (
          failedExecKey &&
          failedExecCount > 0 &&
          watchedKeys.includes(failedExecKey)
        ) {
          failedExecCount -= 1;
          return [];
        }
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
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hIncrBy: vi.fn(async (key: string, field: string, increment: number) =>
      incrementHash(key, field, increment)
    ),
    expire: vi.fn(async () => undefined),
    incrBy: vi.fn(async (key: string, increment: number) => {
      const next = Number(strings.get(key) ?? '0') + increment;
      strings.set(key, String(next));
      return next;
    }),
    watch: vi.fn(async (...keys: string[]) => createTransaction(keys)),
    zAdd: vi.fn(async (key: string, entry: SortedSetEntry) => addSorted(key, entry)),
    zCard: vi.fn(async (key: string) => sortedSets.get(key)?.size ?? 0),
    zRange: vi.fn(async (key: string, start: number, stop: number) => {
      const rows = rankedRows(key);
      const first = start < 0 ? Math.max(0, rows.length + start) : start;
      const last = stop < 0 ? rows.length + stop : stop;
      if (first >= rows.length || last < first) return [];
      return rows.slice(first, last + 1);
    }),
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
      pausedExec = undefined;
      failedExecKey = undefined;
      failedExecCount = 0;
    },
    failExecs: (key: string, count: number) => {
      failedExecKey = key;
      failedExecCount = count;
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

vi.mock('@devvit/web/server', () => ({ redis: redisState.redis }));

import { completeCommunityPuzzle, getBestCommunityCompletion } from '../completion';
import { keys } from '../keys';

const board: Board = {
  width: 5,
  height: 2,
  holes: [2],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
    { kind: 'SLIDER', cells: [5, 6], orient: 'H' },
  ],
};
const optimal: readonly Move[] = [{ pieceIndex: 0, kind: 'HOPPER', to: [2] }];
const longer: readonly Move[] = [
  { pieceIndex: 2, kind: 'SLIDER', to: [8, 9] },
  { pieceIndex: 2, kind: 'SLIDER', to: [5, 6] },
  ...optimal,
];

const storeSubmission = (id: string): void => {
  redisState.strings.set(
    keys.ugcSubmission(id),
    JSON.stringify({ id, creator: 'maker', board, par: 1 })
  );
};

beforeEach(() => {
  redisState.clear();
  vi.clearAllMocks();
});

describe('transactional Community completion', () => {
  it('aborts a stale worse score and credits the creator exactly once', async () => {
    const id = 'puzzle-1';
    storeSubmission(id);
    const candidateKey = keys.ugcCompletionCandidates('alice', id);
    const pause = redisState.pauseNextExec(candidateKey);

    const worseSave = completeCommunityPuzzle('alice', id, longer);
    await pause.reached;
    const betterSave = await completeCommunityPuzzle('alice', id, optimal);
    pause.release();
    const worseResult = await worseSave;

    expect(betterSave).toMatchObject({ ok: true, saved: true, firstSolve: true });
    expect(worseResult).toMatchObject({ ok: true, saved: true, firstSolve: false });
    expect(await getBestCommunityCompletion('alice', id)).toEqual({ moves: 1, par: 1 });
    expect(await redisState.redis.zCard(candidateKey)).toBe(1);
    expect(redisState.hashes.get(keys.ugcSolves())?.get(id)).toBe('1');
    expect(redisState.hashes.get(keys.ugcSolveCredits(id))?.get('alice')).toBe('1');
  });

  it('seeds a legacy credit marker without inflating an already-counted solve', async () => {
    const id = 'puzzle-2';
    storeSubmission(id);
    await redisState.redis.zAdd(keys.ugcPlayed('alice'), { member: id, score: 1 });
    redisState.hashes.set(keys.ugcSolves(), new Map([[id, '1']]));

    const result = await completeCommunityPuzzle('alice', id, optimal);

    expect(result).toMatchObject({ ok: true, saved: true, firstSolve: false });
    expect(redisState.hashes.get(keys.ugcSolves())?.get(id)).toBe('1');
    expect(redisState.hashes.get(keys.ugcSolveCredits(id))?.get('alice')).toBe('1');
  });

  it('does not split verified score evidence from played and creator state', async () => {
    const id = 'puzzle-3';
    storeSubmission(id);
    const candidateKey = keys.ugcCompletionCandidates('alice', id);
    redisState.failExecs(candidateKey, 8);

    await expect(completeCommunityPuzzle('alice', id, optimal)).rejects.toThrow(
      'Community completion was too busy to save.'
    );

    expect(await redisState.redis.zCard(candidateKey)).toBe(0);
    expect(await redisState.redis.zScore(keys.ugcPlayed('alice'), id)).toBeUndefined();
    expect(redisState.hashes.get(keys.ugcSolves())?.get(id)).toBeUndefined();
    expect(redisState.hashes.get(keys.ugcSolveCredits(id))?.get('alice')).toBeUndefined();
  });
});
