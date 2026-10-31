import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { context } from '@devvit/web/client';
import type { UgcListResponse, UgcSubmission } from '../../shared/api';
import { difficultyFromPar, difficultyLabel } from '../../shared/solver/difficulty';
import {
  PALETTE,
  FONT,
  SPACE,
  armTap,
  paintBackdrop,
  drawBoardThumb,
  drawPenguinInto,
  fadeInScene,
  fadeToScene,
  makePill,
  useCrispRendering,
  viewHeight,
  viewWidth,
} from '../art/theme';

const CARD_FILL = 0x1a3a55;
const CARD_FILL_PRESSED = 0x24496a;
const CARD_BORDER = 0x35608a;
const PAGER_H = 42;
const LIST_TIMEOUT_MS = 8000;
/** Registry key: the list page to reopen when a player backs out of a puzzle. */
const PAGE_KEY = 'ugc.listPage';

type LoadState = 'loading' | 'error' | 'ready';

/** Shrink a label to fit `maxWidth`, then trim it with an ellipsis if needed. */
const fitLabel = (label: Phaser.GameObjects.Text, maxWidth: number): void => {
  if (maxWidth <= 0 || label.width <= maxWidth) return;
  const scale = Math.max(0.8, maxWidth / label.width);
  label.setScale(scale);
  let text = label.text;
  while (label.width * scale > maxWidth && text.length > 4) {
    text = text.slice(0, -1);
    label.setText(`${text.trimEnd()}\u2026`);
  }
};

/**
 * Community: a browsable list of player-made puzzles. The server already drops
 * puzzles a signed player has solved and interleaves top-voted, new, and
 * discovery picks; this scene also drops ones solved earlier in the session.
 * Tap a row to play that puzzle (Next then continues down the list), or "Play
 * all" to start at the top. The list is paginated, never scrolled, like My
 * puzzles, so rows can't overlap the header or footer.
 */
