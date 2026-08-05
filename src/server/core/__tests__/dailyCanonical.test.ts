import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();

  const hashFor = (key: string): Map<string, string> => {
    const existing = hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };

  const redis = {
    get: vi.fn(async (key: string) => strings.get(key)),
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field)),
    hSetNX: vi.fn(async (key: string, field: string, value: string) => {
      const hash = hashFor(key);
      if (hash.has(field)) return 0;
      hash.set(field, value);
      return 1;
    }),
  };

  return {
    redis,
    strings,
    clear: () => {
      strings.clear();
      hashes.clear();
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: redisState.redis }));

import { getCanonicalDailyRef } from '../daily';
import { keys } from '../keys';

beforeEach(() => {
  redisState.clear();
  vi.clearAllMocks();
});

describe('canonical published Daily identity', () => {
  it('keeps an already materialized legacy board canonical through a schema rollout', async () => {
    const date = '2026-08-05';
    redisState.strings.set(
      keys.dailyPuzzle({ schema: 5, date }),
      JSON.stringify({ date, board: {}, par: 5 })
    );

    const first = await getCanonicalDailyRef(date);
    redisState.strings.delete(keys.dailyPuzzle({ schema: 5, date }));
    const repeated = await getCanonicalDailyRef(date);

    expect(first).toEqual({ schema: 5, date });
    expect(repeated).toEqual(first);
  });

  it('uses the current schema when no historical board exists', async () => {
    await expect(getCanonicalDailyRef('2026-08-06')).resolves.toEqual({
      schema: 6,
      date: '2026-08-06',
    });
  });
});
