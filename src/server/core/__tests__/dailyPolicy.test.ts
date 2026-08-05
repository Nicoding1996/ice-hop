import { describe, expect, it } from 'vitest';
import { difficultyFromPar } from '../../../shared/solver/difficulty';
import { solve } from '../../../shared/solver/solver';
import {
  DAILY_FALLBACKS,
  DAILY_LADDERS,
  dailyParBand,
  dailyTierForDate,
  isDailyParInBand,
  type DailyTier,
} from '../dailyPolicy';

const TIERS: readonly DailyTier[] = ['easy', 'medium', 'hard'];

describe('daily difficulty policy', () => {
  it('maps weekdays to the intended deterministic tier', () => {
    expect(dailyTierForDate('2026-08-03')).toBe('easy'); // Monday
    expect(dailyTierForDate('2026-08-04')).toBe('easy'); // Tuesday
    expect(dailyTierForDate('2026-08-05')).toBe('medium'); // Wednesday
    expect(dailyTierForDate('2026-08-07')).toBe('medium'); // Friday
    expect(dailyTierForDate('2026-08-08')).toBe('hard'); // Saturday
    expect(dailyTierForDate('2026-08-09')).toBe('hard'); // Sunday
    expect(() => dailyTierForDate('not-a-date')).toThrow('Invalid daily puzzle date.');
  });

  it('uses non-overlapping bands with a global minimum par of four', () => {
    expect(dailyParBand('easy')).toEqual({ min: 4, max: 4 });
    expect(dailyParBand('medium')).toEqual({ min: 5, max: 7 });
    expect(dailyParBand('hard')).toEqual({ min: 8, max: 11 });

    for (const tier of TIERS) {
      for (const config of DAILY_LADDERS[tier]) {
        expect(config.minPar).toBeGreaterThanOrEqual(4);
        expect(isDailyParInBand(tier, config.minPar)).toBe(true);
        expect(isDailyParInBand(tier, config.maxPar)).toBe(true);
      }
    }
  });

  it('keeps every deterministic fallback solved, declared at its true par, and in tier', () => {
    const expectedDifficulty = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };

    for (const tier of TIERS) {
      const fallback = DAILY_FALLBACKS[tier];
      const result = solve(fallback.board);
      expect(result.solvable).toBe(true);
      expect(result.par).toBe(fallback.par);
      expect(isDailyParInBand(tier, result.par)).toBe(true);
      expect(difficultyFromPar(result.par)).toBe(expectedDifficulty[tier]);
    }
  });
});
