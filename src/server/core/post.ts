import { reddit, redis } from '@devvit/web/server';
import type { SplashPostData, UgcSubmission } from '../../shared/api';
import { POST_DATA_SPLASH_KEY } from '../../shared/api';
import { difficultyFromPar } from '../../shared/solver/difficulty';
import type { Difficulty } from '../../shared/solver/difficulty';
import { getOrCreateDailyPuzzle } from './daily';
import { keys } from './keys';

/** A post as returned by submitCustomPost (structural, so no extra type import). */
type CreatedPost = Awaited<ReturnType<typeof reddit.submitCustomPost>>;

/** Wrap the static splash payload for a post's `postData` so the feed card can
 *  render instantly (read client-side via context.postData, no server call). */
const splashData = (payload: SplashPostData): Record<string, string> => ({
  [POST_DATA_SPLASH_KEY]: JSON.stringify(payload),
});

/** Link-flair background per difficulty band (cool for easy -> warm for hard). */
const FLAIR_BG: Record<Difficulty, string> = {
  EASY: '#2e7d52',
  MEDIUM: '#1d6f9c',
  HARD: '#c2552f',
  EXPERT: '#6c4fb5',
};

/** Title-case a difficulty band, e.g. EASY -> Easy. */
const bandLabel = (band: Difficulty): string => band.charAt(0) + band.slice(1).toLowerCase();

/**
 * Tag a post with its difficulty as Reddit link flair, so the feed shows an
 * at-a-glance "Easy/Medium/Hard" cue (spoiler-free: the band only, never the
 * layout or par). Best-effort: needs flair perms and must never fail the post.
 */
const setDifficultyFlair = async (post: CreatedPost, band: Difficulty): Promise<void> => {
  try {
    await reddit.setPostFlair({
      subredditName: post.subredditName,
      postId: post.id,
      text: bandLabel(band),
      backgroundColor: FLAIR_BG[band],
      textColor: 'light',
    });
  } catch (error) {
    console.error(`Failed to set difficulty post flair: ${error}`);
  }
};

/**
 * Ensures the day's puzzle exists, creates the custom post (splash entrypoint),
 * and records which date the new post shows so /api/init can look it up.
 */
export const createDailyPost = async (date: string) => {
  const puzzle = await getOrCreateDailyPuzzle(date);
  const band = difficultyFromPar(puzzle.par);

  const post = await reddit.submitCustomPost({
    title: `Ice Hop - Daily Puzzle - ${date}`,
    entry: 'default',
    // Bake the difficulty band into the post so the "Today: ..." badge shows on
    // first paint (no board - the daily stays spoiler-free).
    postData: splashData({ kind: 'daily', difficulty: band }),
    styles: {
      backgroundColor: '#0a2a43ff',
      backgroundColorDark: '#0a2a43ff',
    },
  });

  await redis.set(keys.postDate(post.id), date);

  // Tag the daily with its difficulty band (spoiler-free; the daily ramps
  // across the week, so this teases "today is Hard"). Best-effort.
  await setDifficultyFlair(post, band);

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
  // Title-case the solver-derived band and pick the right article so the feed
  // title reads naturally and teases the challenge ("an Easy", "a Medium").
  const band = difficultyFromPar(submission.par);
  const label = bandLabel(band);
  const article = /^[AEIOU]/.test(band) ? 'an' : 'a';

  const post = await reddit.submitCustomPost({
    title: `Ice Hop \u2014 ${article} ${label} puzzle by u/${submission.creator}`,
    entry: 'default',
    // Bake the board + difficulty + creator into the post so the preview renders
    // on first paint, with no /api/init round-trip (the thumbnail feels instant).
    postData: splashData({
      kind: 'ugc',
      board: submission.board,
      difficulty: band,
      creator: submission.creator,
    }),
    styles: {
      backgroundColor: '#0a2a43ff',
      backgroundColorDark: '#0a2a43ff',
    },
  });

  await redis.set(keys.ugcPost(post.id), submission.id);

  // Same difficulty link-flair as the daily, so community posts read at a glance.
  await setDifficultyFlair(post, band);

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
