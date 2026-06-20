// DTOs shared between client and server. Keep in sync with the server routes.
import type { Board } from './game/types';

/** Response from GET /api/init: everything the client needs to render a puzzle. */
export type InitResponse = {
  readonly type: 'init';
  readonly date: string;
  readonly board: Board;
  readonly par: number;
  readonly username: string;
  readonly solved: boolean;
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
  readonly createdAt: number;
};

export type SubmitPuzzleRequest = { readonly board: Board };

export type SubmitPuzzleResponse =
  | { readonly ok: true; readonly id: string; readonly par: number }
  | { readonly ok: false; readonly reason: string };

export type UgcListResponse = { readonly submissions: readonly UgcSubmission[] };

export type VoteRequest = { readonly id: string };

export type VoteResponse = { readonly ok: boolean; readonly votes: number; readonly reason?: string };

/** Client -> server (POST /api/ugc/played) to mark a community puzzle solved. */
export type MarkPlayedRequest = { readonly id: string };
