import { Scene } from 'phaser';
import { initAudioPrefs } from '../audio';
import { takeLaunchRoute } from '../expandedLaunch';

// Minimal boot scene. We render the board with vector shapes (no image assets
// to preload yet), so we go straight to the game.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    initAudioPrefs();
    // Splash actions can stash a one-shot destination before expanding;
    // expandedLaunch consumed it before Phaser loaded (it decides whether the
    // host puzzle was prefetched), and hands it over here once.
    const launch = takeLaunchRoute();
    if (launch === 'build') this.scene.start('EditorScene', {});
    else if (launch === 'home') this.scene.start('HomeScene', {});
    else if (launch === 'leaderboard') this.scene.start('HomeScene', { leaderboard: true });
    else if (launch === 'endless') this.scene.start('EndlessScene', {});
    else this.scene.start('GameScene', {});
  }
}
