import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import {
  PALETTE,
  FONT,
  SPACE,
  paintBackdrop,
  drawPenguinInto,
  fadeInScene,
  fadeToScene,
  makePill,
  measureColumn,
  stackColumn,
  PillButton,
} from '../art/theme';
import { showHowToPlay } from '../howToPlay';
import { isSoundOn, setSoundOn, playHop } from '../audio';

/** The hub: pick the daily, build a puzzle, or browse the community stream. */
export class HomeScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private soundButton!: PillButton;
  private content: Phaser.GameObjects.GameObject[] = [];
  /** The "How to play" overlay, when open (so we can close it on rebuild). */
  private rules?: Phaser.GameObjects.Container;

  constructor() {
    super('HomeScene');
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
  }

  private build(): void {
    this.content.forEach((o) => o.destroy());
    this.content = [];
    // A resize rebuilds the hub; close any open rules card so it can't linger
    // stale (it isn't tracked in `content`).
    this.rules?.destroy();
    this.rules = undefined;
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const peng = this.add.container(cx, h * 0.2);
    drawPenguinInto(this, peng, Math.min(86, w * 0.22));
    this.tweens.add({ targets: peng, y: h * 0.2 - 6, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const title = this.add
      .text(cx, h * 0.36, 'ICE HOP', {
        fontFamily: FONT.display,
        fontSize: `${Math.round(Math.min(62, w * 0.155))}px`,
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0.5);
    const tag = this.add
      .text(cx, title.y + title.height / 2 + SPACE.sm, 'Get every penguin into the water!', {
        fontFamily: FONT.ui,
        fontSize: '15px',
        fontStyle: '600',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    // Primary + secondary actions in an evenly-spaced, centred column.
    const wide = Math.min(300, w - 56);
    const play = makePill(this, {
      label: 'Play today\u2019s puzzle',
      variant: 'primary',
      size: 'lg',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'GameScene'),
    });
    const endless = makePill(this, {
      label: 'Endless puzzles',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });
    const build = makePill(this, {
      label: 'Build a puzzle',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    const mine = makePill(this, {
      label: 'My puzzles',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'MyPuzzlesScene'),
    });
    const community = makePill(this, {
      label: 'Community puzzles',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'CommunityScene'),
    });
    const buttons = [play, endless, build, mine, community];

    // Centre the button column in the space below the tagline so the gaps read
    // evenly on both tall phones and short desktop viewports.
    const gap = SPACE.md;
    const regionTop = tag.y + tag.height / 2 + SPACE.xl;
    const regionBottom = h - SPACE.xl;
    const colH = measureColumn(buttons, gap);
    const colTop = Math.max(regionTop, (regionTop + regionBottom) / 2 - colH / 2);
    stackColumn(buttons, cx, colTop, gap);

    // Sound toggle (top-right) and "How to play" (top-left) as chips. The game
    // is built to read without instructions, so "?" is a discoverable safety
    // net, not a wall.
    this.soundButton = makePill(this, {
      label: this.soundLabel(),
      variant: 'chip',
      size: 'sm',
      onClick: () => this.toggleSound(),
    });
    this.soundButton.setPosition(
      w - SPACE.md - this.soundButton.width / 2,
      SPACE.md + this.soundButton.height / 2
    );

    const help = makePill(this, {
      label: '?',
      variant: 'chip',
      size: 'sm',
      minWidth: 40,
      onClick: () => this.showRules(),
    });
    help.setPosition(SPACE.md + help.width / 2, SPACE.md + help.height / 2);

    this.content.push(peng, title, tag, ...buttons, this.soundButton, help);
  }

  private toggleSound(): void {
    const on = !isSoundOn();
    setSoundOn(on);
    this.soundButton.setLabelText(this.soundLabel());
    if (on) playHop();
  }

  private soundLabel(): string {
    return isSoundOn() ? 'Sound: on' : 'Sound: off';
  }

  /** Open the shared "How to play" overlay (the same card the play screen uses).
   *  Guarded so the "?" chip can't stack duplicates. */
  private showRules(): void {
    if (this.rules) return; // already open
    this.rules = showHowToPlay(this, () => {
      this.rules = undefined;
    });
  }
}
