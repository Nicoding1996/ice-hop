import { randomUUID } from 'node:crypto';
import { redis } from '@devvit/web/server';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  MovesBucket,
  RankedBoardEntry,
  RankedBoardKind,
  RankedBoardResponse,
} from '../../shared/api';
import {
  CURRENT_DAILY_SCHEMA,
  LEGACY_DAILY_SCHEMA,
  dailyPuzzleId,
  isDailyDate,
  type DailyPuzzleRef,
} from '../../shared/daily';
import { computeStars, decodeScore, leaderboardScore } from '../../shared/scoring';
import {
  addDays,
  dailyPuzzleDate,
  isStreakCurrent,
  previousDate,
  weekDates,
  weekStartDate,
} from '../../shared/date';
import {
  BOARD_TOP_N,
  bucketsFromBelowCounts,
  bucketsFromMoves,
  competitionRanks,
  distributionBoundaries,
} from '../../shared/leaderboard';
import { keys } from './keys';

export type SolveOutcome = {
  readonly stars: number;
  readonly bestMoves: number;
  readonly rank: number;
  readonly totalPlayers: number;
  readonly streak: number;
  readonly firstSolve: boolean;
};

export type SolveRecord = {
  readonly moves: number;
  readonly timeMs: number;
  readonly stars: number;
};

type CandidateProgress = 'claim' | 'baseline';
type SolveCandidate = SolveRecord & {
  readonly id: string;
  readonly progress: CandidateProgress;
};
export type StreakRecord = { readonly count: number; readonly lastDate: string };
type DailyProgressBaseline = {
  readonly allTime: number;
  readonly streak: StreakRecord;
};

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const parseSolveRecord = (raw: string | undefined): SolveRecord | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const moves = property(value, 'moves');
    const timeMs = property(value, 'timeMs');
    const stars = property(value, 'stars');
    if (
      typeof moves !== 'number' ||
      !Number.isSafeInteger(moves) ||
      moves < 1 ||
      typeof timeMs !== 'number' ||
      !Number.isFinite(timeMs) ||
      timeMs < 0 ||
      typeof stars !== 'number' ||
      !Number.isSafeInteger(stars) ||
      stars < 1 ||
      stars > 3
    ) {
      return null;
    }
    return { moves, timeMs, stars };
  } catch {
    return null;
  }
};

const parseSolveCandidate = (raw: string): SolveCandidate | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const id = property(value, 'id');
    const progressValue = property(value, 'progress');
    const progress: CandidateProgress =
      progressValue === 'claim' || progressValue === 'baseline'
        ? progressValue
        : 'baseline';
    const record = parseSolveRecord(raw);
    return typeof id === 'string' && record ? { id, progress, ...record } : null;
  } catch {
    return null;
  }
};

const parseStreak = (raw: string | undefined): StreakRecord => {
  if (!raw) return { count: 0, lastDate: '' };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return { count: 0, lastDate: '' };
    const count = property(value, 'count');
    const lastDate = property(value, 'lastDate');
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      (lastDate !== '' && !isDailyDate(lastDate))
    ) {
      return { count: 0, lastDate: '' };
    }
    return { count, lastDate };
  } catch {
    return { count: 0, lastDate: '' };
  }
};

const parseProgressBaseline = (raw: string | undefined): DailyProgressBaseline | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) return null;
    const allTime = property(value, 'allTime');
    const streakValue = property(value, 'streak');
    if (
      typeof allTime !== 'number' ||
      !Number.isSafeInteger(allTime) ||
      allTime < 0 ||
      !isObject(streakValue)
    ) {
      return null;
    }
    const streak = parseStreak(JSON.stringify(streakValue));
    return { allTime, streak };
  } catch {
    return null;
  }
};

const toSolveRecord = (record: SolveRecord): SolveRecord => ({
  moves: record.moves,
  timeMs: record.timeMs,
  stars: record.stars,
});

