import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { UgcListResponse } from '../../shared/api';
import {
  PALETTE,
  FONT,
  paintBackdrop,
  drawPenguinInto,
  fadeInScene,
  fadeToScene,
  makePill,
} from '../art/theme';

const TEXT = '#eaf6fb';

/**
 * Loads the community puzzle stream and hands off to GameScene. The server
 * already filters out puzzles the player has solved and interleaves popular +
 * fresh ones, so this scene just kicks off the first puzzle. If there are none,
 * it warmly invites the player to build one.
 */
export class CommunityScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;

  constructor() {
    super('CommunityScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);

    const w = this.scale.width;
    const h = this.scale.height;
    const status = this.add
      .text(w / 2, h * 0.46, 'Loading community puzzles\u2026', {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '600',
        color: TEXT,
        align: 'center',
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5);
    void this.loadAndStart(status);
  }

  private async loadAndStart(status: Phaser.GameObjects.Text): Promise<void> {
    try {
      const response = await fetch('/api/ugc/list');
      if (!response.ok) throw new Error(`list failed: ${response.status}`);
      const data: UgcListResponse = await response.json();
      const subs = data.submissions;
      if (subs.length === 0) {
        status.setText('No community puzzles yet.\nBe the first to build one!');
        this.showEmptyState();
        return;
      }
      this.registry.set('ugc.queue', subs);
      this.registry.set('ugc.index', 0);
      const first = subs[0];
      fadeToScene(this, 'GameScene', {
        community: {
          id: first.id,
          board: first.board,
          par: first.par,
          creator: first.creator,
          votes: first.votes,
          solves: first.solves,
        },
      });
    } catch (error) {
      console.error(error);
      status.setText('Could not load community puzzles.');
      this.showEmptyState();
    }
  }

  private showEmptyState(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    // A friendly penguin above the call to action.
    const peng = this.add.container(w / 2, h * 0.3);
    drawPenguinInto(this, peng, 64);

    makePill(this, {
      label: 'Build a puzzle',
      variant: 'primary',
      x: w / 2,
      y: h * 0.58,
      onClick: () => fadeToScene(this, 'EditorScene'),
    });

    makePill(this, {
      label: 'Back to daily',
      variant: 'ghost',
      size: 'sm',
      x: w / 2,
      y: h * 0.69,
      onClick: () => fadeToScene(this, 'GameScene'),
    });
  }
}
