import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { EndlessSolvedResponse, EndlessTier, EndlessTierCounts } from '../../shared/api';
import {
  PALETTE,
  FONT,
  SPACE,
  paintBackdrop,
  fadeInScene,
  fadeToScene,
  makePill,
  makeBadge,
} from '../art/theme';

type TierInfo = { tier: EndlessTier; label: string; blurb: string };

const TIERS: ReadonlyArray<TierInfo> = [
  { tier: 'easy', label: 'Easy', blurb: 'A gentle warm-up' },
  { tier: 'medium', label: 'Medium', blurb: 'A proper head-scratcher' },
  { tier: 'hard', label: 'Hard', blurb: 'For the bold' },
];

/**
 * Endless tier select: the "play more" hub after the daily. Pick a difficulty
 * and the server hands back an unlimited shuffle of fresh, solver-verified
 * puzzles from that bucket. A lifetime "Solved" banner gives a sense of
 * progression that keeps players coming back.
 */
export class EndlessScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.GameObject[] = [];
  private solved = 0;
  private byTier: EndlessTierCounts = { easy: 0, medium: 0, hard: 0 };
  private solvedLoaded = false;

  constructor() {
    super('EndlessScene');
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
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    void this.loadSolved();
  }

  private async loadSolved(): Promise<void> {
    try {
      const response = await fetch('/api/endless/stats');
      if (!response.ok) throw new Error(`stats failed: ${response.status}`);
      const data: EndlessSolvedResponse = await response.json();
      this.solved = data.solved;
      this.byTier = data.byTier;
    } catch (error) {
      console.error(error);
    } finally {
      this.solvedLoaded = true;
      // If the player already picked a tier (scene shutting down) before this
      // request resolved, don't rebuild a dead scene - that throws and spams the
      // console.
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
        : 'Solve your first to start a streak';
    const banner = makeBadge(this, bannerLabel, 'gold', 'md');
    banner.setPosition(cx, h * 0.33);

    this.content.push(title, sub, banner);

    const ys = [0.47, 0.61, 0.75];
    TIERS.forEach((info, i) => {
      this.content.push(...this.makeTierButton(info, h * ys[i]));
    });

    const back = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    back.setPosition(SPACE.md + back.width / 2, this.menuY());
    this.content.push(back);
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
}
