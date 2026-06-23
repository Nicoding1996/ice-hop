// DTOs shared between client and server. Keep in sync with the server routes.
import type { Board } from './game/types';

/** A community (UGC) puzzle, shaped for the client to render + play. */
export type InitUgcPuzzle = {
  readonly id: string;
  readonly board: Board;
  readonly par: number;
  readonly creator: string;
  readonly votes: number;
  readonly solves: number;
};

/**
 * Response from GET /api/init: what to render for the *current* post. A daily
 * post returns `kind: 'daily'`; a community-puzzle feed post returns
 * `kind: 'ugc'` with the puzzle and its creator. Calling `/api/init?daily=1`
 * always forces today's daily, so the hub can reach it even from inside a
 * community post (where the post itself maps to a UGC puzzle).
 */
export type InitResponse =
  | {
      readonly type: 'init';
      readonly kind: 'daily';
      readonly date: string;
      readonly board: Board;
      readonly par: number;
      readonly username: string;
      readonly solved: boolean;
      /** The viewer's prior result for this daily, when they've already solved
       *  it (drives the "solved today" recap). Absent for a first visit. */
      readonly solvedResult?: { readonly moves: number; readonly stars: number };
      /** Whether we've recorded this viewer as subscribed to the community via
       *  the in-app Join button. Reddit exposes no API to read live subscription
       *  state, so this reflects only app-driven joins - enough to stop
       *  re-prompting. */
      readonly subscribed: boolean;
      /** Current subreddit name, for the "Join r/{name}" win-screen CTA label. */
      readonly subredditName?: string;
    }
  | {
      readonly type: 'init';
      readonly kind: 'ugc';
      readonly puzzle: InitUgcPuzzle;
      readonly username: string;
      /** Whether this viewer has already solved this community puzzle. */
      readonly solved: boolean;
      readonly subredditName?: string;
    };

/** Client -> server (POST /api/solve) when a player completes a puzzle. */
export type SolveSubmission = {
  readonly date: string;
  readonly moves: number;
  readonly timeMs: number;
};

/** Server -> client after recording a solve. */
export type SolveResultDTO = {
  readonly accepted: boolean;
  readonly stars: number; // 0-3
  readonly par: number;
  readonly moves: number;
  readonly bestMoves: number;
  readonly rank: number; // 1-based; 0 when unranked (e.g. logged out)
  readonly totalPlayers: number;
  readonly streak: number; // consecutive days solved
};

export type LeaderboardEntry = {
  readonly username: string;
  readonly moves: number;
  readonly timeMs: number;
};

/** Response from GET /api/leaderboard?date=YYYY-MM-DD (best first). */
export type LeaderboardResponse = {
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
  /** How many players have solved this puzzle (the creator feedback signal). */
  readonly solves: number;
  readonly createdAt: number;
  /** The feed post this puzzle was published to (set after the post is created;
   *  best-effort, so it may be absent if posting failed). */
  readonly postId?: string;
};

export type SubmitPuzzleRequest = { readonly board: Board };

export type SubmitPuzzleResponse =
  | { readonly ok: true; readonly id: string; readonly par: number }
  | { readonly ok: false; readonly reason: string };

export type UgcListResponse = { readonly submissions: readonly UgcSubmission[] };

/** Response from GET /api/ugc/mine: the player's own puzzles plus totals, for
 *  the "My puzzles" creator-feedback view. */
export type MyPuzzlesResponse = {
  readonly submissions: readonly UgcSubmission[];
  readonly totals: { readonly puzzles: number; readonly solves: number; readonly votes: number };
};

export type VoteRequest = { readonly id: string };

export type VoteResponse = { readonly ok: boolean; readonly votes: number; readonly reason?: string };

/** Client -> server (POST /api/ugc/played) to mark a community puzzle solved. */
export type MarkPlayedRequest = { readonly id: string };

// --- Endless mode ---

/** The three solver-graded difficulty buckets for endless play. */
export type EndlessTier = 'easy' | 'medium' | 'hard';

/** Response from GET /api/endless?tier=: a fresh graded puzzle + lifetime count. */
export type EndlessResponse = {
  readonly tier: EndlessTier;
  readonly board: Board;
  readonly par: number;
  /** Total endless puzzles this player has solved (the progression banner). */
  readonly solved: number;
};

/** Lifetime endless solves split by difficulty tier (for the tier-select labels). */
export type EndlessTierCounts = {
  readonly easy: number;
  readonly medium: number;
  readonly hard: number;
};

/** Server -> client after recording an endless solve, and from GET
 *  /api/endless/stats. `solved` is the lifetime total (the progression banner);
 *  `byTier` is the per-tier split shown on the Easy/Medium/Hard buttons. */
export type EndlessSolvedResponse = {
  readonly solved: number;
  readonly byTier: EndlessTierCounts;
};

/** POST /api/comment-score body: the player's final move count for the puzzle
 *  shown in the current post. The server composes the comment text from this +
 *  the puzzle's par, so the posted text stays spoiler-free and consistent. */
export type CommentScoreRequest = {
  readonly moves: number;
};

export type CommentScoreResponse = {
  readonly type: 'commentScore';
  readonly ok: boolean;
};
