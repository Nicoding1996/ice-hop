import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type {
  InitResponse,
  LeaderboardResponse,
  SolveResultDTO,
  SolveSubmission,
} from '../../shared/api';
import { getOrCreateDailyPuzzle } from '../core/daily';
import { getDailyLeaderboard, recordSolve } from '../core/leaderboard';
import { keys } from '../core/keys';
import { todayUtc } from '../../shared/date';
import { ugc } from './ugc';

type ErrorResponse = { status: 'error'; message: string };

export const api = new Hono();

// User-generated puzzle routes: /api/ugc/{submit,list,vote}
api.route('/ugc', ugc);

// Returns the puzzle for the current post (or today's, as a fallback) plus the
// viewer's username and whether they have already solved it.
api.get('/init', async (c) => {
  try {
    const { postId } = context;

    let date = todayUtc();
    if (postId) {
      const mapped = await redis.get(keys.postDate(postId));
      if (mapped) date = mapped;
    }

    const puzzle = await getOrCreateDailyPuzzle(date);
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const solveRecord = await redis.get(keys.solve(date, username));

    return c.json<InitResponse>({
      type: 'init',
      date,
      board: puzzle.board,
      par: puzzle.par,
      username,
      solved: Boolean(solveRecord),
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
