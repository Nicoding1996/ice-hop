// Puzzle-quality analysis used to keep generated boards "designed" rather than
// random: classify each piece by the role it plays relative to the optimal
// solution. Pure TS, no platform imports.
import type { Board, Move, Piece } from '../game/types';
import { rowOf } from '../game/board';
import { legalMoves } from '../game/moves';
import { applyMove } from '../game/rules';

/** Occupied cells strictly between two cells on the same row or column. */
const cellsBetween = (from: number, to: number, width: number): number[] => {
  const out: number[] = [];
  const sameRow = rowOf(from, width) === rowOf(to, width);
  const step = sameRow ? (to > from ? 1 : -1) : to > from ? width : -width;
  for (let c = from + step; c !== to; c += step) out.push(c);
  return out;
};

/** Index of the piece occupying a cell, or -1. */
const pieceAt = (pieces: readonly Piece[], cell: number): number => {
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].cells.includes(cell)) return i;
  }
  return -1;
};

export type PieceRoles = {
  /** Pieces that move in, or are hopped over by, the optimal solution. */
  readonly used: ReadonlySet<number>;
  /** Pieces a player could plausibly touch along the solution path but that the
   *  optimal solution never uses (good misdirection / decoys). */
  readonly decoy: ReadonlySet<number>;
  /** Pieces that are never even touchable along the solution path (dead clutter
   *  that makes a board feel randomly assembled). */
  readonly inert: ReadonlySet<number>;
};

/**
 * Walk the optimal solution and, at each step, record (a) every piece that is
 * engageable from that state and (b) every piece the solution actually uses.
 * A piece is then `used`, a `decoy` (engageable but unused), or `inert`
 * (never engageable along the path).
 */
export const analyzeRoles = (board: Board, solution: readonly Move[]): PieceRoles => {
  const used = new Set<number>();
  const engageable = new Set<number>();

  const markHopTargets = (
    pieces: readonly Piece[],
    move: Move,
    into: Set<number>
  ): void => {
    if (move.kind !== 'HOPPER') return;
    const from = pieces[move.pieceIndex].cells[0];
    for (const c of cellsBetween(from, move.to[0], board.width)) {
      const pi = pieceAt(pieces, c);
      if (pi >= 0) into.add(pi);
    }
  };

  let pieces: readonly Piece[] = board.pieces;
  for (const move of solution) {
    for (const candidate of legalMoves(board, pieces)) {
      engageable.add(candidate.pieceIndex);
      markHopTargets(pieces, candidate, engageable);
    }
    used.add(move.pieceIndex);
    markHopTargets(pieces, move, used);
    pieces = applyMove(pieces, move);
  }

  const decoy = new Set<number>();
  const inert = new Set<number>();
  for (let i = 0; i < board.pieces.length; i++) {
    if (used.has(i)) continue;
    if (engageable.has(i)) decoy.add(i);
    else inert.add(i);
  }
  return { used, decoy, inert };
};
