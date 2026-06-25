import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type {
  MarkPlayedRequest,
  MyPuzzlesResponse,
  SubmitPuzzleRequest,
  SubmitPuzzleResponse,
  UgcListResponse,
  VoteRequest,
  VoteResponse,
} from '../../shared/api';
import { listMine, listStreamForUser, recordPlayed, submitPuzzle, votePuzzle } from '../core/ugc';
import { creatorTotals } from '../../shared/community';

// Mounted at /api/ugc by the api router.
export const ugc = new Hono();

// Every handler is wrapped so a malformed body or a transient Redis failure
// returns a well-formed JSON error (mirroring the /api and /internal routes)
// instead of an unhandled throw. The shapes match each route's success type so
// the client's existing parsing/`response.ok` handling degrades gracefully.

ugc.post('/submit', async (c) => {
  try {
    const body = await c.req.json<SubmitPuzzleRequest>();
    if (!body || !body.board) {
      return c.json<SubmitPuzzleResponse>({ ok: false, reason: 'No puzzle to submit.' }, 400);
    }
    const result = await submitPuzzle(body.board);
    return c.json<SubmitPuzzleResponse>(result);
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
    const submissions = await listStreamForUser(username, 20);
    return c.json<UgcListResponse>({ submissions });
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
    const result = await votePuzzle(body.id);
    return c.json<VoteResponse>(result);
  } catch (error) {
    console.error(`/api/ugc/vote failed: ${error}`);
    return c.json<VoteResponse>({ ok: false, votes: 0, reason: 'Could not upvote right now.' }, 500);
  }
});

ugc.post('/played', async (c) => {
  try {
    const body = await c.req.json<MarkPlayedRequest>();
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    if (body && body.id) await recordPlayed(username, body.id);
    return c.json<{ ok: boolean }>({ ok: true });
  } catch (error) {
    console.error(`/api/ugc/played failed: ${error}`);
    return c.json<{ ok: boolean }>({ ok: false }, 500);
  }
});