export class CommunityScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.GameObject[] = [];
  private subs: UgcSubmission[] = [];
  private state: LoadState = 'loading';
  private page = 0;
  private loadGeneration = 0;
  private leaving = false;

  constructor() {
    super('CommunityScene');
  }

  create(data?: { readonly resume?: boolean }): void {
    useCrispRendering(this);
    const generation = ++this.loadGeneration;
    this.subs = [];
    this.state = 'loading';
    this.leaving = false;
    // Backing out of a puzzle reopens the page it was picked from.
    const savedPage = this.registry.get(PAGE_KEY);
    this.page = data?.resume === true && typeof savedPage === 'number' ? savedPage : 0;
    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
    this.build();
    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
      this.build();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.loadGeneration += 1;
    });
    void this.loadList(generation);
  }

  private async loadList(generation: number): Promise<void> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
    let loaded: UgcSubmission[] | null = null;
    try {
      const response = await fetch('/api/ugc/list', { signal: controller.signal });
      if (!response.ok) throw new Error(`list failed: ${response.status}`);
      const data: UgcListResponse = await response.json();
      const locallyPlayed: string[] = this.registry.get('ugc.played.local') ?? [];
      loaded = data.submissions.filter((submission) => !locallyPlayed.includes(submission.id));
    } catch (error) {
      console.error(error);
    } finally {
      window.clearTimeout(timer);
    }
    // The player may have left (or retried) before the request resolved.
    if (generation !== this.loadGeneration || !this.sys.isActive()) return;
    this.subs = loaded ?? [];
    this.state = loaded ? 'ready' : 'error';
    this.build();
  }

  private text(
    x: number,
    y: number,
    value: string,
    size: number,
    style: { readonly weight?: string; readonly display?: boolean; readonly color?: string } = {}
  ): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, {
      fontFamily: style.display ? FONT.display : FONT.ui,
      fontSize: `${size}px`,
      fontStyle: style.weight ?? '700',
      color: style.color ?? PALETTE.text,
    });
  }

  private build(): void {
    this.content.forEach((object) => object.destroy());
    this.content = [];
    const w = viewWidth(this);
    const h = viewHeight(this);
    const cx = w / 2;
    const compact = h < 680;
    const empty = this.state === 'ready' && this.subs.length === 0;

    const back = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.leave('HomeScene'),
    });
    back.setPosition(SPACE.md + back.width / 2, SPACE.md + back.height / 2);
    this.content.push(back);
    // Builders can jump straight to the editor (the empty state offers it as
    // its main action instead).
    if (!empty) {
      const buildChip = makePill(this, {
        label: '+ Build',
        variant: 'chip',
        size: 'sm',
        onClick: () => this.leave('EditorScene'),
      });
      buildChip.setPosition(w - SPACE.md - buildChip.width / 2, back.y);
      this.content.push(buildChip);
    }

    const title = this.text(
      cx,
      back.y + back.height / 2 + (compact ? SPACE.xs : SPACE.md),
      'Community',
      Math.round(Math.min(compact ? 38 : 46, w * 0.12)),
      { display: true }
    ).setOrigin(0.5, 0);
    const subtitle = this.text(cx, title.y + title.height + SPACE.xs, 'Puzzles made by players', 14, {
      weight: '600',
    })
      .setOrigin(0.5, 0)
      .setAlpha(0.85);
    this.content.push(title, subtitle);
    const top = subtitle.y + subtitle.height + (compact ? SPACE.md : SPACE.lg);

    if (this.state === 'loading') {
      const status = this.text(cx, top + (h - top) * 0.35, 'Loading community puzzles\u2026', 16, {
        weight: '600',
      }).setOrigin(0.5);
      this.content.push(status);
      return;
    }
    if (this.state === 'error') {
      this.buildErrorState(cx, top);
      return;
    }
    if (empty) {
      this.buildEmptyState(cx, top);
      return;
    }

    // "Play all" pinned in thumb reach; the paginated list fills the gap above.
    const playAll = makePill(this, {
      label: 'Play all \u25B6',
      variant: 'primary',
      minWidth: Math.min(260, w - 64),
      onClick: () => this.play(0),
    });
    playAll.setPosition(cx, h - SPACE.lg - playAll.height / 2);
    this.content.push(playAll);
    this.buildList(cx, top, playAll.y - playAll.height / 2 - SPACE.md);
  }

  /** The current page of rows between `top` and `bottom`, with a pager only
   *  when the puzzles overflow one page. */
  private buildList(cx: number, top: number, bottom: number): void {
    const w = viewWidth(this);
    const baseRowH = viewHeight(this) < 600 ? 60 : 66;
    const gap = SPACE.sm;
    const baseStep = baseRowH + gap;
    const rowW = Math.min(440, w - SPACE.lg * 2);
    const capNoPager = Math.max(1, Math.floor((bottom - top + gap) / baseStep));
    const paginated = this.subs.length > capNoPager;
    const listBottom = paginated ? bottom - PAGER_H - SPACE.sm : bottom;
    const perPage = paginated
      ? Math.max(1, Math.floor((listBottom - top + gap) / baseStep))
      : capNoPager;
    // Full pages share the leftover height (bigger thumbnails) instead of
    // leaving a band above the pager; every page uses the same row size.
    const spare = paginated ? listBottom - top - (perPage * baseStep - gap) : 0;
    const rowH = baseRowH + Math.min(12, Math.max(0, Math.floor(spare / perPage)));
    const step = rowH + gap;
    const pageCount = Math.max(1, Math.ceil(this.subs.length / perPage));
    this.page = Math.min(Math.max(0, this.page), pageCount - 1);

    const start = this.page * perPage;
    let y = top + rowH / 2;
    this.subs.slice(start, start + perPage).forEach((submission, offset) => {
      this.content.push(this.makeRow(cx, y, rowW, rowH, submission, start + offset));
      y += step;
    });
    if (pageCount > 1) this.buildPager(cx, bottom - PAGER_H / 2, pageCount);
  }

  /** One tappable puzzle: thumbnail, creator, difficulty and par, votes and solves. */
  private makeRow(
    cx: number,
    cy: number,
    width: number,
    height: number,
    submission: UgcSubmission,
    index: number
  ): Phaser.GameObjects.Container {
    const row = this.add.container(cx, cy);
    const bg = this.add.graphics();
    const paint = (pressed: boolean): void => {
      bg.clear();
      bg.fillStyle(0x06121f, 0.28);
      bg.fillRoundedRect(-width / 2, -height / 2 + 3, width, height, 16);
      bg.fillStyle(pressed ? CARD_FILL_PRESSED : CARD_FILL, 1);
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, 16);
      bg.lineStyle(1.5, CARD_BORDER, 0.9);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 16);
    };
    paint(false);

    const thumbSize = height - 16;
    const thumb = this.add.container(-width / 2 + SPACE.md + thumbSize / 2, 0);
    drawBoardThumb(this, thumb, submission.board, thumbSize);

    const textX = -width / 2 + SPACE.md + thumbSize + SPACE.md;
    const mine = Boolean(context.username) && submission.creator === context.username;
    const name = this.text(textX, -10, mine ? 'by you' : `by ${submission.creator}`, 15, {
      weight: '800',
    }).setOrigin(0, 0.5);
    const detail = this.text(
      textX,
      12,
      `${difficultyLabel(difficultyFromPar(submission.par))} \u00B7 par ${submission.par}`,
      12,
      { weight: '700' }
    )
      .setOrigin(0, 0.5)
      .setAlpha(0.72);

    const chevron = this.text(width / 2 - 16, 0, '\u203A', 26, { weight: '800' })
      .setOrigin(0.5)
      .setAlpha(0.7);
    const statsRight = width / 2 - 32;
    const votes = this.text(statsRight, -10, `\u25B2 ${submission.votes}`, 13, { weight: '800' })
      .setOrigin(1, 0.5)
      .setAlpha(0.85);
    const solves = this.text(
      statsRight,
      12,
      submission.solves === 1 ? '1 solve' : `${submission.solves} solves`,
      12,
      { weight: '700' }
    )
      .setOrigin(1, 0.5)
      .setAlpha(0.72);
    const textMax = statsRight - Math.max(votes.width, solves.width) - SPACE.md - textX;
    fitLabel(name, textMax);
    fitLabel(detail, textMax);

    const zone = this.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    armTap(zone, {
      onPress: () => {
        paint(true);
        row.setScale(0.98);
      },
      onCancel: () => {
        paint(false);
        row.setScale(1);
      },
      onTap: () => {
        paint(false);
        row.setScale(1);
        this.play(index);
      },
    });
    row.add([bg, thumb, name, detail, votes, solves, chevron, zone]);
    row.setSize(width, height);
    return row;
  }

  /** Prev / "Page x of y" / Next, centred. Arrows disable at the ends. */
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
    const label = this.text(cx, cy, `Page ${this.page + 1} of ${pageCount}`, 13).setOrigin(0.5);
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

  /** Start the list at `index`; GameScene's Next continues from there. */
  private play(index: number): void {
    const submission = this.subs[index];
    if (!submission || this.leaving) return;
    this.leaving = true;
    this.registry.set('ugc.queue', this.subs);
    this.registry.set('ugc.index', index);
    this.registry.set(PAGE_KEY, this.page);
    fadeToScene(this, 'GameScene', {
      community: {
        id: submission.id,
        board: submission.board,
        par: submission.par,
        creator: submission.creator,
        votes: submission.votes,
        solves: submission.solves,
      },
    });
  }

  private leave(key: string): void {
    if (this.leaving) return;
    this.leaving = true;
    fadeToScene(this, key);
  }

  /** A failed load is never a dead end: retry in place (Menu stays up top). */
  private buildErrorState(cx: number, top: number): void {
    const w = viewWidth(this);
    const h = viewHeight(this);
    const message = this.add
      .text(cx, top + (h - top) * 0.3, "Couldn't load community puzzles.\nCheck your connection and try again.", {
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
      minWidth: Math.min(220, w - 64),
      onClick: () => {
        this.state = 'loading';
        this.build();
        void this.loadList(++this.loadGeneration);
      },
    });
    retry.setPosition(cx, message.y + message.height / 2 + SPACE.xl + retry.height / 2);
    this.content.push(message, retry);
  }

  /** Nothing new to play: invite the player to build one, or keep playing Endless. */
  private buildEmptyState(cx: number, top: number): void {
    const w = viewWidth(this);
    const h = viewHeight(this);
    const penguinSize = h < 560 ? 48 : 64;
    const penguin = this.add.container(cx, 0);
    drawPenguinInto(this, penguin, penguinSize);
    const message = this.add
      .text(cx, 0, 'No new community puzzles right now.\nBuild one for others to solve!', {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '600',
        color: PALETTE.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: w - 56 },
      })
      .setOrigin(0.5, 0);
    const buildButton = makePill(this, {
      label: 'Build a puzzle',
      variant: 'primary',
      minWidth: Math.min(260, w - 64),
      onClick: () => this.leave('EditorScene'),
    });
    const endless = makePill(this, {
      label: 'Play Endless \u203A',
      variant: 'ghost',
      size: 'sm',
      onClick: () => this.leave('EndlessScene'),
    });
    const blockH =
      penguinSize + SPACE.lg + message.height + SPACE.xl + buildButton.height + SPACE.sm + endless.height;
    // A touch above centre reads as centred under the header.
    let y = top + Math.max(0, (h - SPACE.lg - top - blockH) * 0.42);
    penguin.setY(y + penguinSize / 2);
    y += penguinSize + SPACE.lg;
    message.setY(y);
    y += message.height + SPACE.xl;
    buildButton.setPosition(cx, y + buildButton.height / 2);
    y += buildButton.height + SPACE.sm;
    endless.setPosition(cx, y + endless.height / 2);
    this.content.push(penguin, message, buildButton, endless);
  }
}
