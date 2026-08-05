import { describe, expect, it } from 'vitest';
import {
  currentDailyPuzzleRef,
  dailyPuzzleId,
  parseDailyPuzzleId,
  parsePostDailyMapping,
  type DailyPuzzleRef,
} from '../../../shared/daily';
import { keys } from '../keys';

const date = '2026-08-05';

describe('immutable daily puzzle identity', () => {
  it('binds new posts to an explicit current-schema puzzle id', () => {
    const ref = currentDailyPuzzleRef(date);
    expect(dailyPuzzleId(ref)).toBe('v6:2026-08-05');
    expect(parseDailyPuzzleId(dailyPuzzleId(ref))).toEqual(ref);
  });

  it('resolves historical raw-date post mappings to schema 5', () => {
    const legacy = parsePostDailyMapping(date);
    expect(legacy).toEqual({ schema: 5, date });
    expect(parsePostDailyMapping('v6:2026-08-05')).toEqual({ schema: 6, date });
  });

  it('keeps legacy and current board, solve, and leaderboard namespaces separate', () => {
    const legacy: DailyPuzzleRef = { schema: 5, date };
    const current: DailyPuzzleRef = { schema: 6, date };

    expect(keys.dailyPuzzle(legacy)).toBe('daily:5:2026-08-05');
    expect(keys.dailyPuzzle(current)).toBe('daily:6:2026-08-05');
    expect(keys.solve(legacy, 'alice')).toBe('solve:2026-08-05:alice');
    expect(keys.solve(current, 'alice')).toBe('solve:6:2026-08-05:alice');
    expect(keys.dailyLeaderboard(legacy)).toBe('lb:2026-08-05');
    expect(keys.dailyLeaderboard(current)).toBe('lb:6:2026-08-05');
  });

  it('rejects malformed or unsupported identities instead of guessing', () => {
    expect(parsePostDailyMapping('v7:2026-08-05')).toBeNull();
    expect(parsePostDailyMapping('2026-02-30')).toBeNull();
    expect(parsePostDailyMapping('not-a-date')).toBeNull();
  });
});
