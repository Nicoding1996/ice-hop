import { describe, expect, it } from 'vitest';
import {
  buildAchievementSnapshot,
  qualifiedAchievementIds,
  type AchievementStats,
} from '../achievements';

const stats = (
  solved: number,
  easy: number,
  medium: number,
  hard: number,
  hardAtPar = false
): AchievementStats => ({
  solved,
  byTier: { easy, medium, hard },
  hardAtPar,
});

describe('Endless achievements', () => {
  it('unlocks the quantity milestones at their exact totals', () => {
    expect(qualifiedAchievementIds(stats(9, 9, 0, 0))).not.toContain('ice-breaker');
    expect(qualifiedAchievementIds(stats(10, 10, 0, 0))).toContain('ice-breaker');
    expect(qualifiedAchievementIds(stats(25, 10, 10, 5))).toEqual(
      expect.arrayContaining(['ice-breaker', 'deep-diver'])
    );
    expect(qualifiedAchievementIds(stats(50, 20, 20, 10))).toContain('current-chaser');
    expect(qualifiedAchievementIds(stats(100, 40, 40, 20))).toContain('century-splash');
    expect(qualifiedAchievementIds(stats(250, 100, 100, 50))).toContain('polar-legend');
  });

  it('treats every counted solve equally and leaves hinted solves out through unchanged counts', () => {
    const beforeHint = buildAchievementSnapshot(stats(9, 9, 0, 0));
    const afterHint = buildAchievementSnapshot(stats(9, 9, 0, 0));
    const afterCountedSolve = buildAchievementSnapshot(stats(10, 10, 0, 0));

    expect(afterHint.progress).toEqual(beforeHint.progress);
    expect(afterHint.progress.find((award) => award.id === 'ice-breaker')?.unlocked).toBe(false);
    expect(afterCountedSolve.progress.find((award) => award.id === 'ice-breaker')?.unlocked).toBe(true);
  });

  it('unlocks tier awards, Hard-at-par, and the all-tier award independently', () => {
    const ids = qualifiedAchievementIds(stats(30, 10, 10, 10, true));

    expect(ids).toEqual(
      expect.arrayContaining([
        'easy-explorer',
        'ice-navigator',
        'into-the-deep',
        'polar-expert',
        'cold-logic',
        'all-waters',
      ])
    );
  });

  it('requires a Hard solve for Into the Deep and ten in every tier for All Waters', () => {
    expect(qualifiedAchievementIds(stats(20, 10, 10, 0))).not.toContain('into-the-deep');
    expect(qualifiedAchievementIds(stats(29, 10, 10, 9))).not.toContain('all-waters');
    expect(qualifiedAchievementIds(stats(30, 10, 10, 10))).toContain('all-waters');
  });

  it('reports only newly persisted awards as newly unlocked', () => {
    const snapshot = buildAchievementSnapshot(
      stats(25, 10, 10, 5),
      ['ice-breaker', 'easy-explorer'],
      ['deep-diver', 'ice-navigator']
    );

    expect(snapshot.newlyUnlocked.map((award) => award.id)).toEqual([
      'deep-diver',
      'ice-navigator',
    ]);
    expect(snapshot.unlocked).toBeGreaterThanOrEqual(4);
    expect(snapshot.total).toBe(11);
  });
});
