import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';
import { refillEndlessPools } from '../core/endless';
import { todayUtc } from '../../shared/date';

export const triggers = new Hono();

// On install, seed the subreddit with the first daily puzzle post.
triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createDailyPost(todayUtc());
    // Warm a batch of endless puzzles (spread across tiers) so the first plays
    // are instant. Isolated so a warm-up hiccup never fails the install; the
    // cron tops the rest up over time.
    try {
      await refillEndlessPools(12);
    } catch (warmError) {
      console.error(`endless warm-up on install failed: ${warmError}`);
    }
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Created first daily post ${post.id} in r/${context.subredditName} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`/internal/triggers/on-app-install failed: ${error}`);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create post' }, 400);
  }
});
