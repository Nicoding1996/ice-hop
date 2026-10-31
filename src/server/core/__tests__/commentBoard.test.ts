import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../../../shared/game/types';

const state = vi.hoisted(() => {
  type Row = { readonly member: string; readonly score: number };
  type RangeOptions = {
    readonly by: 'rank' | 'score' | 'lex';
    readonly reverse?: boolean;
    readonly limit?: { readonly offset: number; readonly count: number };
  };
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Map<string, number>>();
  const versions = new Map<string, number>();
  const edits: { readonly id: string; readonly text: string }[] = [];
  const bump = (key: string): void => {
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const hashFor = (key: string): Map<string, string> => {
    const hash = hashes.get(key) ?? new Map<string, string>();
    hashes.set(key, hash);
    return hash;
  };
  const setFor = (key: string): Map<string, number> => {
    const set = sets.get(key) ?? new Map<string, number>();
    sets.set(key, set);
    return set;
  };
  const ascending = (key: string): Row[] =>
    [...(sets.get(key)?.entries() ?? [])]
      .map(([member, score]) => ({ member, score }))
      .sort((left, right) => left.score - right.score || left.member.localeCompare(right.member));
  const zAdd = (key: string, row: Row): number => {
    const set = setFor(key);
    const added = set.has(row.member) ? 0 : 1;
    if (set.get(row.member) !== row.score) {
      set.set(row.member, row.score);
      bump(key);
    }
    return added;
  };
  const zRem = (key: string, members: readonly string[]): number => {
    let removed = 0;
    for (const member of members) if (sets.get(key)?.delete(member)) removed += 1;
    if (removed > 0) bump(key);
    return removed;
  };
  const zRange = (
    key: string,
    start: number | string,
    stop: number | string,
    options: RangeOptions
  ): Row[] => {
    if (options.by === 'score') {
      const min = Number(start);
      const max = stop === '+inf' ? Number.POSITIVE_INFINITY : Number(stop);
      const rows = ascending(key).filter((row) => row.score >= min && row.score <= max);
      const offset = options.limit?.offset ?? 0;
      return rows.slice(offset, options.limit ? offset + options.limit.count : undefined);
    }
    const rows = options.reverse ? ascending(key).reverse() : ascending(key);
    const first = Number(start) < 0 ? Math.max(0, rows.length + Number(start)) : Number(start);
    const last = Number(stop) < 0 ? rows.length + Number(stop) : Number(stop);
    return first >= rows.length || last < first ? [] : rows.slice(first, last + 1);
  };
  const redis = {
    get: vi.fn(async (key: string) => strings.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      strings.set(key, value);
      bump(key);
      return 'OK';
    }),
    incrBy: vi.fn(async (key: string, value: number) => {
      const next = Number(strings.get(key) ?? '0') + value;
      strings.set(key, String(next));
      bump(key);
      return next;
    }),
    mGet: vi.fn(async (keys: readonly string[]) => keys.map((key) => strings.get(key) ?? null)),
    expire: vi.fn(async () => undefined),
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hGetAll: vi.fn(async (key: string) => Object.fromEntries(hashes.get(key) ?? [])),
    hMGet: vi.fn(async (key: string, fields: readonly string[]) =>
      fields.map((field) => hashes.get(key)?.get(field) ?? null)
    ),
    hSet: vi.fn(async (key: string, values: Record<string, string>) => {
      const hash = hashFor(key);
      for (const [field, value] of Object.entries(values)) hash.set(field, value);
      bump(key);
      return Object.keys(values).length;
    }),
    hDel: vi.fn(async (key: string, fields: readonly string[]) => {
      let removed = 0;
      for (const field of fields) if (hashes.get(key)?.delete(field)) removed += 1;
      if (removed > 0) bump(key);
      return removed;
    }),
    zAdd: vi.fn(async (key: string, row: Row) => zAdd(key, row)),
    zRem: vi.fn(async (key: string, members: readonly string[]) => zRem(key, members)),
    zCard: vi.fn(async (key: string) => sets.get(key)?.size ?? 0),
    zScore: vi.fn(async (key: string, member: string) => sets.get(key)?.get(member)),
    zRank: vi.fn(async (key: string, member: string) => {
      const index = ascending(key).findIndex((row) => row.member === member);
      return index >= 0 ? index : undefined;
    }),
    zRange: vi.fn(
      async (key: string, start: number | string, stop: number | string, options: RangeOptions) =>
        zRange(key, start, stop, options)
    ),
    watch: vi.fn(async (...watched: string[]) => {
      const seen = watched.map((key) => versions.get(key) ?? 0);
      const queued: (() => unknown)[] = [];
      return {
        multi: vi.fn(async () => undefined),
        unwatch: vi.fn(async () => undefined),
        zRem: vi.fn(async (key: string, members: readonly string[]) => {
          queued.push(() => zRem(key, members));
        }),
        exec: vi.fn(async () =>
          watched.some((key, index) => (versions.get(key) ?? 0) !== seen[index])
            ? []
            : queued.map((operation) => operation())
        ),
      };
    }),
  };
  const reddit = {
    getCommentById: vi.fn(async (id: string) => ({
      edit: vi.fn(async ({ text }: { readonly text: string }) => {
        edits.push({ id, text });
      }),
    })),
  };
  return {
    edits,
    hashes,
    reddit,
    redis,
    sets,
    strings,
    clear: (): void => {
      strings.clear();
      hashes.clear();
      sets.clear();
      versions.clear();
      edits.length = 0;
    },
  };
});

