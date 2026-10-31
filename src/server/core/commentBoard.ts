// Live leaderboards inside each puzzle post's pinned, app-authored comment.
//
// A board id names what a comment shows: `daily:{puzzleId}` or `ugc:{id}`.
// Boards wait in one queue; the every-5-minutes scheduler job renders each
// queued board and edits its pinned comments only when the text changed.
// - Daily boards stay queued while their puzzle date is current, then render
//   once more as frozen "Final results" and leave the queue.
// - Community boards are queued by a solve that changes them and leave the
//   queue once rendered, unless another change arrived meanwhile.
import { reddit, redis } from '@devvit/web/server';
import {
  ANONYMOUS_PLAYER,
  renderCommunityCommentBoard,
  renderDailyCommentBoard,
  type CommentBoardRow,
} from '../../shared/commentBoard';
import { dailyPuzzleId, parseDailyPuzzleId, type DailyPuzzleRef } from '../../shared/daily';
import { dailyPuzzleDate, previousDate } from '../../shared/date';
import {
  BOARD_TOP_N,
  communityBoardMoves,
  communityBoardScore,
} from '../../shared/leaderboard';
import { decodeScore } from '../../shared/scoring';
import { findCanonicalDailyRef, findDailyPuzzle } from './daily';
import { keys } from './keys';
import { countScoresBelow, getMovesDistribution, hiddenNames } from './leaderboard';

type ParsedBoard =
  | { readonly kind: 'daily'; readonly ref: DailyPuzzleRef }
  | { readonly kind: 'ugc'; readonly id: string };

type CommentId = `t1_${string}`;

/** Most boards one job run renders; the rest wait for the next run. */
const MAX_BOARDS_PER_RUN = 25;
/** Most pinned comments one board updates (a mod may re-post a Daily). */
const MAX_TARGETS_PER_BOARD = 5;
/** Last-rendered text outlives a board's active life by a comfortable margin. */
const TEXT_TTL_MS = 10 * 24 * 60 * 60 * 1000;

const isCommentId = (id: string): id is CommentId => id.startsWith('t1_');

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

export const dailyBoardId = (ref: DailyPuzzleRef): string => `daily:${dailyPuzzleId(ref)}`;
export const communityBoardId = (id: string): string => `ugc:${id}`;

const parseBoardId = (board: string): ParsedBoard | null => {
  if (board.startsWith('daily:')) {
    const ref = parseDailyPuzzleId(board.slice('daily:'.length));
    return ref ? { kind: 'daily', ref } : null;
  }
  if (board.startsWith('ugc:')) {
    const id = board.slice('ugc:'.length);
    return id.length > 0 && id.length <= 64 ? { kind: 'ugc', id } : null;
  }
  return null;
};

/** Daily boards queue by puzzle date, ahead of Community boards queued later. */
const dailyQueueScore = (ref: DailyPuzzleRef): number =>
  Date.parse(`${ref.date}T00:00:00.000Z`);

const displayName = (username: string, hidden: ReadonlySet<string>): string =>
  hidden.has(username) ? ANONYMOUS_PLAYER : username;

// --- Rendering ----------------------------------------------------------------

const previousDailyWinner = async (
  date: string
): Promise<{ readonly username: string; readonly moves: number; readonly timeMs: number } | null> => {
  const ref = await findCanonicalDailyRef(previousDate(date));
  if (!ref) return null;
  const [top] = await redis.zRange(keys.dailyLeaderboard(ref), 0, 0, { by: 'rank' });
  if (!top) return null;
  const decoded = decodeScore(top.score);
  return { username: top.member, moves: decoded.moves, timeMs: decoded.timeMs };
};

/** The full pinned-comment text for a Daily board, or null if it has no puzzle. */
export const renderDailyBoardText = async (
  ref: DailyPuzzleRef,
  final: boolean
): Promise<string | null> => {
  const puzzle = await findDailyPuzzle(ref);
  if (!puzzle) return null;
  const boardKey = keys.dailyLeaderboard(ref);
  const [rows, totalPlayers, winner] = await Promise.all([
    redis.zRange(boardKey, 0, BOARD_TOP_N - 1, { by: 'rank' }),
    redis.zCard(boardKey),
    final ? Promise.resolve(null) : previousDailyWinner(ref.date),
  ]);
  const [distribution, hidden] = await Promise.all([
    getMovesDistribution(boardKey, puzzle.par, totalPlayers),
    hiddenNames([...rows.map((row) => row.member), ...(winner ? [winner.username] : [])]),
  ]);
  const boardRows: CommentBoardRow[] = rows.map((row, index) => {
    const decoded = decodeScore(row.score);
    return {
      rank: index + 1,
      name: displayName(row.member, hidden),
      moves: decoded.moves,
      timeMs: decoded.timeMs,
    };
  });
  return renderDailyCommentBoard({
    date: ref.date,
    par: puzzle.par,
    final,
    totalPlayers,
    rows: boardRows,
    distribution,
    ...(winner
      ? {
          previousWinner: {
            rank: 1,
            name: displayName(winner.username, hidden),
            moves: winner.moves,
            timeMs: winner.timeMs,
          },
        }
      : {}),
  });
};

