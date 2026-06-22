import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { MyPuzzlesResponse, UgcSubmission } from '../../shared/api';
import {
  PALETTE,
  FONT,
  SPACE,
  RADIUS,
  paintBackdrop,
  drawPenguinInto,
  fadeInScene,
  fadeToScene,
  makePill,
} from '../art/theme';

const GOLD = '#ffd166';
const ROW_H = 54;

/** A short "x ago" label from a timestamp (creator-facing, no need for a date). */
const ago = (ts: number): string => {
  const delta = Math.max(0, Date.now() - ts);
  const days = Math.floor(delta / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(delta / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(delta / 60_000);
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
};

/**
 * "My puzzles": the creator feedback loop. Shows how many times each puzzle the
 * player built has been solved and upvoted, with headline totals on top - the
 * reason a builder comes back. Data comes from GET /api/ugc/mine.
 */
export class MyPuzzlesScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.GameObject[] = [];
  private subs: UgcSubmission[] = [];
  private totals: MyPuzzlesResponse['totals'] = { puzzles: 0, solves: 0, votes: 0 };
  private loaded = false;
  private loadError = false;

  constructor() {
    super('MyPuzzlesScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
    this.build();
    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      this.build();
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    void this.loadPuzzles();
  }

  private async loadPuzzles(): Promise<void> {
    this.loadError = false;
    try {
      const response = await fetch('/api/ugc/mine');
      if (!response.ok) throw new Error(`mine failed: ${response.status}`);
      const data: MyPuzzlesResponse = await response.json();
      this.subs = [...data.submissions];
      this.totals = data.totals;
    } catch (error) {
      console.error(error);
      this.loadError = true;
    } finally {
      this.loaded = true;
      // The player may have left before the request resolved; don't rebuild a
      // dead scene (that throws on destroyed objects).
      if (this.sys.isActive()) this.build();
    }
  }

  private build(): void {
    this.content.forEach((o) => o.destroy());
    this.content = [];
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const title = this.add
      .text(cx, h * 0.12, 'My puzzles', {
        fontFamily: FONT.display,
        fontSize: `${Math.round(Math.min(46, w * 0.125))}px`,
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0.5);
    this.content.push(title);

    // Headline totals - the creator payoff - in the one warm accent.
    const subtitle = !this.loaded
      ? 'Loading\u2026'
      : this.totals.puzzles === 0
        ? ''
        : `${this.totals.puzzles} built  \u00B7  ${this.totals.solves} solved  \u00B7  ${this.totals.votes} upvotes`;
    const sub = this.add
      .text(cx, title.y + title.height / 2 + SPACE.sm, subtitle, {
        fontFamily: FONT.ui,
        fontSize: '15px',
        fontStyle: '700',
        color: GOLD,
        align: 'center',
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5);
    this.content.push(sub);

    const back = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    back.setPosition(SPACE.md + back.width / 2, Math.min(72, h * 0.13) / 2);
    this.content.push(back);

    if (!this.loaded) return;

    if (this.loadError) {
      this.buildErrorState();
      return;
    }

    if (this.subs.length === 0) {
      this.buildEmptyState();
      return;
    }

    // Footer CTA pinned to the bottom; the list fills the space above it.
    const buildBtn = makePill(this, {
      label: 'Build another',
      variant: 'primary',
      minWidth: Math.min(260, w - 64),
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    buildBtn.setPosition(cx, h - SPACE.xl - buildBtn.height / 2);
    this.content.push(buildBtn);

    const listTop = sub.y + sub.height / 2 + SPACE.lg;
    const listBottom = buildBtn.y - buildBtn.height / 2 - SPACE.md;
    const available = listBottom - listTop;
    const step = ROW_H + SPACE.sm;
    const maxRows = Math.max(1, Math.floor((available + SPACE.sm) / step));

    // Reserve the last slot for a "+N more" note when the list overflows.
    const overflowing = this.subs.length > maxRows;
    const visibleCount = overflowing ? Math.max(1, maxRows - 1) : this.subs.length;
    const rowW = Math.min(440, w - SPACE.lg * 2);

    let y = listTop + ROW_H / 2;
    for (let i = 0; i < visibleCount; i++) {
      this.buildRow(this.subs[i], cx, y, rowW);
      y += step;
    }
    if (overflowing) {
      const more = this.subs.length - visibleCount;
      const moreText = this.add
        .text(cx, y, `+ ${more} more`, {
          fontFamily: FONT.ui,
          fontSize: '13px',
          fontStyle: '700',
          color: PALETTE.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.6);
      this.content.push(moreText);
    }
  }

  /** One puzzle row: a soft card with par/age on the left, solves/votes right. */
  private buildRow(subm: UgcSubmission, cx: number, cy: number, rowW: number): void {
    const pad = SPACE.lg;
    const card = this.add.graphics();
    card.fillStyle(0x123047, 0.92);
    card.fillRoundedRect(cx - rowW / 2, cy - ROW_H / 2, rowW, ROW_H, RADIUS.button);
    card.lineStyle(1.5, 0x2f5c7a, 0.9);
    card.strokeRoundedRect(cx - rowW / 2, cy - ROW_H / 2, rowW, ROW_H, RADIUS.button);

    const left = this.add
      .text(cx - rowW / 2 + pad, cy, `Par ${subm.par}  \u00B7  ${ago(subm.createdAt)}`, {
        fontFamily: FONT.ui,
        fontSize: '14px',
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0, 0.5);

    const solveLabel = subm.solves === 1 ? '1 solve' : `${subm.solves} solves`;
    const right = this.add
      .text(cx + rowW / 2 - pad, cy, `\u25B2 ${subm.votes}    ${solveLabel}`, {
        fontFamily: FONT.ui,
        fontSize: '14px',
        fontStyle: '700',
        color: GOLD,
      })
      .setOrigin(1, 0.5);

    this.content.push(card, left, right);
  }

  private buildErrorState(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const msg = this.add
      .text(cx, h * 0.46, "Couldn't load your puzzles.\nCheck your connection and try again.", {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '600',
        color: PALETTE.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: w - 56 },
      })
      .setOrigin(0.5);

    const retry = makePill(this, {
      label: 'Try again',
      variant: 'primary',
      x: cx,
      y: h * 0.58,
      minWidth: Math.min(220, w - 64),
      onClick: () => {
        retry.setLabelText('Loading\u2026');
        retry.setEnabled(false);
        this.loadError = false;
        void this.loadPuzzles();
      },
    });
    this.content.push(msg, retry);
  }

  private buildEmptyState(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const peng = this.add.container(cx, h * 0.34);
    drawPenguinInto(this, peng, 64);

    const msg = this.add
      .text(cx, h * 0.5, "You haven't built a puzzle yet.\nMake one and watch the solves roll in!", {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '600',
        color: PALETTE.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: w - 56 },
      })
      .setOrigin(0.5);

    const buildBtn = makePill(this, {
      label: 'Build a puzzle',
      variant: 'primary',
      x: cx,
      y: h * 0.66,
      minWidth: Math.min(260, w - 64),
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    this.content.push(peng, msg, buildBtn);
  }
}
