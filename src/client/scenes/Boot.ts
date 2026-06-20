import { Scene } from 'phaser';
import { initAudioPrefs } from '../audio';

// Minimal boot scene. We render the board with vector shapes (no image assets
// to preload yet), so we go straight to the game.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    initAudioPrefs();
    this.scene.start('GameScene');
  }
}
