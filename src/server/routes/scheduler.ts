import { Hono } from 'hono';
import { createDailyPost } from '../core/post';
import { refillEndlessPools } from '../core/endless';
import { todayUtc } from '../../shared/date';

export const scheduler = new Hono();

// Cron task (registered in devvit.json as scheduler.tasks.daily-puzzle):
// posts a fresh puzzle to the feed each day.
scheduler.post('/daily-puzzle', async (c) => {
  try {
    const post = await createDailyPost(todayUtc());
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
