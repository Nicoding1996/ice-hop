import { describe, expect, it } from 'vitest';
import { boardSignature } from '../game/board';
import { verifyCreatorSolveProof } from '../game/proof';
import { replayMoves, verifySolvedTranscript } from '../game/replay';
import type { Board, Move } from '../game/types';
import { validateBoardStructure } from '../game/validation';

const oneHopBoard: Board = {
  width: 3,
  height: 1,
  holes: [2],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
  ],
};

describe('validateBoardStructure', () => {
  it('normalizes cell ordering while preserving piece ordering', () => {
    const result = validateBoardStructure({
      width: 4,
      height: 2,
      holes: [7, 6],
      pieces: [
        { kind: 'SLIDER', cells: [1, 0], orient: 'H' },
        { kind: 'HOPPER', cells: [3] },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.board.holes).toEqual([6, 7]);
      expect(result.board.pieces[0]?.cells).toEqual([0, 1]);
      expect(result.board.pieces[1]?.kind).toBe('HOPPER');
    }
  });

  it('rejects duplicate and out-of-bounds cells', () => {
    expect(
      validateBoardStructure({
        width: 4,
        height: 4,
        holes: [15, 15],
        pieces: [{ kind: 'HOPPER', cells: [0] }],
      }).ok
    ).toBe(false);

    expect(
      validateBoardStructure({
        width: 4,
        height: 4,
        holes: [15],
        pieces: [{ kind: 'HOPPER', cells: [16] }],
      }).ok
    ).toBe(false);
  });

  it('rejects overlapping pieces', () => {
    const result = validateBoardStructure({
      width: 4,
      height: 4,
      holes: [15],
      pieces: [
        { kind: 'HOPPER', cells: [0] },
        { kind: 'BLOCKER', cells: [0] },
      ],
    });

    expect(result).toEqual({ ok: false, reason: 'Pieces cannot overlap.' });
  });

  it('rejects malformed slider footprints and non-hopper pieces in water', () => {
    expect(
      validateBoardStructure({
        width: 4,
        height: 2,
        holes: [],
        pieces: [{ kind: 'SLIDER', cells: [3, 4], orient: 'H' }],
      }).ok
    ).toBe(false);

    expect(
      validateBoardStructure({
        width: 4,
        height: 2,
        holes: [1],
        pieces: [{ kind: 'SLIDER', cells: [0, 1], orient: 'H' }],
      }).ok
    ).toBe(false);

    expect(
      validateBoardStructure({
        width: 4,
        height: 2,
        holes: [0],
        pieces: [{ kind: 'BLOCKER', cells: [0] }],
      }).ok
    ).toBe(false);
  });
});

describe('move transcript replay', () => {
  it('accepts a legal transcript that solves the exact board', () => {
    const result = verifySolvedTranscript(oneHopBoard, [
      { pieceIndex: 0, kind: 'HOPPER', to: [2] },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.moveCount).toBe(1);
  });

  it('rejects a move that legalMoves does not emit', () => {
    const result = replayMoves(oneHopBoard, [
      { pieceIndex: 0, kind: 'HOPPER', to: [1] },
    ]);

    expect(result).toMatchObject({
      ok: false,
      moveIndex: 0,
      reason: 'Move is not legal from the current board.',
    });
  });

  it('rejects a tampered piece kind', () => {
    const result = replayMoves(oneHopBoard, [
      { pieceIndex: 0, kind: 'SLIDER', to: [2] },
    ]);

    expect(result).toMatchObject({
      ok: false,
      moveIndex: 0,
      reason: 'Move has the wrong piece type.',
    });
  });

  it('rejects a legal transcript that does not solve the board', () => {
    expect(verifySolvedTranscript(oneHopBoard, [])).toEqual({
      ok: false,
      reason: 'Move history does not solve this puzzle.',
    });
  });
});

describe('creator solve proof', () => {
  const moves: readonly Move[] = [{ pieceIndex: 0, kind: 'HOPPER', to: [2] }];

  it('accepts a legal solve for the exact canonical board signature', () => {
    const result = verifyCreatorSolveProof(oneHopBoard, {
      signature: boardSignature(oneHopBoard),
      moves,
    });

    expect(result).toMatchObject({ ok: true, moveCount: 1 });
  });

  it('rejects a proof after the board changes', () => {
    const editedBoard: Board = {
      ...oneHopBoard,
      holes: [0],
    };
    const result = verifyCreatorSolveProof(editedBoard, {
      signature: boardSignature(oneHopBoard),
      moves,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'The puzzle changed after its last successful test.',
    });
  });

  it('rejects a matching signature with a transcript that does not solve', () => {
    const result = verifyCreatorSolveProof(oneHopBoard, {
      signature: boardSignature(oneHopBoard),
      moves: [],
    });

    expect(result).toEqual({
      ok: false,
      reason: 'Test and solve this exact puzzle before submitting.',
    });
  });
});