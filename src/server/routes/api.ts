import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import { buildDailyBoardTeaser } from '../../shared/api';
import type {
  CommentScoreResponse,
  EndlessHintRequest,
  EndlessHintResponse,
  EndlessResponse,
  EndlessReleaseRequest,
  EndlessSolvedResponse,
  EndlessSolveRequest,
  EndlessSolveResponse,
  EndlessTier,
  InitResponse,
  LeaderboardResponse,
  PostPreviewResponse,
  SolveResultDTO,
  SolveSubmission,
  UgcSubmission,
} from '../../shared/api';
import { buildAchievementSnapshot } from '../../shared/achievements';
import {
  dailyPuzzleId,
  parseDailyPuzzleId,
  parsePostDailyMapping,
  sameDailyPuzzle,
  type DailyPuzzleRef,
} from '../../shared/daily';
import { verifySolvedTranscript } from '../../shared/game/replay';
import { validateBoardStructure } from '../../shared/game/validation';
import { todayUtc } from '../../shared/date';
import { buildScoreComment } from '../../shared/share';
import { computeStars } from '../../shared/scoring';
import { difficultyFromPar } from '../../shared/solver/difficulty';
import type { TelemetryEventRequest } from '../../shared/telemetry';
import { isClientTelemetryEvent } from '../../shared/telemetry';
import { syncAchievements } from '../core/achievements';
import {
  completeEndlessPuzzle,
  finalizeEndlessIssue,
  getBestCommunityCompletion,
  getDailyElapsed,
  getEndlessHint,
  issueDailyPlay,
  releaseEndlessIssue,
  reserveEndlessIssue,
} from '../core/completion';
import { getCanonicalDailyRef, getDailyPuzzle } from '../core/daily';
import {
  generateEndlessFallback,
  getEndlessSolved,
  getEndlessStats,
  popPooledPuzzle,
} from '../core/endless';
import { keys } from '../core/keys';
import {
  getBestDailySolve,
  getDailyLeaderboard,
  recordSolve,
} from '../core/leaderboard';
import {
  trackClientTelemetry,
  trackDailyActive,
  trackEndlessIssued,
  trackTelemetry,
} from '../core/telemetry';
import { ugc } from './ugc';

type ErrorResponse = { status: 'error'; message: string };

const ENDLESS_TIERS: ReadonlyArray<EndlessTier> = ['easy', 'medium', 'hard'];
const asTier = (value: string | undefined): EndlessTier =>
  ENDLESS_TIERS.find((tier) => tier === value) ?? 'easy';

const isCommentId = (id: string): id is `t1_${string}` => id.startsWith('t1_');

const getPostDailyRef = async (postId: string): Promise<DailyPuzzleRef | null> => {
  const raw = await redis.get(keys.postDate(postId));
  if (!raw) return null;
  const ref = parsePostDailyMapping(raw);
  if (!ref) throw new Error('Post has an invalid daily puzzle mapping.');
  return ref;
};

const isTrustedDailyRef = async (requestedRef: DailyPuzzleRef): Promise<boolean> => {
  if (sameDailyPuzzle(requestedRef, await getCanonicalDailyRef(todayUtc()))) return true;
  if (!context.postId) return false;
  const hostRef = await getPostDailyRef(context.postId);
  return hostRef !== null && sameDailyPuzzle(requestedRef, hostRef);
};

export const api = new Hono();
api.route('/ugc', ugc);

/**
 * Feed-safe post metadata. This route deliberately never calls issueDailyPlay,
 * so scrolling past a Daily neither exposes its cells nor starts its timer.
 */
