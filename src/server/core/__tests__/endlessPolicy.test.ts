import { describe, expect, it } from 'vitest';
import type { EndlessTier } from '../../../shared/api';
import { boardSignature } from '../../../shared/game/board';
import { validateBoardStructure } from '../../../shared/game/validation';
import { solve } from '../../../shared/solver/solver';
import { analyzeRoles } from '../../../shared/solver/quality';
import {
  ENDLESS_FALLBACKS,
  endlessParBand,
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
