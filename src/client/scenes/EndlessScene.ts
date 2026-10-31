import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { context } from '@devvit/web/client';
import type {
  EndlessSolvedResponse,
  EndlessTier,
  EndlessTierCounts,
} from '../../shared/api';
import {
  buildAchievementSnapshot,
  type AchievementId,
  type AchievementSnapshot,
} from '../../shared/achievements';
import {
  PALETTE,
  FONT,
  SPACE,
  armTap,
  paintBackdrop,
  fadeInScene,
  fadeToScene,
  makePill,
  makePanel,
  useCrispRendering,
  viewHeight,
  viewWidth,
} from '../art/theme';

type TierInfo = {
  readonly tier: EndlessTier;
  readonly label: string;
  readonly blurb: string;
  /** Display copy of the tier's par band (source of truth: endlessPolicy.ts). */
  readonly parBand: string;
  readonly pips: number;
};

const TIERS: ReadonlyArray<TierInfo> = [
  { tier: 'easy', label: 'Easy', blurb: 'A gentle warm-up', parBand: 'par 2\u20134', pips: 1 },
  { tier: 'medium', label: 'Medium', blurb: 'A proper head-scratcher', parBand: 'par 5\u20137', pips: 2 },
  { tier: 'hard', label: 'Hard', blurb: 'For the bold', parBand: 'par 8\u201311', pips: 3 },
];

const CARD_FILL = 0x1a3a55;
const CARD_FILL_PRESSED = 0x24496a;
const CARD_BORDER = 0x35608a;

const emptyAchievements = (): AchievementSnapshot =>
  buildAchievementSnapshot({
    solved: 0,
    byTier: { easy: 0, medium: 0, hard: 0 },
    hardAtPar: false,
  });

/**
 * Endless tier select: the "play more" hub after the daily. Pick a difficulty
 * and the server hands back an unlimited shuffle of fresh, solver-verified
 * puzzles from that bucket. Lifetime counts and awards give returning players
 * a progression path without making one tier worth more than another.
 */
