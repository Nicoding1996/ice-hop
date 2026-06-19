import type { Board, Move, Piece } from './types';
import { colOf, computeOccupancy, inBounds, rowOf } from './board';

const DIRS: ReadonlyArray<{ dr: number; dc: number }> = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

/**
 * All legal moves from the given piece configuration.
 * - HOPPER: jumps over a contiguous run of >= 1 occupied cells in a straight
 *   line, landing on the first empty cell beyond. Cannot step into an adjacent
 *   empty cell. An empty hole is a valid landing cell (the goal).
 * - SLIDER: slides along its axis any number of free cells; cannot jump, and
 *   cannot slide onto a hole (open water - it would fall in).
 * - BLOCKER: never moves.
 */
export const legalMoves = (board: Board, pieces: readonly Piece[]): Move[] => {
  const { width, height } = board;
  const occ = computeOccupancy(board, pieces);
  const holeSet = new Set(board.holes);
  const moves: Move[] = [];

  pieces.forEach((piece, pieceIndex) => {
    if (piece.kind === 'HOPPER') {
      const from = piece.cells[0];
      const r0 = rowOf(from, width);
      const c0 = colOf(from, width);
      for (const { dr, dc } of DIRS) {
        let r = r0 + dr;
        let c = c0 + dc;
        let jumped = false;
        while (inBounds(r, c, width, height) && occ[r * width + c]) {
          jumped = true;
          r += dr;
          c += dc;
        }
        if (jumped && inBounds(r, c, width, height) && !occ[r * width + c]) {
          moves.push({ pieceIndex, kind: 'HOPPER', to: [r * width + c] });
        }
      }
      return;
    }

    if (piece.kind === 'SLIDER') {
      const orient = piece.orient ?? 'H';
      const cells = [...piece.cells].sort((a, b) => a - b);
      const selfSet = new Set(cells);
      const step = orient === 'H' ? 1 : width;
      const span = orient === 'H' ? width : height;
      for (const dir of [-1, 1]) {
        for (let s = 1; s < span; s++) {
          const delta = dir * s * step;
          const newCells = cells.map((x) => x + delta);
          let valid = true;
          for (let k = 0; k < newCells.length; k++) {
            const nc = newCells[k];
            if (nc < 0 || nc >= width * height) {
              valid = false;
              break;
            }
            if (orient === 'H') {
              if (rowOf(nc, width) !== rowOf(cells[k], width)) {
                valid = false;
                break;
              }
            } else if (colOf(nc, width) !== colOf(cells[k], width)) {
              valid = false;
              break;
            }
            // A seal can't slide onto open water (a hole), nor through another piece.
            if (holeSet.has(nc)) {
              valid = false;
              break;
            }
            if (occ[nc] && !selfSet.has(nc)) {
              valid = false;
              break;
            }
          }
          if (!valid) break; // can't reach further this direction
          moves.push({ pieceIndex, kind: 'SLIDER', to: newCells.slice().sort((a, b) => a - b) });
        }
      }
    }
  });

  return moves;
};