api.get('/post-preview', async (c) => {
  try {
    const { postId } = context;
    let dailyRef: DailyPuzzleRef;

    if (postId) {
      const ugcId = await redis.get(keys.ugcPost(postId));
      if (ugcId) {
        const raw = await redis.get(keys.ugcSubmission(ugcId));
        if (!raw) {
          return c.json<ErrorResponse>(
            { status: 'error', message: 'community puzzle is unavailable' },
            404
          );
        }

        const sub: UgcSubmission = JSON.parse(raw);
        const structure = validateBoardStructure(sub.board);
        if (!structure.ok) throw new Error('Community puzzle board is invalid.');

        const username = await reddit.getCurrentUsername();
        const [solvesRaw, playedScore] = await Promise.all([
          redis.hGet(keys.ugcSolves(), ugcId),
          username
            ? redis.zScore(keys.ugcPlayed(username), ugcId)
            : Promise.resolve(undefined),
        ]);
        const parsedSolves = solvesRaw ? Number.parseInt(solvesRaw, 10) : 0;
        const solves =
          Number.isSafeInteger(parsedSolves) && parsedSolves >= 0 ? parsedSolves : 0;

        return c.json<PostPreviewResponse>({
          type: 'post-preview',
          kind: 'ugc',
          board: structure.board,
          difficulty: difficultyFromPar(sub.par),
          creator: sub.creator,
          solves,
          solved: typeof playedScore === 'number',
        });
      }

      const hostRef = await getPostDailyRef(postId);
      if (!hostRef) {
        return c.json<ErrorResponse>(
          { status: 'error', message: 'post is not linked to a puzzle' },
          404
        );
      }
      dailyRef = hostRef;
    } else {
      dailyRef = await getCanonicalDailyRef(todayUtc());
    }

    const puzzle = await getDailyPuzzle(dailyRef);
    return c.json<PostPreviewResponse>({
      type: 'post-preview',
      kind: 'daily',
      date: puzzle.date,
      difficulty: difficultyFromPar(puzzle.par),
      teaser: buildDailyBoardTeaser(puzzle.board),
    });
  } catch (error) {
    console.error(`/api/post-preview failed: ${error}`);
    const message = error instanceof Error ? error.message : 'post preview failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/init', async (c) => {
  try {
    const { postId } = context;
    const forceDaily = c.req.query('daily') === '1';
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const signedIn = username !== 'anon';
    await trackDailyActive(username);

    let dailyRef: DailyPuzzleRef;
    if (!forceDaily && postId) {
      const ugcId = await redis.get(keys.ugcPost(postId));
      if (ugcId) {
        const raw = await redis.get(keys.ugcSubmission(ugcId));
        if (!raw) {
          return c.json<ErrorResponse>(
            { status: 'error', message: 'community puzzle is unavailable' },
            404
          );
        }

        const sub: UgcSubmission = JSON.parse(raw);
        const structure = validateBoardStructure(sub.board);
        if (!structure.ok) throw new Error('Community puzzle board is invalid.');
        const [votesRaw, solvesRaw, playedScore] = await Promise.all([
          redis.zScore(keys.ugcIndex(), ugcId),
          redis.hGet(keys.ugcSolves(), ugcId),
          signedIn
            ? redis.zScore(keys.ugcPlayed(username), ugcId)
            : Promise.resolve(undefined),
        ]);
        return c.json<InitResponse>({
          type: 'init',
          kind: 'ugc',
          puzzle: {
            id: sub.id,
            board: structure.board,
            par: sub.par,
            difficulty: difficultyFromPar(sub.par),
            creator: sub.creator,
            votes: typeof votesRaw === 'number' ? votesRaw : 0,
            solves: solvesRaw ? Number.parseInt(solvesRaw, 10) : 0,
          },
          username,
          solved: typeof playedScore === 'number',
          subredditName: context.subredditName,
        });
      }

      const hostRef = await getPostDailyRef(postId);
      if (!hostRef) {
        return c.json<ErrorResponse>(
          { status: 'error', message: 'post is not linked to a puzzle' },
          404
        );
      }
      dailyRef = hostRef;
    } else {
      dailyRef = await getCanonicalDailyRef(todayUtc());
    }

    const puzzle = await getDailyPuzzle(dailyRef);
    const [solveRecord, subscribed, playId] = await Promise.all([
      signedIn ? getBestDailySolve(dailyRef, username) : Promise.resolve(null),
      signedIn
        ? redis.get(keys.subscribed(username)).then((value) => Boolean(value))
        : Promise.resolve(false),
      issueDailyPlay(username, dailyRef),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      kind: 'daily',
      puzzleId: puzzle.id,
      date: puzzle.date,
      playId,
      board: puzzle.board,
      par: puzzle.par,
      difficulty: difficultyFromPar(puzzle.par),
      username,
      solved: solveRecord !== null,
      ...(solveRecord
        ? { solvedResult: { moves: solveRecord.moves, stars: solveRecord.stars } }
        : {}),
      subscribed,
      subredditName: context.subredditName,
    });
  } catch (error) {
    console.error(`/api/init failed: ${error}`);
    const message = error instanceof Error ? error.message : 'init failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/solve', async (c) => {
  try {
    const body = await c.req.json<SolveSubmission>();
    if (
      !body ||
      typeof body.puzzleId !== 'string' ||
      typeof body.playId !== 'string'
    ) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid submission' }, 400);
    }

    const requestedRef = parseDailyPuzzleId(body.puzzleId);
    if (!requestedRef) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid puzzle id' }, 400);
    }

    const username = await reddit.getCurrentUsername();
    const timeMs = await getDailyElapsed(username ?? 'anon', body.playId, requestedRef);
    if (timeMs === null && !(await isTrustedDailyRef(requestedRef))) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid puzzle id' }, 400);
    }

    const puzzle = await getDailyPuzzle(requestedRef);
    const replay = verifySolvedTranscript(puzzle.board, body.moves);
    if (!replay.ok || replay.moveCount < puzzle.par) {
      return c.json<ErrorResponse>(
        { status: 'error', message: replay.ok ? 'invalid move history' : replay.reason },
        400
      );
    }

    const moves = replay.moveCount;
    if (!username) {
      await trackTelemetry('daily:completed:guest');
      return c.json<SolveResultDTO>({
        accepted: true,
        stars: computeStars(moves, puzzle.par),
        par: puzzle.par,
        moves,
        bestMoves: moves,
        rank: 0,
        totalPlayers: 0,
        streak: 0,
      });
    }

    if (timeMs === null) {
      return c.json<ErrorResponse>({ status: 'error', message: 'daily play has expired' }, 400);
    }
    const outcome = await recordSolve(requestedRef, username, puzzle.par, moves, timeMs);
    if (outcome.firstSolve) await trackTelemetry('daily:completed:signed');
    return c.json<SolveResultDTO>({
      accepted: true,
      stars: outcome.stars,
      par: puzzle.par,
      moves,
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

api.post('/subscribe', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      return c.json<ErrorResponse>({ status: 'error', message: 'not signed in' }, 401);
    }
    try {
      await reddit.subscribeToCurrentSubreddit();
    } catch (subscribeError) {
      console.warn(`/api/subscribe: already a member or transient failure: ${subscribeError}`);
    }
    await redis.set(keys.subscribed(username), '1');
    return c.json({ status: 'success' });
  } catch (error) {
    console.error(`/api/subscribe failed: ${error}`);
    const message = error instanceof Error ? error.message : 'subscribe failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 500);
  }
});

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

    let moves: number;
    let par: number;
    let creator: string | undefined;
    const ugcId = await redis.get(keys.ugcPost(postId));
    if (ugcId) {
      const raw = await redis.get(keys.ugcSubmission(ugcId));
      if (!raw) {
        return c.json<ErrorResponse>({ status: 'error', message: 'puzzle not found' }, 404);
      }
      const sub: UgcSubmission = JSON.parse(raw);
      const completion = await getBestCommunityCompletion(username, ugcId);
      if (!completion || completion.par !== sub.par) {
        return c.json<ErrorResponse>({ status: 'error', message: 'solve not verified' }, 403);
      }
      moves = completion.moves;
      par = sub.par;
      creator = sub.creator;
    } else {
      const ref = await getPostDailyRef(postId);
      if (!ref) {
        return c.json<ErrorResponse>({ status: 'error', message: 'post has no puzzle' }, 404);
      }
      const [puzzle, completion] = await Promise.all([
        getDailyPuzzle(ref),
        getBestDailySolve(ref, username),
      ]);
      if (!completion) {
        return c.json<ErrorResponse>({ status: 'error', message: 'solve not verified' }, 403);
      }
      moves = completion.moves;
      par = puzzle.par;
    }

    // Prepare everything that cannot create a Reddit side effect before taking
    // the at-most-once claim. Once submission begins, fail closed: deleting an
    // ambiguous claim could duplicate a comment that Reddit accepted just before
    // the request failed or the process stopped.
    const text = buildScoreComment({
      moves,
      par,
      stars: computeStars(moves, par),
      creator,
    });
    const pinnedCommentId = await redis.get(keys.pinnedComment(postId));
    const commentTarget =
      pinnedCommentId && isCommentId(pinnedCommentId) ? pinnedCommentId : postId;
    const commentKey = keys.scoreComments(postId);
    const claimed = await redis.hSetNX(commentKey, username, `claimed:${Date.now()}`);
    if (!claimed) {
      return c.json<CommentScoreResponse>({
        type: 'commentScore',
        ok: true,
        alreadyPosted: true,
      });
    }

    await reddit.submitComment({ id: commentTarget, text, runAs: 'USER' });
    await redis.hSet(commentKey, { [username]: 'posted' });
    await trackTelemetry('comment:score_posted');

    return c.json<CommentScoreResponse>({
      type: 'commentScore',
      ok: true,
      alreadyPosted: false,
    });
  } catch (error) {
    console.error(`/api/comment-score failed: ${error}`);
    const message = error instanceof Error ? error.message : 'comment failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const requestedId =
      c.req.query('puzzleId') ?? dailyPuzzleId(await getCanonicalDailyRef(todayUtc()));
    const ref = parseDailyPuzzleId(requestedId);
    if (!ref) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid puzzle id' }, 400);
    }
    return c.json<LeaderboardResponse>({
      puzzleId: dailyPuzzleId(ref),
      date: ref.date,
      entries: await getDailyLeaderboard(ref, 10),
    });
  } catch (error) {
    console.error(`/api/leaderboard failed: ${error}`);
    const message = error instanceof Error ? error.message : 'leaderboard failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/endless', async (c) => {
  let username = 'anon';
  let issueId = '';
  try {
    const tier = asTier(c.req.query('tier'));
    username = (await reddit.getCurrentUsername()) ?? 'anon';
    // Reserve one bounded user slot before consuming a shared pool entry or
    // spending fallback-generation work. Concurrent losers fail at this point.
    issueId = await reserveEndlessIssue(username);
    const pooled = await popPooledPuzzle(tier);
    const { board, par } = pooled ?? generateEndlessFallback(tier);
    await finalizeEndlessIssue(username, issueId, tier, board, par);
    const solved = await getEndlessSolved(username);
    await trackEndlessIssued(tier);
    return c.json<EndlessResponse>({ issueId, tier, board, par, solved });
  } catch (error) {
    if (issueId) {
      try {
        await releaseEndlessIssue(username, issueId);
      } catch (releaseError) {
        console.error(`/api/endless reservation release failed: ${releaseError}`);
      }
    }
    console.error(`/api/endless failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/endless/stats', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anon';
    const counts = await getEndlessStats(username);
    if (username === 'anon') {
      return c.json<EndlessSolvedResponse>({
        ...counts,
        achievements: buildAchievementSnapshot({ ...counts, hardAtPar: false }),
      });
    }
    const achievements = await syncAchievements(username, counts);
    return c.json<EndlessSolvedResponse>({ ...counts, achievements });
  } catch (error) {
    console.error(`/api/endless/stats failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless stats failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/endless/release', async (c) => {
  try {
    const body = await c.req.json<EndlessReleaseRequest>();
    if (!body || typeof body.issueId !== 'string') {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid release' }, 400);
    }
    const username = await reddit.getCurrentUsername();
    if (username) await releaseEndlessIssue(username, body.issueId);
    return c.json({ ok: true });
  } catch (error) {
    console.error(`/api/endless/release failed: ${error}`);
    return c.json<ErrorResponse>({ status: 'error', message: 'release failed' }, 500);
  }
});

api.post('/endless/hint', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      return c.json<ErrorResponse>({ status: 'error', message: 'not signed in' }, 401);
    }
    const body = await c.req.json<EndlessHintRequest>();
    if (!body || typeof body.issueId !== 'string') {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid hint request' }, 400);
    }
    const hint = await getEndlessHint(username, body.issueId, body.moves);
    if (!hint.ok) {
      return c.json<ErrorResponse>({ status: 'error', message: hint.reason }, 400);
    }
    return c.json<EndlessHintResponse>({ move: hint.move });
  } catch (error) {
    console.error(`/api/endless/hint failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless hint failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/endless/solved', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      return c.json<ErrorResponse>({ status: 'error', message: 'not signed in' }, 401);
    }
    const body = await c.req.json<EndlessSolveRequest>();
    if (!body || typeof body.issueId !== 'string') {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid completion' }, 400);
    }
    const completion = await completeEndlessPuzzle(username, body.issueId, body.moves);
    if (!completion.ok) {
      return c.json<ErrorResponse>({ status: 'error', message: completion.reason }, 400);
    }
    return c.json<EndlessSolveResponse>(completion.result);
  } catch (error) {
    console.error(`/api/endless/solved failed: ${error}`);
    const message = error instanceof Error ? error.message : 'endless solve failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Fixed, allowlisted client counters. Unknown/free-form fields are rejected.
api.post('/telemetry', async (c) => {
  try {
    const body = await c.req.json<TelemetryEventRequest>();
    if (!body || !isClientTelemetryEvent(body.event)) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid telemetry event' }, 400);
    }
    const username = await reddit.getCurrentUsername();
    const actor = username
      ? `user:${username}`
      : `post:${context.postId ?? 'guest-without-post'}`;
    const accepted = await trackClientTelemetry(body.event, actor);
    return accepted
      ? c.json({ ok: true })
      : c.json({ ok: false }, 429);
  } catch (error) {
    console.error(`/api/telemetry failed: ${error}`);
    return c.json({ ok: false }, 500);
  }
});