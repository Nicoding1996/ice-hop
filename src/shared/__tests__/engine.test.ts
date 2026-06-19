import { describe, expect, it } from 'vitest';
import type { Board, Move, Piece } from '../game/types';
import { isSolved } from '../game/board';
import { legalMoves } from '../game/moves';
import { applyMove } from '../game/rules';
import { solve } from '../solver/solver';
import { generate } from '../solver/generator';

const sameCells = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const expectSolutionSolves = (board: Board, solution: readonly Move[]): void => {
  let pieces: readonly Piece[] = board.pieces;
  for (const move of solution) {
    const legal = legalMoves(board, pieces);
    expect(legal.some((m) => m.pieceIndex === move.pieceIndex && sameCells(m.to, move.to))).toBe(true);
    pieces = applyMove(pieces, move);
  }
  expect(isSolved(board, pieces)).toBe(true);
};

describe('engine', () => {
  it('lets a hopper jump a blocker into a hole (par 1)', () => {
    const board: Board = {
      width: 3,
      height: 1,
      holes: [2],
      pieces: [
        { kind: 'HOPPER', cells: [0] },
        { kind: 'BLOCKER', cells: [1] },
      ],
    };
    expect(legalMoves(board, board.pieces).some((m) => sameCells(m.to, [2]))).toBe(true);
    const res = solve(board);
    expect(res).toMatchObject({ solvable: true, par: 1 });
    expectSolutionSolves(board, res.solution);
  });

  it('treats a lone hopper with nothing to jump as unsolvable', () => {
    const board: Board = { width: 3, height: 1, holes: [2], pieces: [{ kind: 'HOPPER', cells: [0] }] };
    expect(legalMoves(board, board.pieces)).toHaveLength(0);
    expect(solve(board).solvable).toBe(false);
  });

  it('slides a horizontal slider to each reachable position', () => {
    const board: Board = {
      width: 4,
      height: 1,
      holes: [],
      pieces: [{ kind: 'SLIDER', cells: [0, 1], orient: 'H' }],
    };
    const tos = legalMoves(board, board.pieces)
      .map((m) => m.to.join(','))
      .sort();
    expect(tos).toEqual(['1,2', '2,3']);
  });
});

describe('solver', () => {
  it('finds the optimal two-step solution (par 2)', () => {
    const board: Board = {
      width: 5,
      height: 1,
      holes: [4],
      pieces: [
        { kind: 'HOPPER', cells: [0] },
        { kind: 'BLOCKER', cells: [1] },
        { kind: 'BLOCKER', cells: [3] },
      ],
    };
    const res = solve(board);
    expect(res).toMatchObject({ solvable: true, par: 2 });
    expectSolutionSolves(board, res.solution);
  });

  it('reports par 0 for an already-solved board', () => {
    const board: Board = { width: 3, height: 1, holes: [0], pieces: [{ kind: 'HOPPER', cells: [0] }] };
    expect(solve(board).par).toBe(0);
  });
});

describe('generator', () => {
  it('produces solvable boards whose par matches the solver', () => {
    let found = 0;
    for (let seed = 1; seed <= 30 && found < 3; seed++) {
      const g = generate({
        width: 5,
        height: 5,
        hoppers: 1,
        sliders: 0,
        blockers: 3,
        minPar: 1,
        maxPar: 15,
        attempts: 20_000,
        seed,
      });
      if (!g) continue;
      found++;
      const res = solve(g.board);
      expect(res.solvable).toBe(true);
      expect(res.par).toBe(g.par);
      expectSolutionSolves(g.board, res.solution);
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('slider vs holes', () => {
  it('a seal cannot slide onto a water hole', () => {
    // Row of 4: seal at [0,1], a hole at cell 3.
    const board: Board = {
      width: 4,
      height: 1,
      holes: [3],
      pieces: [{ kind: 'SLIDER', cells: [0, 1], orient: 'H' }],
    };
    const tos = legalMoves(board, board.pieces)
      .map((m) => m.to.join(','))
      .sort();
    // It may slide to [1,2] (cell 2 is open ice) but NOT to [2,3] (cell 3 is open water).
    expect(tos).toEqual(['1,2']);
  });
});
