import { describe, expect, it } from 'vitest';
import type { Board } from '../../../shared/game/types';
import { boardFingerprintId } from '../../../shared/game/symmetry';
import { difficultyFromPar } from '../../../shared/solver/difficulty';
import { analyzeRoles } from '../../../shared/solver/quality';
import { solve } from '../../../shared/solver/solver';
import { analyzeBoard } from '../../../shared/solver/stateGraph';
import {
  DAILY_FALLBACKS,
  DAILY_LADDERS,
  DAILY_MAX_THREE_STAR_LUCK,
  DAILY_PREPARE_POLICY,
  dailyParBand,
  dailyTierForDate,
  generateDailyOnDemand,
  generateDesignedDaily,
  isDailyParInBand,
  parsePreparedDaily,
  upcomingDailyDates,
  type DailyTier,
} from '../dailyPolicy';

const TIERS: readonly DailyTier[] = ['easy', 'medium', 'hard'];

/** A Monday (Easy), Wednesday (Medium), and Saturday (Hard). */
const DATES: Readonly<Record<DailyTier, string>> = {
  easy: '2026-08-03',
  medium: '2026-08-05',
  hard: '2026-08-08',
};

const mixOf = (board: Board): string =>
  ['HOPPER', 'SLIDER', 'BLOCKER']
    .map((kind) => board.pieces.filter((piece) => piece.kind === kind).length)
    .join('/');

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

describe('week-ahead Daily rules', () => {
  it.each(TIERS)(
    'builds a %s Daily with one best solution, no clutter, and low 3-star luck',
    (tier) => {
      const date = DATES[tier];
      const designed = generateDesignedDaily(date, { deadlineMs: 15_000, seed: 21 });
      expect(designed).not.toBeNull();
      if (!designed) return;
      const analysis = analyzeBoard(designed.board);
      expect(analysis?.par).toBe(designed.par);
      expect(isDailyParInBand(tier, designed.par)).toBe(true);
      expect(analysis?.bestSolutions).toBe(1);
      expect(analysis?.threeStarLuck ?? 1).toBeLessThanOrEqual(DAILY_MAX_THREE_STAR_LUCK[tier]);
      const mixes = DAILY_LADDERS[tier].map(
        (config) => `${config.hoppers}/${config.sliders}/${config.blockers}`
      );
      expect(mixes).toContain(mixOf(designed.board));
      const roles = analyzeRoles(designed.board, solve(designed.board).solution);
      expect(roles.inert.size).toBe(0);
      if (tier === 'easy') expect(roles.used.size).toBe(designed.board.pieces.length);
    }
  );

  it('never repeats an excluded puzzle', () => {
    const first = generateDesignedDaily(DATES.medium, { deadlineMs: 15_000, seed: 5 });
    expect(first).not.toBeNull();
    if (!first) return;
    const id = boardFingerprintId(first.board);
    const next = generateDesignedDaily(DATES.medium, {
      deadlineMs: 15_000,
      seed: 5,
      exclude: new Set([id]),
    });
    expect(next && boardFingerprintId(next.board)).not.toBe(id);
  });

  it('stops when its time budget is spent', () => {
    expect(generateDesignedDaily(DATES.hard, { deadlineMs: 0 })).toBeNull();
  });

  it('lists the seven puzzle dates after today', () => {
    expect(upcomingDailyDates('2026-10-31')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
  });

  it('uses a prepared puzzle only for its own date, rules version, and verified par', () => {
    const date = DATES.medium;
    const designed = generateDesignedDaily(date, { deadlineMs: 15_000, seed: 9 });
    expect(designed).not.toBeNull();
    if (!designed) return;
    const entry = { date, board: designed.board, par: designed.par, policy: DAILY_PREPARE_POLICY };
    const raw = JSON.stringify(entry);

    expect(parsePreparedDaily(raw, date)).toEqual(entry);
    expect(parsePreparedDaily(raw, '2026-08-06')).toBeNull();
    expect(parsePreparedDaily(JSON.stringify({ ...entry, policy: 0 }), date)).toBeNull();
    expect(parsePreparedDaily(JSON.stringify({ ...entry, par: designed.par + 1 }), date)).toBeNull();
    // A Medium board stored for an Easy (Monday) date is out of band.
    expect(
      parsePreparedDaily(JSON.stringify({ ...entry, date: DATES.easy }), DATES.easy)
    ).toBeNull();
    expect(parsePreparedDaily('{not json', date)).toBeNull();
    expect(parsePreparedDaily(undefined, date)).toBeNull();
  });

  it.each(TIERS)('still makes an in-band %s Daily on demand', (tier) => {
    const generated = generateDailyOnDemand(DATES[tier], 1234);
    expect(isDailyParInBand(tier, generated.par)).toBe(true);
    expect(solve(generated.board, { maxStates: 400_000 }).par).toBe(generated.par);
    expect(generated.pass).toBe('designed');
  });
});
