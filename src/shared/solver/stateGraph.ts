// Whole-puzzle analysis on the graph of reachable positions. Pure TS.
//
// One exploration answers several quality questions at once: how many moves
// every position needs to finish, how many different best solutions it has,
// and how likely random moves are to finish it within a move budget.
import type { Board, Move, Piece } from '../game/types';
import { isSolved, stateKey } from '../game/board';
import { legalMoves } from '../game/moves';
import { applyMove } from '../game/rules';

export type StateGraph = {
  /** One piece array per position; index 0 is the starting position. */
  readonly states: readonly (readonly Piece[])[];
  /** Position key (stateKey) to its index in `states`. */
  readonly index: ReadonlyMap<string, number>;
  /** Positions one legal move away, one entry per legal move. */
  readonly next: readonly (readonly number[])[];
  readonly solved: readonly boolean[];
  /** False when `maxStates` ran out before every reachable position was seen. */
  readonly complete: boolean;
};

/** Breadth-first map of every position reachable from `board.pieces`. */
export const exploreStates = (board: Board, maxStates: number): StateGraph => {
  const states: (readonly Piece[])[] = [];
  const index = new Map<string, number>();
  const next: number[][] = [];
  const solved: boolean[] = [];
  const add = (pieces: readonly Piece[], key: string): number => {
    const id = states.length;
    states.push(pieces);
    index.set(key, id);
    next.push([]);
    solved.push(isSolved(board, pieces));
    return id;
  };
  add(board.pieces, stateKey(board.pieces));

  for (let current = 0; current < states.length; current++) {
    if (states.length > maxStates) return { states, index, next, solved, complete: false };
    const pieces = states[current];
    const out: number[] = [];
    for (const move of legalMoves(board, pieces)) {
      const child = applyMove(pieces, move);
      const key = stateKey(child);
      out.push(index.get(key) ?? add(child, key));
    }
    next[current] = out;
  }
  return { states, index, next, solved, complete: true };
};

export type FinishDistances = {
  /** Fewest moves from each position to a solved one (-1 when impossible). */
  readonly moves: Int32Array;
  /** Number of different best solutions from each position, capped at `cap`. */
  readonly bestSolutions: Float64Array;
};

/**
 * Moves-to-finish and best-solution counts for every position, by searching
 * backward from all solved positions at once. A best solution from a position
 * steps through positions that each need exactly one move fewer.
 */
export const finishDistances = (graph: StateGraph, cap = 1_000_000): FinishDistances => {
  const count = graph.states.length;
  const previous: number[][] = Array.from({ length: count }, () => []);
  for (let from = 0; from < count; from++) {
    for (const to of graph.next[from]) previous[to].push(from);
  }
  const moves = new Int32Array(count).fill(-1);
  const bestSolutions = new Float64Array(count);
  const order: number[] = [];
  for (let id = 0; id < count; id++) {
    if (graph.solved[id]) {
      moves[id] = 0;
      bestSolutions[id] = 1;
      order.push(id);
    }
  }
  for (let head = 0; head < order.length; head++) {
    const id = order[head];
    for (const before of previous[id]) {
      if (moves[before] >= 0) continue;
      moves[before] = moves[id] + 1;
      order.push(before);
    }
  }
  // `order` is sorted by moves-to-finish, so every successor one move closer
  // to the finish already has its count.
  for (const id of order) {
    const need = moves[id];
    if (need <= 0) continue;
    let total = 0;
    for (const to of graph.next[id]) {
      if (moves[to] === need - 1) total += bestSolutions[to];
    }
    bestSolutions[id] = Math.min(cap, total);
  }
  return { moves, bestSolutions };
};

/**
 * Chance that a player who picks uniformly random legal moves finishes from
 * position `start` within `maxMoves` moves. With `maxMoves = par + 1` this is
 * the chance of earning 3 stars by luck alone.
 */
export const randomFinishChance = (
  graph: StateGraph,
  start: number,
  maxMoves: number
): number => {
  if (graph.solved[start]) return 1;
  let mass = new Map<number, number>([[start, 1]]);
  let finished = 0;
  for (let step = 0; step < maxMoves && mass.size > 0; step++) {
    const after = new Map<number, number>();
    for (const [id, chance] of mass) {
      const out = graph.next[id];
      if (out.length === 0) continue; // stuck: no legal move
      const share = chance / out.length;
      for (const to of out) {
        if (graph.solved[to]) finished += share;
        else after.set(to, (after.get(to) ?? 0) + share);
      }
    }
    mass = after;
  }
  return finished;
};

/**
 * One best solution from `pieces`, as moves indexed against that exact piece
 * array. Moves are recomputed on the live position (graph positions merge
 * interchangeable penguins, so their piece order can differ).
 */
export const bestSolutionFrom = (
  board: Board,
  graph: StateGraph,
  distances: FinishDistances,
  pieces: readonly Piece[]
): Move[] => {
  const path: Move[] = [];
  let current = pieces;
  let need = distances.moves[graph.index.get(stateKey(current)) ?? -1] ?? -1;
  while (need > 0) {
    const step = legalMoves(board, current).find((move) => {
      const id = graph.index.get(stateKey(applyMove(current, move)));
      return id !== undefined && distances.moves[id] === need - 1;
    });
    if (!step) return [];
    path.push(step);
    current = applyMove(current, step);
    need -= 1;
  }
  return path;
};

export type BoardAnalysis = {
  readonly par: number;
  readonly bestSolutions: number;
  /** Chance that random moves finish within par + 1 moves (3 stars by luck). */
  readonly threeStarLuck: number;
  /** Every position reachable from the start. */
  readonly positions: number;
};

/**
 * Par, best-solution count, and 3-star luck for a starting board, or null when
 * it is unsolvable or has more than `maxStates` reachable positions.
 */
export const analyzeBoard = (board: Board, maxStates = 400_000): BoardAnalysis | null => {
  const graph = exploreStates(board, maxStates);
  if (!graph.complete) return null;
  const distances = finishDistances(graph);
  const par = distances.moves[0];
  if (par < 0) return null;
  return {
    par,
    bestSolutions: distances.bestSolutions[0],
    threeStarLuck: randomFinishChance(graph, 0, par + 1),
    positions: graph.states.length,
  };
};
