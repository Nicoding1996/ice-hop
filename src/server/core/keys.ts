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
  /** Flag set when a user joins (subscribes to) the community via the in-app
   *  Join button. Reddit has no API to read live subscription state, so this is
   *  our app-side record, used only to stop re-prompting. */
  subscribed: (user: string): string => `subscribed:${user}`,

  // --- User-generated content ---
  /** Monotonic id counter for submissions. */
  ugcCounter: (): string => `ugc:counter`,
  /** A single submission (JSON UgcSubmission). */
  ugcSubmission: (id: string): string => `ugc:sub:${id}`,
  /** Index/queue of pending submissions (sorted set, score = votes). */
  ugcIndex: (): string => `ugc:index`,
  /** Submissions ordered by creation time (sorted set, score = createdAt). */
  ugcRecent: (): string => `ugc:recent`,
  /** Per-submission voter set (hash username -> "1") for one-vote-per-user. */
  ugcVoters: (id: string): string => `ugc:voters:${id}`,
  /** Known board signatures (hash signature -> creator) to reject duplicates. */
  ugcBoards: (): string => `ugc:boards`,
  /** Submissions a user has solved (sorted set, score = solve time). */
  ugcPlayed: (user: string): string => `ugc:played:${user}`,
  /** How many puzzles a user has submitted on a given UTC day (rate limit). */
  ugcDailyCount: (user: string, date: string): string => `ugc:subs:${user}:${date}`,

  // --- Endless mode ---
  /** Lifetime count of endless puzzles a user has solved (progression banner). */
  endlessSolved: (user: string): string => `endless:${user}`,
  /**
   * Pre-generated puzzle pool for a tier (hash of id -> JSON {board,par}). The
   * `1` is a pool schema version: bump it to abandon stale pools after a tier
   * definition change.
   */
  endlessPool: (tier: string): string => `endless:pool:1:${tier}`,
  /** Monotonic id sequence for a tier's pool entries. */
  endlessPoolSeq: (tier: string): string => `endless:poolseq:1:${tier}`,
};
