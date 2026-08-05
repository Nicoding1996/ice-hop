import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type {
  MarkPlayedRequest,
  MarkPlayedResponse,
  MyPuzzlesResponse,
  SubmitPuzzleRequest,
  SubmitPuzzleResponse,
  UgcListResponse,
  VoteRequest,
  VoteResponse,
} from '../../shared/api';
import { creatorTotals } from '../../shared/community';
import { completeCommunityPuzzle } from '../core/completion';
import { listMine, listStreamForUser, submitPuzzle, votePuzzle } from '../core/ugc';

// Mounted at /api/ugc by the api router.
export const ugc = new Hono();

ugc.post('/submit', async (c) => {
  try {
    const body = await c.req.json<SubmitPuzzleRequest>();
    if (!body || !body.board || !body.proof) {
      return c.json<SubmitPuzzleResponse>(
        { ok: false, reason: 'Test and solve this exact puzzle before submitting.' },
        400
      );
    }
    return c.json<SubmitPuzzleResponse>(await submitPuzzle(body.board, body.proof));
  } catch (error) {
    console.error(`/api/ugc/submit failed: ${error}`);
    return c.json<SubmitPuzzleResponse>(
      { ok: false, reason: 'Could not submit your puzzle - try again.' },
      500
    );
  }
});

ugc.get('/list', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    return c.json<UgcListResponse>({ submissions: await listStreamForUser(username, 20) });
  } catch (error) {
    console.error(`/api/ugc/list failed: ${error}`);
    return c.json<UgcListResponse>({ submissions: [] }, 500);
  }
});

ugc.get('/mine', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const submissions = await listMine(username);
    return c.json<MyPuzzlesResponse>({ submissions, totals: creatorTotals(submissions) });
  } catch (error) {
    console.error(`/api/ugc/mine failed: ${error}`);
    return c.json<MyPuzzlesResponse>(
      { submissions: [], totals: { puzzles: 0, solves: 0, votes: 0 } },
      500
    );
  }
});

ugc.post('/vote', async (c) => {
  try {
    const body = await c.req.json<VoteRequest>();
    if (!body || !body.id) {
      return c.json<VoteResponse>({ ok: false, votes: 0, reason: 'Missing puzzle id.' }, 400);
    }
    return c.json<VoteResponse>(await votePuzzle(body.id));
  } catch (error) {
    console.error(`/api/ugc/vote failed: ${error}`);
    return c.json<VoteResponse>({ ok: false, votes: 0, reason: 'Could not upvote right now.' }, 500);
  }
});

ugc.post('/played', async (c) => {
  try {
    const body = await c.req.json<MarkPlayedRequest>();
    if (!body || typeof body.id !== 'string') {
      return c.json<MarkPlayedResponse>(
        { ok: false, saved: false, reason: 'Missing puzzle completion.' },
        400
      );
    }
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const result = await completeCommunityPuzzle(username, body.id, body.moves);
    return result.ok
      ? c.json<MarkPlayedResponse>(result)
      : c.json<MarkPlayedResponse>(result, 400);
  } catch (error) {
    console.error(`/api/ugc/played failed: ${error}`);
    return c.json<MarkPlayedResponse>(
      { ok: false, saved: false, reason: 'Could not verify this solve.' },
      500
    );
  }
});
