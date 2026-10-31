// Board symmetry: every rule is the same in all four directions, so a board
// that is mirrored or rotated is the same puzzle with the same par. Pure TS.
import type { Board, Piece, PieceKind } from './types';

/** Identity, three flips/rotations, and four transposing ones. */
export const SYMMETRY_COUNT = 8;

const KIND_CODE: Readonly<Record<PieceKind, string>> = {
  HOPPER: 'H',
  SLIDER: 'S',
  BLOCKER: 'B',
};

/**
 * Where `cell` lands under symmetry `t` (0-7). Transforms 4-7 swap rows and
 * columns, so their result is laid out on a board `height` cells wide.
 */
const transformCell = (cell: number, width: number, height: number, t: number): number => {
  const r = Math.floor(cell / width);
  const c = cell % width;
  switch (t) {
    case 0:
      return r * width + c;
    case 1:
      return r * width + (width - 1 - c);
    case 2:
      return (height - 1 - r) * width + c;
    case 3:
      return (height - 1 - r) * width + (width - 1 - c);
    case 4:
      return c * height + r;
    case 5:
      return c * height + (height - 1 - r);
    case 6:
      return (width - 1 - c) * height + r;
    default:
      return (width - 1 - c) * height + (height - 1 - r);
  }
};

const isTransposing = (t: number): boolean => t >= 4;

const describe = (board: Board, t: number): string => {
  const width = isTransposing(t) ? board.height : board.width;
  const height = isTransposing(t) ? board.width : board.height;
  const map = (cell: number): number => transformCell(cell, board.width, board.height, t);
  const holes = board.holes
    .map(map)
    .sort((a, b) => a - b)
    .join(',');
  const pieces = board.pieces
    .map(
      (piece) =>
        `${KIND_CODE[piece.kind]}${piece.cells
          .map(map)
          .sort((a, b) => a - b)
          .join('.')}`
    )
    .sort()
    .join(';');
  return `${width}x${height}|${holes}|${pieces}`;
};

/**
 * One key per puzzle up to mirroring and rotation, ignoring piece order: two
 * boards share a fingerprint exactly when one is a flipped or turned copy of
 * the other. Used to stop the same puzzle being served twice.
 */
export const boardFingerprint = (board: Board): string => {
  let best = describe(board, 0);
  for (let t = 1; t < SYMMETRY_COUNT; t++) {
    const candidate = describe(board, t);
    if (candidate < best) best = candidate;
  }
  return best;
};

const fnv1a = (text: string, basis: number): number => {
  let hash = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * A short id for `boardFingerprint` (two 32-bit hashes), compact enough to
 * store per player. A rare collision only makes one unseen puzzle count as
 * seen, so it can never serve a repeat.
 */
export const boardFingerprintId = (board: Board): string => {
  const key = boardFingerprint(board);
  return `${fnv1a(key, 2166136261).toString(36)}.${fnv1a(key, 0x9747b28c).toString(36)}`;
};

/** The board under symmetry `t` (0-7), keeping piece order. */
export const transformBoard = (board: Board, t: number): Board => {
  const width = isTransposing(t) ? board.height : board.width;
  const height = isTransposing(t) ? board.width : board.height;
  const map = (cell: number): number => transformCell(cell, board.width, board.height, t);
  const pieces: Piece[] = board.pieces.map((piece) => {
    const cells = piece.cells.map(map).sort((a, b) => a - b);
    if (piece.kind !== 'SLIDER') return { kind: piece.kind, cells };
    const [first = 0, second = 0] = cells;
    const sameRow = Math.floor(first / width) === Math.floor(second / width);
    return { kind: piece.kind, cells, orient: second === first + 1 && sameRow ? 'H' : 'V' };
  });
  return {
    width,
    height,
    holes: board.holes.map(map).sort((a, b) => a - b),
    pieces,
  };
};
