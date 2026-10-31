import { Hono } from 'hono';
import { createDailyPost } from '../core/post';
import { refillEndlessPools } from '../core/endless';
import { dailyPuzzleDate } from '../../shared/date';

export const scheduler = new Hono();

// Cron task (registered in devvit.json as scheduler.tasks.daily-puzzle):
// posts a fresh puzzle to the feed each day at the 12:00 UTC rollover.
scheduler.post('/daily-puzzle', async (c) => {
  try {
    // Runs at 12:00 UTC, so the puzzle date is also today's UTC calendar date.
    // A delivery a few seconds early must not re-post the previous puzzle.
    const post = await createDailyPost(dailyPuzzleDate(new Date(Date.now() + 5 * 60_000)));
    return c.json({ status: 'success', postId: post.id }, 200);
  } catch (error) {
    console.error(`/internal/scheduler/daily-puzzle failed: ${error}`);
    return c.json({ status: 'error' }, 400);
  }
});

// Cron task (registered in devvit.json as scheduler.tasks.endless-refill): keeps
// the per-tier endless pools topped up so endless requests only ever do a fast
// pop instead of generating a puzzle inline. No-ops when the pools are full.
scheduler.post('/endless-refill', async (c) => {
  try {
    const added = await refillEndlessPools();
    return c.json({ status: 'success', added }, 200);
  } catch (error) {
    console.error(`/internal/scheduler/endless-refill failed: ${error}`);
    return c.json({ status: 'error' }, 400);
  }
});
