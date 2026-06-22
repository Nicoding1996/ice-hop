import { describe, expect, it } from 'vitest';
import type { Board } from '../game/types';
import type { UgcSubmission } from '../api';
import { boardSignature } from '../game/board';
import { creatorTotals, orderCommunityStream } from '../community';

const board: Board = {
  width: 5,
  height: 5,
  holes: [2],
  pieces: [
    { kind: 'HOPPER', cells: [0] },
    { kind: 'BLOCKER', cells: [1] },
  ],
};

const mk = (
  id: string,
  creator: string,
  votes: number,
  createdAt: number,
  solves = 0
): UgcSubmission => ({
  id,
  creator,
  board,
  par: 1,
  votes,
  solves,
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

  it('surfaces a buried pool puzzle earlier via the discovery lane', () => {
    const buried = mk('9', 'z', 0, 50); // low votes + oldest => tail of both lanes
    const subs = [
      mk('1', 'a', 10, 100),
      mk('2', 'b', 9, 110),
      mk('3', 'c', 8, 120),
      mk('4', 'd', 7, 130),
      buried,
    ];
    // Without discovery the buried puzzle lands last.
    const withoutDiscovery = orderCommunityStream(subs, { limit: 10 });
    expect(withoutDiscovery[withoutDiscovery.length - 1].id).toBe('9');
    // Discovery is always a subset of the pool in production; surfacing it pulls
    // the buried puzzle up to the third slot (votes, new, discovery).
    const withDiscovery = orderCommunityStream(subs, { discovery: [buried], limit: 10 });
    expect(withDiscovery[2].id).toBe('9');
  });

  it('does not duplicate a discovery item already shown via votes/new', () => {
    const subs = [mk('1', 'a', 10, 100), mk('2', 'b', 8, 110)];
    const out = orderCommunityStream(subs, { discovery: [mk('1', 'a', 10, 100)], limit: 10 });
    expect(out.filter((s) => s.id === '1')).toHaveLength(1);
  });

  it('applies played + own-puzzle filtering to the discovery lane too', () => {
    const out = orderCommunityStream([], {
      discovery: [mk('1', 'me', 0, 1), mk('2', 'x', 0, 2)],
      playedIds: new Set(['2']),
      excludeCreator: 'me',
      limit: 10,
    });
    expect(out).toEqual([]);
  });
});

describe('creatorTotals', () => {
  it('sums puzzle count, solves, and votes across a creator\'s submissions', () => {
    const subs = [
      mk('1', 'alice', 5, 100, 12),
      mk('2', 'alice', 3, 200, 4),
      mk('3', 'alice', 0, 300, 0),
    ];
    expect(creatorTotals(subs)).toEqual({ puzzles: 3, solves: 16, votes: 8 });
  });

  it('is all-zero for a creator with no puzzles', () => {
    expect(creatorTotals([])).toEqual({ puzzles: 0, solves: 0, votes: 0 });
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
