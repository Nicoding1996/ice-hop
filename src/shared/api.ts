// DTOs shared between client and server. Keep in sync with the server routes.
import type { Board, Move } from './game/types';
import type { AchievementSnapshot } from './achievements';
import type { CreatorSolveProof } from './game/proof';
import type { Difficulty } from './solver/difficulty';

/**
 * Exact immutable Daily snapshot embedded in current postData and returned by
 * the read-only historical-post preview route. Piece order is immutable because
 * move transcripts address piece indexes.
 */
export type DailySplashSnapshotV2 = {
  readonly version: 2;
  readonly kind: 'daily';
  readonly puzzleId: string;
  readonly date: string;
  readonly board: Board;
  readonly par: number;
  readonly difficulty: Difficulty;
};

export type LegacyDailySplashPostData = {
  readonly kind: 'daily';
  readonly difficulty: Difficulty;
  readonly date?: string;
};

/**
 * Exact immutable Community snapshot embedded in current postData and returned
 * by the read-only historical-post preview route. Piece order is immutable
 * because move transcripts address piece indexes.
 */
export type UgcSplashSnapshotV2 = {
  readonly version: 2;
  readonly kind: 'ugc';
  readonly id: string;
  readonly board: Board;
  readonly par: number;
  readonly difficulty: Difficulty;
  readonly creator: string;
};

/** Legacy unversioned Community postData retained for historical posts. */
export type LegacyUgcSplashPostData = {
  readonly kind: 'ugc';
  readonly board: Board;
  readonly difficulty: Difficulty;
  readonly creator: string;
};

/** Backward-compatible name for the historical unversioned payload. */
export type UgcSplashPostData = LegacyUgcSplashPostData;

/** Static splash payload JSON-stringified under `postData.splash`. */
export type SplashPostData =
  | DailySplashSnapshotV2
  | UgcSplashSnapshotV2
  | LegacyDailySplashPostData
  | LegacyUgcSplashPostData;

/** The `postData` object shape: the splash payload as a JSON string. */
export const POST_DATA_SPLASH_KEY = 'splash';

/**
 * Read-only feed metadata. Daily and Community responses include only the exact
 * immutable board needed to upgrade historical posts; personalized completion
 * state is intentionally limited to the explicit `solved` Community status.
 */
export type PostPreviewResponse =
  | (DailySplashSnapshotV2 & { readonly type: 'post-preview' })
  | (UgcSplashSnapshotV2 & {
      readonly type: 'post-preview';
      readonly solves: number;
      readonly solved: boolean;
    });

/** A community (UGC) puzzle, shaped for the client to render + play. */
export type InitUgcPuzzle = {
  readonly id: string;
  readonly board: Board;
  readonly par: number;
  /** Solver-derived band (from par) for the splash badge + post title. */
  readonly difficulty: Difficulty;
  readonly creator: string;
  readonly votes: number;
  readonly solves: number;
};

/** Response from GET /api/init for the current post or forced daily. */
export type InitResponse =
  | {
      readonly type: 'init';
      readonly kind: 'daily';
      /** Immutable schema + date identity, e.g. v6:2026-08-05. */
      readonly puzzleId: string;
      readonly date: string;
      /** Non-resettable server-issued capability used to verify elapsed time. */
      readonly playId: string;
      readonly board: Board;
      readonly par: number;
      readonly difficulty: Difficulty;
      readonly username: string;
      readonly solved: boolean;
      readonly solvedResult?: { readonly moves: number; readonly stars: number };
      readonly subscribed: boolean;
      readonly subredditName?: string;
    }
  | {
      readonly type: 'init';
      readonly kind: 'ugc';
      readonly puzzle: InitUgcPuzzle;
      readonly username: string;
      readonly solved: boolean;
      readonly subredditName?: string;
    };

/** Client -> server after completing the exact issued daily. */
export type SolveSubmission = {
  readonly puzzleId: string;
  readonly playId: string;
  readonly moves: readonly Move[];
};

/** Server -> client after verifying and recording a daily solve. */
export type SolveResultDTO = {
  readonly accepted: boolean;
  /** Stars for the player's materialized best solve (`bestMoves`). */
  readonly stars: number;
  readonly par: number;
  /** Move count for the just-verified attempt. */
  readonly moves: number;
  /** Best verified move count; `rank` and `stars` describe this score. */
  readonly bestMoves: number;
  readonly rank: number;
  readonly totalPlayers: number;
  readonly streak: number;
};

export type LeaderboardEntry = {
  /** One-based position after sorting by moves, then verified elapsed time. */
  readonly rank: number;
  readonly username: string;
  readonly moves: number;
  readonly timeMs: number;
  /** The player's current Daily streak in days (0 when lapsed). */
  readonly streak: number;
};

/** One move-count bucket of a puzzle's verified best-score distribution. */
export type MovesBucket = {
  /** First move count in the bucket; the first bucket is always par. */
  readonly moves: number;
  /** The final bucket also counts every higher move count. */
  readonly orMore: boolean;
  readonly players: number;
};

