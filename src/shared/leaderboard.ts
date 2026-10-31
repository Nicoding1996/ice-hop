// Pure leaderboard helpers shared by the server, the comment-board renderer,
// and the in-game overlay: move distributions, ranks, durations, and strict
// parsers for the leaderboard responses the client receives.
import type {
  HubResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  MovesBucket,
  RankedBoardEntry,
  RankedBoardKind,
  RankedBoardResponse,
} from './api';
import { isDailyDate, parseDailyPuzzleId } from './daily';
import { leaderboardScore } from './scoring';

/** Buckets in a distribution: par, par+1, par+2, par+3, and par+4 or more. */
export const DISTRIBUTION_BUCKETS = 5;

/** Most leaders any board returns. */
export const BOARD_TOP_N = 10;

/** Rows in the window centred on a ranked viewer. */
export const NEARBY_WINDOW = 5;

const MAX_COUNT = 10_000_000;
const MAX_MOVES = 10_000;
const MAX_USERNAME_LENGTH = 64;

/**
 * Daily leaderboard scores where each bucket after the first begins. Counting
 * the players below every boundary yields the whole distribution.
 */
export const distributionBoundaries = (par: number): number[] =>
  Array.from({ length: DISTRIBUTION_BUCKETS - 1 }, (_, index) =>
    leaderboardScore(par + index + 1, 0)
  );

const bucketAt = (par: number, index: number, players: number): MovesBucket => ({
  moves: par + index,
  orMore: index === DISTRIBUTION_BUCKETS - 1,
  players,
});

/**
 * Per-bucket counts from "players scoring below boundary k" counts. Separate
 * reads can disagree slightly while solves land, so the counts are clamped into
 * a non-decreasing sequence within [0, total]; the buckets always sum to total.
 */
export const bucketsFromBelowCounts = (
  par: number,
  belowCounts: readonly number[],
  total: number
): MovesBucket[] => {
  const safeTotal = Math.max(0, Math.floor(total));
  const buckets: MovesBucket[] = [];
  let previous = 0;
  for (let index = 0; index < DISTRIBUTION_BUCKETS; index++) {
    const raw =
      index < DISTRIBUTION_BUCKETS - 1 ? (belowCounts[index] ?? safeTotal) : safeTotal;
    const below = Math.min(safeTotal, Math.max(previous, Math.floor(raw)));
    buckets.push(bucketAt(par, index, below - previous));
    previous = below;
  }
  return buckets;
};

