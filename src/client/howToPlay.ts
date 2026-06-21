import * as Phaser from 'phaser';
import { PALETTE, drawPenguinInto, drawSealInto, drawRockInto } from './art/theme';

/**
 * Shared "How to play" overlay, used by both the hub and the play screen so a
 * first-time player (who lands straight on the daily, never the menu) can still
 * learn the rules. A dimmed, tappable backdrop behind a rounded card; each rule
 * is paired with the actual vector piece it describes (penguin / seal / rock)
 * plus a water dot for the goal, so it reads at a glance and matches the art.
 *
 * Returns the overlay container so the caller can guard against opening twice
 * and tear it down on resize. `onClose` fires after the dismiss animation.
 */
export const showHowToPlay = (
  scene: Phaser.Scene,
  onClose?: () => void
): Phaser.GameObjects.Container => {
  const w = scene.scale.width;
  const h = scene.scale.height;

  const layer = scene.add.container(0, 0).setDepth(1000);

  // Dimmed, tappable backdrop. With Phaser's default topOnly input, this also
  // shields the board behind it from stray taps while the card is open.
  const dim = scene.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.84).setInteractive();

  // The card: panel + content, scaled together for the pop-in.
  const card = scene.add.container(w / 2, h / 2);
  const panelW = Math.min(380, w - 32);
  const panelH = Math.min(452, h - 44);

  const panel = scene.add.graphics();
  panel.fillStyle(0x123047, 0.98);
  panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);
  panel.lineStyle(2, 0x2f5c7a, 1);
  panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);
  card.add(panel);

  const title = scene.add
    .text(0, -panelH / 2 + 30, 'How to play', {
      fontFamily: 'Arial',
      fontSize: '22px',
      fontStyle: 'bold',
      color: PALETTE.text,
    })
    .setOrigin(0.5);
  card.add(title);

  const iconX = -panelW / 2 + 42;
  const textX = -panelW / 2 + 74;
  const textW = panelW - 74 - 20;
  const rowsTop = -panelH / 2 + 84;
  const rowsBottom = panelH / 2 - 82;
  const rowGap = (rowsBottom - rowsTop) / 3;

  const addLabel = (y: number, text: string, bold = false): void => {
    const label = scene.add
      .text(textX, y, text, {
        fontFamily: 'Arial',
        fontSize: '14px',
        fontStyle: bold ? 'bold' : 'normal',
        color: PALETTE.text,
        align: 'left',
        lineSpacing: 3,
        wordWrap: { width: textW },
      })
      .setOrigin(0, 0.5);
    card.add(label);
  };

  const addPieceIcon = (
    y: number,
    draw: (s: Phaser.Scene, c: Phaser.GameObjects.Container, size: number) => void,
    size: number
  ): void => {
    const icon = scene.add.container(iconX, y);
    draw(scene, icon, size);
    card.add(icon);
  };

  // Rule rows, each paired with the real piece it describes.
  addPieceIcon(rowsTop, drawPenguinInto, 34);
  addLabel(rowsTop, 'Tap a penguin to hop over one or more pieces in a row, into the empty space beyond. It only moves by jumping, and can hop out of the water again.');

  addPieceIcon(rowsTop + rowGap, (s, c, size) => drawSealInto(s, c, size, 'H'), 22);
  addLabel(rowsTop + rowGap, 'Drag a seal to slide it along its lane. It blocks the way but won\u2019t slide into the water.');

  addPieceIcon(rowsTop + rowGap * 2, drawRockInto, 30);
  addLabel(rowsTop + rowGap * 2, 'Ice rocks never move. Penguins hop over them; seals can\u2019t pass.');

  // Goal row: a faint divider, a water dot, and the win condition.
  const goalY = rowsTop + rowGap * 3;
  const divider = scene.add.graphics();
  divider.lineStyle(1, 0x2f5c7a, 0.6);
  divider.lineBetween(-panelW / 2 + 28, goalY - rowGap * 0.42, panelW / 2 - 28, goalY - rowGap * 0.42);
  card.add(divider);

  const water = scene.add.graphics();
  water.fillStyle(PALETTE.water, 1);
  water.fillCircle(iconX, goalY, 15);
  water.lineStyle(3, PALETTE.waterRing, 1);
  water.strokeCircle(iconX, goalY, 15);
  water.fillStyle(PALETTE.waterShimmer, 0.45);
  water.fillEllipse(iconX - 4, goalY - 4, 10, 5);
  card.add(water);
  addLabel(goalY, 'Get every penguin into the water at the same time to win. The fewer moves, the more stars.', true);

  const close = scene.add
    .text(0, panelH / 2 - 34, 'Got it', {
      fontFamily: 'Arial',
      fontSize: '17px',
      fontStyle: 'bold',
      color: '#062033',
      backgroundColor: '#ff8a5b',
      padding: { left: 26, right: 26, top: 10, bottom: 10 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  card.add(close);

  let closed = false;
  const dismiss = (): void => {
    if (closed) return;
    closed = true;
    scene.tweens.add({
      targets: layer,
      alpha: 0,
      duration: 140,
      ease: 'Quad.easeIn',
      onComplete: () => {
        layer.destroy();
        onClose?.();
      },
    });
  };
  dim.on('pointerdown', dismiss);
  close.on(
    'pointerdown',
    (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      dismiss();
    }
  );

  layer.add([dim, card]);
  layer.setAlpha(0);
  card.setScale(0.94);
  scene.tweens.add({ targets: layer, alpha: 1, duration: 160, ease: 'Quad.easeOut' });
  scene.tweens.add({ targets: card, scale: 1, duration: 220, ease: 'Back.easeOut' });

  return layer;
};
