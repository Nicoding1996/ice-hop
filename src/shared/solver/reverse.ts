// Reverse puzzle generation. Pure TS.
//
// Start from a finished board (every penguin in the water), map every position
// reachable from it, and work out how many moves each position needs to get
// back. Any of those positions is a solvable starting board with a known par
// and a known number of best solutions, so one search yields many candidates.
// Moves are reversible, so this finds exactly the starting boards that can be
// solved into this finished layout.
import type { Board, Piece } from '../game/types';
import { boardFingerprintId } from '../game/symmetry';
import { analyzeRoles } from './quality';
import { mulberry32, shuffledIndices } from './random';
import { solve } from './solver';
import {
  bestSolutionFrom,
  exploreStates,
  finishDistances,
  randomFinishChance,
  type StateGraph,
} from './stateGraph';

export type ReverseOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly hoppers: number;
  readonly sliders: number;
  readonly blockers: number;
  readonly minPar: number;
  readonly maxPar: number;
  /** Most best (shortest) solutions allowed; 1 means a single intended line. */
  readonly maxOptimalSolutions?: number;
  /** Reject boards with a piece nothing touches along the solution. */
  readonly rejectInert?: boolean;
  /** Reject boards unless every piece is used by the solution (no decoys). */
  readonly requireAllPiecesUsed?: boolean;
  /** Highest allowed chance that random moves earn 3 stars (par + 1 moves). */
  readonly maxThreeStarLuck?: number;
  /** Fingerprint ids (boardFingerprintId) of puzzles that must not be produced. */
  readonly exclude?: ReadonlySet<string>;
  /** Finished layouts to try. */
  readonly attempts?: number;
  /** Positions mapped per layout before it is skipped as too large. */
  readonly maxStates?: number;
  /** Starting positions checked per layout. */
  readonly candidatesPerLayout?: number;
  readonly seed?: number;
  /** Stop starting new layouts once this many milliseconds have passed. */
  readonly deadlineMs?: number;
};

export type ReverseGenerated = {
  readonly board: Board;
  readonly par: number;
  readonly bestSolutions: number;
  readonly threeStarLuck: number;
};

type Layout = {
  /** The finished position: every penguin in a hole. */
  readonly board: Board;
};

/**
 * A random finished layout: water holes, rocks, seals, and a penguin in every
 * hole. Pieces are ordered seals, rocks, then penguins, like the random
 * generator, and seals and rocks never sit on water.
 */
const randomFinishedLayout = (
  width: number,
  height: number,
  options: ReverseOptions,
  rng: () => number
): Layout | null => {
  const cellCount = width * height;
  const bag = shuffledIndices(cellCount, rng);
  const used = new Array<boolean>(cellCount).fill(false);
  let cursor = 0;
  const take = (): number => {
    while (cursor < cellCount && used[bag[cursor]]) cursor++;
    if (cursor >= cellCount) return -1;
    const cell = bag[cursor];
    cursor++;
    used[cell] = true;
    return cell;
  };

  const holes: number[] = [];
  for (let k = 0; k < options.hoppers; k++) {
    const cell = take();
    if (cell < 0) return null;
    holes.push(cell);
  }
  const sliders: Piece[] = [];
  for (let s = 0; s < options.sliders; s++) {
    const cell = take();
    if (cell < 0) return null;
    const right = cell + 1;
    const down = cell + width;
    const canH = cell % width <= width - 2 && !used[right];
    const canV = down < cellCount && !used[down];
    if (canH && (rng() < 0.5 || !canV)) {
      used[right] = true;
      sliders.push({ kind: 'SLIDER', cells: [cell, right], orient: 'H' });
    } else if (canV) {
      used[down] = true;
      sliders.push({ kind: 'SLIDER', cells: [cell, down], orient: 'V' });
    } else {
      return null;
    }
  }
  const blockers: Piece[] = [];
  for (let b = 0; b < options.blockers; b++) {
    const cell = take();
    if (cell < 0) return null;
    blockers.push({ kind: 'BLOCKER', cells: [cell] });
  }
  const hoppers: Piece[] = holes.map((hole) => ({ kind: 'HOPPER', cells: [hole] }));
  return {
    board: {
      width,
      height,
      holes: [...holes].sort((a, b) => a - b),
      pieces: [...sliders, ...blockers, ...hoppers],
    },
  };
};

