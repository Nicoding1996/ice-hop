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

  // Seed a distinguished/pinned comment so every daily has a discussion home
  // (the "comment section is part of the game" lever). Never let it break the
  // post if the app lacks comment/distinguish permissions.
  try {
    const comment = await reddit.submitComment({
      id: post.id,
      text: [
        "\uD83D\uDC27 **Ice Hop \u2014 today's puzzle is live!**",
        'How to play: tap a penguin to hop it over things, drag a seal to slide. Get every penguin into the water in as few moves as you can ("par" is the fewest possible).',
        'Solved it? Drop your score below \uD83D\uDC47 and see if anyone can beat your move count. You can build your own puzzle from the menu, too!',
      ].join('\n\n'),
    });
    await comment.distinguish(true);
  } catch (error) {
    console.error(`Failed to seed daily comment: ${error}`);
  }

  return post;
};