export type LeaderboardResponse = {
  readonly puzzleId: string;
  readonly date: string;
  /** Solver-computed optimal move count for this puzzle. */
  readonly par: number;
  readonly totalPlayers: number;
  /** Zero for guests or a signed-in viewer without a ranked solve. */
  readonly viewerRank: number;
  /** Bounded global leaders, currently capped at ten by the server. */
  readonly entries: readonly LeaderboardEntry[];
  /** Bounded window centred on the signed-in viewer when they are ranked. */
  readonly nearbyEntries: readonly LeaderboardEntry[];
  /** Best-score counts for par, par+1, ... and a final "or more" bucket. */
  readonly distribution: readonly MovesBucket[];
  /** Whether the signed-in viewer hides their name on comment leaderboards. */
  readonly viewerHidden: boolean;
};

/** Cross-puzzle boards shown beside the per-puzzle Daily leaderboard. */
export type RankedBoardKind = 'week' | 'streak' | 'alltime';

export type RankedBoardEntry = {
  /** Competition rank: equal values share a rank (1, 2, 2, 4). */
  readonly rank: number;
  readonly username: string;
  /** Week: stars earned; streak: current streak days; all-time: days solved. */
  readonly value: number;
};

export type RankedBoardResponse = {
  readonly kind: RankedBoardKind;
  /** Week boards only: the Monday and Sunday puzzle dates it covers. */
  readonly periodStart?: string;
  readonly periodEnd?: string;
  /** Players on the board; omitted for streaks, which lapse without a write. */
  readonly totalPlayers?: number;
  readonly entries: readonly RankedBoardEntry[];
  /** The signed-in viewer's standing; rank is 0 when it is not known. */
  readonly viewer: { readonly rank: number; readonly value: number } | null;
  readonly viewerHidden: boolean;
};

/**
 * Read-only hub summary: today's Daily, the viewer's result and streak, and
 * their Endless total. It never starts a Daily clock or generates a puzzle.
 */
export type HubResponse = {
  /** Today's puzzle date (12:00 UTC rollover). */
  readonly date: string;
  /** Today's par once the puzzle exists, else null. */
  readonly par: number | null;
  /** The signed viewer's best verified solve today, if any. */
  readonly solved: { readonly moves: number; readonly stars: number } | null;
  /** The viewer's rank today (0 when unranked) among `totalPlayers`. */
  readonly rank: number;
  readonly totalPlayers: number;
  /** Current Daily streak in days (0 for guests or lapsed). */
  readonly streak: number;
  /** Lifetime no-hint Endless solves (0 for guests). */
  readonly endlessSolved: number;
};

/** Opt in or out of having your name shown on comment leaderboards. */
export type LeaderboardVisibilityRequest = { readonly hidden: boolean };

export type LeaderboardVisibilityResponse = { readonly ok: true; readonly hidden: boolean };

// --- User-generated content ---

export type UgcSubmission = {
  readonly id: string;
  readonly creator: string;
  readonly board: Board;
  readonly par: number;
  readonly votes: number;
  readonly solves: number;
  readonly createdAt: number;
  readonly postId?: string;
};

export type SubmitPuzzleRequest = {
  readonly board: Board;
  readonly proof: CreatorSolveProof;
};

export type SubmitPuzzleResponse =
  | { readonly ok: true; readonly id: string; readonly par: number }
  | { readonly ok: false; readonly reason: string };

export type UgcListResponse = { readonly submissions: readonly UgcSubmission[] };

export type MyPuzzlesResponse = {
  readonly submissions: readonly UgcSubmission[];
  readonly totals: { readonly puzzles: number; readonly solves: number; readonly votes: number };
};

export type VoteRequest = { readonly id: string };

export type VoteResponse = { readonly ok: boolean; readonly votes: number; readonly reason?: string };

/** Client -> server after solving a fixed community puzzle. */
export type MarkPlayedRequest = {
  readonly id: string;
  readonly moves: readonly Move[];
};

export type MarkPlayedResponse =
  | { readonly ok: true; readonly saved: boolean; readonly firstSolve: boolean }
  | { readonly ok: false; readonly saved: false; readonly reason: string };

// --- Endless mode ---

export type EndlessTier = 'easy' | 'medium' | 'hard';

/** A fresh graded puzzle. issueId binds signed-in completion to this exact board. */
export type EndlessResponse = {
  readonly issueId: string;
  readonly tier: EndlessTier;
  readonly board: Board;
  readonly par: number;
  readonly solved: number;
};

export type EndlessTierCounts = {
  readonly easy: number;
  readonly medium: number;
  readonly hard: number;
};

export type EndlessSolvedResponse = {
  readonly solved: number;
  readonly byTier: EndlessTierCounts;
  readonly achievements: AchievementSnapshot;
};

export type EndlessHintRequest = {
  readonly issueId: string;
  /** Legal moves already committed on this exact issued board. */
  readonly moves: readonly Move[];
};

export type EndlessHintResponse = {
  readonly move: Move;
};

export type EndlessSolveRequest = {
  readonly issueId: string;
  readonly moves: readonly Move[];
};

export type EndlessReleaseRequest = {
  readonly issueId: string;
};

export type EndlessSolveResponse = EndlessSolvedResponse & {
  /** False on an idempotent retry of an issue that was already counted. */
  readonly counted: boolean;
};

/** Score comments contain no client score claim; the server loads verified progress. */
export type CommentScoreRequest = Record<string, never>;

export type CommentScoreResponse = {
  readonly type: 'commentScore';
  readonly ok: boolean;
  readonly alreadyPosted: boolean;
};
