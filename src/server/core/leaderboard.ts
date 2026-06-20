import { context, reddit, redis } from '@devvit/web/server';
import type { LeaderboardEntry } from '../../shared/api';
import { computeStars, decodeScore, leaderboardScore } from '../../shared/scoring';
import { previousDate } from '../../shared/date';
import { keys } from './keys';

export type SolveOutcome = {
  readonly stars: number;
  readonly bestMoves: number;
  readonly rank: number; // 1-based; 0 when unranked
  readonly totalPlayers: number;
  readonly streak: number;
};

type SolveRecord = { moves: number; timeMs: number; stars: number };
type StreakRecord = { count: number; lastDate: string };

/** Set a streak-based user flair (best-effort; needs flair perms + a subreddit). */
const setStreakFlair = async (username: string, streak: number): Promise<void> => {
  const subredditName = context.subredditName;
  if (!subredditName || username === 'anon') return;
  const text = streak >= 2 ? `\uD83D\uDD25 ${streak}-day streak` : '\uD83D\uDC27 Ice Hopper';
  try {
    await reddit.setUserFlair({ subredditName, username, text, backgroundColor: '#1d6f9c', textColor: 'light' });
  } catch (error) {
    console.error(`Failed to set streak flair: ${error}`);
  }
};

/**
 * Records a solve: keeps the user's best (fewest moves, then fastest time),
 * updates the daily leaderboard, maintains a consecutive-day streak, bumps an
 * all-time "dailies solved" count on first solve, and returns rank + streak.
 */
export const recordSolve = async (
  date: string,
  username: string,
  par: number,
  moves: number,
  timeMs: number
): Promise<SolveOutcome> => {
  const stars = computeStars(moves, par);
  const ranked = username !== 'anon';

  let best: SolveRecord = { moves, timeMs, stars };
  const existingRaw = await redis.get(keys.solve(date, username));
  const firstSolveToday = !existingRaw;
  if (existingRaw) {
    const prev: SolveRecord = JSON.parse(existingRaw);
    if (leaderboardScore(prev.moves, prev.timeMs) <= leaderboardScore(moves, timeMs)) {
      best = prev; // keep the better existing solve
    }
  }
  await redis.set(keys.solve(date, username), JSON.stringify(best));

  if (!ranked) {
    return { stars: best.stars, bestMoves: best.moves, rank: 0, totalPlayers: 0, streak: 0 };
  }

  // Streak: consecutive days with a solve (the "don't break your streak" hook).
  let streak = 1;
  const streakRaw = await redis.get(keys.streak(username));
  const prevStreak: StreakRecord = streakRaw ? JSON.parse(streakRaw) : { count: 0, lastDate: '' };
  if (firstSolveToday) {
    if (prevStreak.lastDate === previousDate(date)) streak = prevStreak.count + 1;
    else if (prevStreak.lastDate === date) streak = prevStreak.count; // desync safety
    else streak = 1;
    await redis.set(keys.streak(username), JSON.stringify({ count: streak, lastDate: date }));
    await setStreakFlair(username, streak);
  } else {
    streak = prevStreak.count > 0 ? prevStreak.count : 1;
  }

  const key = keys.dailyLeaderboard(date);
  const score = leaderboardScore(best.moves, best.timeMs);
  const current = await redis.zScore(key, username);
  if (typeof current !== 'number' || score < current) {
    await redis.zAdd(key, { member: username, score });
  }
  if (firstSolveToday) {
    await redis.zIncrBy(keys.allTimeLeaderboard(), username, 1);
  }

  const rankAsc = await redis.zRank(key, username); // 0-based, best (lowest score) first
  const totalPlayers = await redis.zCard(key);
  return {
    stars: best.stars,
    bestMoves: best.moves,
    rank: typeof rankAsc === 'number' ? rankAsc + 1 : 0,
    totalPlayers,
    streak,
  };
};

export const getDailyLeaderboard = async (
  date: string,
  topN: number
): Promise<LeaderboardEntry[]> => {
  const rows = await redis.zRange(keys.dailyLeaderboard(date), 0, topN - 1, { by: 'rank' });
  return rows.map((row) => {
    const { moves, timeMs } = decodeScore(row.score);
    return { username: row.member, moves, timeMs };
  });
};
