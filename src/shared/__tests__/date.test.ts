import { describe, expect, it } from 'vitest';
import {
  DAILY_ROLLOVER_UTC_HOUR,
  addDays,
  dailyPuzzleDate,
  formatPuzzleDate,
  isStreakCurrent,
  previousDate,
  todayUtc,
  weekDates,
  weekStartDate,
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

describe('weekly board dates', () => {
  it('starts every week on its Monday puzzle date', () => {
    // 2026-10-26 is a Monday; 2026-11-01 is the Sunday that ends its week.
    expect(weekStartDate('2026-10-26')).toBe('2026-10-26');
    expect(weekStartDate('2026-10-30')).toBe('2026-10-26');
    expect(weekStartDate('2026-11-01')).toBe('2026-10-26');
    expect(weekStartDate('2026-11-02')).toBe('2026-11-02');
    expect(weekStartDate('2027-01-01')).toBe('2026-12-28');
  });

  it('resets with the Monday 12:00 UTC rollover, not at midnight', () => {
    expect(weekStartDate(dailyPuzzleDate(new Date('2026-11-02T11:59:00.000Z')))).toBe(
      '2026-10-26'
    );
    expect(weekStartDate(dailyPuzzleDate(new Date('2026-11-02T12:00:00.000Z')))).toBe(
      '2026-11-02'
    );
  });

  it('lists the seven puzzle dates of a week across a month boundary', () => {
    expect(weekDates('2026-10-26')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
  });
});

describe('formatPuzzleDate', () => {
  it('formats short, locale-independent labels', () => {
    expect(formatPuzzleDate('2026-10-30')).toBe('Oct 30');
    expect(formatPuzzleDate('2026-10-30', true)).toBe('Fri, Oct 30');
    expect(formatPuzzleDate('2027-01-01', true)).toBe('Fri, Jan 1');
  });

  it('leaves an unparseable value untouched', () => {
    expect(formatPuzzleDate('not-a-date')).toBe('not-a-date');
  });
});
