import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';
import { todayUtc } from '../../shared/date';

export const menu = new Hono();

// Moderator menu action: manually create today's puzzle post and open it.
menu.post('/post-daily', async (c) => {
  try {
    const post = await createDailyPost(todayUtc());
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}` },
      200
    );
  } catch (error) {
    console.error(`/internal/menu/post-daily failed: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create the daily puzzle post' }, 400);
  }
});
