import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';
import { todayUtc } from '../../shared/date';

export const triggers = new Hono();

// On install, seed the subreddit with the first daily puzzle post.
triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createDailyPost(todayUtc());
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
