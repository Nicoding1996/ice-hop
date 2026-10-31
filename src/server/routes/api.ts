import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
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
  HubResponse,
  InitResponse,
  LeaderboardResponse,
  LeaderboardVisibilityRequest,
  LeaderboardVisibilityResponse,
  PostPreviewResponse,
  RankedBoardResponse,
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
import { dailyPuzzleDate, previousDate } from '../../shared/date';
import { isRankedBoardKind } from '../../shared/leaderboard';
import { buildScoreComment } from '../../shared/share';
import { computeStars } from '../../shared/scoring';
import { difficultyFromPar } from '../../shared/solver/difficulty';
import type { TelemetryEventRequest } from '../../shared/telemetry';
import { isClientTelemetryEvent } from '../../shared/telemetry';
import { syncAchievements } from '../core/achievements';
import {
  claimGuestDailyCompletion,
  completeEndlessPuzzle,
  finalizeEndlessIssue,
  getBestCommunityCompletion,
  getDailyElapsed,
  getEndlessHint,
  issueDailyPlay,
  releaseEndlessIssue,
  reserveEndlessIssue,
} from '../core/completion';
import { ensureDailyCommentBoard, requeueBoardsForPlayer } from '../core/commentBoard';
import {
  findCanonicalDailyRef,
  findDailyPuzzle,
  getCanonicalDailyRef,
  getDailyPuzzle,
} from '../core/daily';
import {
  generateEndlessFallback,
  getEndlessSolved,
  getEndlessStats,
  popPooledPuzzle,
} from '../core/endless';
import { keys } from '../core/keys';
import {
  getBestDailySolve,
  getCurrentStreak,
  getDailyBoardView,
  getRankedBoard,
  recordSolve,
  setNameHidden,
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

/**
 * Best-effort: link the host Daily post's pinned comment to its live board, so
 * posts published before live boards start showing standings on first solve.
 */
const attachHostCommentBoard = async (ref: DailyPuzzleRef): Promise<void> => {
  try {
    const { postId } = context;
    if (!postId) return;
    const hostRef = await getPostDailyRef(postId);
    if (hostRef && sameDailyPuzzle(hostRef, ref)) await ensureDailyCommentBoard(ref, postId);
  } catch (error) {
    console.error(`Live comment board registration failed: ${error}`);
  }
};

export const api = new Hono();
api.route('/ugc', ugc);

/**
 * Read-only feed metadata. Daily and Community responses include the exact
 * immutable board so historical posts can restore the same playable inline
 * card as new posts. This route never issues a play capability.
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
          version: 2,
          kind: 'ugc',
          id: sub.id,
          board: structure.board,
          par: sub.par,
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
      dailyRef = await getCanonicalDailyRef(dailyPuzzleDate());
    }

    const puzzle = await getDailyPuzzle(dailyRef);
    return c.json<PostPreviewResponse>({
      type: 'post-preview',
      version: 2,
      kind: 'daily',
      puzzleId: puzzle.id,
      date: puzzle.date,
      board: puzzle.board,
      par: puzzle.par,
      difficulty: difficultyFromPar(puzzle.par),
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
      dailyRef = await getCanonicalDailyRef(dailyPuzzleDate());
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
    if (timeMs === null) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'daily play has expired' },
        410
      );
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
      const firstCompletion = await claimGuestDailyCompletion(body.playId, requestedRef);
      if (firstCompletion) await trackTelemetry('daily:completed:guest');
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

    const outcome = await recordSolve(requestedRef, username, puzzle.par, moves, timeMs);
    if (outcome.firstSolve) await trackTelemetry('daily:completed:signed');
    await attachHostCommentBoard(requestedRef);
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
    let date: string | undefined;
    let streak: number | undefined;
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
      const [puzzle, completion, currentStreak] = await Promise.all([
        getDailyPuzzle(ref),
        getBestDailySolve(ref, username),
        getCurrentStreak(username),
      ]);
      if (!completion) {
        return c.json<ErrorResponse>({ status: 'error', message: 'solve not verified' }, 403);
      }
      moves = completion.moves;
      par = puzzle.par;
      date = ref.date;
      streak = currentStreak;
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
      date,
      streak,
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

/**
 * One Daily puzzle's leaderboard. Select it with `puzzleId`, `day=yesterday`,
 * or `post=1` (the host post's Daily, else today's); the default is today's.
 * Reads never claim or generate a puzzle for a request-supplied id.
 */
api.get('/leaderboard', async (c) => {
  try {
    let ref: DailyPuzzleRef | null;
    const requestedId = c.req.query('puzzleId');
    if (requestedId !== undefined) {
      ref = parseDailyPuzzleId(requestedId);
      if (!ref) {
        return c.json<ErrorResponse>({ status: 'error', message: 'invalid puzzle id' }, 400);
      }
    } else if (c.req.query('day') === 'yesterday') {
      ref = await findCanonicalDailyRef(previousDate(dailyPuzzleDate()));
    } else {
      const { postId } = context;
      const hostRef =
        c.req.query('post') === '1' && postId ? await getPostDailyRef(postId) : null;
      ref = hostRef ?? (await getCanonicalDailyRef(dailyPuzzleDate()));
    }
    const puzzle = ref ? await findDailyPuzzle(ref) : null;
    if (!ref || !puzzle) {
      return c.json<ErrorResponse>({ status: 'error', message: 'no daily puzzle' }, 404);
    }
    const username = await reddit.getCurrentUsername();
    const view = await getDailyBoardView(ref, puzzle.par, username);
    return c.json<LeaderboardResponse>({
      puzzleId: dailyPuzzleId(ref),
      date: ref.date,
      ...view,
    });
  } catch (error) {
    console.error(`/api/leaderboard failed: ${error}`);
    const message = error instanceof Error ? error.message : 'leaderboard failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

/**
 * Read-only hub summary. Uses read-only Daily lookups, so opening the hub never
 * claims, generates, or starts the clock on today's puzzle.
 */
api.get('/hub', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();
    const date = dailyPuzzleDate();
    const ref = await findCanonicalDailyRef(date);
    const puzzle = ref ? await findDailyPuzzle(ref) : null;
    const boardKey = ref ? keys.dailyLeaderboard(ref) : null;
    const [best, rankIndex, totalPlayers, streak, endlessSolved] = await Promise.all([
      username && ref ? getBestDailySolve(ref, username) : Promise.resolve(null),
      username && boardKey ? redis.zRank(boardKey, username) : Promise.resolve(undefined),
      boardKey ? redis.zCard(boardKey) : Promise.resolve(0),
      username ? getCurrentStreak(username) : Promise.resolve(0),
      username ? getEndlessSolved(username) : Promise.resolve(0),
    ]);
    const rank = typeof rankIndex === 'number' ? Math.min(rankIndex + 1, totalPlayers) : 0;
    return c.json<HubResponse>({
      date,
      par: puzzle?.par ?? null,
      solved: best ? { moves: best.moves, stars: best.stars } : null,
      rank,
      totalPlayers,
      streak,
      endlessSolved,
    });
  } catch (error) {
    console.error(`/api/hub failed: ${error}`);
    return c.json<ErrorResponse>({ status: 'error', message: 'hub failed' }, 400);
  }
});

/** This week's stars, current streaks, or all-time days solved. */
api.get('/leaderboard/board', async (c) => {
  try {
    const kind = c.req.query('kind');
    if (!isRankedBoardKind(kind)) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid board' }, 400);
    }
    const username = await reddit.getCurrentUsername();
    return c.json<RankedBoardResponse>(await getRankedBoard(kind, username));
  } catch (error) {
    console.error(`/api/leaderboard/board failed: ${error}`);
    const message = error instanceof Error ? error.message : 'leaderboard failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

/** Show or hide the signed-in player's name on live comment leaderboards. */
api.post('/leaderboard/visibility', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      return c.json<ErrorResponse>({ status: 'error', message: 'not signed in' }, 401);
    }
    const body = await c.req.json<LeaderboardVisibilityRequest>();
    if (!body || typeof body.hidden !== 'boolean') {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid request' }, 400);
    }
    await setNameHidden(username, body.hidden);
    try {
      await requeueBoardsForPlayer(username);
    } catch (error) {
      console.error(`Comment board requeue failed: ${error}`);
    }
    return c.json<LeaderboardVisibilityResponse>({ ok: true, hidden: body.hidden });
  } catch (error) {
    console.error(`/api/leaderboard/visibility failed: ${error}`);
    return c.json<ErrorResponse>({ status: 'error', message: 'visibility update failed' }, 400);
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
    if (accepted && body.event === 'daily_started') {
      await trackDailyActive(username ?? 'anon');
    }
    return accepted
      ? c.json({ ok: true })
      : c.json({ ok: false }, 429);
  } catch (error) {
    console.error(`/api/telemetry failed: ${error}`);
    return c.json({ ok: false }, 500);
  }
});