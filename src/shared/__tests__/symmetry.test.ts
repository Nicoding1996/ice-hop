import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import { boardSignature } from '../game/board';
import { validateBoardStructure } from '../game/validation';
import {
  SYMMETRY_COUNT,
  boardFingerprint,
  boardFingerprintId,
  transformBoard,
} from '../game/symmetry';
import { countShortestSolutions, solve } from '../solver/solver';

/** The UI smoke test's Community board: two seals, a rock, two penguins (par 7). */
const BOARD: Board = {
  width: 5,
  height: 5,
  holes: [6, 14],
  pieces: [
    { kind: 'SLIDER', cells: [7, 8], orient: 'H' },
    { kind: 'SLIDER', cells: [18, 23], orient: 'V' },
    { kind: 'BLOCKER', cells: [1] },
    { kind: 'HOPPER', cells: [12] },
    { kind: 'HOPPER', cells: [0] },
  ],
};

const transforms = (board: Board): Board[] =>
  Array.from({ length: SYMMETRY_COUNT }, (_, t) => transformBoard(board, t));

describe('board symmetry', () => {
  it('turns and flips a board into valid copies with the same par and best solutions', () => {
    const par = solve(BOARD).par;
    const best = countShortestSolutions(BOARD, { cap: 1000 });
    for (const copy of transforms(BOARD)) {
      expect(validateBoardStructure(copy).ok).toBe(true);
      expect(solve(copy).par).toBe(par);
      expect(countShortestSolutions(copy, { cap: 1000 })).toBe(best);
    }
  });

  it('gives all eight copies one fingerprint and id, whatever the piece order', () => {
    const copies = transforms(BOARD);
    expect(new Set(copies.map(boardSignature)).size).toBe(SYMMETRY_COUNT);
    expect(new Set(copies.map(boardFingerprint)).size).toBe(1);
    expect(new Set(copies.map(boardFingerprintId)).size).toBe(1);
    const reordered: Board = { ...BOARD, pieces: [...BOARD.pieces].reverse() };
    expect(boardFingerprint(reordered)).toBe(boardFingerprint(BOARD));
  });

  it('tells different puzzles apart', () => {
    const moved: Board = {
      ...BOARD,
      pieces: BOARD.pieces.map((piece) =>
        piece.kind === 'BLOCKER' ? { kind: 'BLOCKER', cells: [2] } : piece
      ),
    };
    expect(boardFingerprint(moved)).not.toBe(boardFingerprint(BOARD));
    expect(boardFingerprintId(moved)).not.toBe(boardFingerprintId(BOARD));
    expect(boardFingerprintId(BOARD)).toMatch(/^[0-9a-z]+\.[0-9a-z]+$/);
  });

  it('swaps width and height, and seal direction, when a board is transposed', () => {
    const wide: Board = {
      width: 5,
      height: 4,
      holes: [4],
      pieces: [
        { kind: 'SLIDER', cells: [10, 11], orient: 'H' },
        { kind: 'BLOCKER', cells: [3] },
        { kind: 'HOPPER', cells: [2] },
      ],
    };
    const turned = transformBoard(wide, 4);
    expect(turned.width).toBe(4);
    expect(turned.height).toBe(5);
    expect(turned.pieces[0]?.orient).toBe('V');
    expect(validateBoardStructure(turned).ok).toBe(true);
    expect(solve(turned).par).toBe(solve(wide).par);
    expect(boardFingerprint(turned)).toBe(boardFingerprint(wide));
  });
});
