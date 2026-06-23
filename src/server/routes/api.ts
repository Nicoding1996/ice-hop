import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  EndlessResponse,
  EndlessSolvedResponse,
  EndlessTier,
  InitResponse,
  LeaderboardResponse,
  SolveResultDTO,
  SolveSubmission,
  UgcSubmission,
  CommentScoreRequest,
  CommentScoreResponse,
} from '../../shared/api';
import { getOrCreateDailyPuzzle } from '../core/daily';
import { generateEndlessFallback, getEndlessSolved, getEndlessStats, popPooledPuzzle, recordEndlessSolve } from '../core/endless';
import { getDailyLeaderboard, recordSolve } from '../core/leaderboard';
import { keys } from '../core/keys';
import { todayUtc } from '../../shared/date';
import { buildScoreComment } from '../../shared/share';
import { computeStars } from '../../shared/scoring';
import { ugc } from './ugc';

type ErrorResponse = { status: 'error'; message: string };

const ENDLESS_TIERS: ReadonlyArray<EndlessTier> = ['easy', 'medium', 'hard'];
const asTier = (value: string | undefined): EndlessTier =>
  ENDLESS_TIERS.find((t) => t === value) ?? 'easy';

export const api = new Hono();

// User-generated puzzle routes: /api/ugc/{submit,list,vote}
api.route('/ugc', ugc);

