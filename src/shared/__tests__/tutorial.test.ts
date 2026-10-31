import { describe, expect, it } from 'vitest';
import { legalMoves } from '../game/moves';
import { isSolved } from '../game/board';
import { validateBoardStructure } from '../game/validation';
import { solve } from '../solver/solver';
import { TUTORIAL_STEPS } from '../tutorial';

describe('TUTORIAL_STEPS', () => {
  it('has three valid, unsolved, short practice boards', () => {
    expect(TUTORIAL_STEPS).toHaveLength(3);
    for (const step of TUTORIAL_STEPS) {
      expect(validateBoardStructure(step.board).ok).toBe(true);
      expect(isSolved(step.board, step.board.pieces)).toBe(false);
      const result = solve(step.board);
      expect(result.solvable).toBe(true);
      expect(result.par).toBeLessThanOrEqual(2);
    }
  });

  it('highlights the only piece that can make the first move', () => {
    for (const step of TUTORIAL_STEPS) {
      const movers = new Set(
        legalMoves(step.board, step.board.pieces).map((move) => move.pieceIndex)
      );
      expect([...movers]).toEqual([step.focusPiece]);
    }
  });

  it('teaches hopping out of the water in the last step', () => {
    const last = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
    const focus = last.board.pieces[last.focusPiece];
    expect(focus.kind).toBe('HOPPER');
    expect(last.board.holes).toContain(focus.cells[0]);
    expect(solve(last.board).solution[0]?.pieceIndex).toBe(last.focusPiece);
  });
});
