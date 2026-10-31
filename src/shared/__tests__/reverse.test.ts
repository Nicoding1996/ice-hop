import { describe, expect, it } from 'vitest';
import { boardSignature } from '../game/board';
import { boardFingerprintId } from '../game/symmetry';
import { validateBoardStructure } from '../game/validation';
import { analyzeRoles } from '../solver/quality';
import { generateReverse, type ReverseOptions } from '../solver/reverse';
import { countShortestSolutions, solve } from '../solver/solver';
import { analyzeBoard } from '../solver/stateGraph';

const CASES: ReadonlyArray<readonly [string, ReverseOptions]> = [
  [
    'Easy, every piece used',
    { hoppers: 2, sliders: 1, blockers: 1, minPar: 4, maxPar: 4, requireAllPiecesUsed: true },
  ],
  ['Medium', { hoppers: 2, sliders: 1, blockers: 2, minPar: 5, maxPar: 7 }],
  ['Hard', { hoppers: 3, sliders: 1, blockers: 2, minPar: 8, maxPar: 11 }],
];

describe('reverse generation', () => {
  it.each(CASES)('builds a valid %s board with one best solution and no clutter', (_name, options) => {
    const generated = generateReverse({
      ...options,
      maxOptimalSolutions: 1,
      rejectInert: true,
      maxThreeStarLuck: 0.05,
      attempts: 400,
      seed: 7,
    });
    expect(generated).not.toBeNull();
    if (!generated) return;
    const { board, par } = generated;
    expect(validateBoardStructure(board).ok).toBe(true);

    const result = solve(board, { maxStates: 400_000 });
    expect(result.par).toBe(par);
    expect(par).toBeGreaterThanOrEqual(options.minPar);
    expect(par).toBeLessThanOrEqual(options.maxPar);
    expect(countShortestSolutions(board, { maxStates: 400_000, cap: 10 })).toBe(1);
    expect(analyzeBoard(board)?.threeStarLuck ?? 1).toBeLessThanOrEqual(0.05);

    const kinds = board.pieces.map((piece) => piece.kind);
    expect(kinds.filter((kind) => kind === 'HOPPER')).toHaveLength(options.hoppers);
    expect(kinds.filter((kind) => kind === 'SLIDER')).toHaveLength(options.sliders);
    expect(kinds.filter((kind) => kind === 'BLOCKER')).toHaveLength(options.blockers);
    expect(board.holes).toHaveLength(options.hoppers);
    const holes = new Set(board.holes);
    expect(board.pieces.some((piece) => piece.kind === 'HOPPER' && holes.has(piece.cells[0]))).toBe(
      false
    );

    const roles = analyzeRoles(board, result.solution);
    expect(roles.inert.size).toBe(0);
    if (options.requireAllPiecesUsed) expect(roles.used.size).toBe(board.pieces.length);
  });

  it('repeats a board for the same seed and skips excluded puzzles', () => {
    const options: ReverseOptions = {
      hoppers: 2,
      sliders: 1,
      blockers: 2,
      minPar: 5,
      maxPar: 7,
      maxOptimalSolutions: 1,
      attempts: 400,
      seed: 11,
    };
    const first = generateReverse(options);
    const again = generateReverse(options);
    expect(first && again && boardSignature(again.board)).toBe(first && boardSignature(first.board));
    if (!first) return;
    const id = boardFingerprintId(first.board);
    const other = generateReverse({ ...options, exclude: new Set([id]) });
    expect(other).not.toBeNull();
    expect(other && boardFingerprintId(other.board)).not.toBe(id);
  });

  it('returns null when no board can meet the band', () => {
    expect(
      generateReverse({ hoppers: 1, sliders: 0, blockers: 1, minPar: 20, maxPar: 20, attempts: 30, seed: 3 })
    ).toBeNull();
  });
});