const betterSolve = (left: SolveRecord, right: SolveRecord): SolveRecord =>
  toSolveRecord(
    leaderboardScore(left.moves, left.timeMs) <= leaderboardScore(right.moves, right.timeMs)
      ? left
      : right
  );

const candidateJson = (
  record: SolveRecord,
  id: string,
  progress: CandidateProgress
): string => JSON.stringify({ id, progress, ...record });

const TRANSACTION_ATTEMPTS = 8;
const transactionCommitted = (result: unknown, expectedResults: number): boolean =>
  Array.isArray(result) && result.length === expectedResults;

/** Return the authoritative candidate minimum, falling back to a legacy record. */
export const getBestDailySolve = async (
  ref: DailyPuzzleRef,
  username: string
): Promise<SolveRecord | null> => {
  const [rows, legacyRaw] = await Promise.all([
    redis.zRange(keys.dailyBestCandidates(ref, username), 0, -1, { by: 'rank' }),
    redis.get(keys.solve(ref, username)),
  ]);
  let best = parseSolveRecord(legacyRaw);
  for (const row of rows) {
    const candidate = parseSolveCandidate(row.member);
    if (!candidate) continue;
    best = best ? betterSolve(best, candidate) : toSolveRecord(candidate);
  }
  return best;
};

/** Atomically compact candidates and publish the same winner everywhere. */
const compactDailyBest = async (
  ref: DailyPuzzleRef,
  username: string,
  ranked: boolean
): Promise<SolveRecord> => {
  const candidateKey = keys.dailyBestCandidates(ref, username);
  const solveKey = keys.solve(ref, username);
  const leaderboardKey = keys.dailyLeaderboard(ref);

  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(candidateKey);
    const rows = await redis.zRange(candidateKey, 0, -1, { by: 'rank' });
    let best: SolveRecord | null = null;
    let bestMember = '';
    const remove: string[] = [];
    for (const row of rows) {
      const candidate = parseSolveCandidate(row.member);
      if (!candidate) {
        remove.push(row.member);
      } else if (!best) {
        best = toSolveRecord(candidate);
        bestMember = row.member;
      } else {
        remove.push(row.member);
      }
    }
    if (!best) {
      await transaction.unwatch();
      throw new Error('Verified daily solve candidate is missing.');
    }

    await transaction.multi();
    let expectedResults = 1;
    if (remove.length > 0) {
      await transaction.zRem(candidateKey, remove);
      expectedResults += 1;
    }
    await transaction.set(solveKey, JSON.stringify(best));
    if (ranked) {
      await transaction.zAdd(leaderboardKey, {
        member: username,
        score: leaderboardScore(best.moves, best.timeMs),
      });
      expectedResults += 1;
    }
    const result: unknown = await transaction.exec();
    if (transactionCommitted(result, expectedResults)) return best;

    // A racing writer changed the candidate source. Retry from its new minimum.
    if (bestMember) continue;
  }
  throw new Error('Daily best score was too busy to publish.');
};

const refsForDate = (date: string): readonly DailyPuzzleRef[] => [
  { schema: LEGACY_DAILY_SCHEMA, date },
  { schema: CURRENT_DAILY_SCHEMA, date },
];

const hasSolveOnDate = async (date: string, username: string): Promise<boolean> => {
  const records = await Promise.all(
    refsForDate(date).map((ref) => getBestDailySolve(ref, username))
  );
  return records.some((record) => record !== null);
};

/** Only explicitly fresh candidate evidence may repair the post-baseline date ledger. */
const hasClaimCandidateOnDate = async (
  date: string,
  username: string
): Promise<boolean> => {
  const rowGroups = await Promise.all(
    refsForDate(date).map((ref) =>
      redis.zRange(keys.dailyBestCandidates(ref, username), 0, -1, { by: 'rank' })
    )
  );
  return rowGroups.some((rows) =>
    rows.some((row) => parseSolveCandidate(row.member)?.progress === 'claim')
  );
};

