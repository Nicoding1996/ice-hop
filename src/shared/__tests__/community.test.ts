import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import type { UgcSubmission } from '../api';
import { boardSignature } from '../game/board';
import { orderCommunityStream } from '../community';

const board: Board = {
  width: 5,
  height: 5,
  holes: [2],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
  ],
};

const mk = (id: string, creator: string, votes: number, createdAt: number): UgcSubmission => ({
  id,
  creator,
  board,
  par: 1,
  votes,
  createdAt,
});

describe('orderCommunityStream', () => {
  it('excludes the player\'s solved puzzles and their own puzzles', () => {
    const subs = [mk('1', 'alice', 5, 100), mk('2', 'bob', 3, 200), mk('3', 'carol', 1, 300)];
    const out = orderCommunityStream(subs, {
      playedIds: new Set(['1']),
      excludeCreator: 'bob',
      limit: 10,
    });
    expect(out.map((s) => s.id)).toEqual(['3']);
  });

  it('interleaves the top-voted and the newest puzzles', () => {
    const subs = [
      mk('1', 'a', 10, 100), // most voted, oldest
      mk('2', 'b', 8, 110),
      mk('3', 'c', 1, 500), // newest, few votes
      mk('4', 'd', 0, 400),
    ];
    const out = orderCommunityStream(subs, { limit: 10 });
    // First pick is the top-voted, second is the newest.
    expect(out[0].id).toBe('1');
    expect(out[1].id).toBe('3');
    expect(out).toHaveLength(4);
  });

  it('respects the limit', () => {
    const subs = [
      mk('1', 'a', 10, 100),
      mk('2', 'b', 8, 110),
      mk('3', 'c', 1, 500),
      mk('4', 'd', 0, 400),
    ];
    expect(orderCommunityStream(subs, { limit: 2 })).toHaveLength(2);
  });
});

describe('boardSignature', () => {
  it('is identical for the same board regardless of piece/hole order', () => {
    const a: Board = {
      width: 5,
      height: 5,
      holes: [2, 4],
      pieces: [
        { kind: 'HOPPER', cells: [0] },
        { kind: 'BLOCKER', cells: [1] },
      ],
    };
    const b: Board = {
      width: 5,
      height: 5,
      holes: [4, 2],
      pieces: [
        { kind: 'BLOCKER', cells: [1] },
        { kind: 'HOPPER', cells: [0] },
      ],
    };
    expect(boardSignature(a)).toBe(boardSignature(b));
  });

  it('differs when the puzzle content differs', () => {
    const a: Board = { width: 5, height: 5, holes: [2], pieces: [{ kind: 'HOPPER', cells: [0] }] };
    const b: Board = { width: 5, height: 5, holes: [3], pieces: [{ kind: 'HOPPER', cells: [0] }] };
    expect(boardSignature(a)).not.toBe(boardSignature(b));
  });
});