vi.mock('@devvit/web/server', () => ({
  context: { subredditName: 'ice_hop_dev' },
  reddit: state.reddit,
  redis: state.redis,
}));

import { ANONYMOUS_PLAYER } from '../../../shared/commentBoard';
import { currentDailyPuzzleRef, dailyPuzzleId } from '../../../shared/daily';
import { communityBoardScore } from '../../../shared/leaderboard';
import { leaderboardScore } from '../../../shared/scoring';
import {
  communityBoardId,
  dailyBoardId,
  recordCommunityBoardSolve,
  refreshCommentBoards,
  registerDailyCommentBoard,
} from '../commentBoard';
import { keys } from '../keys';
import { getRankedBoard, setNameHidden } from '../leaderboard';

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

const today = currentDailyPuzzleRef('2026-10-30');
const yesterday = currentDailyPuzzleRef('2026-10-29');

const storeDaily = (date: string, par: number): void => {
  const ref = currentDailyPuzzleRef(date);
  state.strings.set(keys.dailyPuzzle(ref), JSON.stringify({ date, board, par }));
  state.hashes.set(
    keys.dailyPuzzleIdentities(),
    new Map([...(state.hashes.get(keys.dailyPuzzleIdentities()) ?? []), [date, dailyPuzzleId(ref)]])
  );
};

const solve = async (date: string, user: string, moves: number, timeMs: number): Promise<void> => {
  await state.redis.zAdd(keys.dailyLeaderboard(currentDailyPuzzleRef(date)), {
    member: user,
    score: leaderboardScore(moves, timeMs),
  });
};