/** Exact distribution from a complete list of best move counts. */
export const bucketsFromMoves = (par: number, moves: readonly number[]): MovesBucket[] => {
  const counts = new Array<number>(DISTRIBUTION_BUCKETS).fill(0);
  for (const value of moves) {
    const index = Math.min(DISTRIBUTION_BUCKETS - 1, Math.max(0, value - par));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((players, index) => bucketAt(par, index, players));
};

const COMMUNITY_SCORE_BASE = 10_000_000_000;

/**
 * One ascending sorted-set score for a Community board: fewest moves first,
 * then the earliest verified solve at that count. Whole seconds keep the score
 * an exact integer for any realistic move count.
 */
export const communityBoardScore = (moves: number, solvedAtMs: number): number =>
  moves * COMMUNITY_SCORE_BASE +
  Math.max(0, Math.min(COMMUNITY_SCORE_BASE - 1, Math.floor(solvedAtMs / 1000)));

/** Move count encoded in a Community board score. */
export const communityBoardMoves = (score: number): number =>
  Math.floor(score / COMMUNITY_SCORE_BASE);

/** Competition ranks (1, 2, 2, 4) for values already sorted best-first. */
export const competitionRanks = (values: readonly number[]): number[] => {
  const ranks: number[] = [];
  values.forEach((value, index) => {
    const prior = ranks[index - 1];
    ranks.push(
      index > 0 && prior !== undefined && values[index - 1] === value ? prior : index + 1
    );
  });
  return ranks;
};

/** "0:42", "12:05", or "1:02:03" for a verified elapsed time. */
export const formatDuration = (ms: number): string => {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
};

// --- Response parsers (client-side trust boundary) ---------------------------

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;
const isCount = (value: unknown, max = MAX_COUNT): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const isUsername = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_USERNAME_LENGTH;

const parseEntry = (value: unknown, totalPlayers: number): LeaderboardEntry | null => {
  if (!isObject(value)) return null;
  const rank = property(value, 'rank');
  const username = property(value, 'username');
  const moves = property(value, 'moves');
  const timeMs = property(value, 'timeMs');
  const streak = property(value, 'streak');
  if (
    !isCount(rank, totalPlayers) ||
    rank < 1 ||
    !isUsername(username) ||
    !isCount(moves, MAX_MOVES) ||
    moves < 1 ||
    !isCount(timeMs, Number.MAX_SAFE_INTEGER) ||
    !isCount(streak)
  ) {
    return null;
  }
  return { rank, username, moves, timeMs, streak };
};

const parseEntries = (
  value: unknown,
  totalPlayers: number,
  maxEntries: number
): LeaderboardEntry[] | null => {
  if (!Array.isArray(value) || value.length > maxEntries || value.length > totalPlayers) {
    return null;
  }
  const entries: LeaderboardEntry[] = [];
  for (const candidate of value) {
    const entry = parseEntry(candidate, totalPlayers);
    const previous = entries.at(-1);
    if (!entry || (previous && entry.rank !== previous.rank + 1)) return null;
    entries.push(entry);
  }
  return entries;
};

const scoreOrdered = (entries: readonly LeaderboardEntry[]): boolean =>
  entries.every((entry, index) => {
    const previous = entries[index - 1];
    return (
      !previous ||
      previous.moves < entry.moves ||
      (previous.moves === entry.moves && previous.timeMs <= entry.timeMs)
    );
  });

const sameEntry = (left: LeaderboardEntry, right: LeaderboardEntry): boolean =>
  left.rank === right.rank &&
  left.username === right.username &&
  left.moves === right.moves &&
  left.timeMs === right.timeMs;

/** The top slice and the viewer window must describe one consistent ordering. */
const slicesAgree = (
  entries: readonly LeaderboardEntry[],
  nearbyEntries: readonly LeaderboardEntry[],
  viewerRank: number,
  viewer: string | undefined
): boolean => {
  const byRank = new Map<number, LeaderboardEntry>();
  const byUsername = new Map<string, number>();
  for (const entry of [...entries, ...nearbyEntries]) {
    const rankedEntry = byRank.get(entry.rank);
    const usernameRank = byUsername.get(entry.username);
    if (
      (rankedEntry && !sameEntry(rankedEntry, entry)) ||
      (usernameRank !== undefined && usernameRank !== entry.rank)
    ) {
      return false;
    }
    byRank.set(entry.rank, entry);
    byUsername.set(entry.username, entry.rank);
  }
  const known = [...byRank.values()].sort((left, right) => left.rank - right.rank);
  if (!scoreOrdered(known)) return false;
  if (!viewer) return viewerRank === 0;
  const viewerEntryRank = byUsername.get(viewer);
  return viewerRank === 0
    ? viewerEntryRank === undefined
    : viewerEntryRank === viewerRank && byRank.get(viewerRank)?.username === viewer;
};

const parseDistribution = (value: unknown, par: number): MovesBucket[] | null => {
  if (!Array.isArray(value) || value.length !== DISTRIBUTION_BUCKETS) return null;
  const buckets: MovesBucket[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!isObject(candidate)) return null;
    const moves = property(candidate, 'moves');
    const orMore = property(candidate, 'orMore');
    const players = property(candidate, 'players');
    if (
      moves !== par + index ||
      orMore !== (index === DISTRIBUTION_BUCKETS - 1) ||
      !isCount(players)
    ) {
      return null;
    }
    buckets.push({ moves: par + index, orMore: index === DISTRIBUTION_BUCKETS - 1, players });
  }
  return buckets;
};

export type DailyLeaderboardExpectation = {
  /** Required puzzle id; omit to accept any valid Daily puzzle id. */
  readonly puzzleId?: string;
  /** The signed-in viewer's username; omit for guests. */
  readonly viewer?: string;
};

/** Strictly validate a `/api/leaderboard` response before anything renders it. */
export const parseDailyLeaderboard = (
  value: unknown,
  expected: DailyLeaderboardExpectation
): LeaderboardResponse | null => {
  if (!isObject(value)) return null;
  const puzzleId = property(value, 'puzzleId');
  const ref = parseDailyPuzzleId(puzzleId);
  if (
    !ref ||
    typeof puzzleId !== 'string' ||
    (expected.puzzleId !== undefined && puzzleId !== expected.puzzleId)
  ) {
    return null;
  }
  const date = property(value, 'date');
  const par = property(value, 'par');
  const totalPlayers = property(value, 'totalPlayers');
  const viewerRank = property(value, 'viewerRank');
  const viewerHidden = property(value, 'viewerHidden');
  if (
    date !== ref.date ||
    !isCount(par, MAX_MOVES) ||
    par < 1 ||
    !isCount(totalPlayers) ||
    !isCount(viewerRank, totalPlayers) ||
    typeof viewerHidden !== 'boolean'
  ) {
    return null;
  }

  const entries = parseEntries(property(value, 'entries'), totalPlayers, BOARD_TOP_N);
  const nearbyEntries = parseEntries(
    property(value, 'nearbyEntries'),
    totalPlayers,
    NEARBY_WINDOW
  );
  const distribution = parseDistribution(property(value, 'distribution'), par);
  if (
    !entries ||
    !nearbyEntries ||
    !distribution ||
    !scoreOrdered(entries) ||
    !scoreOrdered(nearbyEntries) ||
    !slicesAgree(entries, nearbyEntries, viewerRank, expected.viewer) ||
    entries.length !== Math.min(BOARD_TOP_N, totalPlayers) ||
    entries.some((entry, index) => entry.rank !== index + 1) ||
    (viewerRank === 0
      ? nearbyEntries.length !== 0
      : nearbyEntries.length !== Math.min(NEARBY_WINDOW, totalPlayers) ||
        !nearbyEntries.some((entry) => entry.rank === viewerRank)) ||
    entries.some((entry) => entry.moves < par)
  ) {
    return null;
  }

  return {
    puzzleId,
    date: ref.date,
    par,
    totalPlayers,
    viewerRank,
    entries,
    nearbyEntries,
    distribution,
    viewerHidden,
  };
};

