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
    // The splash's "Build" button stashes an intent here before expanding the
    // view (the inline splash and expanded game share the app's webview origin,
    // so localStorage carries across). Read it once and clear it so a stale flag
    // can't misroute a later launch; default to playing the current post.
    let launch: string | null = null;
    try {
      launch = localStorage.getItem('icehop.launch');
      if (launch) localStorage.removeItem('icehop.launch');
    } catch {
      /* localStorage unavailable - just play the post */
    }
    if (launch === 'build') this.scene.start('EditorScene');
    else this.scene.start('GameScene');
  }
}
