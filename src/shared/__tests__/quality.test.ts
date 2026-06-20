import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import { countShortestSolutions, solve } from '../solver/solver';
import { analyzeRoles } from '../solver/quality';
import { generate } from '../solver/generator';

describe('countShortestSolutions', () => {
  it('counts a forced single-jump board as exactly one solution', () => {
    // 5-wide: penguin at 0 can only hop right over the rock at 1 into hole 2.
    const board: Board = {
      width: 5,
      height: 5,
      holes: [2],
      pieces: [
        { kind: 'HOPPER', cells: [0] },
        { kind: 'BLOCKER', cells: [1] },
      ],
    };
    expect(solve(board).par).toBe(1);
    expect(countShortestSolutions(board)).toBe(1);
  });

  it('detects a board with two distinct optimal solutions', () => {
    // Penguin in the middle of a row can hop left or right into a hole; both are par 1.
    const board: Board = {
      width: 5,
      height: 5,
      holes: [10, 14],
      pieces: [
        { kind: 'HOPPER', cells: [12] },
        { kind: 'BLOCKER', cells: [11] },
        { kind: 'BLOCKER', cells: [13] },
      ],
    };
    expect(solve(board).par).toBe(1);
    expect(countShortestSolutions(board)).toBe(2);
  });
});

describe('analyzeRoles', () => {
  it('flags a piece nothing ever touches as inert clutter', () => {
    // Rock at 1 is hopped; rock at 24 (far corner) is never reachable on the path.
    const board: Board = {
      width: 5,
      height: 5,
      holes: [2],
      pieces: [
        { kind: 'HOPPER', cells: [0] }, // index 0
        { kind: 'BLOCKER', cells: [1] }, // index 1 (hopped over)
        { kind: 'BLOCKER', cells: [24] }, // index 2 (inert)
      ],
    };
    const roles = analyzeRoles(board, solve(board).solution);
    expect(roles.used.has(0)).toBe(true);
    expect(roles.used.has(1)).toBe(true);
    expect(roles.inert.has(2)).toBe(true);
    expect(roles.decoy.size).toBe(0);
  });

  it('flags a touchable-but-unused piece as a decoy, not clutter', () => {
    // Penguin at 0 solves by hopping right over rock 1 into hole 2. It COULD also
    // hop down over rock 5 (to empty cell 10), so rock 5 is a decoy.
    const board: Board = {
      width: 5,
      height: 5,
      holes: [2],
      pieces: [
        { kind: 'HOPPER', cells: [0] }, // index 0
        { kind: 'BLOCKER', cells: [1] }, // index 1 (used)
        { kind: 'BLOCKER', cells: [5] }, // index 2 (decoy)
      ],
    };
    const roles = analyzeRoles(board, solve(board).solution);
    expect(roles.used.has(1)).toBe(true);
    expect(roles.decoy.has(2)).toBe(true);
    expect(roles.inert.size).toBe(0);
    expect(countShortestSolutions(board)).toBe(1); // the decoy doesn't add a 2nd solution
  });
});

describe('generator quality gates', () => {
  it('only emits unique, clutter-free boards when the gates are enabled', () => {
    let found = 0;
    for (let seed = 1; seed <= 40 && found < 3; seed++) {
      const g = generate({
        width: 5,
        height: 5,
        hoppers: 2,
        sliders: 1,
        blockers: 1,
        minPar: 3,
        maxPar: 8,
        attempts: 8000,
        seed,
        requireUnique: true,
        rejectInert: true,
      });
      if (!g) continue;
      found++;
      expect(countShortestSolutions(g.board)).toBe(1);
      expect(analyzeRoles(g.board, solve(g.board).solution).inert.size).toBe(0);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('emits boards where every piece is on the path when requireAllPiecesUsed is set', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = generate({
        width: 5,
        height: 5,
        hoppers: 2,
        sliders: 0,
        blockers: 2,
        minPar: 2,
        maxPar: 6,
        attempts: 8000,
        seed,
        requireUnique: true,
        requireAllPiecesUsed: true,
      });
      if (!g) continue;
      const roles = analyzeRoles(g.board, solve(g.board).solution);
      expect(roles.decoy.size).toBe(0);
      expect(roles.inert.size).toBe(0);
      return; // one confirmed board is enough
    }
    throw new Error('expected at least one board with all pieces used');
  });
});
