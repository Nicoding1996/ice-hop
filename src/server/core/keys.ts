// Single source of truth for Redis keys.

import type { DailyPuzzleRef } from '../../shared/daily';

const dailyProgressSuffix = (ref: DailyPuzzleRef): string =>
  ref.schema === 5 ? ref.date : `${ref.schema}:${ref.date}`;

export const keys = {
  /** Stored immutable daily puzzle (JSON DailyPuzzle). */
  dailyPuzzle: (ref: DailyPuzzleRef): string => `daily:${ref.schema}:${ref.date}`,
  /** Atomic winner records for concurrent current-daily generation. */
  dailyPuzzleCreations: (): string => `daily:creation:1`,
  /** One canonical published puzzle identity per UTC date across schema rollouts. */
  dailyPuzzleIdentities: (): string => `daily:identity:1`,
  /** Maps a post id to a versioned puzzle id; legacy values are raw dates. */
  postDate: (postId: string): string => `post:${postId}`,
  /** Maps a feed post id to the UGC submission id it shows. */
  ugcPost: (postId: string): string => `post:ugc:${postId}`,
  /** Maps a post id to its pinned/stickied comment id. */
  pinnedComment: (postId: string): string => `post:pinned:${postId}`,
  /** A user's materialized best solve for one immutable daily puzzle. */
  solve: (ref: DailyPuzzleRef, user: string): string =>
    `solve:${dailyProgressSuffix(ref)}:${user}`,
  /** Bounded sorted-set candidates used to converge on an atomic minimum score. */
  dailyBestCandidates: (ref: DailyPuzzleRef, user: string): string =>
    `solve:best:1:${ref.schema}:${ref.date}:${user}`,
  /** Permanent post-migration dates that drive retry-repairable progression. */
  dailyProgress: (user: string): string => `daily:progress:1:${user}`,
  /** Atomic snapshot of pre-ledger all-time/streak state. */
  dailyProgressMeta: (user: string): string => `daily:progress:1:${user}:meta`,
  /** One expiring, non-resettable Daily clock per signed user and immutable puzzle. */
  dailyPlay: (ref: DailyPuzzleRef, user: string): string =>
    `daily:play:2:${ref.schema}:${ref.date}:${user}`,
  /** Singleton server-only signing secret for stateless guest Daily capabilities. */
  dailyGuestSecrets: (): string => `daily:guest-secrets:1`,
  /**
   * Expiring token-digest claims that make guest completion telemetry retry-safe.
   * Version 1 was introduced with stateless guest solve idempotency.
   */
  dailyGuestCompletionClaims: (ref: DailyPuzzleRef): string =>
    `daily:guest-completed:1:${ref.schema}:${ref.date}`,
  /** Per-puzzle leaderboard; schema 5 retains the historical date-only key. */
  dailyLeaderboard: (ref: DailyPuzzleRef): string => `lb:${dailyProgressSuffix(ref)}`,
  /** All-time progression count (one point per UTC date solved). */
  allTimeLeaderboard: (): string => `lb:all`,
  /**
   * Weekly board: each player's summed best Daily stars over the Monday-Sunday
   * puzzle dates of the week starting `weekStart`. Expires after the week ends.
   */
  weeklyLeaderboard: (weekStart: string): string => `lb:week:1:${weekStart}`,
  /** Streak count at each player's latest solve; lapsed rows are filtered on read. */
  streakLeaderboard: (): string => `lb:streak:1`,
  /** Players who hide their name on comment leaderboards (username -> '1'). */
  leaderboardHidden: (): string => `lb:hidden:1`,
  /** A user's current streak record (JSON). */
  streak: (user: string): string => `streak:${user}`,

  // --- Live pinned-comment leaderboards ---
  /** Boards whose pinned comments the scheduler renders, scored by queue order. */
  commentBoards: (): string => `cb:queue:1`,
  /** Pinned comments showing one board: post id -> comment id. */
  commentBoardTargets: (board: string): string => `cb:targets:1:${board}`,
  /** Change counter that lets the job dequeue a board only if nothing changed. */
  commentBoardVersion: (board: string): string => `cb:version:1:${board}`,
  /** Last text written to a pinned comment, so unchanged boards skip the edit. */
  commentBoardText: (commentId: string): string => `cb:text:1:${commentId}`,
  /** Users who have posted their verified score under a host post. */
  scoreComments: (postId: string): string => `commented:${postId}`,
  /** Flag set when a user joins via the in-app Join button. */
  subscribed: (user: string): string => `subscribed:${user}`,

  // --- User-generated content ---
  ugcCounter: (): string => `ugc:counter`,
  ugcSubmission: (id: string): string => `ugc:sub:${id}`,
  ugcIndex: (): string => `ugc:index`,
  ugcRecent: (): string => `ugc:recent`,
  ugcVoters: (id: string): string => `ugc:voters:${id}`,
  ugcBoards: (): string => `ugc:boards`,
  ugcPlayed: (user: string): string => `ugc:played:${user}`,
  /** Materialized verified completion used by score comments. */
  ugcCompletions: (user: string): string => `ugc:completion:${user}`,
  /** Bounded candidates used to derive a concurrency-safe best community score. */
  ugcCompletionCandidates: (user: string, id: string): string =>
    `ugc:completion:best:1:${user}:${id}`,
  ugcDailyCount: (user: string, date: string): string => `ugc:subs:${user}:${date}`,
  ugcSolves: (): string => `ugc:solves`,
  /** Per-puzzle users whose first solve has been reflected in the creator total. */
  ugcSolveCredits: (id: string): string => `ugc:solvecredits:1:${id}`,
  /** Per-puzzle best signed solves: fewest moves, then earliest verified solve. */
  ugcLeaderboard: (id: string): string => `ugc:lb:1:${id}`,
  ugcByCreator: (user: string): string => `ugc:bycreator:${user}`,

  // --- Endless mode ---
  /** Legacy counters retained only as the one-time migration baseline. */
  endlessSolved: (user: string): string => `endless:${user}`,
  endlessSolvedTier: (user: string, tier: string): string => `endless:${user}:${tier}`,
  /** Atomic legacy-counter snapshot taken before ledger-backed progression. */
  endlessLedgerMeta: (user: string): string => `endless:ledger:1:${user}:meta`,
  /** Authoritative permanent completion ledger for one user and tier. */
  endlessLedger: (user: string, tier: string): string => `endless:ledger:1:${user}:${tier}`,
  /** Permanent flag earned by a verified no-hint Hard solve exactly at par. */
  endlessHardAtPar: (user: string): string => `endless:hard-at-par:${user}`,
  /** Award id -> first unlock timestamp. */
  achievements: (user: string): string => `achievements:${user}`,
  /** Bounded expiring collection of user-bound issued puzzle records. */
  endlessIssues: (user: string): string => `endless:issues:2:${user}`,
  /** Legacy per-issue key retained only while pre-migration records expire. */
  endlessIssue: (user: string, issueId: string): string => `endless:issue:1:${user}:${issueId}`,
  /** Atomic hinted/completed arbitration for issued puzzles on a UTC date. */
  endlessResolutions: (user: string, date: string): string =>
    `endless:done:1:${user}:${date}`,
  endlessPool: (tier: string): string => `endless:pool:1:${tier}`,
  endlessPoolSeq: (tier: string): string => `endless:poolseq:1:${tier}`,

  // --- Aggregate product telemetry ---
  telemetryDay: (date: string): string => `telemetry:day:1:${date}`,
  telemetryActive: (date: string): string => `telemetry:active:1:${date}`,
  /** Short-lived per-actor request counts that bound the public event endpoint. */
  telemetryRate: (date: string): string => `telemetry:rate:1:${date}`,
};
