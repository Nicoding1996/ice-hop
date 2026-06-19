import type { Board } from '../game/types';
import { solve } from './solver';

export type ValidationResult = { ok: true; par: number } | { ok: false; reason: string };

/**
 * Validates a user-submitted puzzle by actually solving it. This is what makes
 * UGC safe: nothing reaches the community queue unless the solver proves it is
 * solvable, and we record its true par at the same time.
 */
export const validateSubmission = (board: Board): ValidationResult => {
  const { width, height } = board;
  if (width < 4 || width > 6 || height < 4 || height > 6) {
    return { ok: false, reason: 'Board must be between 4x4 and 6x6.' };
  }

  const hoppers = board.pieces.filter((p) => p.kind === 'HOPPER').length;
  if (hoppers < 1) return { ok: false, reason: 'Add at least one penguin.' };
  if (hoppers > 4) return { ok: false, reason: 'Use at most four penguins.' };
  if (board.holes.length !== hoppers) {
    return { ok: false, reason: 'The number of water holes must equal the number of penguins.' };
  }

  const result = solve(board, { maxStates: 200_000 });
  if (!result.solvable) return { ok: false, reason: 'This puzzle has no solution.' };
  if (result.par < 2) return { ok: false, reason: 'Too easy - it should take at least 2 moves.' };

  return { ok: true, par: result.par };
};
