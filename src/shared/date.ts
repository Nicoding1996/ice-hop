// Date helpers shared by client and server. The daily puzzle is keyed by its
// puzzle date and generated from a deterministic seed derived from it.

export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10); // YYYY-MM-DD

/**
 * UTC hour at which a new Daily puzzle starts. It must match the
 * `scheduler.tasks.daily-puzzle` cron in devvit.json (`0 12 * * *`), so the
 * hub's "today" is always the puzzle of the newest Daily post and its thread.
 */
export const DAILY_ROLLOVER_UTC_HOUR = 12;

/**
 * The current Daily puzzle date: the UTC calendar date of the most recent
 * 12:00 UTC rollover. Puzzle "2026-10-30" runs from 2026-10-30 12:00 UTC until
 * 2026-10-31 11:59:59 UTC. Telemetry and rate limits keep plain UTC days.
 */
export const dailyPuzzleDate = (now: Date = new Date()): string =>
  todayUtc(new Date(now.getTime() - DAILY_ROLLOVER_UTC_HOUR * 3_600_000));

/** The UTC date string for the day before `date`. Used for streak continuity. */
export const previousDate = (date: string): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Whether a streak whose newest solve is `lastDate` is still alive on the
 * current puzzle date. A solve dated after `puzzleDate` also counts: players
 * who solved a calendar-dated puzzle before the 12:00 UTC rollover was
 * introduced must not see their streak drop to zero.
 */
export const isStreakCurrent = (lastDate: string, puzzleDate: string): boolean =>
  lastDate !== '' && lastDate >= previousDate(puzzleDate);

/** Stable 31-bit seed from a YYYY-MM-DD string (FNV-1a). */
export const seedFromDate = (date: string): number => {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 0x7fffffff;
};
