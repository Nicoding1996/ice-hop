import type { Move, Piece } from './types';

/** Returns a new piece list with the moved piece relocated. Order is preserved. */
export const applyMove = (pieces: readonly Piece[], move: Move): Piece[] =>
  pieces.map((piece, i) =>
    i === move.pieceIndex
      ? { ...piece, cells: [...move.to].sort((a, b) => a - b) }
      : { ...piece }
  );

export { isSolved } from './board';
