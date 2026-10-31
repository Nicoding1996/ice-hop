// Markdown for the live pinned-comment leaderboards on Daily and Community
// posts. Pure so post seeding, the scheduler job, and tests render identical
// text. Names are plain (never "u/" mentions) so updates ping nobody.
import type { MovesBucket } from './api';
import { formatPuzzleDate } from './date';
import { formatDuration } from './leaderboard';

/** Shown instead of a name for players who hide it on comment boards. */
export const ANONYMOUS_PLAYER = 'Anonymous penguin';

export type CommentBoardRow = {
  readonly rank: number;
  /** Display name, already anonymized when the player opted out. */
  readonly name: string;
  readonly moves: number;
  /** Verified elapsed time; Daily boards only. */
  readonly timeMs?: number;
};

export type DailyCommentBoard = {
  readonly date: string;
  readonly par: number;
  /** True once the puzzle's day has closed and the standings are frozen. */
  readonly final: boolean;
  readonly totalPlayers: number;
  readonly rows: readonly CommentBoardRow[];
  readonly distribution: readonly MovesBucket[];
  /** Live boards only: the previous Daily's winner, when it had one. */
  readonly previousWinner?: CommentBoardRow;
};

export type CommunityCommentBoard = {
  readonly creator: string;
  readonly par: number;
  readonly totalPlayers: number;
  /** Solvers whose best equals par. */
  readonly atPar: number;
  readonly rows: readonly CommentBoardRow[];
};

/** Escape Markdown control characters so a name can never format or link. */
export const escapeMarkdown = (text: string): string =>
  text.replace(/[\\`*_~^|[\]()<>#!]/g, (char) => `\\${char}`);

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
const rankCell = (rank: number): string => MEDALS[rank - 1] ?? String(rank);

const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const percent = (part: number, total: number): string =>
  `${total > 0 ? Math.round((part / total) * 100) : 0}%`;

const BAR_WIDTH = 10;
const bar = (players: number, max: number): string =>
  players > 0 && max > 0
    ? '\u{1F7E6}'.repeat(Math.max(1, Math.round((players / max) * BAR_WIDTH)))
    : '';

const DAILY_HOW_TO =
  'How to play: tap a penguin to hop it over things, drag a seal to slide. Get every penguin into the water in as few moves as you can ("par" is the fewest possible).';

const dailyTable = (rows: readonly CommentBoardRow[]): string =>
  [
    '| # | Player | Moves | Time |',
    '|:-:|:--|:-:|:-:|',
    ...rows.map(
      (row) =>
        `| ${rankCell(row.rank)} | ${escapeMarkdown(row.name)} | ${row.moves} | ${
          row.timeMs === undefined ? '\u2013' : formatDuration(row.timeMs)
        } |`
    ),
  ].join('\n');

/** Bar chart of best scores, trimmed after the last non-empty bucket. */
const distributionTable = (par: number, distribution: readonly MovesBucket[]): string => {
  let last = distribution.length - 1;
  while (last > 0 && (distribution[last]?.players ?? 0) === 0) last -= 1;
  const shown = distribution.slice(0, last + 1);
  const max = Math.max(0, ...shown.map((bucket) => bucket.players));
  return [
    '| Moves | Players |',
    '|:--|:--|',
    ...shown.map((bucket) => {
      const label =
        bucket.moves === par ? `${bucket.moves} (par)` : `${bucket.moves}${bucket.orMore ? '+' : ''}`;
      const chart = bar(bucket.players, max);
      return `| ${label} | ${chart ? `${chart} ` : ''}${bucket.players} |`;
    }),
  ].join('\n');
};

/** The full pinned-comment body for a Daily post (live or final). */
export const renderDailyCommentBoard = (board: DailyCommentBoard): string => {
  const sections: string[] = [
    `\u{1F427} **Ice Hop \u2014 Daily puzzle for ${formatPuzzleDate(board.date, true)}**`,
    DAILY_HOW_TO,
    board.final ? '### \u{1F3C1} Final results' : '### \u{1F3C6} Live leaderboard',
  ];

  if (board.rows.length === 0) {
    sections.push(
      board.final
        ? 'Nobody solved this one before it closed.'
        : 'No solves yet. Be the first penguin in! \u{1F427}'
    );
  } else {
    const atPar = board.distribution[0]?.players ?? 0;
    sections.push(
      dailyTable(board.rows),
      `**${counted(board.totalPlayers, 'player', 'players')}** \u00B7 **${atPar} hit par** (${percent(atPar, board.totalPlayers)}) \u00B7 par ${board.par}`,
      distributionTable(board.par, board.distribution)
    );
  }

  const winner = board.previousWinner;
  if (!board.final && winner) {
    const time = winner.timeMs === undefined ? '' : `, ${formatDuration(winner.timeMs)}`;
    sections.push(
      `\u{1F451} Yesterday's winner: **${escapeMarkdown(winner.name)}** (${counted(winner.moves, 'move', 'moves')}${time})`
    );
  }

  if (board.final) {
    sections.push(
      '*Final standings from when this puzzle closed. A new Daily drops every day at 12:00 UTC.*'
    );
  } else {
    sections.push(
      '*Live: updates every few minutes. Fewest moves wins; faster verified time breaks ties.*',
      'Solved it? Tap **Comment my score** on the win screen, or drop your move count below \u{1F447}'
    );
  }
  return sections.join('\n\n');
};

/** The full pinned-comment body for a Community puzzle post. */
export const renderCommunityCommentBoard = (board: CommunityCommentBoard): string => {
  const sections: string[] = [
    // The creator credit is the one deliberate mention: it was in the original
    // seeded comment, and edits do not send new mention notifications.
    `\u{1F427} **A community puzzle by u/${board.creator}!**`,
    'Tap a penguin to hop it over things, drag a seal to slide. Get every penguin into the water in as few moves as you can.',
    '### \u{1F3C6} Best solves',
  ];

  if (board.rows.length === 0) {
    sections.push('No solves yet. Be the first penguin in! \u{1F427}');
  } else {
    sections.push(
      [
        '| # | Player | Moves |',
        '|:-:|:--|:-:|',
        ...board.rows.map(
          (row) => `| ${rankCell(row.rank)} | ${escapeMarkdown(row.name)} | ${row.moves} |`
        ),
      ].join('\n'),
      `**${counted(board.totalPlayers, 'solver', 'solvers')}** \u00B7 **${board.atPar} at par** (${percent(board.atPar, board.totalPlayers)}) \u00B7 par ${board.par}`,
      '*Updates every few minutes. Ties go to whoever got there first.*'
    );
  }

  sections.push(
    'Solved it? Drop your move count below \u{1F447} and upvote the puzzle if you liked it. Want to make your own? Tap **Full game**, then choose **Build a puzzle**.'
  );
  return sections.join('\n\n');
};
