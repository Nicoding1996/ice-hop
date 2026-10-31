import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import {
  HOP_BASE_MS,
  HOP_MAX_MS,
  keepSelectedAfterMove,
  moveDistance,
  moveDurationMs,
  sealBlockedByWater,
} from '../game/motion';

const board: Board = {
  width: 5,
  height: 5,
  holes: [4, 13],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
    { kind: 'SLIDER', cells: [11, 12], orient: 'H' },
  ],
};

describe('motion timing', () => {
  it('scales hop duration with distance, capped', () => {
    const penguin = board.pieces[0];
    const short = { pieceIndex: 0, kind: 'HOPPER' as const, to: [2] };
    const long = { pieceIndex: 0, kind: 'HOPPER' as const, to: [4] };
    expect(moveDistance(board, penguin, short)).toBe(2);
    expect(moveDurationMs(board, penguin, short)).toBeGreaterThanOrEqual(HOP_BASE_MS);
    expect(moveDurationMs(board, penguin, long)).toBeGreaterThan(moveDurationMs(board, penguin, short));
    const far = { pieceIndex: 0, kind: 'HOPPER' as const, to: [24] };
    expect(moveDurationMs(board, penguin, far)).toBe(HOP_MAX_MS);
  });
});

describe('sealBlockedByWater', () => {
  it('detects open water directly beyond the seal', () => {
    const seal = board.pieces[2];
    expect(sealBlockedByWater(board, seal, 1)).toBe(true); // cell 13 is a hole
    expect(sealBlockedByWater(board, seal, -1)).toBe(false); // cell 10 is ice
  });

  it('ignores the board edge and non-seals', () => {
    const edgeSeal = { kind: 'SLIDER' as const, cells: [23, 24], orient: 'H' as const };
    expect(sealBlockedByWater(board, edgeSeal, 1)).toBe(false);
    expect(sealBlockedByWater(board, board.pieces[0], 1)).toBe(false);
  });
});

describe('keepSelectedAfterMove', () => {
  it('keeps a penguin selected after a dry hop that can continue', () => {
    expect(keepSelectedAfterMove(board, { pieceIndex: 0, kind: 'HOPPER', to: [2] }, true)).toBe(true);
    expect(keepSelectedAfterMove(board, { pieceIndex: 0, kind: 'HOPPER', to: [2] }, false)).toBe(false);
  });

  it('releases a penguin that dived into water, and seals', () => {
    expect(keepSelectedAfterMove(board, { pieceIndex: 0, kind: 'HOPPER', to: [4] }, true)).toBe(false);
    expect(keepSelectedAfterMove(board, { pieceIndex: 2, kind: 'SLIDER', to: [10, 11] }, true)).toBe(false);
  });
});
