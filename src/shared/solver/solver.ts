import type { Board, Move, Piece } from '../game/types';
import { isSolved, stateKey } from '../game/board';
import { legalMoves } from '../game/moves';
import { applyMove } from '../game/rules';

export type SolveResult = {
  readonly solvable: boolean;
  /** Optimal move count; -1 when unsolvable or the search budget is exceeded. */
  readonly par: number;
  /** One optimal solution path (empty when already solved or unsolvable). */
  readonly solution: readonly Move[];
};

type SearchNode = { readonly pieces: readonly Piece[]; readonly path: readonly Move[] };

/**
 * Breadth-first search over board states. Because BFS explores by depth, the
 * first solved state found is guaranteed optimal -> this is our `par`.
 * State space is small (few pieces on a small grid), so plain BFS is plenty.
 */
export const solve = (board: Board, options?: { maxStates?: number }): SolveResult => {
  const maxStates = options?.maxStates ?? 200_000;
  if (isSolved(board, board.pieces)) return { solvable: true, par: 0, solution: [] };

  const visited = new Set<string>([stateKey(board.pieces)]);
  let frontier: SearchNode[] = [{ pieces: board.pieces, path: [] }];
  let explored = 0;

  while (frontier.length > 0) {
    const next: SearchNode[] = [];
    for (const node of frontier) {
      if (++explored > maxStates) return { solvable: false, par: -1, solution: [] };
      for (const move of legalMoves(board, node.pieces)) {
        const childPieces = applyMove(node.pieces, move);
        const key = stateKey(childPieces);
        if (visited.has(key)) continue;
        const path = [...node.path, move];
        if (isSolved(board, childPieces)) {
          return { solvable: true, par: path.length, solution: path };
        }
        visited.add(key);
        next.push({ pieces: childPieces, path });
      }
    }
    frontier = next;
  }

  return { solvable: false, par: -1, solution: [] };
};

export const isSolvable = (board: Board, options?: { maxStates?: number }): boolean =>
  solve(board, options).solvable;