// Returns the puzzle for the current post plus the viewer's username and solve
// state. A community-puzzle feed post resolves to its UGC puzzle; a daily post
// (or `?daily=1`, which forces today's daily regardless of the current post)
// resolves to the daily. `?daily=1` lets the hub reach the daily even from
// inside a community post.
api.get('/init', async (c) => {
  try {
    const { postId } = context;
    const forceDaily = c.req.query('daily') === '1';
    const username = (await reddit.getCurrentUsername()) ?? 'anon';

    // A community-puzzle feed post: hand back that puzzle (with live vote/solve
    // counts) so the splash can preview it and the game can play it.
    if (!forceDaily && postId) {
      const ugcId = await redis.get(keys.ugcPost(postId));
      if (ugcId) {
        const raw = await redis.get(keys.ugcSubmission(ugcId));
        if (raw) {
          const sub: UgcSubmission = JSON.parse(raw);
          const [votesRaw, solvesRaw, playedScore] = await Promise.all([
            redis.zScore(keys.ugcIndex(), ugcId),
            redis.hGet(keys.ugcSolves(), ugcId),
            username !== 'anon' ? redis.zScore(keys.ugcPlayed(username), ugcId) : Promise.resolve(undefined),
          ]);
          return c.json<InitResponse>({
            type: 'init',
            kind: 'ugc',
            puzzle: {
              id: sub.id,
              board: sub.board,
              par: sub.par,
              creator: sub.creator,
              votes: typeof votesRaw === 'number' ? votesRaw : 0,
              solves: solvesRaw ? parseInt(solvesRaw, 10) : 0,
            },
            username,
            solved: typeof playedScore === 'number',
            subredditName: context.subredditName,
          });
        }
      }
    }

    // Daily puzzle: the post's mapped date, or today when forced/unmapped.
    let date = todayUtc();
    if (!forceDaily && postId) {
      const mapped = await redis.get(keys.postDate(postId));
      if (mapped) date = mapped;
    }

    const puzzle = await getOrCreateDailyPuzzle(date);
    const solveRecord = await redis.get(keys.solve(date, username));
    let solvedResult: { moves: number; stars: number } | undefined;
    if (solveRecord) {
      const rec: { moves: number; timeMs: number; stars: number } = JSON.parse(solveRecord);
      solvedResult = { moves: rec.moves, stars: rec.stars };
    }
    const subscribed = username !== 'anon' && Boolean(await redis.get(keys.subscribed(username)));

    return c.json<InitResponse>({
      type: 'init',
      kind: 'daily',
      date,
      board: puzzle.board,
      par: puzzle.par,
      username,
      solved: Boolean(solveRecord),
      solvedResult,
      subscribed,
      subredditName: context.subredditName,
    });
  } catch (error) {
    console.error(`/api/init failed: ${error}`);
    const message = error instanceof Error ? error.message : 'init failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Records a completed solve and returns stars + leaderboard rank + streak.
api.post('/solve', async (c) => {
  try {
    const body = await c.req.json<SolveSubmission>();
    if (typeof body.moves !== 'number' || typeof body.timeMs !== 'number' || !body.date) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid submission' }, 400);
    }
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const puzzle = await getOrCreateDailyPuzzle(body.date);
    const outcome = await recordSolve(body.date, username, puzzle.par, body.moves, body.timeMs);

    return c.json<SolveResultDTO>({
      accepted: true,
      stars: outcome.stars,
      par: puzzle.par,
      moves: body.moves,
      bestMoves: outcome.bestMoves,
      rank: outcome.rank,
      totalPlayers: outcome.totalPlayers,
      streak: outcome.streak,
    });
  } catch (error) {
    console.error(`/api/solve failed: ${error}`);
    const message = error instanceof Error ? error.message : 'solve failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Subscribe the viewer to the community on their behalf. Triggered only by an
// explicit "Join" tap on the win screen (Reddit's user-actions policy: a
// distinct, opt-in action that never gates play). There's no API to read live
// subscription state, so we also record an app-side flag to stop re-prompting.
api.post('/subscribe', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    if (username === 'anon') {
      return c.json<ErrorResponse>({ status: 'error', message: 'not signed in' }, 401);
    }
    await reddit.subscribeToCurrentSubreddit();
    await redis.set(keys.subscribed(username), '1');
    return c.json({ status: 'success' });
  } catch (error) {
    console.error(`/api/subscribe failed: ${error}`);
    const message = error instanceof Error ? error.message : 'subscribe failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 500);
  }
});

// Posts the player's score into the CURRENT post's comment thread, authored by
// the player (runAs: 'USER', gated by the SUBMIT_COMMENT asUser scope). Only
// fires on an explicit "Comment my score" tap. The text is composed server-side
// from the player's move count + the puzzle's par, so it stays spoiler-free and
// consistent; a community puzzle credits its maker.
api.post('/comment-score', async (c) => {
  try {
    const { postId } = context;
    if (!postId) {
      return c.json<ErrorResponse>({ status: 'error', message: 'no post in context' }, 400);
    }
    const username = await reddit.getCurrentUsername();
    if (!username) {
      return c.json<ErrorResponse>({ status: 'error', message: 'not signed in' }, 401);
    }

    const body = await c.req.json<CommentScoreRequest>();
    const moves = Math.floor(Number(body.moves));
    if (!Number.isFinite(moves) || moves <= 0) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid moves' }, 400);
    }

    // Resolve what this post shows -> par (+ creator for a community puzzle),
    // mirroring /api/init so the comment matches the puzzle being played.
    let par: number;
    let creator: string | undefined;
    const ugcId = await redis.get(keys.ugcPost(postId));
    if (ugcId) {
      const raw = await redis.get(keys.ugcSubmission(ugcId));
      if (!raw) {
        return c.json<ErrorResponse>({ status: 'error', message: 'puzzle not found' }, 404);
      }
      const sub: UgcSubmission = JSON.parse(raw);
      par = sub.par;
      creator = sub.creator;
    } else {
      const mapped = await redis.get(keys.postDate(postId));
      const puzzle = await getOrCreateDailyPuzzle(mapped ?? todayUtc());
      par = puzzle.par;
    }

    const text = buildScoreComment({ moves, par, stars: computeStars(moves, par), creator });
    await reddit.submitComment({ id: postId, text, runAs: 'USER' });
    return c.json<CommentScoreResponse>({ type: 'commentScore', ok: true });
  } catch (error) {
    console.error(`/api/comment-score failed: ${error}`);
    const message = error instanceof Error ? error.message : 'comment failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Top solvers for a given day (best first).
api.get('/leaderboard', async (c) => {
  try {
    const date = c.req.query('date') ?? todayUtc();
    const entries = await getDailyLeaderboard(date, 10);
    return c.json<LeaderboardResponse>({ date, entries });
  } catch (error) {
    console.error(`/api/leaderboard failed: ${error}`);
    const message = error instanceof Error ? error.message : 'leaderboard failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Endless mode: hand back a fresh, solver-verified puzzle for the requested
// tier plus the viewer's lifetime solved count (the progression banner).
api.get('/endless', async (c) => {
  try {
    const tier = asTier(c.req.query('tier'));
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    // Fast path: take a pre-generated puzzle from the pool. Only generate on the
    // fly when the pool is momentarily empty - and then use the FAST, bounded
    // generator so the request can never hang (the pool supplies nicer puzzles).
    const pooled = await popPooledPuzzle(tier);
    const { board, par } = pooled ?? generateEndlessFallback(tier);
    const solved = await getEndlessSolved(username);
    return c.json<EndlessResponse>({ tier, board, par, solved });
  } catch (error) {
    console.error(`/api/endless failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Lightweight lifetime count for the tier-select banner (no puzzle generation):
// the total (the banner) plus the per-tier split (the Easy/Medium/Hard labels).
api.get('/endless/stats', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const stats = await getEndlessStats(username);
    return c.json<EndlessSolvedResponse>(stats);
  } catch (error) {
    console.error(`/api/endless/stats failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless stats failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Records one endless solve (for the tier in the body) and returns the new
// lifetime total plus the per-tier split.
api.post('/endless/solved', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const body = await c.req.json<{ tier?: EndlessTier }>().catch(() => ({ tier: undefined }));
    const stats = await recordEndlessSolve(username, asTier(body.tier));
    return c.json<EndlessSolvedResponse>(stats);
  } catch (error) {
    console.error(`/api/endless/solved failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless solve failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
