import type { Move, Piece } from './types';

export type SlideDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Where one legal seal move "stops" in its lane. The stop is the cell the
 * seal's leading edge reaches, so every legal offset maps to its own one-cell
 * target on both play surfaces, and the two surfaces always agree.
 */
export type SlideStop = {
  readonly direction: SlideDirection;
  /** The cell the leading end of the seal lands on (a one-cell tap target). */
  readonly leadingCell: number;
  /** Distance travelled, in cells. */
  readonly distance: number;
};

export const slideStop = (piece: Piece, move: Move, width: number): SlideStop | null => {
  if (piece.kind !== 'SLIDER' || move.kind !== 'SLIDER' || move.to.length === 0) return null;
  const vertical = (piece.orient ?? 'H') === 'V';
  const step = vertical ? width : 1;
  const from = Math.min(...piece.cells);
  const to = [...move.to].sort((a, b) => a - b);
  const offset = (to[0] - from) / step;
  if (!Number.isInteger(offset) || offset === 0) return null;
  const forward = offset > 0;
  const leadingCell = forward ? to[to.length - 1] : to[0];
  const direction: SlideDirection = vertical
    ? forward
      ? 'down'
      : 'up'
    : forward
      ? 'right'
      : 'left';
  return { direction, leadingCell, distance: Math.abs(offset) };
};
