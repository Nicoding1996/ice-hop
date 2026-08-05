import { redis } from '@devvit/web/server';
import {
  buildAchievementSnapshot,
  isAchievementId,
  qualifiedAchievementIds,
  type AchievementId,
  type AchievementSnapshot,
} from '../../shared/achievements';
import type { EndlessSolvedResponse } from '../../shared/api';
import { keys } from './keys';
import { getEndlessHardAtPar } from './endless';

type EndlessCounts = Pick<EndlessSolvedResponse, 'solved' | 'byTier'>;

/** Persist newly qualified awards with first-unlock timestamps and return progress. */
export const syncAchievements = async (
  user: string,
  counts: EndlessCounts
): Promise<AchievementSnapshot> => {
  const hardAtPar = await getEndlessHardAtPar(user);
  const stats = { ...counts, hardAtPar };
  const rawIds = await redis.hKeys(keys.achievements(user));
  const persisted = rawIds.filter(isAchievementId);
  const persistedSet = new Set<AchievementId>(persisted);
  const newlyUnlocked: AchievementId[] = [];

  for (const id of qualifiedAchievementIds(stats)) {
    if (persistedSet.has(id)) continue;
    const added = await redis.hSetNX(keys.achievements(user), id, String(Date.now()));
    if (added) {
      persistedSet.add(id);
      newlyUnlocked.push(id);
    }
  }

  return buildAchievementSnapshot(stats, [...persistedSet], newlyUnlocked);
};
