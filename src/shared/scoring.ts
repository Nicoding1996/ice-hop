// Pure scoring logic shared by client and server so both agree on stars/ranking.

/**
 * Stars are encouraging: solving always earns at least 1 (you won!), a clean
 * line earns 3. par+1 = 3, up to double par = 2, anything solved = 1.
 */
export const computeStars = (moves: number, par: number): number => {
  if (moves <= par + 1) return 3;
  if (moves <= par * 2) return 2;
  return 1;
};

/**
 * Encode "fewest moves, then fastest time" into ONE ascending score for a Redis
 * sorted set (lower = better). Time is capped so it can never overflow into the
 * moves component, which keeps moves strictly primary and time the tiebreak.
 */
export const TIME_CAP_MS = 9_999_999;

export const leaderboardScore = (moves: number, timeMs: number): number =>
  moves * (TIME_CAP_MS + 1) + Math.max(0, Math.min(Math.round(timeMs), TIME_CAP_MS));

export const decodeScore = (score: number): { moves: number; timeMs: number } => ({
  moves: Math.floor(score / (TIME_CAP_MS + 1)),
  timeMs: score % (TIME_CAP_MS + 1),
});
