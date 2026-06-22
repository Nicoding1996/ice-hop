import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { MyPuzzlesResponse, UgcSubmission } from '../../shared/api';
import type { Board } from '../../shared/game/types';
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
const ROW_H = 56;
const PAGER_H = 42;

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
 * A tiny schematic of a board so a creator can recognise which puzzle is which
 * at a glance: ice backing, water holes, and a coloured dot per piece. Drawn
 * centred on (0,0) into `container`. Purely a glyph - not the full character art.
 */
const drawBoardThumb = (
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  board: Board,
  size: number
): void => {
  const { width: cols, height: rows } = board;
  const cell = size / Math.max(cols, rows);
  // Size the backing to the actual grid extent so non-square boards aren't
  // letterboxed inside a square with uneven padding.
  const gw = cols * cell;
  const gh = rows * cell;
  const ox = -gw / 2;
  const oy = -gh / 2;
  const g = scene.add.graphics();
  g.fillStyle(PALETTE.iceSheet, 1);
  g.fillRoundedRect(ox, oy, gw, gh, 4);
  g.lineStyle(1, PALETTE.iceEdge, 0.8);
  g.strokeRoundedRect(ox, oy, gw, gh, 4);

  const holes = new Set(board.holes);
  const kindAt = new Map<number, string>();
  for (const p of board.pieces) for (const c of p.cells) kindAt.set(c, p.kind);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = ox + c * cell + cell / 2;
      const y = oy + r * cell + cell / 2;
      if (holes.has(idx)) {
        g.fillStyle(PALETTE.water, 1);
        g.fillCircle(x, y, cell * 0.32);
      }
      const kind = kindAt.get(idx);
      if (kind === 'HOPPER') {
        g.fillStyle(PALETTE.penguin, 1);
        g.fillCircle(x, y, cell * 0.34);
      } else if (kind === 'SLIDER') {
        g.fillStyle(PALETTE.seal, 1);
        g.fillRoundedRect(x - cell * 0.4, y - cell * 0.32, cell * 0.8, cell * 0.64, 2);
      } else if (kind === 'BLOCKER') {
        g.fillStyle(PALETTE.rock, 1);
        g.fillRoundedRect(x - cell * 0.36, y - cell * 0.36, cell * 0.72, cell * 0.72, 2);
      }
    }
  }
  container.add(g);
};

/**
 * "My puzzles": the creator feedback loop. Shows how many times each puzzle the
 * player built has been solved and upvoted, with headline totals on top - the
 * reason a builder comes back. The list is PAGINATED (Prev / Next) rather than
 * scrolled: it only ever renders the rows that fit, so nothing overlaps the
 * header or footer and it needs no clipping mask (Phaser 4 geometry masks are a
 * no-op under the WebGL renderer this game runs). Data from GET /api/ugc/mine.
 */
