// Builds the spoiler-free, copy-to-comments result text (Wordle-style).
// It intentionally reveals only the score/streak/rank - never the board layout
// or the solution - so sharing never spoils the puzzle for others.
import { escapeMarkdown } from './commentBoard';
import { formatPuzzleDate } from './date';

export type ShareData = {
  readonly date: string;
  readonly moves: number;
  readonly par: number;
  readonly stars: number;
  readonly streak: number;
  readonly rank: number;
  readonly totalPlayers: number;
};

export const buildShareText = (d: ShareData): string => {
  const earned = Math.max(0, Math.min(3, d.stars));
  const stars = '⭐'.repeat(earned) + '⬜'.repeat(3 - earned);
  const lines = [`Ice Hop 🐧 ${d.date}`, `${stars}  ${d.moves} moves (par ${d.par})`];

  const tail: string[] = [];
  if (d.streak > 1) tail.push(`🔥 ${d.streak}-day streak`);
  if (d.rank > 0) tail.push(`🏆 #${d.rank}/${d.totalPlayers}`);
  if (tail.length > 0) lines.push(tail.join('  ·  '));

  return lines.join('\n');
};

export type ScoreComment = {
  readonly moves: number;
  readonly par: number;
  readonly stars: number;
  /** Community puzzle author, when commenting on a UGC puzzle post. */
  readonly creator?: string;
  /** Daily puzzle date (YYYY-MM-DD), when commenting on a Daily post. */
  readonly date?: string;
  /** The player's current Daily streak in days. */
  readonly streak?: number;
};

/**
 * A short, spoiler-free score line to drop into a post's comment thread (the
 * "comment section is the scoreboard" loop), e.g.
 * "🐧 Daily Oct 30 · ⭐⭐⭐ 6 moves (par 6) 🎯 · 🔥 3-day streak".
 * Worded as moves vs par to invite "beat my count" replies. Names are plain
 * text, never "u/" mentions, so a score comment pings nobody.
 */
export const buildScoreComment = (s: ScoreComment): string => {
  const earned = Math.max(0, Math.min(3, s.stars));
  const stars = '⭐'.repeat(earned) + '⬜'.repeat(3 - earned);
  const what = s.creator
    ? `${escapeMarkdown(s.creator)}'s puzzle`
    : s.date
      ? `Daily ${formatPuzzleDate(s.date)}`
      : "Today's puzzle";
  const moves = `${s.moves} ${s.moves === 1 ? 'move' : 'moves'}`;
  const parts = [
    `\uD83D\uDC27 ${what}`,
    `${stars} ${moves} (par ${s.par})${s.moves <= s.par ? ' \uD83C\uDFAF' : ''}`,
  ];
  const streak = s.streak ?? 0;
  if (!s.creator && streak >= 2) parts.push(`\uD83D\uDD25 ${streak}-day streak`);
  return parts.join(' \u00B7 ');
};
