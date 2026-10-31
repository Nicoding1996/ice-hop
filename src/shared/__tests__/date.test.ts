import { describe, expect, it } from 'vitest';
import {
  DAILY_ROLLOVER_UTC_HOUR,
  dailyPuzzleDate,
  isStreakCurrent,
  previousDate,
  todayUtc,
} from '../date';

describe('dailyPuzzleDate', () => {
  it('rolls over at 12:00 UTC, matching the daily-puzzle cron', () => {
    expect(DAILY_ROLLOVER_UTC_HOUR).toBe(12);
    expect(dailyPuzzleDate(new Date('2026-10-30T11:59:59.999Z'))).toBe('2026-10-29');
    expect(dailyPuzzleDate(new Date('2026-10-30T12:00:00.000Z'))).toBe('2026-10-30');
    expect(dailyPuzzleDate(new Date('2026-10-30T23:59:59.000Z'))).toBe('2026-10-30');
    expect(dailyPuzzleDate(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10-30');
  });

  it('crosses month and year boundaries like the UTC calendar', () => {
    expect(dailyPuzzleDate(new Date('2027-01-01T06:00:00.000Z'))).toBe('2026-12-31');
    expect(dailyPuzzleDate(new Date('2026-03-01T09:00:00.000Z'))).toBe('2026-02-28');
  });

  it('keeps plain UTC days for non-Daily counters', () => {
    expect(todayUtc(new Date('2026-10-31T06:00:00.000Z'))).toBe('2026-10-31');
  });
});

describe('isStreakCurrent', () => {
  it('keeps a streak alive through the current and previous puzzle dates', () => {
    expect(isStreakCurrent('2026-10-30', '2026-10-30')).toBe(true);
    expect(isStreakCurrent(previousDate('2026-10-30'), '2026-10-30')).toBe(true);
    expect(isStreakCurrent('2026-10-28', '2026-10-30')).toBe(false);
    expect(isStreakCurrent('', '2026-10-30')).toBe(false);
  });

  it('counts a solve dated one day ahead from before the rollover change', () => {
    expect(isStreakCurrent('2026-10-31', '2026-10-30')).toBe(true);
  });
});
