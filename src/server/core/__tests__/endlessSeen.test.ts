import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  type Row = { readonly member: string; readonly score: number };
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Map<string, number>>();
  const hashFor = (key: string): Map<string, string> => {
    const existing = hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };
  const setFor = (key: string): Map<string, number> => {
    const existing = sets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    sets.set(key, created);
    return created;
  };
  const ascending = (key: string): Row[] =>
    [...(sets.get(key)?.entries() ?? [])]
      .map(([member, score]) => ({ member, score }))
      .sort((left, right) => left.score - right.score || left.member.localeCompare(right.member));
  const rankWindow = (length: number, start: number, stop: number): [number, number] => [
    start < 0 ? Math.max(0, length + start) : start,
    stop < 0 ? length + stop : Math.min(stop, length - 1),
  ];
  const redis = {
    get: vi.fn(async () => undefined),
    expire: vi.fn(async () => undefined),
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hKeys: vi.fn(async (key: string) => [...(hashes.get(key)?.keys() ?? [])]),
    hLen: vi.fn(async (key: string) => hashes.get(key)?.size ?? 0),
    hSetNX: vi.fn(async (key: string, field: string, value: string) => {
      const hash = hashFor(key);
      if (hash.has(field)) return 0;
      hash.set(field, value);
      return 1;
    }),
    hDel: vi.fn(async (key: string, fields: readonly string[]) => {
      let removed = 0;
      for (const field of fields) if (hashes.get(key)?.delete(field)) removed += 1;
      return removed;
    }),
    zAdd: vi.fn(async (key: string, row: Row) => {
      const set = setFor(key);
      const added = set.has(row.member) ? 0 : 1;
      set.set(row.member, row.score);
      return added;
    }),
    zScore: vi.fn(async (key: string, member: string) => sets.get(key)?.get(member)),
    zRange: vi.fn(async (key: string, start: number, stop: number) => {
      const rows = ascending(key);
      const [first, last] = rankWindow(rows.length, start, stop);
      return first > last ? [] : rows.slice(first, last + 1);
    }),
    zRemRangeByRank: vi.fn(async (key: string, start: number, stop: number) => {
      const rows = ascending(key);
      const [first, last] = rankWindow(rows.length, start, stop);
      if (first > last) return 0;
      const doomed = rows.slice(first, last + 1);
      for (const row of doomed) sets.get(key)?.delete(row.member);
      return doomed.length;
    }),
  };
  return {
    redis,
    hashes,
    sets,
    clear: () => {
      hashes.clear();
      sets.clear();
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: redisState.redis }));

import type { EndlessTier } from '../../../shared/api';
import { validateBoardStructure } from '../../../shared/game/validation';
import { markEndlessSeen, popPooledPuzzle, refillEndlessPools, takeEndlessPuzzle } from '../endless';
import {
  ENDLESS_FALLBACKS,
  endlessPuzzleId,
  isEndlessParInBand,
  type EndlessPuzzle,
} from '../endlessPolicy';
import { keys } from '../keys';

const pick = (tier: EndlessTier, index: number): EndlessPuzzle => {
  const puzzle = ENDLESS_FALLBACKS[tier][index];
  if (!puzzle) throw new Error(`Missing ${tier} fallback ${index}`);
  return puzzle;
};

const pool = async (tier: EndlessTier, puzzles: readonly EndlessPuzzle[]): Promise<void> => {
  for (const puzzle of puzzles) {
    await redisState.redis.hSetNX(keys.endlessPool(tier), endlessPuzzleId(puzzle), JSON.stringify(puzzle));
  }
};

const poolIds = (tier: EndlessTier): string[] => [
  ...(redisState.hashes.get(keys.endlessPool(tier))?.keys() ?? []),
];

beforeEach(() => {
  redisState.clear();
  vi.clearAllMocks();
});