/** Strictly validate a `/api/hub` response. */
export const parseHubResponse = (value: unknown): HubResponse | null => {
  if (!isObject(value)) return null;
  const date = property(value, 'date');
  const par = property(value, 'par');
  const solvedValue = property(value, 'solved');
  const rank = property(value, 'rank');
  const totalPlayers = property(value, 'totalPlayers');
  const streak = property(value, 'streak');
  const endlessSolved = property(value, 'endlessSolved');
  if (
    !isDailyDate(date) ||
    (par !== null && (!isCount(par, MAX_MOVES) || par < 1)) ||
    !isCount(totalPlayers) ||
    !isCount(rank, totalPlayers) ||
    !isCount(streak) ||
    !isCount(endlessSolved)
  ) {
    return null;
  }
  let solved: HubResponse['solved'] = null;
  if (solvedValue !== null) {
    if (!isObject(solvedValue)) return null;
    const moves = property(solvedValue, 'moves');
    const stars = property(solvedValue, 'stars');
    if (!isCount(moves, MAX_MOVES) || moves < 1 || !isCount(stars, 3) || stars < 1) return null;
    solved = { moves, stars };
  }
  return { date, par, solved, rank, totalPlayers, streak, endlessSolved };
};

const RANKED_KINDS: readonly RankedBoardKind[] = ['week', 'streak', 'alltime'];

export const isRankedBoardKind = (value: unknown): value is RankedBoardKind =>
  RANKED_KINDS.some((kind) => kind === value);

/** Strictly validate a `/api/leaderboard/board` response for one board kind. */
export const parseRankedBoard = (
  value: unknown,
  kind: RankedBoardKind
): RankedBoardResponse | null => {
  if (!isObject(value) || property(value, 'kind') !== kind) return null;
  const periodStart = property(value, 'periodStart');
  const periodEnd = property(value, 'periodEnd');
  const totalPlayers = property(value, 'totalPlayers');
  const viewerHidden = property(value, 'viewerHidden');
  const rawEntries = property(value, 'entries');
  const rawViewer = property(value, 'viewer');
  if (
    typeof viewerHidden !== 'boolean' ||
    !Array.isArray(rawEntries) ||
    rawEntries.length > BOARD_TOP_N ||
    (kind === 'week'
      ? !isDailyDate(periodStart) || !isDailyDate(periodEnd) || periodEnd < periodStart
      : periodStart !== undefined || periodEnd !== undefined) ||
    (totalPlayers !== undefined && !isCount(totalPlayers))
  ) {
    return null;
  }

  const entries: RankedBoardEntry[] = [];
  for (const candidate of rawEntries) {
    if (!isObject(candidate)) return null;
    const rank = property(candidate, 'rank');
    const username = property(candidate, 'username');
    const entryValue = property(candidate, 'value');
    const previous = entries.at(-1);
    if (
      !isCount(rank) ||
      rank < 1 ||
      !isUsername(username) ||
      !isCount(entryValue) ||
      (previous && (rank < previous.rank || entryValue > previous.value))
    ) {
      return null;
    }
    entries.push({ rank, username, value: entryValue });
  }
  if (typeof totalPlayers === 'number' && entries.length > totalPlayers) return null;

  let viewer: RankedBoardResponse['viewer'] = null;
  if (rawViewer !== null) {
    if (!isObject(rawViewer)) return null;
    const rank = property(rawViewer, 'rank');
    const viewerValue = property(rawViewer, 'value');
    if (!isCount(rank) || !isCount(viewerValue)) return null;
    viewer = { rank, value: viewerValue };
  }

  return {
    kind,
    ...(kind === 'week' && typeof periodStart === 'string' && typeof periodEnd === 'string'
      ? { periodStart, periodEnd }
      : {}),
    ...(typeof totalPlayers === 'number' ? { totalPlayers } : {}),
    entries,
    viewer,
    viewerHidden,
  };
};
