import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_PLAYER,
  escapeMarkdown,
  renderCommunityCommentBoard,
  renderDailyCommentBoard,
} from '../commentBoard';
import { bucketsFromMoves } from '../leaderboard';
import { buildScoreComment } from '../share';

describe('renderDailyCommentBoard', () => {
  const rows = [
    { rank: 1, name: 'alice', moves: 6, timeMs: 42_000 },
    { rank: 2, name: 'bob_the_builder', moves: 6, timeMs: 65_000 },
    { rank: 3, name: ANONYMOUS_PLAYER, moves: 7, timeMs: 31_000 },
    { rank: 4, name: 'dee', moves: 9, timeMs: 130_000 },
  ];

  it('renders a live table, par rate, distribution, and yesterday\u2019s winner', () => {
    const text = renderDailyCommentBoard({
      date: '2026-10-30',
      par: 6,
      final: false,
      totalPlayers: 4,
      rows,
      distribution: bucketsFromMoves(6, [6, 6, 7, 9]),
      previousWinner: { rank: 1, name: 'zed', moves: 5, timeMs: 31_000 },
    });
    expect(text).toContain('Daily puzzle for Fri, Oct 30');
    expect(text).toContain('### \u{1F3C6} Live leaderboard');
    expect(text).toContain('| \u{1F947} | alice | 6 | 0:42 |');
    expect(text).toContain('| \u{1F948} | bob\\_the\\_builder | 6 | 1:05 |');
    expect(text).toContain(`| \u{1F949} | ${ANONYMOUS_PLAYER} | 7 | 0:31 |`);
    expect(text).toContain('| 4 | dee | 9 | 2:10 |');
    expect(text).toContain('**4 players** \u00B7 **2 hit par** (50%) \u00B7 par 6');
    expect(text).toContain('| 6 (par) |');
    // The chart stops after the last bucket anyone reached.
    expect(text).toContain('| 9 |');
    expect(text).not.toContain('| 10+ |');
    expect(text).toContain("Yesterday's winner: **zed** (5 moves, 0:31)");
    expect(text).toContain('Comment my score');
    // Plain names only: an update must never mention (ping) a player.
    expect(text).not.toMatch(/u\//);
  });

  it('freezes into final results without live prompts', () => {
    const text = renderDailyCommentBoard({
      date: '2026-10-29',
      par: 6,
      final: true,
      totalPlayers: 4,
      rows,
      distribution: bucketsFromMoves(6, [6, 6, 7, 9]),
      previousWinner: { rank: 1, name: 'zed', moves: 5 },
    });
    expect(text).toContain('### \u{1F3C1} Final results');
    expect(text).toContain('Final standings');
    expect(text).not.toContain('Live leaderboard');
    expect(text).not.toContain("Yesterday's winner");
    expect(text).not.toContain('Comment my score');
  });

  it('invites the first solver on an empty board', () => {
    const text = renderDailyCommentBoard({
      date: '2026-10-30',
      par: 4,
      final: false,
      totalPlayers: 0,
      rows: [],
      distribution: bucketsFromMoves(4, []),
    });
    expect(text).toContain('No solves yet. Be the first penguin in!');
    expect(text).not.toContain('| # |');
  });
});

describe('renderCommunityCommentBoard', () => {
  it('credits the creator and ranks plain-name solvers', () => {
    const text = renderCommunityCommentBoard({
      creator: 'maker',
      par: 5,
      totalPlayers: 3,
      atPar: 1,
      rows: [
        { rank: 1, name: 'alice', moves: 5 },
        { rank: 2, name: ANONYMOUS_PLAYER, moves: 6 },
        { rank: 3, name: 'cara', moves: 8 },
      ],
    });
    expect(text).toContain('A community puzzle by u/maker!');
    expect(text).toContain('### \u{1F3C6} Best solves');
    expect(text).toContain('| \u{1F947} | alice | 5 |');
    expect(text).toContain('**3 solvers** \u00B7 **1 at par** (33%) \u00B7 par 5');
    expect(text).toContain('Ties go to whoever got there first');
    expect(text.match(/u\//g)).toHaveLength(1);
  });
});

describe('escapeMarkdown', () => {
  it('neutralises formatting and table characters in names', () => {
    expect(escapeMarkdown('a_b*c|d')).toBe('a\\_b\\*c\\|d');
    expect(escapeMarkdown('[x](y)')).toBe('\\[x\\]\\(y\\)');
    expect(escapeMarkdown('plain-name42')).toBe('plain-name42');
  });
});

describe('buildScoreComment', () => {
  it('posts a dated Daily line with a par mark and streak', () => {
    expect(
      buildScoreComment({ moves: 6, par: 6, stars: 3, date: '2026-10-30', streak: 3 })
    ).toBe(
      '\u{1F427} Daily Oct 30 \u00B7 \u2B50\u2B50\u2B50 6 moves (par 6) \u{1F3AF} \u00B7 \u{1F525} 3-day streak'
    );
  });

  it('skips the streak under two days and the mark above par', () => {
    const text = buildScoreComment({ moves: 9, par: 6, stars: 2, date: '2026-10-30', streak: 1 });
    expect(text).toBe('\u{1F427} Daily Oct 30 \u00B7 \u2B50\u2B50\u2B1C 9 moves (par 6)');
  });

  it('names a Community creator in plain text, never as a mention', () => {
    const text = buildScoreComment({ moves: 5, par: 5, stars: 3, creator: 'some_maker', streak: 9 });
    expect(text).toBe(
      "\u{1F427} some\\_maker's puzzle \u00B7 \u2B50\u2B50\u2B50 5 moves (par 5) \u{1F3AF}"
    );
    expect(text).not.toContain('u/');
  });
});
