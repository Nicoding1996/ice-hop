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

/**
 * Counts how many DISTINCT shortest (optimal) solution paths a board has,
 * capped at `cap` (we only care whether it is exactly 1 vs more-than-1, so the
 * count short-circuits at the cap). Returns 0 when unsolvable or the search
 * budget is exceeded.
 *
 * Method: BFS layer by layer. The number of shortest paths to a state is the
 * sum of the shortest-path counts of the predecessors exactly one layer up, so
 * we propagate path counts forward and, on the first layer that contains any
 * solved state (that depth == par), sum the counts of those solved states.
 */
export const countShortestSolutions = (
  board: Board,
  options?: { maxStates?: number; cap?: number }
): number => {
  const maxStates = options?.maxStates ?? 200_000;
  const cap = options?.cap ?? 2;
  if (isSolved(board, board.pieces)) return 1;

  type LayerEntry = { pieces: readonly Piece[]; paths: number };
  let layer = new Map<string, LayerEntry>([
    [stateKey(board.pieces), { pieces: board.pieces, paths: 1 }],
  ]);
  const seen = new Set<string>(layer.keys());
  let explored = 0;

  while (layer.size > 0) {
    // A solved state first appears at depth == par; sum those and stop.
    let solvedPaths = 0;
    let anySolved = false;
    for (const entry of layer.values()) {
      if (isSolved(board, entry.pieces)) {
        anySolved = true;
        solvedPaths = Math.min(cap, solvedPaths + entry.paths);
      }
    }
    if (anySolved) return solvedPaths;

    const nextLayer = new Map<string, LayerEntry>();
    for (const entry of layer.values()) {
      if (++explored > maxStates) return 0; // can't prove uniqueness in budget
      for (const move of legalMoves(board, entry.pieces)) {
        const child = applyMove(entry.pieces, move);
        const key = stateKey(child);
        if (seen.has(key)) continue; // reached in an earlier or same layer
        const existing = nextLayer.get(key);
        if (existing) existing.paths = Math.min(cap, existing.paths + entry.paths);
        else nextLayer.set(key, { pieces: child, paths: Math.min(cap, entry.paths) });
      }
    }
    for (const key of nextLayer.keys()) seen.add(key);
    layer = nextLayer;
  }
  return 0;
};