const getDailyProgressBaseline = async (username: string): Promise<DailyProgressBaseline> => {
  const metaKey = keys.dailyProgressMeta(username);
  const existing = parseProgressBaseline(await redis.hGet(metaKey, 'baseline'));
  if (existing) return existing;

  const [allTimeScore, streakRaw] = await Promise.all([
    redis.zScore(keys.allTimeLeaderboard(), username),
    redis.get(keys.streak(username)),
  ]);
  const candidate: DailyProgressBaseline = {
    allTime:
      typeof allTimeScore === 'number' && Number.isSafeInteger(allTimeScore) && allTimeScore >= 0
        ? allTimeScore
        : 0,
    streak: parseStreak(streakRaw),
  };
  const raw = JSON.stringify(candidate);
  const added = Boolean(await redis.hSetNX(metaKey, 'baseline', raw));
  if (added) return candidate;
  const winner = parseProgressBaseline(await redis.hGet(metaKey, 'baseline'));
  if (!winner) throw new Error('Daily progression baseline is invalid.');
  return winner;
};

/** Rebuild derived progression atomically from one baseline plus date evidence. */
const repairDailyProgress = async (username: string): Promise<StreakRecord> => {
  const progressKey = keys.dailyProgress(username);
  const streakKey = keys.streak(username);
  const allTimeKey = keys.allTimeLeaderboard();

  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    const transaction = await redis.watch(progressKey);
    const [baseline, rawDates] = await Promise.all([
      getDailyProgressBaseline(username),
      redis.hKeys(progressKey),
    ]);
    const dates = rawDates.filter(isDailyDate).sort();
    let streak = baseline.streak;
    for (const date of dates) {
      if (streak.lastDate && date <= streak.lastDate) continue;
      streak = {
        count: streak.lastDate === previousDate(date) ? streak.count + 1 : 1,
        lastDate: date,
      };
    }

    await transaction.multi();
    await transaction.set(streakKey, JSON.stringify(streak));
    await transaction.zAdd(allTimeKey, {
      member: username,
      score: baseline.allTime + dates.length,
    });
    // The streak board row is written with the record it mirrors, so a reader
    // can trust that a matching record means the row is current.
    await transaction.zAdd(keys.streakLeaderboard(), {
      member: username,
      score: streak.count,
    });
    const result: unknown = await transaction.exec();
    if (!transactionCommitted(result, 3)) continue;

    return streak;
  }
  throw new Error('Daily progression was too busy to publish.');
};

/** Weekly boards outlive their week long enough for "last week" lookups. */
const WEEKLY_BOARD_TTL_SECONDS = 70 * 24 * 60 * 60;

/**
 * Recompute one player's weekly stars from the materialized best solve of each
 * puzzle date in that week, then publish the total. Deriving the sum (rather
 * than incrementing) keeps retries idempotent and repairs any earlier miss.
 * Best-effort: the weekly board must never fail a verified Daily solve.
 */
const updateWeeklyBoard = async (date: string, username: string): Promise<void> => {
  try {
    const weekStart = weekStartDate(date);
    const dates = weekDates(weekStart);
    const solveKeys = dates.flatMap((day) =>
      refsForDate(day).map((ref) => keys.solve(ref, username))
    );
    const raws = await redis.mGet(solveKeys);
    const perSchema = refsForDate(date).length;
    let total = 0;
    dates.forEach((_, dateIndex) => {
      let best = 0;
      for (let offset = 0; offset < perSchema; offset++) {
        const record = parseSolveRecord(raws[dateIndex * perSchema + offset] ?? undefined);
        if (record) best = Math.max(best, record.stars);
      }
      total += best;
    });
    if (total <= 0) return;
    const boardKey = keys.weeklyLeaderboard(weekStart);
    await redis.zAdd(boardKey, { member: username, score: total });
    await redis.expire(boardKey, WEEKLY_BOARD_TTL_SECONDS);
  } catch (error) {
    console.error(`Weekly board update failed: ${error}`);
  }
};

