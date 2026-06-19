import { reddit, redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import type { SubmitPuzzleResponse, UgcSubmission, VoteResponse } from '../../shared/api';
import { validateSubmission } from '../../shared/solver/validate';
import { keys } from './keys';

/** Validate (via the solver) and store a user-submitted puzzle in the queue. */
export const submitPuzzle = async (board: Board): Promise<SubmitPuzzleResponse> => {
  const username = (await reddit.getCurrentUsername()) ?? 'anon';
  if (username === 'anon') return { ok: false, reason: 'Sign in to submit a puzzle.' };

  const validation = validateSubmission(board);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  const id = String(await redis.incrBy(keys.ugcCounter(), 1));
  const submission: UgcSubmission = {
    id,
    creator: username,
    board,
    par: validation.par,
    votes: 0,
    createdAt: Date.now(),
  };
  await redis.set(keys.ugcSubmission(id), JSON.stringify(submission));
  await redis.zAdd(keys.ugcIndex(), { member: id, score: 0 });
  return { ok: true, id, par: validation.par };
};

/** Top-voted pending submissions, most votes first. */
export const listSubmissions = async (topN: number): Promise<UgcSubmission[]> => {
  const count = await redis.zCard(keys.ugcIndex());
  if (count === 0) return [];

  const rows = await redis.zRange(keys.ugcIndex(), 0, count - 1, { by: 'rank' });
  rows.reverse(); // sorted set is ascending by votes; we want most-voted first
  const top = rows.slice(0, topN);
  if (top.length === 0) return [];

  const raws = await redis.mGet(top.map((r) => keys.ugcSubmission(r.member)));
  const out: UgcSubmission[] = [];
  for (let i = 0; i < top.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    const sub: UgcSubmission = JSON.parse(raw);
    out.push({ ...sub, votes: top[i].score });
  }
  return out;
};

/** One upvote per user per submission (enforced with hSetNX). */
export const votePuzzle = async (id: string): Promise<VoteResponse> => {
  const username = (await reddit.getCurrentUsername()) ?? 'anon';
  if (username === 'anon') return { ok: false, votes: 0 };

  const exists = await redis.exists(keys.ugcSubmission(id));
  if (!exists) return { ok: false, votes: 0 };

  const added = await redis.hSetNX(keys.ugcVoters(id), username, '1');
  if (!added) {
    const current = await redis.zScore(keys.ugcIndex(), id);
    return { ok: false, votes: typeof current === 'number' ? current : 0 };
  }

  const votes = await redis.zIncrBy(keys.ugcIndex(), id, 1);
  return { ok: true, votes };
};

/**
 * Pops the top-voted submission to become a daily puzzle (the community-curated
 * daily). Removing it from the index ensures it is used only once.
 */
export const consumeTopSubmissionForDaily = async (): Promise<{
  board: Board;
  par: number;
  creator: string;
} | null> => {
  const count = await redis.zCard(keys.ugcIndex());
  if (count === 0) return null;

  const rows = await redis.zRange(keys.ugcIndex(), 0, count - 1, { by: 'rank' });
  if (rows.length === 0) return null;
  const top = rows[rows.length - 1]; // highest votes

  const raw = await redis.get(keys.ugcSubmission(top.member));
  await redis.zRem(keys.ugcIndex(), [top.member]);
  if (!raw) return null;

  const sub: UgcSubmission = JSON.parse(raw);
  return { board: sub.board, par: sub.par, creator: sub.creator };
};
