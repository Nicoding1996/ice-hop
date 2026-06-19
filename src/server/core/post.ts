import { reddit, redis } from '@devvit/web/server';
import { getOrCreateDailyPuzzle } from './daily';
import { keys } from './keys';

/**
 * Ensures the day's puzzle exists, creates the custom post (splash entrypoint),
 * and records which date the new post shows so /api/init can look it up.
 */
export const createDailyPost = async (date: string) => {
  await getOrCreateDailyPuzzle(date);

  const post = await reddit.submitCustomPost({
    title: `Ice Hop - Daily Puzzle - ${date}`,
    entry: 'default',
    styles: {
      backgroundColor: '#0a2a43ff',
      backgroundColorDark: '#0a2a43ff',
    },
  });

  await redis.set(keys.postDate(post.id), date);
  return post;
};
