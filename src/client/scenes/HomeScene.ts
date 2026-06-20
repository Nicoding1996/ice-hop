import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { PALETTE, paintBackdrop, drawPenguinInto, fadeInScene, fadeToScene } from '../art/theme';
import { isSoundOn, setSoundOn, playHop } from '../audio';

/** The hub: pick the daily, build a puzzle, or browse the community stream. */
export class HomeScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private soundButton!: Phaser.GameObjects.Text;
  private content: Phaser.GameObjects.GameObject[] = [];

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
      .text(w / 2, h * 0.42, 'Get the whole colony into the water.', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    const play = this.makeButton("Play today\u2019s puzzle", '#ff8a5b', '#062033', h * 0.56, true, () =>
      fadeToScene(this, 'GameScene')
    );
    const build = this.makeButton('Build a puzzle', '#cfe6f2', '#062033', h * 0.66, false, () =>
      fadeToScene(this, 'EditorScene')
    );
    const community = this.makeButton('Community puzzles', '#cfe6f2', '#062033', h * 0.74, false, () =>
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

    this.content.push(peng, title, tag, play, build, community, this.soundButton);
  }

  private soundLabel(): string {
    return isSoundOn() ? 'Sound: on' : 'Sound: off';
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
