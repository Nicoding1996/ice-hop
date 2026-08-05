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
    // Splash actions can stash a one-shot destination before expanding. The
    // inline splash and expanded game share the app's webview origin, so
    // localStorage carries across. Clear it immediately so later launches
    // cannot inherit stale navigation; default to playing the current post.
    let launch: string | null = null;
    try {
      launch = localStorage.getItem('icehop.launch');
      if (launch) localStorage.removeItem('icehop.launch');
    } catch {
      /* localStorage unavailable - just play the post */
    }
    if (launch === 'build') this.scene.start('EditorScene', {});
    else if (launch === 'home') this.scene.start('HomeScene', {});
    else this.scene.start('GameScene', {});
  }
}
