import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import { verifySolvedTranscript } from '../game/replay';
import { countShortestSolutions, solve } from '../solver/solver';
import {
  analyzeBoard,
  bestSolutionFrom,
  exploreStates,
  finishDistances,
  randomFinishChance,
} from '../solver/stateGraph';

/** The UI smoke test's Daily board (par 6) and Community board (par 7). */
const DAILY: Board = {
  width: 5,
  height: 5,
  holes: [12, 19, 21],
  pieces: [
    { kind: 'SLIDER', cells: [23, 24], orient: 'H' },
    { kind: 'BLOCKER', cells: [13] },
    { kind: 'HOPPER', cells: [9] },
    { kind: 'HOPPER', cells: [11] },
    { kind: 'HOPPER', cells: [10] },
  ],
};
const COMMUNITY: Board = {
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

/** One penguin with two moves: right over a rock into the water, or down. */
const COIN_FLIP: Board = {
  width: 5,
  height: 5,
  holes: [8],
  pieces: [
    { kind: 'BLOCKER', cells: [7] },
    { kind: 'BLOCKER', cells: [11] },
    { kind: 'HOPPER', cells: [6] },
  ],
};

describe('position graph analysis', () => {
  it.each([
    ['Daily', DAILY],
    ['Community', COMMUNITY],
  ])('agrees with the solver on par and best-solution count (%s)', (_name, board) => {
    const analysis = analyzeBoard(board);
    expect(analysis).not.toBeNull();
    expect(analysis?.par).toBe(solve(board).par);
    expect(analysis?.bestSolutions).toBe(countShortestSolutions(board, { cap: 100_000 }));
  });

  it('finds a best solution that replays to a win in exactly par moves', () => {
    for (const board of [DAILY, COMMUNITY]) {
      const graph = exploreStates(board, 400_000);
      const distances = finishDistances(graph);
      const path = bestSolutionFrom(board, graph, distances, board.pieces);
      const replay = verifySolvedTranscript(board, path);
      expect(replay.ok).toBe(true);
      expect(path).toHaveLength(solve(board).par);
    }
  });

  it('measures the chance that random moves finish within a move budget', () => {
    const graph = exploreStates(COIN_FLIP, 1000);
    expect(randomFinishChance(graph, 0, 1)).toBeCloseTo(0.5);
    const daily = exploreStates(DAILY, 400_000);
    const par = solve(DAILY).par;
    const tight = randomFinishChance(daily, 0, par);
    const loose = randomFinishChance(daily, 0, par + 1);
    expect(tight).toBeGreaterThan(0);
    expect(loose).toBeGreaterThanOrEqual(tight);
    expect(loose).toBeLessThanOrEqual(1);
  });

  it('reports an incomplete map instead of guessing when positions run out', () => {
    expect(exploreStates(DAILY, 5).complete).toBe(false);
    expect(analyzeBoard(DAILY, 5)).toBeNull();
  });
});