const startsInWater = (board: Board, pieces: readonly Piece[]): boolean => {
  const holes = new Set(board.holes);
  return pieces.some((piece) => piece.kind === 'HOPPER' && holes.has(piece.cells[0]));
};

/** Check one candidate start; returns the puzzle when it passes every gate. */
const acceptCandidate = (
  layout: Layout,
  graph: StateGraph,
  distances: ReturnType<typeof finishDistances>,
  id: number,
  options: ReverseOptions
): ReverseGenerated | null => {
  const pieces = graph.states[id];
  if (startsInWater(layout.board, pieces)) return null;
  const board: Board = { ...layout.board, pieces: pieces.map((piece) => ({ ...piece, cells: [...piece.cells] })) };
  if (options.exclude && options.exclude.has(boardFingerprintId(board))) return null;

  const par = distances.moves[id];
  // Cheapest checks first: piece roles walk one solution, the luck check
  // spreads over every position within par + 1 moves.
  if (options.rejectInert || options.requireAllPiecesUsed) {
    const solution = bestSolutionFrom(layout.board, graph, distances, board.pieces);
    if (solution.length !== par) return null;
    const roles = analyzeRoles(board, solution);
    if (options.requireAllPiecesUsed && roles.used.size !== board.pieces.length) return null;
    if (options.rejectInert && roles.inert.size > 0) return null;
  }
  const luck = randomFinishChance(graph, id, par + 1);
  if (luck > (options.maxThreeStarLuck ?? 1)) return null;

  // The shipped par must be exactly what the shared solver reports.
  const check = solve(board, { maxStates: Math.max(200_000, graph.states.length * 2) });
  if (!check.solvable || check.par !== par) return null;
  return { board, par, bestSolutions: distances.bestSolutions[id], threeStarLuck: luck };
};

/**
 * Generate a puzzle by working backward from a finished board. Returns null
 * when no layout yields a board that passes every gate within the attempt or
 * time budget. Every returned board is solver-verified at its par.
 */
export const generateReverse = (options: ReverseOptions): ReverseGenerated | null => {
  const width = options.width ?? 5;
  const height = options.height ?? 5;
  const attempts = options.attempts ?? 200;
  // The largest layouts measured for the shipped piece mixes map about 18,000
  // positions; the cap bounds memory for anything unusually large.
  const maxStates = options.maxStates ?? 40_000;
  const perLayout = options.candidatesPerLayout ?? 60;
  const maxOptimal = options.maxOptimalSolutions ?? Number.POSITIVE_INFINITY;
  const rng = mulberry32(options.seed ?? Math.floor(Math.random() * 0x7fffffff));
  const deadline = options.deadlineMs !== undefined ? Date.now() + options.deadlineMs : Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (Date.now() > deadline) break;
    const layout = randomFinishedLayout(width, height, options, rng);
    if (!layout) continue;
    const graph = exploreStates(layout.board, maxStates);
    if (!graph.complete) continue;
    const distances = finishDistances(graph, maxOptimal + 1);

    const candidates: number[] = [];
    for (let id = 0; id < graph.states.length; id++) {
      const need = distances.moves[id];
      if (need < options.minPar || need > options.maxPar) continue;
      if (distances.bestSolutions[id] > maxOptimal) continue;
      candidates.push(id);
    }
    if (candidates.length === 0) continue;

    const order = shuffledIndices(candidates.length, rng).slice(0, perLayout);
    for (const pick of order) {
      const accepted = acceptCandidate(layout, graph, distances, candidates[pick], options);
      if (accepted) return accepted;
    }
  }
  return null;
};
