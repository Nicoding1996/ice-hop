// DTOs shared between client and server. Keep in sync with the server routes.
import type { Board, Move } from './game/types';
import type { AchievementSnapshot } from './achievements';
import type { CreatorSolveProof } from './game/proof';
import type { Difficulty } from './solver/difficulty';

/**
 * Lossy Daily-board summary used by the feed teaser. It deliberately contains
 * counts but no cell positions, so a player cannot inspect the card payload to
 * study the Daily before its authoritative play clock starts.
 */
export type DailyBoardTeaser = {
  readonly width: number;
  readonly height: number;
  readonly hoppers: number;
  readonly sliders: number;
  readonly blockers: number;
  readonly holes: number;
};

export const buildDailyBoardTeaser = (board: Board): DailyBoardTeaser => {
  let hoppers = 0;
  let sliders = 0;
  let blockers = 0;
  for (const piece of board.pieces) {
    if (piece.kind === 'HOPPER') hoppers++;
    else if (piece.kind === 'SLIDER') sliders++;
    else blockers++;
  }
  return {
    width: board.width,
    height: board.height,
    hoppers,
    sliders,
    blockers,
    holes: board.holes.length,
  };
};

/**
 * Static splash payload baked into a post's `postData` (JSON-stringified under
 * the `splash` key) at creation, so the feed card renders on first paint with
 * NO server round-trip. Kept well under the 2KB postData limit. Community posts
 * carry their exact board; Daily posts carry only a position-free teaser.
 */
export type SplashPostData =
  | {
      readonly kind: 'daily';
      readonly difficulty: Difficulty;
      /** Optional so posts created before dated board teasers remain readable. */
      readonly date?: string;
      readonly teaser?: DailyBoardTeaser;
    }
  | {
      readonly kind: 'ugc';
      readonly board: Board;
      readonly difficulty: Difficulty;
      readonly creator: string;
    };

/** The `postData` object shape: the splash payload as a JSON string. */
export const POST_DATA_SPLASH_KEY = 'splash';

/** Read-only feed metadata. Unlike `/api/init`, this never begins a play. */
export type PostPreviewResponse =
  | {
      readonly type: 'post-preview';
      readonly kind: 'daily';
      readonly date: string;
      readonly difficulty: Difficulty;
      readonly teaser: DailyBoardTeaser;
    }
  | {
      readonly type: 'post-preview';
      readonly kind: 'ugc';
      readonly board: Board;
      readonly difficulty: Difficulty;
      readonly creator: string;
      readonly solves: number;
      readonly solved: boolean;
    };

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
      /** Non-resettable server clock bound before the board is disclosed. */
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
  readonly stars: number;
  readonly par: number;
  readonly moves: number;
  readonly bestMoves: number;
  readonly rank: number;
  readonly totalPlayers: number;
  readonly streak: number;
};

export type LeaderboardEntry = {
  readonly username: string;
  readonly moves: number;
  readonly timeMs: number;
};

export type LeaderboardResponse = {
  readonly puzzleId: string;
  readonly date: string;
  readonly entries: readonly LeaderboardEntry[];
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