type CommunityPuzzleInfo = {
  readonly id: string;
  readonly creator: string;
  readonly par: number;
  readonly postId?: string;
};

const parseCommunityPuzzle = (raw: string | undefined, id: string): CommunityPuzzleInfo | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const creator = property(value, 'creator');
    const par = property(value, 'par');
    const postId = property(value, 'postId');
    if (
      property(value, 'id') !== id ||
      typeof creator !== 'string' ||
      typeof par !== 'number' ||
      !Number.isSafeInteger(par) ||
      par < 1
    ) {
      return null;
    }
    return { id, creator, par, ...(typeof postId === 'string' ? { postId } : {}) };
  } catch {
    return null;
  }
};

/** The full pinned-comment text for one Community puzzle's board. */
export const renderCommunityBoardText = async (puzzle: CommunityPuzzleInfo): Promise<string> => {
  const boardKey = keys.ugcLeaderboard(puzzle.id);
  const [rows, totalPlayers] = await Promise.all([
    redis.zRange(boardKey, 0, BOARD_TOP_N - 1, { by: 'rank' }),
    redis.zCard(boardKey),
  ]);
  const [atPar, hidden] = await Promise.all([
    totalPlayers > 0
      ? countScoresBelow(boardKey, communityBoardScore(puzzle.par + 1, 0), totalPlayers)
      : Promise.resolve(0),
    hiddenNames(rows.map((row) => row.member)),
  ]);
  return renderCommunityCommentBoard({
    creator: puzzle.creator,
    par: puzzle.par,
    totalPlayers,
    atPar,
    rows: rows.map((row, index) => ({
      rank: index + 1,
      name: displayName(row.member, hidden),
      moves: communityBoardMoves(row.score),
    })),
  });
};

// --- Registration and change tracking -------------------------------------------

/** Remember the text a comment was seeded with so the first run skips the edit. */
export const rememberCommentText = async (commentId: string, text: string): Promise<void> => {
  await redis.set(keys.commentBoardText(commentId), text, {
    expiration: new Date(Date.now() + TEXT_TTL_MS),
  });
};

/** Attach a Daily post's pinned comment to its puzzle's live board. */
export const registerDailyCommentBoard = async (
  ref: DailyPuzzleRef,
  postId: string,
  commentId: string
): Promise<void> => {
  const board = dailyBoardId(ref);
  await redis.hSet(keys.commentBoardTargets(board), { [postId]: commentId });
  await redis.zAdd(keys.commentBoards(), { member: board, score: dailyQueueScore(ref) });
};

/**
 * Lazily attach a Daily post created before live boards existed. Only the
 * current puzzle date registers: a closed board stays frozen at its final text.
 */
export const ensureDailyCommentBoard = async (
  ref: DailyPuzzleRef,
  postId: string
): Promise<void> => {
  if (ref.date !== dailyPuzzleDate()) return;
  const board = dailyBoardId(ref);
  const [commentId, registered] = await Promise.all([
    redis.get(keys.pinnedComment(postId)),
    redis.hGet(keys.commentBoardTargets(board), postId),
  ]);
  if (!commentId || !isCommentId(commentId) || registered === commentId) return;
  await registerDailyCommentBoard(ref, postId, commentId);
};

/** Attach a Community post's pinned comment to its puzzle's board. */
export const registerCommunityCommentBoard = async (
  id: string,
  postId: string,
  commentId: string
): Promise<void> => {
  await redis.hSet(keys.commentBoardTargets(communityBoardId(id)), { [postId]: commentId });
};

/** Queue a board for rendering after its data changed. */
export const markCommentBoardChanged = async (board: string): Promise<void> => {
  await redis.incrBy(keys.commentBoardVersion(board), 1);
  await redis.zAdd(keys.commentBoards(), { member: board, score: Date.now() });
};

/**
 * Publish a signed, non-creator Community solve to the puzzle's board when it
 * improves the player's entry, then queue the pinned comment for an update.
 * Best-effort: the board must never fail a verified solve.
 */
export const recordCommunityBoardSolve = async (
  id: string,
  username: string,
  moves: number
): Promise<void> => {
  try {
    const boardKey = keys.ugcLeaderboard(id);
    const existing = await redis.zScore(boardKey, username);
    if (typeof existing === 'number' && communityBoardMoves(existing) <= moves) return;
    await redis.zAdd(boardKey, {
      member: username,
      score: communityBoardScore(moves, Date.now()),
    });
    await markCommentBoardChanged(communityBoardId(id));
  } catch (error) {
    console.error(`Community board update failed for ${id}: ${error}`);
  }
};

