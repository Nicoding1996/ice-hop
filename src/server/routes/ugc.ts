import { Hono } from 'hono';
import type {
  SubmitPuzzleRequest,
  SubmitPuzzleResponse,
  UgcListResponse,
  VoteRequest,
  VoteResponse,
} from '../../shared/api';
import { listSubmissions, submitPuzzle, votePuzzle } from '../core/ugc';

// Mounted at /api/ugc by the api router.
export const ugc = new Hono();

ugc.post('/submit', async (c) => {
  const body = await c.req.json<SubmitPuzzleRequest>();
  const result = await submitPuzzle(body.board);
  return c.json<SubmitPuzzleResponse>(result);
});

ugc.get('/list', async (c) => {
  const submissions = await listSubmissions(20);
  return c.json<UgcListResponse>({ submissions });
});

ugc.post('/vote', async (c) => {
  const body = await c.req.json<VoteRequest>();
  const result = await votePuzzle(body.id);
  return c.json<VoteResponse>(result);
});
