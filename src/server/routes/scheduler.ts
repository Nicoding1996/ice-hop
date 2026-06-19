import { Hono } from 'hono';
import { createDailyPost } from '../core/post';
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
