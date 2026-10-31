import { describe, expect, it } from 'vitest';
import type { Board, Piece } from '../game/types';
import { legalMoves } from '../game/moves';
import { slideStop } from '../game/slide';

describe('slideStop', () => {
  it('maps every legal horizontal offset to a distinct leading cell', () => {
    // A horizontal seal at cells 6-7 on a 5x5 board with room on both sides.
    const board: Board = {
      width: 5,
      height: 5,
      holes: [20],
      pieces: [{ kind: 'SLIDER', cells: [6, 7], orient: 'H' }, { kind: 'HOPPER', cells: [24] }],
    };
    const seal = board.pieces[0];
    const stops = legalMoves(board, board.pieces)
      .filter((move) => move.pieceIndex === 0)
      .map((move) => slideStop(seal, move, board.width));
    expect(stops).toEqual(
      expect.arrayContaining([
        { direction: 'left', leadingCell: 5, distance: 1 },
        { direction: 'right', leadingCell: 8, distance: 1 },
        { direction: 'right', leadingCell: 9, distance: 2 },
      ])
    );
    const cells = stops.map((stop) => stop?.leadingCell);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('reports vertical lanes as up/down by whole rows', () => {
    const board: Board = {
      width: 5,
      height: 5,
      holes: [4],
      pieces: [{ kind: 'SLIDER', cells: [7, 12], orient: 'V' }, { kind: 'HOPPER', cells: [0] }],
    };
    const seal = board.pieces[0];
    const stops = legalMoves(board, board.pieces)
      .filter((move) => move.pieceIndex === 0)
      .map((move) => slideStop(seal, move, board.width));
    expect(stops).toEqual(
      expect.arrayContaining([
        { direction: 'up', leadingCell: 2, distance: 1 },
        { direction: 'down', leadingCell: 17, distance: 1 },
        { direction: 'down', leadingCell: 22, distance: 2 },
      ])
    );
  });

  it('ignores penguins and non-moves', () => {
    const penguin: Piece = { kind: 'HOPPER', cells: [0] };
    expect(slideStop(penguin, { pieceIndex: 0, kind: 'HOPPER', to: [2] }, 5)).toBeNull();
    const seal: Piece = { kind: 'SLIDER', cells: [6, 7], orient: 'H' };
    expect(slideStop(seal, { pieceIndex: 0, kind: 'SLIDER', to: [6, 7] }, 5)).toBeNull();
  });
});
