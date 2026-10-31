import type { Board, Move, Piece } from './types';
import { colOf, rowOf } from './board';

/**
 * Shared motion timing so the feed post and the full game feel the same.
 * Longer hops take a little longer (a 1-cell hop and a 4-cell hop used to both
 * take 240ms), capped so play never feels sluggish.
 */
export const HOP_BASE_MS = 230;
export const HOP_PER_EXTRA_CELL_MS = 45;
export const HOP_MAX_MS = 380;
export const SLIDE_BASE_MS = 170;
export const SLIDE_PER_EXTRA_CELL_MS = 35;
export const SLIDE_MAX_MS = 300;

/** How long a penguin's celebration beat lasts before the result card. */
export const WIN_CELEBRATION_MS = 1100;
export const WIN_CELEBRATION_REDUCED_MS = 450;

/** Cells travelled by a move (Manhattan distance between piece origins). */
export const moveDistance = (board: Board, piece: Piece, move: Move): number => {
  const from = Math.min(...piece.cells);
  const to = Math.min(...move.to);
  return (
    Math.abs(rowOf(to, board.width) - rowOf(from, board.width)) +
    Math.abs(colOf(to, board.width) - colOf(from, board.width))
  );
};

export const moveDurationMs = (board: Board, piece: Piece, move: Move): number => {
  const extra = Math.max(0, moveDistance(board, piece, move) - 1);
  return move.kind === 'HOPPER'
    ? Math.min(HOP_MAX_MS, HOP_BASE_MS + extra * HOP_PER_EXTRA_CELL_MS)
    : Math.min(SLIDE_MAX_MS, SLIDE_BASE_MS + extra * SLIDE_PER_EXTRA_CELL_MS);
};

/**
 * Whether a seal pushed one step in `direction` would hit open water. Seals
 * refuse water (a flipper bump teaches the rule) but simply stop at rocks,
 * other pieces, and the board edge.
 */
export const sealBlockedByWater = (
  board: Board,
  piece: Piece,
  direction: -1 | 1
): boolean => {
  if (piece.kind !== 'SLIDER') return false;
  const vertical = (piece.orient ?? 'H') === 'V';
  const cells = [...piece.cells].sort((a, b) => a - b);
  const edge = direction > 0 ? cells[cells.length - 1] : cells[0];
  const row = rowOf(edge, board.width);
  const col = colOf(edge, board.width);
  const nextRow = vertical ? row + direction : row;
  const nextCol = vertical ? col : col + direction;
  if (nextRow < 0 || nextRow >= board.height || nextCol < 0 || nextCol >= board.width) {
    return false;
  }
  return board.holes.includes(nextRow * board.width + nextCol);
};

/**
 * Keep a penguin selected after it hops when it can hop again, so chains of
 * hops need one tap each instead of two. A penguin that just dived into water
 * is released, so a stray tap cannot pull it straight back out.
 */
export const keepSelectedAfterMove = (
  board: Board,
  move: Move,
  hasFollowUpMoves: boolean
): boolean =>
  move.kind === 'HOPPER' &&
  hasFollowUpMoves &&
  !move.to.every((cell) => board.holes.includes(cell));
