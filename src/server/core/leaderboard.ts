import { randomUUID } from 'node:crypto';
import { context, reddit, redis } from '@devvit/web/server';
import type { LeaderboardEntry, LeaderboardResponse } from '../../shared/api';
import {
  CURRENT_DAILY_SCHEMA,
  LEGACY_DAILY_SCHEMA,
  dailyPuzzleId,
  isDailyDate,
  type DailyPuzzleRef,
} from '../../shared/daily';
import { computeStars, decodeScore, leaderboardScore } from '../../shared/scoring';
import { previousDate, todayUtc } from '../../shared/date';
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
type StreakRecord = { readonly count: number; readonly lastDate: string };
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

/**
 * Set the player's subreddit flair from their returning-player streak AND their
 * creator output. This is best-effort and never blocks a solve or submission.
 */
export const setPlayerFlair = async (username: string, streak?: number): Promise<void> => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName || username === 'anon') return;

    let days = streak;
    if (days === undefined) {
      const rec = parseStreak(await redis.get(keys.streak(username)));
      const today = todayUtc();
      const alive = rec.lastDate === today || rec.lastDate === previousDate(today);
      days = alive ? rec.count : 0;
    }
    const built = await redis.zCard(keys.ugcByCreator(username));
    const base = days >= 2 ? `\uD83D\uDD25 ${days}-day streak` : '\uD83D\uDC27 Ice Hopper';
    const maker = built > 0
      ? ` \u00B7 \uD83E\uDDE9 ${built} ${built === 1 ? 'puzzle' : 'puzzles'}`
      : '';

    await reddit.setUserFlair({
      subredditName,
      username,
      text: `${base}${maker}`,
      backgroundColor: '#1d6f9c',
      textColor: 'light',
    });
  } catch (error) {
    console.error(`Failed to set player flair: ${error}`);
  }
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
    const result: unknown = await transaction.exec();
    if (!transactionCommitted(result, 2)) continue;

    await setPlayerFlair(username, streak.count);
    return streak;
  }
  throw new Error('Daily progression was too busy to publish.');
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