export class MyPuzzlesScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.GameObject[] = [];
  private subs: UgcSubmission[] = [];
  private totals: MyPuzzlesResponse['totals'] = { puzzles: 0, solves: 0, votes: 0 };
  private loaded = false;
  private loadError = false;
  private page = 0;

  constructor() {
    super('MyPuzzlesScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.page = 0;
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
    this.build();

    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      this.build();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
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

    // Footer CTA pinned to the bottom; the paginated list fills the gap above.
    const buildBtn = makePill(this, {
      label: 'Build another',
      variant: 'primary',
      minWidth: Math.min(260, w - 64),
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    buildBtn.setPosition(cx, h - SPACE.xl - buildBtn.height / 2);
    this.content.push(buildBtn);

    this.buildList(cx, sub.y + sub.height / 2 + SPACE.lg, buildBtn.y - buildBtn.height / 2);
  }

  /** Render the current page of puzzles between [top, footerTop], adding Prev/
   *  Next controls only when they're needed. Pagination (not scrolling) keeps
   *  every row inside the band, so rows can never overlap the header or footer. */
  private buildList(cx: number, top: number, footerTop: number): void {
    const w = this.scale.width;
    const gap = SPACE.sm;
    const step = ROW_H + gap;
    const rowW = Math.min(440, w - SPACE.lg * 2);

    // How many rows fit if there were no pager, then again once we reserve
    // space for the pager (only needed when the puzzles actually overflow).
    const fullBottom = footerTop - SPACE.md;
    const capNoPager = Math.max(1, Math.floor((fullBottom - top + gap) / step));

    const paginated = this.subs.length > capNoPager;
    const listBottom = paginated ? fullBottom - PAGER_H - SPACE.md : fullBottom;
    const perPage = paginated
      ? Math.max(1, Math.floor((listBottom - top + gap) / step))
      : capNoPager;
    const pageCount = Math.max(1, Math.ceil(this.subs.length / perPage));
    this.page = Math.min(Math.max(0, this.page), pageCount - 1);

    const startIdx = this.page * perPage;
    const pageRows = this.subs.slice(startIdx, startIdx + perPage);
    let y = top + ROW_H / 2;
    for (const s of pageRows) {
      this.buildRow(s, cx, y, rowW);
      y += step;
    }

    if (pageCount > 1) this.buildPager(cx, fullBottom - PAGER_H / 2, pageCount);
  }

  /** Prev / "page x of y" / Next, centred. Arrows disable at the ends. */
  private buildPager(cx: number, cy: number, pageCount: number): void {
    const prev = makePill(this, {
      label: '\u2039',
      variant: 'chip',
      size: 'sm',
      minWidth: 48,
      onClick: () => this.goToPage(this.page - 1),
    });
    const next = makePill(this, {
      label: '\u203A',
      variant: 'chip',
      size: 'sm',
      minWidth: 48,
      onClick: () => this.goToPage(this.page + 1),
    });
    const label = this.add
      .text(cx, cy, `Page ${this.page + 1} of ${pageCount}`, {
        fontFamily: FONT.ui,
        fontSize: '13px',
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0.5);

    const gap = SPACE.md;
    const total = prev.width + gap + label.width + gap + next.width;
    let x = cx - total / 2;
    prev.setPosition(x + prev.width / 2, cy);
    x += prev.width + gap;
    label.setPosition(x + label.width / 2, cy);
    x += label.width + gap;
    next.setPosition(x + next.width / 2, cy);

    prev.setEnabled(this.page > 0);
    next.setEnabled(this.page < pageCount - 1);
    this.content.push(prev, label, next);
  }

  private goToPage(page: number): void {
    this.page = page;
    this.build();
  }

  /** One puzzle row: a board thumbnail, par/age, and solves/votes. */
  private buildRow(subm: UgcSubmission, cx: number, cy: number, rowW: number): void {
    const pad = SPACE.md;
    const card = this.add.graphics();
    card.fillStyle(0x123047, 0.92);
    card.fillRoundedRect(cx - rowW / 2, cy - ROW_H / 2, rowW, ROW_H, RADIUS.button);
    card.lineStyle(1.5, 0x2f5c7a, 0.9);
    card.strokeRoundedRect(cx - rowW / 2, cy - ROW_H / 2, rowW, ROW_H, RADIUS.button);
    this.content.push(card);

    const thumbSize = ROW_H - 14;
    const thumb = this.add.container(cx - rowW / 2 + pad + thumbSize / 2, cy);
    drawBoardThumb(this, thumb, subm.board, thumbSize);
    this.content.push(thumb);

    const textX = cx - rowW / 2 + pad + thumbSize + SPACE.md;
    const parText = this.add
      .text(textX, cy - 9, `Par ${subm.par}`, {
        fontFamily: FONT.ui,
        fontSize: '15px',
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0, 0.5);
    const ageText = this.add
      .text(textX, cy + 11, ago(subm.createdAt), {
        fontFamily: FONT.ui,
        fontSize: '11px',
        fontStyle: '600',
        color: PALETTE.text,
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.6);
    this.content.push(parText, ageText);

    const solveLabel = subm.solves === 1 ? '1 solve' : `${subm.solves} solves`;
    const solvesText = this.add
      .text(cx + rowW / 2 - pad, cy - 9, solveLabel, {
        fontFamily: FONT.ui,
        fontSize: '14px',
        fontStyle: '700',
        color: GOLD,
      })
      .setOrigin(1, 0.5);
    const votesText = this.add
      .text(cx + rowW / 2 - pad, cy + 11, `\u25B2 ${subm.votes}`, {
        fontFamily: FONT.ui,
        fontSize: '12px',
        fontStyle: '700',
        color: GOLD,
      })
      .setOrigin(1, 0.5)
      .setAlpha(0.85);
    this.content.push(solvesText, votesText);
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
