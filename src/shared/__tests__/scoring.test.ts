import { describe, expect, it } from 'vitest';
import {
  computeStars,
  decodeScore,
  leaderboardScore,
  starGoal,
  starGoalLabel,
} from '../scoring';

describe('starGoal', () => {
  it('shows the best stars still reachable, matching computeStars', () => {
    // Par 6: three stars up to 7 moves, two stars up to 12, then any solve.
    expect(starGoal(0, 6)).toEqual({ stars: 3, maxMoves: 7 });
    expect(starGoal(6, 6)).toEqual({ stars: 3, maxMoves: 7 });
    expect(starGoal(7, 6)).toEqual({ stars: 2, maxMoves: 12 });
    expect(starGoal(11, 6)).toEqual({ stars: 2, maxMoves: 12 });
    expect(starGoal(12, 6)).toEqual({ stars: 1, maxMoves: null });
    for (let moves = 0; moves < 20; moves++) {
      const goal = starGoal(moves, 6);
      // Finishing on the very next move earns exactly the promised stars.
      expect(computeStars(moves + 1, 6)).toBe(goal.stars);
    }
  });

  it('labels goals the same way everywhere', () => {
    expect(starGoalLabel(starGoal(0, 6))).toBe('\u2605\u2605\u2605 up to 7');
    expect(starGoalLabel(starGoal(12, 6))).toBe('\u2605 any solve');
  });
});

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
