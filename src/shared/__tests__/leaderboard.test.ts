import { describe, expect, it } from 'vitest';
import type { LeaderboardEntry, LeaderboardResponse } from '../api';
import {
  DISTRIBUTION_BUCKETS,
  bucketsFromBelowCounts,
  bucketsFromMoves,
  communityBoardMoves,
  communityBoardScore,
  competitionRanks,
  distributionBoundaries,
  formatDuration,
  parseDailyLeaderboard,
  parseRankedBoard,
} from '../leaderboard';
import { decodeScore, leaderboardScore } from '../scoring';

const entry = (rank: number, username: string, moves: number, timeMs = 1000): LeaderboardEntry => ({
  rank,
  username,
  moves,
  timeMs,
  streak: 0,
});

const dailyResponse = (overrides: Partial<LeaderboardResponse> = {}): LeaderboardResponse => ({
  puzzleId: 'v6:2026-10-30',
  date: '2026-10-30',
  par: 6,
  totalPlayers: 2,
  viewerRank: 0,
  entries: [entry(1, 'alice', 6, 500), entry(2, 'bob', 7, 400)],
  nearbyEntries: [],
  distribution: bucketsFromMoves(6, [6, 7]),
  viewerHidden: false,
  ...overrides,
});

describe('move distributions', () => {
  it('buckets par, each move over par, and a final open bucket', () => {
    const buckets = bucketsFromMoves(6, [6, 6, 7, 9, 10, 14]);
    expect(buckets).toHaveLength(DISTRIBUTION_BUCKETS);
    expect(buckets.map((bucket) => [bucket.moves, bucket.players, bucket.orMore])).toEqual([
      [6, 2, false],
      [7, 1, false],
      [8, 0, false],
      [9, 1, false],
      [10, 2, true],
    ]);
  });

  it('derives the same buckets from boundary counts as from a full read', () => {
    const moves = [6, 6, 7, 9, 10, 14];
    const scores = moves.map((count, index) => leaderboardScore(count, index * 100)).sort(
      (left, right) => left - right
    );
    const below = distributionBoundaries(6).map(
      (boundary) => scores.filter((score) => score < boundary).length
    );
    expect(bucketsFromBelowCounts(6, below, scores.length)).toEqual(bucketsFromMoves(6, moves));
    expect(scores.every((score) => decodeScore(score).moves >= 6)).toBe(true);
  });

  it('clamps counts read during concurrent solves into a consistent total', () => {
    const buckets = bucketsFromBelowCounts(4, [3, 2, 9, 5], 6);
    expect(buckets.reduce((sum, bucket) => sum + bucket.players, 0)).toBe(6);
    expect(buckets.every((bucket) => bucket.players >= 0)).toBe(true);
  });
});

describe('ranks and durations', () => {
  it('gives equal values a shared competition rank', () => {
    expect(competitionRanks([21, 18, 18, 15, 15, 15, 3])).toEqual([1, 2, 2, 4, 4, 4, 7]);
    expect(competitionRanks([])).toEqual([]);
  });

  it('formats verified elapsed time as m:ss or h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42_900)).toBe('0:42');
    expect(formatDuration(725_000)).toBe('12:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('orders Community solves by moves, then the earliest solve', () => {
    const early = communityBoardScore(6, Date.UTC(2026, 9, 30, 12));
    const late = communityBoardScore(6, Date.UTC(2026, 9, 30, 13));
    const better = communityBoardScore(5, Date.UTC(2026, 9, 31));
    expect(better).toBeLessThan(early);
    expect(early).toBeLessThan(late);
    expect(communityBoardMoves(late)).toBe(6);
    expect(Number.isSafeInteger(communityBoardScore(500, Date.UTC(2100, 0, 1)))).toBe(true);
  });
});

describe('parseDailyLeaderboard', () => {
  it('accepts a consistent response and its expected viewer', () => {
    const response = dailyResponse({
      viewerRank: 2,
      nearbyEntries: [entry(1, 'alice', 6, 500), entry(2, 'bob', 7, 400)],
    });
    expect(parseDailyLeaderboard(response, { puzzleId: 'v6:2026-10-30', viewer: 'bob' })).toEqual(
      response
    );
  });

  it('accepts any valid Daily id when none is required', () => {
    const response = dailyResponse({ puzzleId: 'v6:2026-10-29', date: '2026-10-29' });
    expect(parseDailyLeaderboard(response, {})).toEqual(response);
  });

  it('rejects a different puzzle, a bad distribution, or mismatched viewer state', () => {
    expect(parseDailyLeaderboard(dailyResponse(), { puzzleId: 'v6:2026-10-29' })).toBeNull();
    expect(
      parseDailyLeaderboard(dailyResponse({ distribution: bucketsFromMoves(5, [6, 7]) }), {})
    ).toBeNull();
    expect(parseDailyLeaderboard(dailyResponse(), { viewer: 'bob' })).toBeNull();
    expect(
      parseDailyLeaderboard(
        dailyResponse({ entries: [entry(1, 'alice', 7), entry(2, 'bob', 6)] }),
        {}
      )
    ).toBeNull();
    expect(
      parseDailyLeaderboard(dailyResponse({ entries: [entry(1, 'alice', 5), entry(2, 'bob', 7)] }), {})
    ).toBeNull();
    expect(parseDailyLeaderboard({ ...dailyResponse(), viewerHidden: 'no' }, {})).toBeNull();
  });
});

describe('parseRankedBoard', () => {
  const week = {
    kind: 'week',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-01',
    totalPlayers: 3,
    entries: [
      { rank: 1, username: 'alice', value: 15 },
      { rank: 2, username: 'bob', value: 12 },
      { rank: 2, username: 'cara', value: 12 },
    ],
    viewer: { rank: 2, value: 12 },
    viewerHidden: true,
  };

  it('accepts shared ranks and the viewer standing', () => {
    expect(parseRankedBoard(week, 'week')).toEqual(week);
    expect(
      parseRankedBoard({ kind: 'streak', entries: [], viewer: null, viewerHidden: false }, 'streak')
    ).toEqual({ kind: 'streak', entries: [], viewer: null, viewerHidden: false });
  });

  it('rejects the wrong kind, unordered values, or a week without its dates', () => {
    expect(parseRankedBoard(week, 'alltime')).toBeNull();
    expect(
      parseRankedBoard(
        {
          ...week,
          entries: [
            { rank: 1, username: 'alice', value: 9 },
            { rank: 2, username: 'bob', value: 12 },
          ],
        },
        'week'
      )
    ).toBeNull();
    expect(parseRankedBoard({ ...week, periodEnd: undefined }, 'week')).toBeNull();
    expect(parseRankedBoard({ ...week, viewer: { rank: -1, value: 2 } }, 'week')).toBeNull();
  });
});