export class EndlessScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.GameObject[] = [];
  private solved = 0;
  private byTier: EndlessTierCounts = { easy: 0, medium: 0, hard: 0 };
  private achievements: AchievementSnapshot = emptyAchievements();
  private solvedLoaded = false;
  private awardsOverlay?: Phaser.GameObjects.Container;
  private loadGeneration = 0;

  constructor() {
    super('EndlessScene');
  }

  create(): void {
    useCrispRendering(this);
    const generation = ++this.loadGeneration;
    this.solvedLoaded = false;
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
    void this.loadSolved(generation);
  }

  private async loadSolved(generation: number): Promise<void> {
    if (!context.username) {
      // Guest counts come from this session's registry synchronously, while
      // create() is still running (sys.isActive() is false until it returns),
      // so publish them directly instead of through the async path's guard.
      this.loadGuestSolved();
      this.solvedLoaded = true;
      this.build();
      return;
    }
    await this.loadSignedSolved(generation);
  }

  /** Guests keep their counts in this session's registry only. */
  private loadGuestSolved(): void {
    const solved = this.registry.get('endless.solved');
    const easy = this.registry.get('endless.solved.easy');
    const medium = this.registry.get('endless.solved.medium');
    const hard = this.registry.get('endless.solved.hard');
    this.solved = typeof solved === 'number' ? solved : 0;
    this.byTier = {
      easy: typeof easy === 'number' ? easy : 0,
      medium: typeof medium === 'number' ? medium : 0,
      hard: typeof hard === 'number' ? hard : 0,
    };
    const unlocked: AchievementId[] = this.registry.get('endless.achievementIds') ?? [];
    this.achievements = buildAchievementSnapshot(
      {
        solved: this.solved,
        byTier: this.byTier,
        hardAtPar: this.registry.get('endless.hardAtPar') === true,
      },
      unlocked
    );
    this.registry.set('endless.achievements', this.achievements);
  }

  private async loadSignedSolved(generation: number): Promise<void> {
    try {
      const response = await fetch('/api/endless/stats');
      if (!response.ok) throw new Error(`stats failed: ${response.status}`);
      const data: EndlessSolvedResponse = await response.json();
      if (generation !== this.loadGeneration || !this.sys.isActive()) return;

      const knownSolved = this.registry.get('endless.solved');
      const knownEasy = this.registry.get('endless.solved.easy');
      const knownMedium = this.registry.get('endless.solved.medium');
      const knownHard = this.registry.get('endless.solved.hard');
      this.solved = Math.max(
        this.solved,
        typeof knownSolved === 'number' ? knownSolved : 0,
        data.solved
      );
      this.byTier = {
        easy: Math.max(
          this.byTier.easy,
          typeof knownEasy === 'number' ? knownEasy : 0,
          data.byTier.easy
        ),
        medium: Math.max(
          this.byTier.medium,
          typeof knownMedium === 'number' ? knownMedium : 0,
          data.byTier.medium
        ),
        hard: Math.max(
          this.byTier.hard,
          typeof knownHard === 'number' ? knownHard : 0,
          data.byTier.hard
        ),
      };
      const existingIds: AchievementId[] =
        this.registry.get('endless.achievementIds') ?? [];
      const incomingIds = data.achievements.progress
        .filter((achievement) => achievement.unlocked)
        .map((achievement) => achievement.id);
      const mergedIds = [...new Set<AchievementId>([...existingIds, ...incomingIds])];
      this.achievements = buildAchievementSnapshot(
        {
          solved: this.solved,
          byTier: this.byTier,
          hardAtPar: mergedIds.includes('cold-logic'),
        },
        mergedIds
      );
      this.registry.set('endless.solved', this.solved);
      this.registry.set('endless.solved.easy', this.byTier.easy);
      this.registry.set('endless.solved.medium', this.byTier.medium);
      this.registry.set('endless.solved.hard', this.byTier.hard);
      this.registry.set('endless.achievements', this.achievements);
      this.registry.set('endless.achievementIds', mergedIds);
    } catch (error) {
      console.error(error);
    } finally {
      if (generation === this.loadGeneration && this.sys.isActive()) {
        this.solvedLoaded = true;
        this.build();
      }
    }
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
    this.closeAwards();
    this.content.forEach((object) => object.destroy());
    this.content = [];
    const w = viewWidth(this);
    const h = viewHeight(this);
    const cx = w / 2;
    const compact = h < 680;
    const cardW = Math.min(340, w - 40);

    const back = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    back.setPosition(SPACE.md + back.width / 2, SPACE.md + back.height / 2);

    const title = this.text(cx, 0, 'Endless', Math.round(Math.min(compact ? 42 : 52, w * 0.14)), {
      display: true,
    }).setOrigin(0.5, 0);
    const sub = this.text(cx, 0, 'Pick a level. The puzzles never run out.', 14, { weight: '600' })
      .setOrigin(0.5, 0)
      .setAlpha(0.85);

    // The progression payoff: the lifetime count in the gold accent, with a
    // bar toward the nearest award still to earn.
    const progress = this.buildProgress(cx, cardW, compact);
    const cardH = compact ? 70 : 82;
    const cardGap = compact ? SPACE.sm + 2 : SPACE.md;
    const cards = TIERS.map((info) => this.makeTierCard(cx, cardW, cardH, info));
    const awards = makePill(this, {
      label: this.solvedLoaded
        ? `Awards ${this.achievements.unlocked}/${this.achievements.total}`
        : 'Awards \u2026',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.showAwards(0),
    });

    // One centred column under the Menu chip.
    const gapAfterTitle = compact ? SPACE.md : SPACE.lg;
    const stackH =
      title.height +
      SPACE.xs +
      sub.height +
      gapAfterTitle +
      progress.height +
      gapAfterTitle +
      cards.length * cardH +
      (cards.length - 1) * cardGap +
      gapAfterTitle +
      awards.height;
    const regionTop = SPACE.md + back.height + SPACE.sm;
    const regionBottom = h - SPACE.md;
    let y = regionTop + Math.max(0, (regionBottom - regionTop - stackH) / 2);
    title.setY(y);
    y += title.height + SPACE.xs;
    sub.setY(y);
    y += sub.height + gapAfterTitle;
    progress.setY(y);
    y += progress.height + gapAfterTitle;
    for (const card of cards) {
      card.setY(y + cardH / 2);
      y += cardH + cardGap;
    }
    y += gapAfterTitle - cardGap;
    awards.setPosition(cx, y + awards.height / 2);

    this.content.push(back, title, sub, progress, ...cards, awards);
  }

  /** "Solved so far" and a bar toward the closest award still locked. */
  private buildProgress(cx: number, width: number, compact: boolean): Phaser.GameObjects.Container {
    const block = this.add.container(cx, 0);
    const label = !this.solvedLoaded
      ? 'Solved so far: \u2026'
      : this.solved > 0
        ? `Solved so far: ${this.solved}`
        : 'Solve one to start your count';
    const count = this.text(0, 0, label, compact ? 18 : 20, { weight: '800', color: PALETTE.arrow })
      .setOrigin(0.5, 0);
    block.add(count);
    let height = count.height;
    const next = this.solvedLoaded
      ? [...this.achievements.progress]
          .filter((achievement) => !achievement.unlocked && achievement.target > 0)
          .sort(
            (left, right) =>
              (left.target - left.current) / left.target - (right.target - right.current) / right.target
          )[0]
      : undefined;
    if (next) {
      const barW = Math.min(width, 260);
      const barY = height + SPACE.sm;
      const fraction = Math.max(0, Math.min(1, next.current / next.target));
      const bar = this.add.graphics();
      bar.fillStyle(0x0e2740, 1);
      bar.fillRoundedRect(-barW / 2, barY, barW, 8, 4);
      if (fraction > 0) {
        bar.fillStyle(PALETTE.waterShimmer, 0.85);
        bar.fillRoundedRect(-barW / 2, barY, Math.max(8, barW * fraction), 8, 4);
      }
      const caption = this.text(
        0,
        barY + 14,
        `Next award: ${next.title} \u00B7 ${next.current}/${next.target}`,
        12,
        { weight: '700' }
      )
        .setOrigin(0.5, 0)
        .setAlpha(0.75);
      if (caption.width > width) caption.setScale(width / caption.width);
      block.add([bar, caption]);
      height = barY + 14 + caption.height;
    }
    block.setSize(width, height);
    return block;
  }

  /** A tappable tier card: difficulty pips, name and blurb, and its count. */
  private makeTierCard(
    cx: number,
    width: number,
    height: number,
    info: TierInfo
  ): Phaser.GameObjects.Container {
    const card = this.add.container(cx, 0);
    const bg = this.add.graphics();
    const paint = (pressed: boolean): void => {
      bg.clear();
      bg.fillStyle(0x06121f, 0.28);
      bg.fillRoundedRect(-width / 2, -height / 2 + 3, width, height, 18);
      bg.fillStyle(pressed ? CARD_FILL_PRESSED : CARD_FILL, 1);
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, 18);
      bg.lineStyle(1.5, CARD_BORDER, 0.9);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 18);
    };
    paint(false);

    // Difficulty pips: one to three filled ice dots, stacked at the left.
    const pips = this.add.graphics();
    const pipX = -width / 2 + 26;
    for (let index = 0; index < 3; index++) {
      const pipY = (index - 1) * 13;
      const filled = 2 - index < info.pips;
      pips.fillStyle(filled ? PALETTE.waterShimmer : 0x0e2740, filled ? 0.95 : 1);
      pips.fillCircle(pipX, pipY, 4.5);
    }

    const textX = -width / 2 + 48;
    const name = this.text(textX, -9, info.label, 20, { display: true }).setOrigin(0, 0.5);
    const blurb = this.text(textX, 15, `${info.blurb} \u00B7 ${info.parBand}`, 12, { weight: '700' })
      .setOrigin(0, 0.5)
      .setAlpha(0.72);
    const count = this.byTier[info.tier];
    const chevron = this.text(width / 2 - 18, 0, '\u203A', 26, { weight: '800' })
      .setOrigin(0.5)
      .setAlpha(0.7);
    const solved = this.text(width / 2 - 34, 0, count > 0 ? `${count} \u2713` : '', 14, {
      weight: '800',
    })
      .setOrigin(1, 0.5)
      .setAlpha(0.85);
    const maxBlurb = width / 2 - 34 - (count > 0 ? solved.width + SPACE.sm : 0) - textX;
    if (blurb.width > maxBlurb) blurb.setScale(Math.max(0.75, maxBlurb / blurb.width));

    const zone = this.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    armTap(zone, {
      onPress: () => {
        paint(true);
        card.setScale(0.98);
      },
      onCancel: () => {
        paint(false);
        card.setScale(1);
      },
      onTap: () => {
        paint(false);
        card.setScale(1);
        fadeToScene(this, 'GameScene', { endless: { tier: info.tier } });
      },
    });
    card.add([bg, pips, name, blurb, solved, chevron, zone]);
    card.setSize(width, height);
    return card;
  }

  private showAwards(requestedPage: number): void {
    this.closeAwards();
    const w = viewWidth(this);
    const h = viewHeight(this);
    const pageSize = h < 390 ? 1 : h < 560 ? 2 : h < 720 ? 3 : 4;
    const compact = h < 500;
    const totalPages = Math.max(1, Math.ceil(this.achievements.progress.length / pageSize));
    const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
    const cardW = Math.min(460, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const cardLeft = w / 2 - cardW / 2;
    const cardTop = h / 2 - cardH / 2;
    const cardBottom = cardTop + cardH;
    const contentW = cardW - SPACE.xl * 2;
    const overlay = this.add.container(0, 0).setDepth(1000);
    this.awardsOverlay = overlay;

    const shade = this.add
      .rectangle(w / 2, h / 2, w, h, 0x05131f, 0.78)
      .setInteractive();
    const panel = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    const title = this.add
      .text(w / 2, cardTop + SPACE.xl, 'Awards', {
        fontFamily: FONT.display,
        fontSize: compact ? '22px' : '26px',
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0.5, 0);
    const summary = this.add
      .text(
        w / 2,
        title.y + title.height + SPACE.xs,
        `${this.achievements.unlocked} of ${this.achievements.total} unlocked`,
        {
          fontFamily: FONT.ui,
          fontSize: '12px',
          fontStyle: '700',
          color: PALETTE.text,
        }
      )
      .setOrigin(0.5, 0)
      .setAlpha(0.75);
    overlay.add([shade, panel, title, summary]);

    const entries = this.achievements.progress.slice(page * pageSize, (page + 1) * pageSize);
    const listTop = cardTop + (compact ? 78 : 92);
    const listBottom = cardBottom - (totalPages > 1 ? 86 : 66);
    const rowHeight = (listBottom - listTop) / pageSize;
    for (let index = 0; index < entries.length; index++) {
      const achievement = entries[index];
      const rowY = listTop + index * rowHeight;
      const name = this.add
        .text(cardLeft + SPACE.xl, rowY, achievement.title, {
          fontFamily: FONT.ui,
          fontSize: compact ? '13px' : '15px',
          fontStyle: '800',
          color: achievement.unlocked ? '#ffd166' : PALETTE.text,
          wordWrap: { width: contentW * 0.62 },
        })
        .setOrigin(0, 0);
      const progress = this.add
        .text(
          cardLeft + cardW - SPACE.xl,
          rowY,
          achievement.unlocked ? 'Unlocked' : `${achievement.current}/${achievement.target}`,
          {
            fontFamily: FONT.ui,
            fontSize: '12px',
            fontStyle: '800',
            color: achievement.unlocked ? '#ffd166' : PALETTE.text,
          }
        )
        .setOrigin(1, 0)
        .setAlpha(achievement.unlocked ? 1 : 0.72);
      const description = this.add
        .text(cardLeft + SPACE.xl, rowY + (compact ? 20 : 23), achievement.description, {
          fontFamily: FONT.ui,
          fontSize: compact ? '11px' : '12px',
          fontStyle: '600',
          color: PALETTE.text,
          wordWrap: { width: contentW },
        })
        .setOrigin(0, 0)
        .setAlpha(0.72);
      overlay.add([name, progress, description]);
    }

    const close = makePill(this, {
      label: 'Close',
      variant: 'chip',
      size: 'sm',
      x: w / 2,
      y: cardBottom - SPACE.xl,
      onClick: () => this.closeAwards(),
    });
    overlay.add(close);

    if (totalPages > 1) {
      const pageLabel = this.add
        .text(w / 2, cardBottom - 67, `${page + 1} / ${totalPages}`, {
          fontFamily: FONT.ui,
          fontSize: '12px',
          fontStyle: '700',
          color: PALETTE.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.7);
      overlay.add(pageLabel);
      if (page > 0) {
        const previous = makePill(this, {
          label: '\u2039 Prev',
          variant: 'chip',
          size: 'sm',
          x: cardLeft + SPACE.xl + 30,
          y: cardBottom - 67,
          onClick: () => this.showAwards(page - 1),
        });
        overlay.add(previous);
      }
      if (page < totalPages - 1) {
        const next = makePill(this, {
          label: 'Next \u203a',
          variant: 'chip',
          size: 'sm',
          x: cardLeft + cardW - SPACE.xl - 30,
          y: cardBottom - 67,
          onClick: () => this.showAwards(page + 1),
        });
        overlay.add(next);
      }
    }
  }

  private closeAwards(): void {
    this.awardsOverlay?.destroy(true);
    this.awardsOverlay = undefined;
  }
}