beforeEach(() => {
  state.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T15:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('live Daily comment boards', () => {
  it('edits the pinned comment, skips unchanged text, and anonymizes opted-out names', async () => {
    storeDaily('2026-10-29', 5);
    storeDaily('2026-10-30', 6);
    await solve('2026-10-29', 'zed', 5, 31_000);
    await solve('2026-10-30', 'alice', 6, 42_000);
    await solve('2026-10-30', 'bob_x', 7, 30_000);
    await setNameHidden('bob_x', true);
    await registerDailyCommentBoard(today, 't3_today', 't1_today');

    expect(await refreshCommentBoards()).toMatchObject({ edited: 1, finalized: 0 });
    const text = state.edits[0]?.text ?? '';
    expect(state.edits[0]?.id).toBe('t1_today');
    expect(text).toContain('Live leaderboard');
    expect(text).toContain('| \u{1F947} | alice | 6 | 0:42 |');
    expect(text).toContain(ANONYMOUS_PLAYER);
    expect(text).not.toContain('bob');
    expect(text).toContain("Yesterday's winner: **zed** (5 moves, 0:31)");

    // Nothing changed: no Reddit call at all.
    expect(await refreshCommentBoards()).toMatchObject({ edited: 0 });
    expect(state.reddit.getCommentById).toHaveBeenCalledTimes(1);

    await solve('2026-10-30', 'cara', 6, 50_000);
    expect(await refreshCommentBoards()).toMatchObject({ edited: 1 });
    expect(state.edits[1]?.text).toContain('| \u{1F948} | cara | 6 | 0:50 |');
    expect(await state.redis.zScore(keys.commentBoards(), dailyBoardId(today))).toBeDefined();
  });

  it('freezes a closed Daily into final results once and leaves the queue', async () => {
    storeDaily('2026-10-30', 6);
    await solve('2026-10-30', 'alice', 6, 42_000);
    await registerDailyCommentBoard(today, 't3_today', 't1_today');
    await refreshCommentBoards();

    vi.setSystemTime(new Date('2026-10-31T12:03:00.000Z'));
    await solve('2026-10-30', 'late', 9, 10_000);
    expect(await refreshCommentBoards()).toMatchObject({ edited: 1, finalized: 1 });
    const final = state.edits.at(-1)?.text ?? '';
    expect(final).toContain('Final results');
    expect(final).not.toContain('Comment my score');
    expect(await state.redis.zScore(keys.commentBoards(), dailyBoardId(today))).toBeUndefined();

    await solve('2026-10-30', 'later', 9, 9_000);
    expect(await refreshCommentBoards()).toMatchObject({ processed: 0, edited: 0 });
  });

  it('drops a queued board whose puzzle date has no stored puzzle once it closes', async () => {
    await registerDailyCommentBoard(yesterday, 't3_old', 't1_old');
    expect(await refreshCommentBoards()).toMatchObject({ edited: 0, finalized: 1 });
    expect(await state.redis.zCard(keys.commentBoards())).toBe(0);
  });
});

describe('live Community comment boards', () => {
  const id = 'puzzle-1';
  const board_id = communityBoardId(id);

  beforeEach(() => {
    state.strings.set(
      keys.ugcSubmission(id),
      JSON.stringify({ id, creator: 'maker', board, par: 5, postId: 't3_ugc' })
    );
    // A post published before live boards: only its pinned comment is known.
    state.strings.set(keys.pinnedComment('t3_ugc'), 't1_ugc');
  });

  it('queues on an improving solve and dequeues once rendered', async () => {
    await recordCommunityBoardSolve(id, 'alice', 6);
    expect(await refreshCommentBoards()).toMatchObject({ edited: 1 });
    expect(state.edits[0]?.id).toBe('t1_ugc');
    expect(state.edits[0]?.text).toContain('| \u{1F947} | alice | 6 |');
    expect(state.edits[0]?.text).toContain('**1 solver** \u00B7 **0 at par**');
    expect(await state.redis.zScore(keys.commentBoards(), board_id)).toBeUndefined();

    // A worse solve changes nothing; a par solve updates the comment again.
    await recordCommunityBoardSolve(id, 'alice', 7);
    expect(await state.redis.zScore(keys.commentBoards(), board_id)).toBeUndefined();
    await recordCommunityBoardSolve(id, 'alice', 5);
    expect(await refreshCommentBoards()).toMatchObject({ edited: 1 });
    expect(state.edits[1]?.text).toContain('**1 at par**');
    expect(await state.redis.zScore(keys.ugcLeaderboard(id), 'alice')).toBe(
      communityBoardScore(5, Date.now())
    );
  });

  it('keeps a board queued when a new solve lands while it renders', async () => {
    await recordCommunityBoardSolve(id, 'alice', 6);
    state.reddit.getCommentById.mockImplementationOnce(async (commentId: string) => ({
      edit: vi.fn(async ({ text }: { readonly text: string }) => {
        state.edits.push({ id: commentId, text });
        await recordCommunityBoardSolve(id, 'bob', 5);
      }),
    }));
    await refreshCommentBoards();
    expect(await state.redis.zScore(keys.commentBoards(), board_id)).toBeDefined();
    await refreshCommentBoards();
    expect(state.edits.at(-1)?.text).toContain('| \u{1F947} | bob | 5 |');
    expect(await state.redis.zScore(keys.commentBoards(), board_id)).toBeUndefined();
  });
});

describe('cross-puzzle ranked boards', () => {
  it('ranks this week with shared ranks and finds an unlisted viewer', async () => {
    const weekKey = keys.weeklyLeaderboard('2026-10-26');
    const scores = [21, 18, 18, 15, 14, 13, 12, 11, 10, 9, 8, 7];
    for (const [index, score] of scores.entries()) {
      await state.redis.zAdd(weekKey, { member: `p${index}`, score });
    }
    await state.redis.zAdd(weekKey, { member: 'viewer', score: 7 });

    const week = await getRankedBoard('week', 'viewer');
    expect(week.periodStart).toBe('2026-10-26');
    expect(week.periodEnd).toBe('2026-11-01');
    expect(week.entries.map((entry) => entry.rank)).toEqual([1, 2, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(week.totalPlayers).toBe(13);
    // One player shares the viewer's 7 stars; eleven score higher.
    expect(week.viewer).toEqual({ rank: 12, value: 7 });
  });

  it('lists only current streaks and clears lapsed rows', async () => {
    await state.redis.zAdd(keys.streakLeaderboard(), { member: 'alice', score: 4 });
    await state.redis.zAdd(keys.streakLeaderboard(), { member: 'bob', score: 12 });
    state.strings.set(keys.streak('alice'), JSON.stringify({ count: 4, lastDate: '2026-10-29' }));
    state.strings.set(keys.streak('bob'), JSON.stringify({ count: 12, lastDate: '2026-10-20' }));

    const streaks = await getRankedBoard('streak', 'alice');
    expect(streaks.entries).toEqual([{ rank: 1, username: 'alice', value: 4 }]);
    expect(streaks.viewer).toEqual({ rank: 1, value: 4 });
    expect(await state.redis.zScore(keys.streakLeaderboard(), 'bob')).toBeUndefined();
  });
});
