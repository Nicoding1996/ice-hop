import { describe, expect, it } from 'vitest';
import {
  guestDailyCompletionFor,
  mergeProgressCount,
  rememberGuestDailyCompletion,
} from '../progression';

describe('guest Daily session progression', () => {
  it('stores puzzle-keyed recaps without leaking one Daily into another', () => {
    const first = rememberGuestDailyCompletion(undefined, {
      puzzleId: 'v6:2026-08-05',
      moves: 5,
      stars: 3,
    });
    const both = rememberGuestDailyCompletion(first, {
      puzzleId: 'v6:2026-08-06',
      moves: 7,
      stars: 2,
    });

    expect(guestDailyCompletionFor(both, 'v6:2026-08-05')).toEqual({
      puzzleId: 'v6:2026-08-05',
      moves: 5,
      stars: 3,
    });
    expect(guestDailyCompletionFor(both, 'v6:2026-08-06')).toEqual({
      puzzleId: 'v6:2026-08-06',
      moves: 7,
      stars: 2,
    });
    expect(guestDailyCompletionFor(both, 'v6:2026-08-07')).toBeNull();
  });

  it('replaces a replay result and ignores malformed registry data', () => {
    const malformed: unknown = [{ puzzleId: 'v6:2026-08-05', moves: -1, stars: 9 }];
    const remembered = rememberGuestDailyCompletion(malformed, {
      puzzleId: 'v6:2026-08-05',
      moves: 6,
      stars: 2,
    });
    const replayed = rememberGuestDailyCompletion(remembered, {
      puzzleId: 'v6:2026-08-05',
      moves: 5,
      stars: 3,
    });

    expect(replayed).toHaveLength(1);
    expect(guestDailyCompletionFor(replayed, 'v6:2026-08-05')).toMatchObject({
      moves: 5,
      stars: 3,
    });
  });
});

describe('monotonic progression reconciliation', () => {
  it('does not let an older issue response or failed save lower confirmed Endless progress', () => {
    expect(mergeProgressCount(12, 11)).toBe(12);
    expect(mergeProgressCount(12, 13)).toBe(13);
    expect(mergeProgressCount(undefined, 4)).toBe(4);
  });
});
