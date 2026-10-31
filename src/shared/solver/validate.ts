import { validateBoardStructure } from '../game/validation';
import { solve } from './solver';

export type ValidationResult = { ok: true; par: number } | { ok: false; reason: string };

/**
 * Validates a user-submitted puzzle by checking its geometry and actually
 * solving it. Nothing reaches the community queue unless the solver proves it
 * is solvable, and we record its true par at the same time.
 */
export const validateSubmission = (value: unknown): ValidationResult => {
  const structure = validateBoardStructure(value);
  if (!structure.ok) return structure;

  const board = structure.board;
  const { width, height } = board;
  if (width < 4 || width > 6 || height < 4 || height > 6) {
    return { ok: false, reason: 'Board must be between 4x4 and 6x6.' };
  }

  const hoppers = board.pieces.filter((piece) => piece.kind === 'HOPPER').length;
  if (hoppers < 1) return { ok: false, reason: 'Add at least one penguin.' };
  if (hoppers > 4) return { ok: false, reason: 'Use at most four penguins.' };
  if (board.holes.length !== hoppers) {
    return { ok: false, reason: 'Use exactly one water hole per penguin.' };
  }

  const result = solve(board, { maxStates: 200_000 });
  if (!result.solvable) return { ok: false, reason: 'This puzzle has no solution.' };
  if (result.par < 2) return { ok: false, reason: 'Too easy - it should take at least 2 moves.' };

  return { ok: true, par: result.par };
};
