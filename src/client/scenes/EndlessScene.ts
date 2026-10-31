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
  paintBackdrop,
  fadeInScene,
  fadeToScene,
  makePill,
  makeBadge,
  makePanel,
  useCrispText,
} from '../art/theme';

type TierInfo = { tier: EndlessTier; label: string; blurb: string };

const TIERS: ReadonlyArray<TierInfo> = [
  { tier: 'easy', label: 'Easy', blurb: 'A gentle warm-up' },
  { tier: 'medium', label: 'Medium', blurb: 'A proper head-scratcher' },
  { tier: 'hard', label: 'Hard', blurb: 'For the bold' },
];

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
    useCrispText(this);
    const generation = ++this.loadGeneration;
    this.solvedLoaded = false;
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
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.loadGeneration += 1;
    });
    void this.loadSolved(generation);
  }

  private async loadSolved(generation: number): Promise<void> {
    try {
      if (!context.username) {
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
        const unlocked: AchievementId[] =
          this.registry.get('endless.achievementIds') ?? [];
        this.achievements = buildAchievementSnapshot(
          {
            solved: this.solved,
            byTier: this.byTier,
            hardAtPar: this.registry.get('endless.hardAtPar') === true,
          },
          unlocked
        );
        this.registry.set('endless.achievements', this.achievements);
        return;
      }

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

  private build(): void {
    this.closeAwards();
    this.content.forEach((object) => object.destroy());
    this.content = [];
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const title = this.add
      .text(cx, h * 0.16, 'Endless', {
        fontFamily: FONT.display,
        fontSize: `${Math.round(Math.min(52, w * 0.14))}px`,
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(cx, title.y + title.height / 2 + SPACE.sm, 'Pick a level. The puzzles never run out.', {
        fontFamily: FONT.ui,
        fontSize: '14px',
        fontStyle: '600',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    // The progression payoff: a lifetime solved count in the gold accent.
    const bannerLabel = !this.solvedLoaded
      ? 'Solved so far: \u2026'
      : this.solved > 0
        ? `Solved so far: ${this.solved}`
        : 'Solve one to start your count';
    const banner = makeBadge(this, bannerLabel, 'gold', 'md');
    banner.setPosition(cx, h * 0.33);

    this.content.push(title, sub, banner);

    const ys = [0.47, 0.61, 0.75];
    TIERS.forEach((info, index) => {
      this.content.push(...this.makeTierButton(info, h * ys[index]));
    });

    const awards = makePill(this, {
      label: this.solvedLoaded
        ? `Awards ${this.achievements.unlocked}/${this.achievements.total}`
        : 'Awards \u2026',
      variant: 'chip',
      size: 'sm',
      x: cx,
      y: Math.min(h - SPACE.xl, h * 0.9),
      onClick: () => this.showAwards(0),
    });

    const back = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    back.setPosition(SPACE.md + back.width / 2, this.menuY());
    this.content.push(awards, back);
  }

  private menuY(): number {
    return Math.min(72, this.scale.height * 0.13) / 2;
  }

  private makeTierButton(info: TierInfo, y: number): Phaser.GameObjects.GameObject[] {
    const w = this.scale.width;
    const btn = makePill(this, {
      label: info.label,
      variant: 'secondary',
      size: 'lg',
      x: w / 2,
      y,
      minWidth: Math.min(260, w - 64),
      onClick: () => fadeToScene(this, 'GameScene', { endless: { tier: info.tier } }),
    });
    // Quietly fold the per-tier solved count into the blurb (muted, no extra
    // accent, so the gold total banner stays the one highlight). Hidden until
    // the player has a solve in this tier - which also sidesteps the migration
    // case where a pre-existing total has no per-tier history yet.
    const count = this.byTier[info.tier];
    const blurbText = count > 0 ? `${info.blurb}   \u00B7   ${count} solved` : info.blurb;
    const blurb = this.add
      .text(w / 2, y + btn.height / 2 + SPACE.sm, blurbText, {
        fontFamily: FONT.ui,
        fontSize: '12px',
        fontStyle: '600',
        color: PALETTE.text,
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    return [btn, blurb];
  }

  private showAwards(requestedPage: number): void {
    this.closeAwards();
    const w = this.scale.width;
    const h = this.scale.height;
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
