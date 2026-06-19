import { describe, expect, it } from 'vitest';
import { buildShareText } from '../share';

describe('buildShareText', () => {
  it('includes the score, streak and rank but never the board', () => {
    const text = buildShareText({
      date: '2026-06-19',
      moves: 8,
      par: 7,
      stars: 3,
      streak: 5,
      rank: 3,
      totalPlayers: 47,
    });
    expect(text).toContain('Ice Hop');
    expect(text).toContain('2026-06-19');
    expect(text).toContain('8 moves (par 7)');
    expect(text).toContain('5-day streak');
    expect(text).toContain('#3/47');
    // Spoiler-free: no board internals leak into the share text.
    expect(text).not.toContain('HOPPER');
    expect(text).not.toContain('cells');
  });

  it('omits the streak/rank line for a first, unranked solve', () => {
    const text = buildShareText({
      date: '2026-06-19',
      moves: 5,
      par: 5,
      stars: 3,
      streak: 1,
      rank: 0,
      totalPlayers: 0,
    });
    expect(text).not.toContain('streak');
    expect(text).not.toContain('#');
  });
});
