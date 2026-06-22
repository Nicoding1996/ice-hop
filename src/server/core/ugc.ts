import { reddit, redis } from '@devvit/web/server';
import type { Board } from '../../shared/game/types';
import type { SubmitPuzzleResponse, UgcSubmission, VoteResponse } from '../../shared/api';
import { boardSignature } from '../../shared/game/board';
import { orderCommunityStream } from '../../shared/community';
import { validateSubmission } from '../../shared/solver/validate';
import { todayUtc } from '../../shared/date';
import { keys } from './keys';

/** Max puzzles one user may submit per UTC day (anti-spam). */
const DAILY_SUBMISSION_CAP = 5;
/** How many candidates to pull from each index when building a stream. */
const POOL_SIZE = 150;
/** How many random puzzles to sample across the whole catalog for discovery. */
const DISCOVERY_SAMPLE = 30;

/**
 * A random sample of up to `k` submission ids from the 1..maxId sequence.
 * Submission ids come from a contiguous monotonic counter, so sampling integers
 * gives roughly uniform exposure across the ENTIRE catalog - not just the
 * top-voted and newest windows - so older mid-tier puzzles can resurface.
 */
const sampleIdRange = (maxId: number, k: number): string[] => {
  if (maxId <= 0) return [];
  if (maxId <= k) return Array.from({ length: maxId }, (_, i) => String(i + 1));
  const picked = new Set<number>();
  for (let attempts = 0; picked.size < k && attempts < k * 5; attempts++) {
    picked.add(1 + Math.floor(Math.random() * maxId));
  }
  return [...picked].map(String);
};

/** Validate (via the solver), rate-limit, de-duplicate, then store a puzzle. */
export const submitPuzzle = async (board: Board): Promise<SubmitPuzzleResponse> => {
  const username = (await reddit.getCurrentUsername()) ?? 'anon';
  if (username === 'anon') return { ok: false, reason: 'Sign in to submit a puzzle.' };

  const validation = validateSubmission(board);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  // Rate limit: at most DAILY_SUBMISSION_CAP accepted submissions per day.
  const today = todayUtc();
  const countRaw = await redis.get(keys.ugcDailyCount(username, today));
  const todayCount = countRaw ? parseInt(countRaw, 10) : 0;
  if (todayCount >= DAILY_SUBMISSION_CAP) {
    return { ok: false, reason: `You've hit today's limit of ${DAILY_SUBMISSION_CAP} puzzles. Try again tomorrow!` };
  }

  // De-duplicate: hSetNX reserves the signature and tells us if it was new.
  const isNew = await redis.hSetNX(keys.ugcBoards(), boardSignature(board), username);
  if (!isNew) return { ok: false, reason: 'That exact puzzle has already been submitted.' };

  const id = String(await redis.incrBy(keys.ugcCounter(), 1));
  const submission: UgcSubmission = {
    id,
    creator: username,
    board,
    par: validation.par,
    votes: 0,
    solves: 0,
    createdAt: Date.now(),
  };
  await redis.set(keys.ugcSubmission(id), JSON.stringify(submission));
  await redis.zAdd(keys.ugcIndex(), { member: id, score: 0 });
  await redis.zAdd(keys.ugcRecent(), { member: id, score: submission.createdAt });
  // Index by creator so the player can find their puzzles in "My puzzles".
  await redis.zAdd(keys.ugcByCreator(username), { member: id, score: submission.createdAt });
  const dailyKey = keys.ugcDailyCount(username, today);
  await redis.incrBy(dailyKey, 1);
  // The per-day counter only matters for "today"; let it auto-clean.
  if (todayCount === 0) await redis.expire(dailyKey, 60 * 60 * 48);
  return { ok: true, id, par: validation.par };
};

/** The set of submission ids a user has already solved. */
const getPlayedIds = async (username: string): Promise<Set<string>> => {
  if (username === 'anon') return new Set<string>();
  const count = await redis.zCard(keys.ugcPlayed(username));
  if (count === 0) return new Set<string>();
  const rows = await redis.zRange(keys.ugcPlayed(username), 0, count - 1, { by: 'rank' });
  return new Set(rows.map((r) => r.member));
};

/** Record that a user solved a community puzzle, so it leaves their stream. The
 *  per-puzzle solve count ticks up only on a user's first solve (zAdd reports
 *  whether the member was new, so concurrent solves can't double-count) and
 *  never for a creator solving their own puzzle (mirrors the no-self-vote rule). */
export const recordPlayed = async (username: string, id: string): Promise<void> => {
  if (username === 'anon') return;
  const raw = await redis.get(keys.ugcSubmission(id));
  if (!raw) return;
  const sub: UgcSubmission = JSON.parse(raw);
  const added = await redis.zAdd(keys.ugcPlayed(username), { member: id, score: Date.now() });
  if (added > 0 && sub.creator !== username) {
    await redis.hIncrBy(keys.ugcSolves(), id, 1);
  }
};

/** Live solve counts for a set of ids (hash id -> count); missing -> 0. */
const solvesByID = async (ids: readonly string[]): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const counts = await redis.hMGet(keys.ugcSolves(), [...ids]);
  ids.forEach((id, i) => {
    const raw = counts[i];
    map.set(id, raw ? parseInt(raw, 10) : 0);
  });
  return map;
};

/** Live vote counts for a set of ids, reading the index sorted set (the source
 *  of truth). `seed` pre-fills scores we already fetched (e.g. the top pool) so
 *  we only look up the rest. */
