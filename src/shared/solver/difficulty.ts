import type { Board } from '../game/types';
import { solve } from './solver';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';

export type Grade = {
  readonly solvable: boolean;
  readonly par: number;
  readonly difficulty: Difficulty;
};

/** Grade a board by its optimal solution length (par). */
export const gradeBoard = (board: Board): Grade => {
  const res = solve(board);
  if (!res.solvable) return { solvable: false, par: -1, difficulty: 'EXPERT' };
  const par = res.par;
  const difficulty: Difficulty =
    par >= 12 ? 'EXPERT' : par >= 8 ? 'HARD' : par >= 5 ? 'MEDIUM' : 'EASY';
  return { solvable: true, par, difficulty };
};