/**
 * Record one verified solve. Durable score-candidate evidence is written before
 * the date claim, so a partial failure can never create progression without a
 * recoverable recap/comment score. A retry recognizes new-schema candidates and
 * repairs a missing date claim without double-counting legacy baseline solves.
 */
export const recordSolve = async (
  ref: DailyPuzzleRef,
  username: string,
  par: number,
  moves: number,
  timeMs: number
): Promise<SolveOutcome> => {
  const ranked = username !== 'anon';
  await getDailyProgressBaseline(username);
  const candidateKey = keys.dailyBestCandidates(ref, username);
  const [hadSolveOnDate, hadClaimCandidateOnDate, existing, candidateCount] =
    await Promise.all([
      hasSolveOnDate(ref.date, username),
      hasClaimCandidateOnDate(ref.date, username),
      getBestDailySolve(ref, username),
      redis.zCard(candidateKey),
    ]);
  const progress: CandidateProgress =
    !hadSolveOnDate || hadClaimCandidateOnDate ? 'claim' : 'baseline';

  const candidate: SolveRecord = { moves, timeMs, stars: computeStars(moves, par) };
  // Only seed a carry row when the best score exists solely in the legacy
  // materialized key. Candidate-backed bests already remain in the source set.
  if (existing && candidateCount === 0) {
    await redis.zAdd(candidateKey, {
      member: candidateJson(existing, 'carry', 'baseline'),
      score: leaderboardScore(existing.moves, existing.timeMs),
    });
  }
  await redis.zAdd(candidateKey, {
    member: candidateJson(candidate, randomUUID(), progress),
    score: leaderboardScore(candidate.moves, candidate.timeMs),
  });

  const progressAdded =
    progress === 'claim'
      ? Boolean(
          await redis.hSetNX(
            keys.dailyProgress(username),
            ref.date,
            dailyPuzzleId(ref)
          )
        )
      : false;
  const best = await compactDailyBest(ref, username, ranked);

  if (!ranked) {
    return {
      stars: best.stars,
      bestMoves: best.moves,
      rank: 0,
      totalPlayers: 0,
      streak: 0,
      firstSolve: progressAdded,
    };
  }

  const leaderboardKey = keys.dailyLeaderboard(ref);
  const streak = await repairDailyProgress(username);
  await updateWeeklyBoard(ref.date, username);
  const [rankAsc, totalPlayers] = await Promise.all([
    redis.zRank(leaderboardKey, username),
    redis.zCard(leaderboardKey),
  ]);
  return {
    stars: best.stars,
    bestMoves: best.moves,
    rank: typeof rankAsc === 'number' ? rankAsc + 1 : 0,
    totalPlayers,
    streak: streak.count,
    firstSolve: progressAdded,
  };
};

type DailyLeaderboardSnapshot = Pick<
  LeaderboardResponse,
  'totalPlayers' | 'viewerRank' | 'entries' | 'nearbyEntries'
>;

const leaderboardEntries = (
  rows: readonly { readonly member: string; readonly score: number }[],
  startIndex: number
): LeaderboardEntry[] =>
  rows.map((row, index) => {
    const decoded = decodeScore(row.score);
    return {
      rank: startIndex + index + 1,
      username: row.member,
      moves: decoded.moves,
      timeMs: decoded.timeMs,
      // Filled in by getDailyBoardView, which batches the streak reads.
      streak: 0,
    };
  });

/**
 * Return only bounded leaderboard slices: the first ten at most, plus five rows
 * centred on the signed-in viewer. This keeps comparison useful to players far
 * from the leaders without ever reading the whole sorted set.
 */
