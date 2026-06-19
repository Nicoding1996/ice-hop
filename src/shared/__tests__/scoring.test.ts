import { describe, expect, it } from 'vitest';
import { computeStars, decodeScore, leaderboardScore } from '../scoring';

describe('scoring', () => {
  it('awards stars by moves vs par', () => {
    expect(computeStars(5, 5)).toBe(3);
    expect(computeStars(6, 5)).toBe(3);
    expect(computeStars(7, 5)).toBe(2);
    expect(computeStars(10, 5)).toBe(2);
    expect(computeStars(11, 5)).toBe(1);
  });

  it('ranks fewest moves first, then fastest time', () => {
    // Fewer moves always wins, even with a slower time.
    expect(leaderboardScore(5, 999_999)).toBeLessThan(leaderboardScore(6, 0));
    // Equal moves -> faster time wins.
    expect(leaderboardScore(5, 1000)).toBeLessThan(leaderboardScore(5, 2000));
  });

  it('round-trips encode/decode', () => {
    expect(decodeScore(leaderboardScore(7, 12_345))).toEqual({ moves: 7, timeMs: 12_345 });
  });
});
