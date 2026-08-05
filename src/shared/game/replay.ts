import { isSolved } from './board';
import { legalMoves } from './moves';
import { applyMove } from './rules';
import type { Board, Move, Piece, PieceKind } from './types';
import { validateBoardStructure } from './validation';

export const MAX_REPLAY_MOVES = 500;

export type ReplayFailure = {
  ok: false;
  reason: string;
  moveIndex?: number;
};

export type ReplayResult =
  | {
      ok: true;
      board: Board;
      pieces: readonly Piece[];
      moves: readonly Move[];
      moveCount: number;
      solved: boolean;
    }
  | ReplayFailure;

export type SolvedReplayResult =
  | {
      ok: true;
      board: Board;
      pieces: readonly Piece[];
      moves: readonly Move[];
      moveCount: number;
    }
  | ReplayFailure;

const property = (value: object, key: string): unknown => Reflect.get(value, key);

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const readKind = (value: unknown): PieceKind | null => {
  if (value === 'HOPPER' || value === 'SLIDER' || value === 'BLOCKER') return value;
  return null;
};

const sameCells = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((cell, index) => cell === right[index]);

const sameMove = (left: Move, right: Move): boolean =>
  left.pieceIndex === right.pieceIndex &&
  left.kind === right.kind &&
  sameCells(left.to, right.to);

const invalidMove = (moveIndex: number, reason: string): ReplayFailure => ({
  ok: false,
  reason,
  moveIndex,
});

/** Replays an untrusted move transcript using only moves emitted by legalMoves. */
export const replayMoves = (boardValue: unknown, transcriptValue: unknown): ReplayResult => {
  const structure = validateBoardStructure(boardValue);
  if (!structure.ok) return structure;

  if (!Array.isArray(transcriptValue)) {
    return { ok: false, reason: 'Move history is missing or malformed.' };
  }
  if (transcriptValue.length > MAX_REPLAY_MOVES) {
    return { ok: false, reason: `Move history cannot exceed ${MAX_REPLAY_MOVES} moves.` };
  }

  const board = structure.board;
  const cellCount = board.width * board.height;
  let pieces: readonly Piece[] = board.pieces;
  const moves: Move[] = [];

  for (let moveIndex = 0; moveIndex < transcriptValue.length; moveIndex++) {
    const rawMove: unknown = transcriptValue[moveIndex];
    if (!isObject(rawMove)) return invalidMove(moveIndex, 'Move data is malformed.');

    const pieceIndexValue = property(rawMove, 'pieceIndex');
    if (
      typeof pieceIndexValue !== 'number' ||
      !Number.isSafeInteger(pieceIndexValue) ||
      pieceIndexValue < 0 ||
      pieceIndexValue >= pieces.length
    ) {
      return invalidMove(moveIndex, 'Move references an unknown piece.');
    }

    const kind = readKind(property(rawMove, 'kind'));
    const piece = pieces[pieceIndexValue];
    if (!kind || !piece || kind !== piece.kind) {
      return invalidMove(moveIndex, 'Move has the wrong piece type.');
    }

    const toValue = property(rawMove, 'to');
    if (!Array.isArray(toValue) || toValue.length !== piece.cells.length) {
      return invalidMove(moveIndex, 'Move destination is malformed.');
    }

    const to: number[] = [];
    const destinationCells = new Set<number>();
    for (const rawCell of toValue) {
      const cell: unknown = rawCell;
      if (
        typeof cell !== 'number' ||
        !Number.isSafeInteger(cell) ||
        cell < 0 ||
        cell >= cellCount ||
        destinationCells.has(cell)
      ) {
        return invalidMove(moveIndex, 'Move destination is malformed.');
      }
      to.push(cell);
      destinationCells.add(cell);
    }
    to.sort((a, b) => a - b);

    const requestedMove: Move = { pieceIndex: pieceIndexValue, kind, to };
    const canonicalMove = legalMoves(board, pieces).find((move) => sameMove(move, requestedMove));
    if (!canonicalMove) return invalidMove(moveIndex, 'Move is not legal from the current board.');

    moves.push({
      pieceIndex: canonicalMove.pieceIndex,
      kind: canonicalMove.kind,
      to: [...canonicalMove.to],
    });
    pieces = applyMove(pieces, canonicalMove);
  }

  return {
    ok: true,
    board,
    pieces,
    moves,
    moveCount: transcriptValue.length,
    solved: isSolved(board, pieces),
  };
};

/** Verifies that every move is legal and that the resulting board is solved. */
export const verifySolvedTranscript = (
  boardValue: unknown,
  transcriptValue: unknown
): SolvedReplayResult => {
  const replay = replayMoves(boardValue, transcriptValue);
  if (!replay.ok) return replay;
  if (!replay.solved) return { ok: false, reason: 'Move history does not solve this puzzle.' };

  return {
    ok: true,
    board: replay.board,
    pieces: replay.pieces,
    moves: replay.moves,
    moveCount: replay.moveCount,
  };
};
