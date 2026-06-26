import { context, reddit, redis } from '@devvit/web/server';
import type { LeaderboardEntry } from '../../shared/api';
import { computeStars, decodeScore, leaderboardScore } from '../../shared/scoring';
import { previousDate, todayUtc } from '../../shared/date';
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

/**
 * Set the player's subreddit flair from their returning-player streak AND their
 * creator output (puzzles built), so a regular's flair shows both "I keep
 * coming back" and "I make puzzles" - the public, recurring status that nudges
 * return visits and gives makers a badge. Best-effort: needs flair perms + a
 * subreddit, and a failure must never block a solve or a submit (the whole body
 * is guarded). Pass `streak` when the caller just computed it (a daily solve);
 * omit it to read the stored streak (a puzzle submit only changes the creator
 * half).
 */
export const setPlayerFlair = async (username: string, streak?: number): Promise<void> => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName || username === 'anon') return;

    let days = streak;
    if (days === undefined) {
      // Submit path: read the stored streak, but only count it as live if the
      // last solve was today or yesterday. The stored count isn't decremented
      // when a streak lapses (it's recomputed on the next solve), so otherwise
      // the badge would overstate it. It self-corrects on the next daily solve.
      const raw = await redis.get(keys.streak(username));
      const rec: StreakRecord = raw ? JSON.parse(raw) : { count: 0, lastDate: '' };
      const today = todayUtc();
      const alive = rec.lastDate === today || rec.lastDate === previousDate(today);
      days = alive ? rec.count : 0;
    }
    const built = await redis.zCard(keys.ugcByCreator(username));

    const base = days >= 2 ? `\uD83D\uDD25 ${days}-day streak` : '\uD83D\uDC27 Ice Hopper';
    const maker = built > 0 ? ` \u00B7 \uD83E\uDDE9 ${built} ${built === 1 ? 'puzzle' : 'puzzles'}` : '';

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
    await setPlayerFlair(username, streak);
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
