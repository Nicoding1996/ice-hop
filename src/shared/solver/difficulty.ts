import type { Board } from '../game/types';
import { solve } from './solver';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';

export type Grade = {
  readonly solvable: boolean;
  readonly par: number;
  readonly difficulty: Difficulty;
};

/**
 * Map an optimal solution length (par) to a difficulty band. Pure (no solver),
 * so the client splash and the post title can label an already-solved puzzle by
 * its known par without re-running the solver - the single source of truth for
 * the thresholds.
 */
export const difficultyFromPar = (par: number): Difficulty =>
  par >= 12 ? 'EXPERT' : par >= 8 ? 'HARD' : par >= 5 ? 'MEDIUM' : 'EASY';

/** Grade a board by its optimal solution length (par). */
export const gradeBoard = (board: Board): Grade => {
  const res = solve(board);
  if (!res.solvable) return { solvable: false, par: -1, difficulty: 'EXPERT' };
  return { solvable: true, par: res.par, difficulty: difficultyFromPar(res.par) };
};
