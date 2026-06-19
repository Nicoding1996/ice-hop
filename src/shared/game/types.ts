// Core game model. Pure data, theme-agnostic, no platform imports.
//
// Pieces are abstract so the theme/art is a swappable skin:
//   HOPPER  - moves only by jumping in a straight line over occupied cells.
//   SLIDER  - a 1xN piece that slides along its axis; cannot jump.
//   BLOCKER - never moves; pure obstacle.
// A puzzle is SOLVED when every HOPPER occupies a HOLE cell.

export type PieceKind = 'HOPPER' | 'SLIDER' | 'BLOCKER';
export type Orientation = 'H' | 'V';

export type Piece = {
  readonly kind: PieceKind;
  /** Occupied cell indices (row * width + col). Length 1 for HOPPER/BLOCKER, >= 2 for SLIDER. */
  readonly cells: readonly number[];
  /** Required for SLIDER; defines the axis it travels along. */
  readonly orient?: Orientation;
};

export type Board = {
  readonly width: number;
  readonly height: number;
  /** Target cells. Solved when every HOPPER sits on one of these. */
  readonly holes: readonly number[];
  readonly pieces: readonly Piece[];
};

/** A single relocation of one piece. One move = one hop OR one slide. */
export type Move = {
  readonly pieceIndex: number;
  readonly kind: PieceKind;
  /** The piece's cells after the move (sorted ascending). */
  readonly to: readonly number[];
};
