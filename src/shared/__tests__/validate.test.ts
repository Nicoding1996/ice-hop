import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import { generate } from '../solver/generator';
import { validateSubmission } from '../solver/validate';

describe('validateSubmission', () => {
  it('accepts a solvable, well-formed board and reports par', () => {
    let board: Board | null = null;
    for (let seed = 1; seed <= 40 && !board; seed++) {
      const g = generate({
        width: 5,
        height: 5,
        hoppers: 2,
        sliders: 0,
        blockers: 2,
        minPar: 2,
        maxPar: 12,
        attempts: 20_000,
        seed,
      });
      if (g) board = g.board;
    }
    expect(board).not.toBeNull();
    if (board) {
      const v = validateSubmission(board);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.par).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects an out-of-range board size', () => {
    const tooSmall: Board = { width: 3, height: 3, holes: [8], pieces: [{ kind: 'HOPPER', cells: [0] }] };
    expect(validateSubmission(tooSmall).ok).toBe(false);
  });

  it('rejects when holes do not match penguins', () => {
    const mismatched: Board = {
      width: 4,
      height: 4,
      holes: [14, 15],
      pieces: [
        { kind: 'HOPPER', cells: [0] },
        { kind: 'BLOCKER', cells: [1] },
      ],
    };
    expect(validateSubmission(mismatched).ok).toBe(false);
  });
});
