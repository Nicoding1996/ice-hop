import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { UgcListResponse } from '../../shared/api';

const TEXT = '#eaf6fb';

/**
 * Loads the community puzzle queue and starts the "stream": it stores the queue
 * in the global registry and launches the first puzzle in GameScene. GameScene
 * handles Next/Skip/Upvote from there. If there are no puzzles, it invites the
 * player to build one.
 */
export class CommunityScene extends Scene {
  constructor() {
    super('CommunityScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0a2a43);
    const w = this.scale.width;
    const h = this.scale.height;
    const status = this.add
      .text(w / 2, h * 0.4, 'Loading community puzzles...', {
        fontFamily: 'Arial',
        fontSize: '16px',
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
        status.setText('No community puzzles yet -\nbe the first to build one!');
        this.addExitButtons();
        return;
      }
      this.registry.set('ugc.queue', subs);
      this.registry.set('ugc.index', 0);
      const first = subs[0];
      this.scene.start('GameScene', {
        community: { id: first.id, board: first.board, par: first.par, creator: first.creator },
      });
    } catch (error) {
      console.error(error);
      status.setText('Could not load community puzzles.');
      this.addExitButtons();
    }
  }

  private addExitButtons(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const build = this.add
      .text(w / 2, h * 0.56, 'Build a puzzle', {
        fontFamily: 'Arial',
        fontSize: '17px',
        color: '#062033',
        backgroundColor: '#aef0d2',
        padding: { left: 14, right: 14, top: 9, bottom: 9 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    build.on('pointerdown', () => this.scene.start('EditorScene'));
    const back = this.add
      .text(w / 2, h * 0.68, 'Back to daily', { fontFamily: 'Arial', fontSize: '16px', color: TEXT })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('GameScene'));
  }
}
