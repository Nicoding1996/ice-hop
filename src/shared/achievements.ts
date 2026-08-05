export type AchievementId =
  | 'ice-breaker'
  | 'deep-diver'
  | 'current-chaser'
  | 'century-splash'
  | 'polar-legend'
  | 'easy-explorer'
  | 'ice-navigator'
  | 'into-the-deep'
  | 'polar-expert'
  | 'cold-logic'
  | 'all-waters';

export type AchievementStats = {
  readonly solved: number;
  readonly byTier: {
    readonly easy: number;
    readonly medium: number;
    readonly hard: number;
  };
  readonly hardAtPar: boolean;
};

export type AchievementProgress = {
  readonly id: AchievementId;
  readonly title: string;
  readonly description: string;
  readonly current: number;
  readonly target: number;
  readonly unlocked: boolean;
};

export type AchievementBadge = Pick<AchievementProgress, 'id' | 'title' | 'description'>;

export type AchievementSnapshot = {
  readonly unlocked: number;
  readonly total: number;
  readonly progress: readonly AchievementProgress[];
  readonly newlyUnlocked: readonly AchievementBadge[];
};

type AchievementDefinition = {
  readonly id: AchievementId;
  readonly title: string;
  readonly description: string;
  readonly target: number;
  readonly current: (stats: AchievementStats) => number;
};

const overall = (target: number): ((stats: AchievementStats) => number) =>
  (stats) => Math.min(stats.solved, target);

const DEFINITIONS: readonly AchievementDefinition[] = [
  { id: 'ice-breaker', title: 'Ice Breaker', description: 'Solve 10 Endless puzzles.', target: 10, current: overall(10) },
  { id: 'deep-diver', title: 'Deep Diver', description: 'Solve 25 Endless puzzles.', target: 25, current: overall(25) },
  { id: 'current-chaser', title: 'Current Chaser', description: 'Solve 50 Endless puzzles.', target: 50, current: overall(50) },
  { id: 'century-splash', title: 'Century Splash', description: 'Solve 100 Endless puzzles.', target: 100, current: overall(100) },
  { id: 'polar-legend', title: 'Polar Legend', description: 'Solve 250 Endless puzzles.', target: 250, current: overall(250) },
  { id: 'easy-explorer', title: 'Easy Explorer', description: 'Solve 10 Easy puzzles.', target: 10, current: (stats) => Math.min(stats.byTier.easy, 10) },
  { id: 'ice-navigator', title: 'Ice Navigator', description: 'Solve 10 Medium puzzles.', target: 10, current: (stats) => Math.min(stats.byTier.medium, 10) },
  { id: 'into-the-deep', title: 'Into the Deep', description: 'Solve your first Hard puzzle.', target: 1, current: (stats) => Math.min(stats.byTier.hard, 1) },
  { id: 'polar-expert', title: 'Polar Expert', description: 'Solve 10 Hard puzzles.', target: 10, current: (stats) => Math.min(stats.byTier.hard, 10) },
  { id: 'cold-logic', title: 'Cold Logic', description: 'Solve a Hard puzzle exactly at par.', target: 1, current: (stats) => stats.hardAtPar ? 1 : 0 },
  {
    id: 'all-waters',
    title: 'All Waters',
    description: 'Solve 10 puzzles in every tier.',
    target: 10,
    current: (stats) => Math.min(stats.byTier.easy, stats.byTier.medium, stats.byTier.hard, 10),
  },
];

export const qualifiedAchievementIds = (stats: AchievementStats): AchievementId[] =>
  DEFINITIONS.filter((definition) => definition.current(stats) >= definition.target).map(
    (definition) => definition.id
  );

export const buildAchievementSnapshot = (
  stats: AchievementStats,
  persistedUnlocked: readonly AchievementId[] = [],
  newlyUnlockedIds: readonly AchievementId[] = []
): AchievementSnapshot => {
  const unlockedIds = new Set<AchievementId>([
    ...persistedUnlocked,
    ...qualifiedAchievementIds(stats),
  ]);
  const newlyUnlocked = new Set<AchievementId>(newlyUnlockedIds);
  const progress = DEFINITIONS.map((definition): AchievementProgress => ({
    id: definition.id,
    title: definition.title,
    description: definition.description,
    current: definition.current(stats),
    target: definition.target,
    unlocked: unlockedIds.has(definition.id),
  }));
  return {
    unlocked: progress.filter((achievement) => achievement.unlocked).length,
    total: progress.length,
    progress,
    newlyUnlocked: progress
      .filter((achievement) => newlyUnlocked.has(achievement.id))
      .map(({ id, title, description }) => ({ id, title, description })),
  };
};

export const isAchievementId = (value: string): value is AchievementId =>
  DEFINITIONS.some((definition) => definition.id === value);