export const getDailyLeaderboard = async (
  ref: DailyPuzzleRef,
  topN: number,
  viewer?: string
): Promise<DailyLeaderboardSnapshot> => {
  const leaderboardKey = keys.dailyLeaderboard(ref);
  const boundedTopN = Number.isSafeInteger(topN) ? Math.max(0, Math.min(topN, 10)) : 0;

  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
    // WATCH turns the otherwise separate bounded reads into an optimistic
    // snapshot: if any solve changes the set before validation, EXEC aborts and
    // the whole read is retried from the new ordering.
    const transaction = await redis.watch(leaderboardKey);
    const [topRows, totalPlayers, viewerIndex] = await Promise.all([
      boundedTopN > 0
        ? redis.zRange(leaderboardKey, 0, boundedTopN - 1, { by: 'rank' })
        : Promise.resolve([]),
      redis.zCard(leaderboardKey),
      viewer ? redis.zRank(leaderboardKey, viewer) : Promise.resolve(undefined),
    ]);

    const rankedViewerIndex = typeof viewerIndex === 'number' ? viewerIndex : undefined;
    const viewerRank = rankedViewerIndex === undefined ? 0 : rankedViewerIndex + 1;
    let nearbyEntries: LeaderboardEntry[] = [];
    // Validate the dependent range before reading it. Besides rejecting a
    // racing rank/card pair, this guarantees the stop can never become -1
    // (which Redis would interpret as "through the final member").
    if (
      rankedViewerIndex !== undefined &&
      totalPlayers > 0 &&
      rankedViewerIndex < totalPlayers
    ) {
      const windowSize = 5;
      const maxStart = Math.max(0, totalPlayers - windowSize);
      const nearbyStart = Math.min(Math.max(0, rankedViewerIndex - 2), maxStart);
      const nearbyRows = await redis.zRange(
        leaderboardKey,
        nearbyStart,
        Math.min(totalPlayers - 1, nearbyStart + windowSize - 1),
        { by: 'rank' }
      );
      nearbyEntries = leaderboardEntries(nearbyRows, nearbyStart);
    }

    await transaction.multi();
    await transaction.zCard(leaderboardKey);
    const validation: unknown = await transaction.exec();
    const snapshotIsStable =
      Array.isArray(validation) &&
      validation.length === 1 &&
      validation[0] === totalPlayers;
    if (!snapshotIsStable) continue;

    return {
      totalPlayers,
      viewerRank,
      entries: leaderboardEntries(topRows, 0),
      nearbyEntries,
    };
  }

  throw new Error('Daily leaderboard was too busy to read.');
};

/** Stored streak records for many players in one read (lapsed ones included). */
export const getStreakRecords = async (
  usernames: readonly string[]
): Promise<StreakRecord[]> => {
  if (usernames.length === 0) return [];
  const raws = await redis.mGet(usernames.map((username) => keys.streak(username)));
  return usernames.map((_, index) => parseStreak(raws[index] ?? undefined));
};

/** A player's current Daily streak in days: 0 once it has lapsed. */
export const getCurrentStreak = async (username: string): Promise<number> => {
  const record = parseStreak(await redis.get(keys.streak(username)));
  return isStreakCurrent(record.lastDate, dailyPuzzleDate()) ? record.count : 0;
};

/** Current streaks for many players in one read (0 when lapsed or unknown). */
const getCurrentStreaks = async (
  usernames: readonly string[]
): Promise<Map<string, number>> => {
  const streaks = new Map<string, number>();
  if (usernames.length === 0) return streaks;
  const today = dailyPuzzleDate();
  const raws = await redis.mGet(usernames.map((username) => keys.streak(username)));
  usernames.forEach((username, index) => {
    const record = parseStreak(raws[index] ?? undefined);
    streaks.set(username, isStreakCurrent(record.lastDate, today) ? record.count : 0);
  });
  return streaks;
};

/**
 * Number of members scoring strictly below `score`. Devvit's Redis client has
 * no ZCOUNT, so this reads the first member at or above the boundary and uses
 * its rank: every member before it scores lower.
 */
