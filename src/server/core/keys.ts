// Single source of truth for Redis keys.

export const keys = {
  /** Stored daily puzzle (JSON DailyPuzzle). */
  dailyPuzzle: (date: string): string => `daily:5:${date}`,
  /** Maps a post id to the puzzle date it shows. */
  postDate: (postId: string): string => `post:${postId}`,
  /** A user's solve record for a given day (JSON). */
  solve: (date: string, user: string): string => `solve:${date}:${user}`,
  /** Per-day leaderboard (sorted set). */
  dailyLeaderboard: (date: string): string => `lb:${date}`,
  /** All-time leaderboard (sorted set, score = dailies solved). */
  allTimeLeaderboard: (): string => `lb:all`,
  /** A user's current streak record (JSON). */
  streak: (user: string): string => `streak:${user}`,

  // --- User-generated content ---
  /** Monotonic id counter for submissions. */
  ugcCounter: (): string => `ugc:counter`,
  /** A single submission (JSON UgcSubmission). */
  ugcSubmission: (id: string): string => `ugc:sub:${id}`,
  /** Index/queue of pending submissions (sorted set, score = votes). */
  ugcIndex: (): string => `ugc:index`,
  /** Per-submission voter set (hash username -> "1") for one-vote-per-user. */
  ugcVoters: (id: string): string => `ugc:voters:${id}`,
};
