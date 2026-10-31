import { Scene } from 'phaser';
import { context } from '@devvit/web/client';
import { initAudioPrefs } from '../audio';

// Minimal boot scene. We render the board with vector shapes (no image assets
// to preload yet), so we go straight to the game.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    initAudioPrefs();
    // Splash actions can stash a one-shot destination before expanding. Scope
    // it to this Reddit tab and host post so another card/tab cannot reroute us.
    const launchStorageKey =
      typeof context.postId === 'string' && context.postId.length > 0
        ? `icehop.launch:${context.postId}`
        : 'icehop.launch:no-post';
    let launch: string | null = null;
    try {
      launch = sessionStorage.getItem(launchStorageKey);
      if (launch) sessionStorage.removeItem(launchStorageKey);
    } catch {
      /* sessionStorage unavailable - just play the post */
    }
    if (launch === 'build') this.scene.start('EditorScene', {});
    else if (launch === 'home') this.scene.start('HomeScene', {});
    else if (launch === 'leaderboard') this.scene.start('HomeScene', { leaderboard: true });
    else if (launch === 'endless') this.scene.start('EndlessScene', {});
    else this.scene.start('GameScene', {});
  }
}