/**
 * After a name-visibility change, queue the Community boards the player most
 * recently solved and appears on. Today's Daily board re-renders on its own.
 */
export const requeueBoardsForPlayer = async (username: string): Promise<void> => {
  const played = await redis.zRange(keys.ugcPlayed(username), 0, 49, {
    by: 'rank',
    reverse: true,
  });
  const scores = await Promise.all(
    played.map((row) => redis.zScore(keys.ugcLeaderboard(row.member), username))
  );
  const listed = played.filter((_, index) => typeof scores[index] === 'number');
  for (const row of listed) await markCommentBoardChanged(communityBoardId(row.member));
};

// --- Scheduler job ------------------------------------------------------------------

const boardTargets = async (
  board: string,
  parsed: ParsedBoard,
  puzzle: CommunityPuzzleInfo | null
): Promise<CommentId[]> => {
  const targets = await redis.hGetAll(keys.commentBoardTargets(board));
  const commentIds = Object.values(targets).filter(isCommentId);
  if (commentIds.length === 0 && parsed.kind === 'ugc' && puzzle?.postId) {
    // Community posts published before live boards: their pinned comment is
    // still reachable through the submission's post.
    const pinned = await redis.get(keys.pinnedComment(puzzle.postId));
    if (pinned && isCommentId(pinned)) {
      await registerCommunityCommentBoard(parsed.id, puzzle.postId, pinned);
      return [pinned];
    }
  }
  return commentIds.slice(0, MAX_TARGETS_PER_BOARD);
};

/** Edit one pinned comment unless it already shows exactly this text. */
const writeComment = async (commentId: CommentId, text: string): Promise<boolean> => {
  if ((await redis.get(keys.commentBoardText(commentId))) === text) return false;
  const comment = await reddit.getCommentById(commentId);
  await comment.edit({ text });
  await rememberCommentText(commentId, text);
  return true;
};

/** Leave the queue only if no change was recorded since `version` was read. */
const dequeueIfUnchanged = async (board: string, version: string | undefined): Promise<void> => {
  const versionKey = keys.commentBoardVersion(board);
  const transaction = await redis.watch(versionKey);
  const current = await redis.get(versionKey);
  if (current !== version) {
    await transaction.unwatch();
    return;
  }
  await transaction.multi();
  await transaction.zRem(keys.commentBoards(), [board]);
  await transaction.exec();
};

export type CommentBoardRefresh = {
  readonly processed: number;
  readonly edited: number;
  readonly finalized: number;
};

/** Render queued boards and edit their pinned comments. Called every 5 minutes. */
export const refreshCommentBoards = async (budgetMs = 20_000): Promise<CommentBoardRefresh> => {
  const started = Date.now();
  const today = dailyPuzzleDate();
  const queue = await redis.zRange(keys.commentBoards(), 0, MAX_BOARDS_PER_RUN - 1, {
    by: 'rank',
  });
  let processed = 0;
  let edited = 0;
  let finalized = 0;

  for (const entry of queue) {
    if (Date.now() - started > budgetMs) break;
    processed += 1;
    const board = entry.member;
    const parsed = parseBoardId(board);
    if (!parsed) {
      await redis.zRem(keys.commentBoards(), [board]);
      continue;
    }
    const final = parsed.kind === 'daily' && parsed.ref.date < today;
    try {
      const version = await redis.get(keys.commentBoardVersion(board));
      const puzzle =
        parsed.kind === 'ugc'
          ? parseCommunityPuzzle(await redis.get(keys.ugcSubmission(parsed.id)), parsed.id)
          : null;
      const text =
        parsed.kind === 'daily'
          ? await renderDailyBoardText(parsed.ref, final)
          : puzzle
            ? await renderCommunityBoardText(puzzle)
            : null;

      if (text !== null) {
        for (const commentId of await boardTargets(board, parsed, puzzle)) {
          try {
            if (await writeComment(commentId, text)) edited += 1;
          } catch (error) {
            // A removed or locked comment must not block the other targets.
            console.error(`Comment board edit failed for ${commentId}: ${error}`);
          }
        }
      }

      if (final) {
        await redis.zRem(keys.commentBoards(), [board]);
        finalized += 1;
      } else if (parsed.kind === 'ugc' || text === null) {
        await dequeueIfUnchanged(board, version);
      }
    } catch (error) {
      console.error(`Comment board ${board} failed: ${error}`);
      // Never retry a closed Daily forever; a live board simply tries again.
      if (final) await redis.zRem(keys.commentBoards(), [board]);
    }
  }
  return { processed, edited, finalized };
};