export const countScoresBelow = async (
  key: string,
  score: number,
  total: number
): Promise<number> => {
  const [first] = await redis.zRange(key, score, '+inf', {
    by: 'score',
    limit: { offset: 0, count: 1 },
  });
  if (!first) return total;
  const rank = await redis.zRank(key, first.member);
  return typeof rank === 'number' ? Math.min(rank, total) : total;
};

/** Small boards are read whole; larger ones are counted at bucket boundaries. */
const DISTRIBUTION_FULL_READ_LIMIT = 250;

/** Best-score distribution (par, par+1, ... par+4 or more) for a Daily board. */
export const getMovesDistribution = async (
  leaderboardKey: string,
  par: number,
  total: number
): Promise<MovesBucket[]> => {
  if (total <= 0) return bucketsFromMoves(par, []);
  if (total <= DISTRIBUTION_FULL_READ_LIMIT) {
    const rows = await redis.zRange(leaderboardKey, 0, -1, { by: 'rank' });
    return bucketsFromMoves(
      par,
      rows.map((row) => decodeScore(row.score).moves)
    );
  }
  const below = await Promise.all(
    distributionBoundaries(par).map((boundary) =>
      countScoresBelow(leaderboardKey, boundary, total)
    )
  );
  return bucketsFromBelowCounts(par, below, total);
};

/** Whether a player hides their name on comment leaderboards. */
export const isNameHidden = async (username: string): Promise<boolean> =>
  Boolean(await redis.hGet(keys.leaderboardHidden(), username));

/** Opt a player out of (or back into) named comment-board rows. */
export const setNameHidden = async (username: string, hidden: boolean): Promise<void> => {
  if (hidden) {
    await redis.hSet(keys.leaderboardHidden(), { [username]: '1' });
  } else {
    await redis.hDel(keys.leaderboardHidden(), [username]);
  }
};

/** The subset of `usernames` who hide their name on comment boards. */
export const hiddenNames = async (usernames: readonly string[]): Promise<Set<string>> => {
  const unique = [...new Set(usernames)];
  if (unique.length === 0) return new Set();
  const flags = await redis.hMGet(keys.leaderboardHidden(), unique);
  return new Set(unique.filter((_, index) => Boolean(flags[index])));
};

export type DailyBoardView = Omit<LeaderboardResponse, 'puzzleId' | 'date'>;

/**
 * The in-app Daily leaderboard: a consistent ranked snapshot plus each listed
 * player's current streak, the move distribution, and the viewer's opt-out.
 */
export const getDailyBoardView = async (
  ref: DailyPuzzleRef,
  par: number,
  viewer?: string
): Promise<DailyBoardView> => {
  const snapshot = await getDailyLeaderboard(ref, BOARD_TOP_N, viewer);
  const listed = [...snapshot.entries, ...snapshot.nearbyEntries].map(
    (entry) => entry.username
  );
  const [streaks, distribution, viewerHidden] = await Promise.all([
    getCurrentStreaks([...new Set(listed)]),
    getMovesDistribution(keys.dailyLeaderboard(ref), par, snapshot.totalPlayers),
    viewer ? isNameHidden(viewer) : Promise.resolve(false),
  ]);
  const withStreak = (entry: LeaderboardEntry): LeaderboardEntry => ({
    ...entry,
    streak: streaks.get(entry.username) ?? 0,
  });
  return {
    par,
    totalPlayers: snapshot.totalPlayers,
    viewerRank: snapshot.viewerRank,
    entries: snapshot.entries.map(withStreak),
    nearbyEntries: snapshot.nearbyEntries.map(withStreak),
    distribution,
    viewerHidden,
  };
};

/** Rows read from the streak board before lapsed ones are filtered out. */
const STREAK_SCAN = 30;

