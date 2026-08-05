import { boardSignature } from './board';
import { verifySolvedTranscript } from './replay';
import type { Board, Move } from './types';
import { validateBoardStructure } from './validation';

export type CreatorSolveProof = {
  readonly signature: string;
  readonly moves: readonly Move[];
};

export type CreatorProofResult =
  | {
      readonly ok: true;
      readonly board: Board;
      readonly proof: CreatorSolveProof;
      readonly moveCount: number;
    }
  | { readonly ok: false; readonly reason: string };

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

/** Verify that a creator legally solved the exact board being submitted. */
export const verifyCreatorSolveProof = (
  boardValue: unknown,
  proofValue: unknown
): CreatorProofResult => {
  const structure = validateBoardStructure(boardValue);
  if (!structure.ok) return structure;
  if (!isObject(proofValue)) {
    return { ok: false, reason: 'Test and solve this exact puzzle before submitting.' };
  }

  const signature = property(proofValue, 'signature');
  const moves = property(proofValue, 'moves');
  if (typeof signature !== 'string' || signature !== boardSignature(structure.board)) {
    return { ok: false, reason: 'The puzzle changed after its last successful test.' };
  }

  const replay = verifySolvedTranscript(structure.board, moves);
  if (!replay.ok) {
    return { ok: false, reason: 'Test and solve this exact puzzle before submitting.' };
  }
  return {
    ok: true,
    board: replay.board,
    proof: { signature, moves: replay.moves },
    moveCount: replay.moveCount,
  };
};
