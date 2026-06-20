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

document.addEventListener('DOMContentLoaded', () => {
  startGame('game-container');
});
