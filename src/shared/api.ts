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
};

export type LeaderboardResponse = {
  readonly puzzleId: string;
  readonly date: string;
  readonly totalPlayers: number;
  /** Zero for guests or a signed-in viewer without a ranked solve. */
  readonly viewerRank: number;
  /** Bounded global leaders, currently capped at ten by the server. */
  readonly entries: readonly LeaderboardEntry[];
  /** Bounded window centred on the signed-in viewer when they are ranked. */
  readonly nearbyEntries: readonly LeaderboardEntry[];
};

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