describe('Endless repeats', () => {
  it('gives a signed-in player only pooled puzzles they have not seen', async () => {
    const seen = pick('easy', 0);
    const fresh = pick('easy', 1);
    await pool('easy', [seen, fresh]);
    await redisState.redis.zAdd(keys.endlessSeen('alice', 'easy'), {
      member: endlessPuzzleId(seen),
      score: 1,
    });

    const served = await takeEndlessPuzzle('alice', 'easy');
    expect(endlessPuzzleId(served)).toBe(endlessPuzzleId(fresh));
    // The seen board stays in the pool for other players.
    expect(poolIds('easy')).toEqual([endlessPuzzleId(seen)]);
  });

  it('makes a new unseen puzzle when every pooled one has been seen', async () => {
    const seen = pick('easy', 0);
    await pool('easy', [seen]);
    await redisState.redis.zAdd(keys.endlessSeen('alice', 'easy'), {
      member: endlessPuzzleId(seen),
      score: 1,
    });

    const served = await takeEndlessPuzzle('alice', 'easy');
    expect(endlessPuzzleId(served)).not.toBe(endlessPuzzleId(seen));
    expect(isEndlessParInBand('easy', served.par)).toBe(true);
    expect(poolIds('easy')).toEqual([endlessPuzzleId(seen)]);
  });

  it('serves guests from the pool and remembers nothing for them', async () => {
    const puzzle = pick('easy', 0);
    await pool('easy', [puzzle]);
    const served = await takeEndlessPuzzle('anon', 'easy');
    expect(endlessPuzzleId(served)).toBe(endlessPuzzleId(puzzle));
    await markEndlessSeen('anon', 'easy', served);
    expect(redisState.redis.zAdd).not.toHaveBeenCalled();
  });

  it('remembers the newest 500 puzzles per player and tier', async () => {
    const key = keys.endlessSeen('alice', 'easy');
    for (let index = 1; index <= 505; index++) {
      await redisState.redis.zAdd(key, { member: `old${index}`, score: index });
    }
    const puzzle = pick('easy', 2);
    await markEndlessSeen('alice', 'easy', puzzle);
    const remembered = redisState.sets.get(key);
    expect(remembered?.size).toBe(500);
    expect(remembered?.has(endlessPuzzleId(puzzle))).toBe(true);
    expect(remembered?.has('old6')).toBe(false);
    expect(remembered?.has('old7')).toBe(true);
  });

  it('gives a pooled puzzle to only one of two players asking at once', async () => {
    const puzzle = pick('medium', 0);
    await pool('medium', [puzzle]);
    const results = await Promise.all([popPooledPuzzle('medium'), popPooledPuzzle('medium')]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(poolIds('medium')).toEqual([]);
  });

  it('drops pooled boards from the wrong difficulty instead of serving them', async () => {
    await redisState.redis.hSetNX(keys.endlessPool('hard'), 'legacy1', JSON.stringify(pick('easy', 0)));
    await expect(popPooledPuzzle('hard')).resolves.toBeNull();
    expect(poolIds('hard')).toEqual([]);
  });

  it('files refilled puzzles under their own id, so a puzzle is pooled once', async () => {
    const added = await refillEndlessPools(25_000);
    expect(added).toBeGreaterThan(0);
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      const entries = redisState.hashes.get(keys.endlessPool(tier)) ?? new Map<string, string>();
      expect(entries.size).toBeGreaterThan(0);
      for (const [id, raw] of entries) {
        const value: unknown = JSON.parse(raw);
        const fields = typeof value === 'object' && value !== null ? value : {};
        const par = Reflect.get(fields, 'par');
        const structure = validateBoardStructure(Reflect.get(fields, 'board'));
        expect(structure.ok && typeof par === 'number').toBe(true);
        if (!structure.ok || typeof par !== 'number') continue;
        expect(isEndlessParInBand(tier, par)).toBe(true);
        expect(endlessPuzzleId({ board: structure.board, par })).toBe(id);
      }
    }
    // A second run adds nothing a full pool already holds, and never a copy.
    const sizes = (['easy', 'medium', 'hard'] as const).map((tier) => poolIds(tier).length);
    await refillEndlessPools(25_000);
    for (const [index, tier] of (['easy', 'medium', 'hard'] as const).entries()) {
      const ids = poolIds(tier);
      expect(ids.length).toBeGreaterThanOrEqual(sizes[index] ?? 0);
      expect(ids.length).toBeLessThanOrEqual(12);
      expect(new Set(ids).size).toBe(ids.length);
    }
  }, 120_000);
});
