import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { PALETTE, paintBackdrop, drawPenguinInto, fadeInScene, fadeToScene } from '../art/theme';
import { showHowToPlay } from '../howToPlay';
import { isSoundOn, setSoundOn, playHop } from '../audio';

/** The hub: pick the daily, build a puzzle, or browse the community stream. */
export class HomeScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private soundButton!: Phaser.GameObjects.Text;
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
    this.scale.on('resize', () => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      this.build();
    });
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

    const peng = this.add.container(w / 2, h * 0.2);
    drawPenguinInto(this, peng, Math.min(86, w * 0.22));
    this.tweens.add({ targets: peng, y: h * 0.2 - 6, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const title = this.add
      .text(w / 2, h * 0.34, 'ICE HOP', {
        fontFamily: 'Arial',
        fontSize: `${Math.round(Math.min(54, w * 0.14))}px`,
        fontStyle: 'bold',
        color: PALETTE.text,
      })
      .setOrigin(0.5);
    const tag = this.add
      .text(w / 2, h * 0.42, 'Get every penguin into the water!', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    const play = this.makeButton("Play today\u2019s puzzle", '#ff8a5b', '#062033', h * 0.53, true, () =>
      fadeToScene(this, 'GameScene')
    );
    const endless = this.makeButton('Endless puzzles', '#cfe6f2', '#062033', h * 0.63, false, () =>
      fadeToScene(this, 'EndlessScene')
    );
    const build = this.makeButton('Build a puzzle', '#cfe6f2', '#062033', h * 0.71, false, () =>
      fadeToScene(this, 'EditorScene')
    );
    const community = this.makeButton('Community puzzles', '#cfe6f2', '#062033', h * 0.79, false, () =>
      fadeToScene(this, 'CommunityScene')
    );

    this.soundButton = this.add
      .text(w - 14, 14, this.soundLabel(), {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: PALETTE.text,
        backgroundColor: '#1f3f59',
        padding: { left: 9, right: 9, top: 5, bottom: 5 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.soundButton.on('pointerdown', () => {
      const on = !isSoundOn();
      setSoundOn(on);
      this.soundButton.setText(this.soundLabel());
      if (on) playHop();
    });

    // Optional "How to play" entry point (top-left). The game is built to read
    // without instructions, so this is a discoverable safety net, not a wall.
    const help = this.add
      .text(14, 14, '?', {
        fontFamily: 'Arial',
        fontSize: '15px',
        fontStyle: 'bold',
        color: PALETTE.text,
        backgroundColor: '#1f3f59',
        padding: { left: 12, right: 12, top: 5, bottom: 5 },
      })
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    help.on('pointerdown', () => this.showRules());

    this.content.push(peng, title, tag, play, endless, build, community, this.soundButton, help);
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

  private makeButton(
    label: string,
    bg: string,
    fg: string,
    y: number,
    big: boolean,
    onClick: () => void
  ): Phaser.GameObjects.Text {
    const btn = this.add
      .text(this.scale.width / 2, y, label, {
        fontFamily: 'Arial',
        fontSize: big ? '19px' : '16px',
        fontStyle: big ? 'bold' : 'normal',
        color: fg,
        backgroundColor: bg,
        padding: { left: big ? 26 : 18, right: big ? 26 : 18, top: big ? 12 : 9, bottom: big ? 12 : 9 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', onClick);
    return btn;
  }
}
