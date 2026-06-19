import type { Board, Piece } from './types';

export const idx = (row: number, col: number, width: number): number => row * width + col;
export const rowOf = (cell: number, width: number): number => Math.floor(cell / width);
export const colOf = (cell: number, width: number): number => cell % width;

export const inBounds = (
  row: number,
  col: number,
  width: number,
  height: number
): boolean => row >= 0 && row < height && col >= 0 && col < width;

/** Boolean grid: true where any piece sits. Holes are terrain, not occupancy. */
export const computeOccupancy = (board: Board, pieces: readonly Piece[]): boolean[] => {
  const occ = new Array<boolean>(board.width * board.height).fill(false);
  for (const piece of pieces) {
    for (const cell of piece.cells) occ[cell] = true;
  }
  return occ;
};

/**
 * Canonical key for de-duplicating states in search. Hoppers of equal type are
 * interchangeable, so we sort piece descriptors; identical layouts collapse to
 * the same key regardless of piece array order.
 */
export const stateKey = (pieces: readonly Piece[]): string => {
  const parts = pieces.map((p) => {
    const cells = [...p.cells].sort((a, b) => a - b).join(',');
    return `${p.kind}${p.orient ?? ''}:${cells}`;
  });
  parts.sort();
  return parts.join('|');
};

export const isSolved = (board: Board, pieces: readonly Piece[]): boolean => {
  const holes = new Set(board.holes);
  for (const piece of pieces) {
    if (piece.kind === 'HOPPER' && !holes.has(piece.cells[0])) return false;
  }
  return true;
};
