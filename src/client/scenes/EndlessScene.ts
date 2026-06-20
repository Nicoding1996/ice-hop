import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { EndlessSolvedResponse, EndlessTier } from '../../shared/api';
import { PALETTE, paintBackdrop, fadeInScene, fadeToScene } from '../art/theme';

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
    this.scale.on('resize', () => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      this.build();
    });
    void this.loadSolved();
  }

  private async loadSolved(): Promise<void> {
    try {
      const response = await fetch('/api/endless/stats');
      if (!response.ok) throw new Error(`stats failed: ${response.status}`);
      const data: EndlessSolvedResponse = await response.json();
      this.solved = data.solved;
    } catch (error) {
      console.error(error);
    } finally {
      this.solvedLoaded = true;
      this.build();
    }
  }

  private build(): void {
    this.content.forEach((o) => o.destroy());
    this.content = [];
    const w = this.scale.width;
    const h = this.scale.height;

    const title = this.add
      .text(w / 2, h * 0.16, 'Endless', {
        fontFamily: 'Arial',
        fontSize: `${Math.round(Math.min(46, w * 0.12))}px`,
        fontStyle: 'bold',
        color: PALETTE.text,
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(w / 2, h * 0.25, 'Pick a level. The puzzles never run out.', {
        fontFamily: 'Arial',
        fontSize: '14px',
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
    const banner = this.add
      .text(w / 2, h * 0.33, bannerLabel, {
        fontFamily: 'Arial',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#062033',
        backgroundColor: '#ffd166',
        padding: { left: 14, right: 14, top: 7, bottom: 7 },
      })
      .setOrigin(0.5);

    this.content.push(title, sub, banner);

    const ys = [0.47, 0.61, 0.75];
    TIERS.forEach((info, i) => {
      this.content.push(...this.makeTierButton(info, h * ys[i]));
    });

    const back = this.add
      .text(44, this.menuY(), '\u2039 Menu', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: PALETTE.text,
        backgroundColor: '#1f3f59',
        padding: { left: 11, right: 11, top: 6, bottom: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => fadeToScene(this, 'HomeScene'));
    this.content.push(back);
  }

  private menuY(): number {
    return Math.min(72, this.scale.height * 0.13) / 2;
  }

  private makeTierButton(info: TierInfo, y: number): Phaser.GameObjects.GameObject[] {
    const w = this.scale.width;
    const btn = this.add
      .text(w / 2, y, info.label, {
        fontFamily: 'Arial',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#062033',
        backgroundColor: '#cfe6f2',
        padding: { left: 30, right: 30, top: 11, bottom: 11 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => fadeToScene(this, 'GameScene', { endless: { tier: info.tier } }));
    const blurb = this.add
      .text(w / 2, y + 30, info.blurb, {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: PALETTE.text,
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    return [btn, blurb];
  }
}
