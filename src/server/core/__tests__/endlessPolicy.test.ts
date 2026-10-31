import { describe, expect, it } from 'vitest';
import type { EndlessTier } from '../../../shared/api';
import { boardSignature } from '../../../shared/game/board';
import { transformBoard } from '../../../shared/game/symmetry';
import { validateBoardStructure } from '../../../shared/game/validation';
import { solve } from '../../../shared/solver/solver';
import { analyzeRoles } from '../../../shared/solver/quality';
import { analyzeBoard } from '../../../shared/solver/stateGraph';
import {
  ENDLESS_FALLBACKS,
  ENDLESS_TIERS,
  endlessParBand,
  endlessPuzzleId,
  endlessStaticFallback,
  generateEndlessFallback,
  generateEndlessPoolPuzzle,
  isEndlessParInBand,
} from '../endlessPolicy';

const TIERS: readonly EndlessTier[] = ['easy', 'medium', 'hard'];

describe('Endless tier bands', () => {
  it('keeps non-overlapping Easy 2-4, Medium 5-7, Hard 8-11 bands', () => {
    expect(endlessParBand('easy')).toEqual({ min: 2, max: 4 });
    expect(endlessParBand('medium')).toEqual({ min: 5, max: 7 });
    expect(endlessParBand('hard')).toEqual({ min: 8, max: 11 });
    expect(isEndlessParInBand('medium', 4)).toBe(false);
    expect(isEndlessParInBand('hard', 8)).toBe(true);
  });
});

describe('ENDLESS_FALLBACKS', () => {
  it.each(TIERS)('%s static boards are valid, solver-verified, in band, and distinct', (tier) => {
    const boards = ENDLESS_FALLBACKS[tier];
    expect(boards.length).toBeGreaterThanOrEqual(tier === 'easy' ? 6 : 3);
    const signatures = new Set<string>();
    for (const fallback of boards) {
      expect(validateBoardStructure(fallback.board).ok).toBe(true);
      const result = solve(fallback.board, { maxStates: 400_000 });
      expect(result.solvable).toBe(true);
      expect(result.par).toBe(fallback.par);
      expect(isEndlessParInBand(tier, fallback.par)).toBe(true);
      if (tier === 'easy') {
        // Easy stays trap-free: every piece is on the optimal path.
        expect(analyzeRoles(fallback.board, result.solution).used.size).toBe(
          fallback.board.pieces.length
        );
      }
      signatures.add(boardSignature(fallback.board));
    }
    expect(signatures.size).toBe(boards.length);
  });
});

describe('Endless generation', () => {
  it.each(TIERS)('request-path fallback always returns an in-band %s board', (tier) => {
    for (let run = 0; run < 3; run++) {
      const puzzle = generateEndlessFallback(tier);
      expect(isEndlessParInBand(tier, puzzle.par)).toBe(true);
      expect(solve(puzzle.board, { maxStates: 400_000 }).par).toBe(puzzle.par);
    }
  });

  it('stops pool generation once its time budget is spent', () => {
    expect(generateEndlessPoolPuzzle('hard', 0)).toBeNull();
  });
});

describe('Endless variety and quality', () => {
  it('keeps every Easy mix trap-free, par 2-4, and within the piece limits', () => {
    expect(ENDLESS_TIERS.easy.length).toBeGreaterThanOrEqual(7);
    for (const config of ENDLESS_TIERS.easy) {
      expect(config.requireAllPiecesUsed).toBe(true);
      expect([config.minPar, config.maxPar]).toEqual([2, 4]);
      expect(config.hoppers).toBeGreaterThanOrEqual(1);
      expect(config.hoppers).toBeLessThanOrEqual(3);
      expect(config.sliders).toBeLessThanOrEqual(2);
      expect(config.blockers).toBeGreaterThanOrEqual(1);
      expect(config.blockers).toBeLessThanOrEqual(2);
    }
  });

  it.each(TIERS)('fills the %s pool with in-band, clutter-free boards', (tier) => {
    for (let run = 0; run < 3; run++) {
      const puzzle = generateEndlessPoolPuzzle(tier, 20_000);
      expect(puzzle).not.toBeNull();
      if (!puzzle) return;
      const result = solve(puzzle.board, { maxStates: 400_000 });
      expect(result.par).toBe(puzzle.par);
      expect(isEndlessParInBand(tier, puzzle.par)).toBe(true);
      const roles = analyzeRoles(puzzle.board, result.solution);
      expect(roles.inert.size).toBe(0);
      if (tier === 'easy') expect(roles.used.size).toBe(puzzle.board.pieces.length);
      else expect(analyzeBoard(puzzle.board)?.bestSolutions ?? 99).toBeLessThanOrEqual(2);
    }
  });

  it('gives a puzzle and its mirrored or turned copies one id', () => {
    const puzzle = ENDLESS_FALLBACKS.medium[0];
    expect(puzzle).toBeDefined();
    if (!puzzle) return;
    for (let t = 1; t < 8; t++) {
      expect(endlessPuzzleId({ ...puzzle, board: transformBoard(puzzle.board, t) })).toBe(
        endlessPuzzleId(puzzle)
      );
    }
  });

  it('never returns an excluded puzzle from generation', () => {
    const seen = new Set<string>();
    for (let run = 0; run < 20; run++) {
      const puzzle = generateEndlessFallback('easy', seen);
      const id = endlessPuzzleId(puzzle);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('prefers static boards the player has not seen', () => {
    const boards = ENDLESS_FALLBACKS.easy;
    const keep = boards[0];
    expect(keep).toBeDefined();
    if (!keep) return;
    const allButOne = new Set(boards.slice(1).map(endlessPuzzleId));
    for (let run = 0; run < 10; run++) {
      expect(endlessPuzzleId(endlessStaticFallback('easy', allButOne))).toBe(endlessPuzzleId(keep));
    }
    const everything = new Set(boards.map(endlessPuzzleId));
    expect(everything.has(endlessPuzzleId(endlessStaticFallback('easy', everything)))).toBe(true);
  });
});
