// Builds the spoiler-free, copy-to-comments result text (Wordle-style).
// It intentionally reveals only the score/streak/rank - never the board layout
// or the solution - so sharing never spoils the puzzle for others.

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
};

/**
 * A short, spoiler-free score line to drop into a post's comment thread (the
 * "comment section is the scoreboard" loop). Worded as moves vs par - never
 * "tries" - to match the rest of the game and invite "beat my count" replies.
 */
export const buildScoreComment = (s: ScoreComment): string => {
  const earned = Math.max(0, Math.min(3, s.stars));
  const stars = '⭐'.repeat(earned) + '⬜'.repeat(3 - earned);
  const what = s.creator ? `u/${s.creator}'s puzzle` : "today's puzzle";
  const note =
    s.moves <= s.par ? ' \u2014 par! \uD83C\uDFAF' : s.moves === s.par + 1 ? ' \u2014 one over par' : '';
  return `Solved ${what} in ${s.moves} moves (par ${s.par}) ${stars}${note} \uD83D\uDC27`;
};