const getStreakBoard = async (
  viewer: string | undefined,
  viewerHidden: boolean
): Promise<RankedBoardResponse> => {
  const boardKey = keys.streakLeaderboard();
  const today = dailyPuzzleDate();
  // WATCH before reading so lapsed rows are removed only if no solve rewrote
  // the board meanwhile (a fresh solve also rewrites the row it mirrors).
  const transaction = await redis.watch(boardKey);
  const rows = await redis.zRange(boardKey, 0, STREAK_SCAN - 1, {
    by: 'rank',
    reverse: true,
  });
  const records =
    rows.length > 0 ? await redis.mGet(rows.map((row) => keys.streak(row.member))) : [];
  const current: { readonly username: string; readonly value: number }[] = [];
  const lapsed: string[] = [];
  rows.forEach((row, index) => {
    const record = parseStreak(records[index] ?? undefined);
    if (record.count > 0 && isStreakCurrent(record.lastDate, today)) {
      current.push({ username: row.member, value: record.count });
    } else {
      lapsed.push(row.member);
    }
  });
  try {
    if (lapsed.length > 0) {
      await transaction.multi();
      await transaction.zRem(boardKey, lapsed);
      await transaction.exec();
    } else {
      await transaction.unwatch();
    }
  } catch (error) {
    console.warn(`Streak board cleanup skipped: ${error}`);
  }

  current.sort(
    (left, right) => right.value - left.value || left.username.localeCompare(right.username)
  );
  const top = current.slice(0, BOARD_TOP_N);
  const ranks = competitionRanks(top.map((entry) => entry.value));
  const entries: RankedBoardEntry[] = top.map((entry, index) => ({
    rank: ranks[index] ?? index + 1,
    username: entry.username,
    value: entry.value,
  }));
  let viewerStanding: RankedBoardResponse['viewer'] = null;
  if (viewer) {
    const value = await getCurrentStreak(viewer);
    viewerStanding = {
      rank: entries.find((entry) => entry.username === viewer)?.rank ?? 0,
      value,
    };
  }
  return { kind: 'streak', entries, viewer: viewerStanding, viewerHidden };
};

/**
 * Cross-puzzle boards: this week's Daily stars, current streaks, or all-time
 * days solved. Each returns the top ten (competition-ranked) and the viewer.
 */
export const getRankedBoard = async (
  kind: RankedBoardKind,
  viewer: string | undefined
): Promise<RankedBoardResponse> => {
  const viewerHidden = viewer ? await isNameHidden(viewer) : false;
  if (kind === 'streak') return getStreakBoard(viewer, viewerHidden);

  const weekStart = weekStartDate(dailyPuzzleDate());
  const boardKey =
    kind === 'week' ? keys.weeklyLeaderboard(weekStart) : keys.allTimeLeaderboard();
  const [rows, totalPlayers, viewerScore] = await Promise.all([
    redis.zRange(boardKey, 0, BOARD_TOP_N - 1, { by: 'rank', reverse: true }),
    redis.zCard(boardKey),
    viewer ? redis.zScore(boardKey, viewer) : Promise.resolve(undefined),
  ]);
  const scored = rows.filter((row) => row.score > 0);
  const ranks = competitionRanks(scored.map((row) => row.score));
  const entries: RankedBoardEntry[] = scored.map((row, index) => ({
    rank: ranks[index] ?? index + 1,
    username: row.member,
    value: row.score,
  }));

  let viewerStanding: RankedBoardResponse['viewer'] = null;
  if (viewer && typeof viewerScore === 'number' && viewerScore > 0) {
    const listed = entries.find((entry) => entry.username === viewer);
    // Scores are whole numbers, so "below score + 1" counts everyone at or
    // under the viewer; the rest rank strictly ahead.
    const rank =
      listed?.rank ??
      1 + totalPlayers - (await countScoresBelow(boardKey, viewerScore + 1, totalPlayers));
    viewerStanding = { rank: Math.max(1, rank), value: viewerScore };
  }

  return {
    kind,
    ...(kind === 'week' ? { periodStart: weekStart, periodEnd: addDays(weekStart, 6) } : {}),
    totalPlayers,
    entries,
    viewer: viewerStanding,
    viewerHidden,
  };
};
