import { reddit, redis } from '@devvit/web/server';
import type { UgcSubmission } from '../../shared/api';
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

/**
 * Publishes an accepted community puzzle as its own feed post, credited to its
 * creator. This is the community/retention loop: each player-built puzzle gets
 * its own post that Reddit can surface in people's feeds, with a discussion
 * thread of its own. The post uses the same splash entrypoint as the daily; the
 * splash reads /api/init, sees this post maps to a UGC puzzle, and renders a
 * preview + "Play" / "Build". Returns the new post id so the caller can record
 * the post <-> puzzle link.
 */
export const createUgcPost = async (submission: UgcSubmission): Promise<string> => {
  const post = await reddit.submitCustomPost({
    title: `Ice Hop \u2014 a puzzle by u/${submission.creator}`,
    entry: 'default',
    styles: {
      backgroundColor: '#0a2a43ff',
      backgroundColorDark: '#0a2a43ff',
    },
  });

  await redis.set(keys.ugcPost(post.id), submission.id);

  // Seed a distinguished credit/how-to comment, mirroring the daily, so the
  // creator is named in the thread and there's a home for scores. Best-effort.
  try {
    const comment = await reddit.submitComment({
      id: post.id,
      text: [
        `\uD83D\uDC27 **A community puzzle by u/${submission.creator}!**`,
        'Tap a penguin to hop it over things, drag a seal to slide. Get every penguin into the water in as few moves as you can.',
        'Solved it? Drop your move count below \uD83D\uDC47 and upvote the puzzle if you liked it. Want to make your own? Tap **Build a puzzle**.',
      ].join('\n\n'),
    });
    await comment.distinguish(true);
  } catch (error) {
    console.error(`Failed to seed UGC comment: ${error}`);
  }

  return post.id;
};
