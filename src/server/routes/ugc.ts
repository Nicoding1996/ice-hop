import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type {
  MarkPlayedRequest,
  SubmitPuzzleRequest,
  SubmitPuzzleResponse,
  UgcListResponse,
  VoteRequest,
  VoteResponse,
} from '../../shared/api';
import { listStreamForUser, recordPlayed, submitPuzzle, votePuzzle } from '../core/ugc';

// Mounted at /api/ugc by the api router.
export const ugc = new Hono();

ugc.post('/submit', async (c) => {
  const body = await c.req.json<SubmitPuzzleRequest>();
  const result = await submitPuzzle(body.board);
  return c.json<SubmitPuzzleResponse>(result);
});

ugc.get('/list', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? 'anon';
  const submissions = await listStreamForUser(username, 20);
  return c.json<UgcListResponse>({ submissions });
});

ugc.post('/vote', async (c) => {
  const body = await c.req.json<VoteRequest>();
  const result = await votePuzzle(body.id);
  return c.json<VoteResponse>(result);
});

ugc.post('/played', async (c) => {
  const body = await c.req.json<MarkPlayedRequest>();
  const username = (await reddit.getCurrentUsername()) ?? 'anon';
  await recordPlayed(username, body.id);
  return c.json<{ ok: boolean }>({ ok: true });
});
