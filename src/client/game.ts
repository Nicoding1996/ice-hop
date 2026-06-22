import * as Phaser from 'phaser';
import { AUTO, Game, Scale } from 'phaser';
import { Boot } from './scenes/Boot';
import { GameScene } from './scenes/GameScene';
import { EditorScene } from './scenes/EditorScene';
import { CommunityScene } from './scenes/CommunityScene';
import { EndlessScene } from './scenes/EndlessScene';
import { HomeScene } from './scenes/HomeScene';

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#0a2a43',
  scale: {
    mode: Scale.RESIZE,
    autoCenter: Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [Boot, GameScene, EditorScene, CommunityScene, EndlessScene, HomeScene],
};

const startGame = (parent: string): Game => new Game({ ...config, parent });

/**
 * Wait for the web fonts (Fredoka + Nunito) to load before booting Phaser, so
 * the first frame renders in the real fonts rather than the fallback (Phaser
 * does not reflow Text when a font loads later). Capped by a short timeout so a
 * blocked/slow CDN never delays the game - it just starts on the fallback stack.
 */
const ensureFonts = async (): Promise<void> => {
  if (!document.fonts?.load) return;
  const specs = [
    '500 1em Fredoka',
    '600 1em Fredoka',
    '700 1em Fredoka',
    '400 1em Nunito',
    '600 1em Nunito',
    '700 1em Nunito',
    '800 1em Nunito',
  ];
  const loaded = Promise.all(specs.map((s) => document.fonts.load(s))).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
  try {
    await Promise.race([loaded, timeout]);
  } catch {
    /* fall back to the system stacks declared in theme.ts FONT */
  }
};

document.addEventListener('DOMContentLoaded', () => {
  void ensureFonts().finally(() => startGame('game-container'));
});