const votesByID = async (
  ids: readonly string[],
  seed: Map<string, number>
): Promise<Map<string, number>> => {
  const map = new Map<string, number>(seed);
  const missing = ids.filter((id) => !map.has(id));
  const scores = await Promise.all(missing.map((id) => redis.zScore(keys.ugcIndex(), id)));
  missing.forEach((id, i) => map.set(id, scores[i] ?? 0));
  return map;
};

/**
 * Build a player's community stream: a candidate pool of the top-voted and the
 * newest submissions, with the player's solved puzzles and own puzzles removed,
 * interleaved so popular and fresh puzzles both show up (see community.ts).
 */
export const listStreamForUser = async (
  username: string,
  limit: number
): Promise<UgcSubmission[]> => {
  const voteCount = await redis.zCard(keys.ugcIndex());
  if (voteCount === 0) return [];

  const topRows = await redis.zRange(
    keys.ugcIndex(),
    Math.max(0, voteCount - POOL_SIZE),
    voteCount - 1,
    { by: 'rank' }
  );
  // Seed with the scores we already have from the top pool; the rest are looked
  // up below so recent-but-not-top puzzles still show their true vote count.
  const topScores = new Map<string, number>();
  for (const r of topRows) topScores.set(r.member, r.score);

  const recentCount = await redis.zCard(keys.ugcRecent());
  const recentRows =
    recentCount > 0
      ? await redis.zRange(keys.ugcRecent(), Math.max(0, recentCount - POOL_SIZE), recentCount - 1, {
          by: 'rank',
        })
      : [];

  // A random sample of the whole catalog so older mid-tier puzzles can
  // resurface instead of being buried behind the top/newest windows forever.
  const maxId = parseInt((await redis.get(keys.ugcCounter())) ?? '0', 10);
  const sampleIds = sampleIdRange(maxId, DISCOVERY_SAMPLE);

  const ids = [
    ...new Set([
      ...topRows.map((r) => r.member),
      ...recentRows.map((r) => r.member),
      ...sampleIds,
    ]),
  ];
  if (ids.length === 0) return [];

  const [raws, voteByID, solveByID] = await Promise.all([
    redis.mGet(ids.map((id) => keys.ugcSubmission(id))),
    votesByID(ids, topScores),
    solvesByID(ids),
  ]);
  const byId = new Map<string, UgcSubmission>();
  const subs: UgcSubmission[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    const parsed: UgcSubmission = JSON.parse(raw);
    const sub: UgcSubmission = {
      ...parsed,
      votes: voteByID.get(ids[i]) ?? 0,
      solves: solveByID.get(ids[i]) ?? 0,
    };
    subs.push(sub);
    byId.set(ids[i], sub);
  }
  // The discovery lane is the resolved subset of the random sample.
  const discovery = sampleIds
    .map((id) => byId.get(id))
    .filter((s): s is UgcSubmission => s !== undefined);

  const playedIds = await getPlayedIds(username);
  // Note: we intentionally do NOT exclude the player's own puzzles, so creators
  // can see their submission go live (and a solo tester/judge isn't shown an
  // empty stream). Solved puzzles are still filtered out via playedIds.
  return orderCommunityStream(subs, { playedIds, limit, discovery });
};

/** The player's own submissions, newest first, with live votes + solve counts.
 *  Powers the "My puzzles" creator-feedback view. */
export const listMine = async (username: string): Promise<UgcSubmission[]> => {
  if (username === 'anon') return [];
  const count = await redis.zCard(keys.ugcByCreator(username));
  if (count === 0) return [];

  const rows = await redis.zRange(keys.ugcByCreator(username), 0, count - 1, { by: 'rank' });
  const ids = rows.map((r) => r.member);
  const [raws, voteByID, solveByID] = await Promise.all([
    redis.mGet(ids.map((id) => keys.ugcSubmission(id))),
    votesByID(ids, new Map<string, number>()),
    solvesByID(ids),
  ]);
  const subs: UgcSubmission[] = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    const sub: UgcSubmission = JSON.parse(raw);
    subs.push({ ...sub, votes: voteByID.get(ids[i]) ?? 0, solves: solveByID.get(ids[i]) ?? 0 });
  }
  subs.sort((a, b) => b.createdAt - a.createdAt);
  return subs;
};

/** One upvote per user per submission (enforced with hSetNX). Creators cannot
 *  upvote their own puzzles. */
export const votePuzzle = async (id: string): Promise<VoteResponse> => {
  const username = (await reddit.getCurrentUsername()) ?? 'anon';
  if (username === 'anon') return { ok: false, votes: 0, reason: 'Sign in to upvote.' };

  const raw = await redis.get(keys.ugcSubmission(id));
  if (!raw) return { ok: false, votes: 0, reason: 'That puzzle is no longer around.' };
  const sub: UgcSubmission = JSON.parse(raw);

  const currentVotes = async (): Promise<number> => {
    const v = await redis.zScore(keys.ugcIndex(), id);
    return typeof v === 'number' ? v : 0;
  };

  if (sub.creator === username) {
    return { ok: false, votes: await currentVotes(), reason: "You can't upvote your own puzzle." };
  }

  const added = await redis.hSetNX(keys.ugcVoters(id), username, '1');
  if (!added) return { ok: false, votes: await currentVotes(), reason: 'You already upvoted this one.' };

  const votes = await redis.zIncrBy(keys.ugcIndex(), id, 1);
  return { ok: true, votes };
};
