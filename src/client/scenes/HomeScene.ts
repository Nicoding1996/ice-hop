import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { HubResponse } from '../../shared/api';
import { dailyPuzzleDate, formatPuzzleDate } from '../../shared/date';
import { parseHubResponse } from '../../shared/leaderboard';
import { difficultyFromPar, difficultyLabel } from '../../shared/solver/difficulty';
import {
  PALETTE,
  FONT,
  SPACE,
  armTap,
  paintBackdrop,
  drawFlame,
  drawMusicIcon,
  drawPenguinInto,
  drawRockInto,
  drawSpeakerIcon,
  drawTrophyIcon,
  fadeInScene,
  fadeToScene,
  makeIconButton,
  makePill,
  IconButton,
  useCrispRendering,
  viewHeight,
  viewWidth,
} from '../art/theme';
import { showHowToPlay } from '../howToPlay';
import { showLeaderboard } from '../leaderboard';
import {
  isSoundOn,
  setSoundOn,
  isMusicOn,
  setMusicOn,
  playHop,
  startMusic,
  clearMasterAudioMute,
} from '../audio';

type Tile = {
  readonly title: string;
  readonly sub: string;
  readonly icon: (scene: Phaser.Scene, container: Phaser.GameObjects.Container, size: number) => void;
  readonly onTap: () => void;
};

const TILE_FILL = 0x1a3a55;
const TILE_FILL_PRESSED = 0x24496a;
const TILE_BORDER = 0x35608a;
const HUB_TIMEOUT_MS = 8000;

/**
 * The hub: today's puzzle up front with the player's status and streak, then
 * the four ways to keep playing as icon tiles (Endless, Community, Build,
 * Leaderboards), and My puzzles as a quiet link.
 */
export class HomeScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private soundButton!: IconButton;
  private musicButton!: IconButton;
  private content: Phaser.GameObjects.GameObject[] = [];
  /** The "How to play" overlay, when open (so we can close it on rebuild). */
  private rules?: Phaser.GameObjects.Container;
  /** The leaderboard overlay, when open (rebuilt at the new size on resize). */
  private leaderboards?: Phaser.GameObjects.Container;
  /** Whether the open overlay shows the host post's Daily (feed link). */
  private leaderboardsHostPost = false;
  /** Read-only summary for the status line and tile subtitles. */
  private hub: HubResponse | null = null;

  constructor() {
    super('HomeScene');
  }

  create(data?: { readonly leaderboard?: boolean }): void {
    useCrispRendering(this);
    this.rules = undefined;
    this.leaderboards = undefined;
    this.hub = null;
    // The play HUD's speaker is a scene-local convenience; the hub returns to
    // the player's independently persisted channel choices without authorizing
    // music unless this expanded document already received a valid gesture.
    clearMasterAudioMute();
    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
    this.build();
    // A feed win card's "Leaderboard" link opens the hub with the board for
    // that post's Daily already showing; closing it leaves the player here.
    if (data?.leaderboard) this.showLeaderboards(true);
    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
      this.build();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    void this.loadHub();
  }

  /** Fetch the hub summary; the hub stays fully usable without it. */
  private async loadHub(): Promise<void> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
    try {
      const response = await fetch('/api/hub', { signal: controller.signal });
      if (!response.ok) return;
      const hub = parseHubResponse(await response.json());
      if (!hub || !this.sys.isActive()) return;
      this.hub = hub;
      this.build();
    } catch (error) {
      console.error(error);
    } finally {
      window.clearTimeout(timer);
    }
  }

  private text(
    x: number,
    y: number,
    value: string,
    size: number,
    style: { readonly weight?: string; readonly display?: boolean; readonly color?: string } = {}
  ): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, {
      fontFamily: style.display ? FONT.display : FONT.ui,
      fontSize: `${size}px`,
      fontStyle: style.weight ?? '700',
      color: style.color ?? PALETTE.text,
    });
  }

  private build(): void {
    this.content.forEach((o) => o.destroy());
    this.content = [];
    // A resize rebuilds the hub; close any open rules card so it can't linger
    // stale (it isn't tracked in `content`).
    this.rules?.destroy();
    this.rules = undefined;
    // An open leaderboard is rebuilt at the new size instead of dropped.
    const reopenLeaderboards = Boolean(this.leaderboards?.active);
    const reopenHostPost = this.leaderboardsHostPost;
    this.leaderboards?.destroy();
    this.leaderboards = undefined;

    const w = viewWidth(this);
    const h = viewHeight(this);
    const cx = w / 2;
    const tight = h < 560;
    const compact = h < 700;
    const wide = Math.min(320, w - 40);

    // Top bar: "?" left, SFX + Music icon toggles right (same icons as the
    // feed post). The game reads without instructions, so "?" is a safety net.
    const help = makePill(this, {
      label: '?',
      variant: 'chip',
      size: 'sm',
      minWidth: 40,
      onClick: () => this.showRules(),
    });
    help.setPosition(SPACE.md + help.width / 2, SPACE.md + help.height / 2);
    this.musicButton = makeIconButton(this, {
      variant: 'chip',
      size: 'sm',
      draw: (g, size) => drawMusicIcon(g, size, isMusicOn()),
      onClick: () => this.toggleMusic(),
    });
    this.musicButton.setPosition(w - SPACE.md - 17, SPACE.md + 17);
    this.soundButton = makeIconButton(this, {
      variant: 'chip',
      size: 'sm',
      draw: (g, size) => drawSpeakerIcon(g, size, isSoundOn()),
      onClick: () => this.toggleSound(),
    });
    this.soundButton.setPosition(this.musicButton.x - 34 - SPACE.sm, SPACE.md + 17);
    const topBarBottom = SPACE.md + 34;

    // Hero: penguin, wordmark, tagline (the penguin drops on short screens).
    const penguinSize = tight ? 0 : compact ? 60 : 82;
    const peng = this.add.container(cx, 0);
    if (penguinSize > 0) drawPenguinInto(this, peng, penguinSize);
    const title = this.text(cx, 0, 'ICE HOP', Math.round(Math.min(tight ? 40 : compact ? 50 : 62, w * 0.155)), {
      display: true,
    }).setOrigin(0.5, 0);
    const tag = this.text(cx, 0, 'Get every penguin into the water!', compact ? 14 : 15, {
      weight: '600',
    })
      .setOrigin(0.5, 0)
      .setAlpha(0.85);

    // Today's puzzle and the player's status under it.
    const play = makePill(this, {
      label: 'Play today\u2019s puzzle',
      variant: 'primary',
      size: 'lg',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    const status = this.buildStatusLine(cx);

    // Ways to keep playing, as a 2x2 grid of icon tiles.
    const hub = this.hub;
    const tiles: Tile[] = [
      {
        title: 'Endless',
        sub: hub && hub.endlessSolved > 0 ? `${hub.endlessSolved} solved` : 'Easy \u00B7 Medium \u00B7 Hard',
        icon: (scene, c, size) => drawPenguinInto(scene, c, size),
        onTap: () => fadeToScene(this, 'EndlessScene'),
      },
      {
        title: 'Community',
        sub: 'Made by players',
        icon: (scene, c, size) => {
          const back = scene.add.container(size * 0.28, -size * 0.06).setScale(0.78).setAlpha(0.8);
          drawPenguinInto(scene, back, size);
          const front = scene.add.container(-size * 0.2, size * 0.04);
          drawPenguinInto(scene, front, size);
          c.add([back, front]);
        },
        onTap: () => fadeToScene(this, 'CommunityScene'),
      },
      {
        title: 'Build',
        sub: 'Make your own',
        icon: (scene, c, size) => {
          drawRockInto(scene, c, size * 0.85);
          const plus = scene.add.graphics();
          plus.fillStyle(0x1f3f59, 1);
          plus.fillCircle(size * 0.38, -size * 0.32, size * 0.2);
          plus.lineStyle(Math.max(2, size * 0.06), PALETTE.iceHi, 1);
          plus.lineBetween(size * 0.38 - size * 0.1, -size * 0.32, size * 0.38 + size * 0.1, -size * 0.32);
          plus.lineBetween(size * 0.38, -size * 0.42, size * 0.38, -size * 0.22);
          c.add(plus);
        },
        onTap: () => fadeToScene(this, 'EditorScene'),
      },
      {
        title: 'Leaderboards',
        sub: hub && hub.rank > 0 ? `#${hub.rank} today` : 'Daily \u00B7 Week \u00B7 Streaks',
        icon: (scene, c, size) => {
          const g = scene.add.graphics();
          drawTrophyIcon(g, size * 0.9);
          c.add(g);
        },
        onTap: () => this.showLeaderboards(),
      },
    ];
    const tileGap = SPACE.sm + 2;
    const tileW = (wide - tileGap) / 2;
    const tileH = tight ? 78 : compact ? 86 : 100;
    const grid = this.add.container(cx, 0);
    tiles.forEach((tile, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = (column === 0 ? -1 : 1) * (tileW / 2 + tileGap / 2);
      const y = row * (tileH + tileGap) + tileH / 2;
      grid.add(this.makeTile(x, y, tileW, tileH, tile, compact));
    });
    const gridH = tileH * 2 + tileGap;

    const mine = makePill(this, {
      label: 'My puzzles \u203A',
      variant: 'ghost',
      size: 'sm',
      onClick: () => fadeToScene(this, 'MyPuzzlesScene'),
    });

    // Stack the groups top to bottom and centre them under the top bar.
    const heroH =
      (penguinSize > 0 ? penguinSize + SPACE.xs : 0) + title.height + SPACE.xs + tag.height;
    const gaps = compact ? [SPACE.lg, SPACE.sm, SPACE.lg, SPACE.md] : [SPACE.xl, SPACE.sm, SPACE.xl, SPACE.lg];
    const stackH =
      heroH + gaps[0] + play.height + gaps[1] + status.height + gaps[2] + gridH + gaps[3] + mine.height;
    const regionTop = topBarBottom + SPACE.sm;
    const regionBottom = h - SPACE.md;
    let y = regionTop + Math.max(0, (regionBottom - regionTop - stackH) / 2);
    if (penguinSize > 0) {
      peng.setY(y + penguinSize / 2);
      this.tweens.add({ targets: peng, y: peng.y - 6, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      y += penguinSize + SPACE.xs;
    }
    title.setY(y);
    y += title.height + SPACE.xs;
    tag.setY(y);
    y += tag.height + gaps[0];
    play.setY(y + play.height / 2).setX(cx);
    y += play.height + gaps[1];
    status.setY(y + status.height / 2);
    y += status.height + gaps[2];
    grid.setY(y);
    y += gridH + gaps[3];
    mine.setPosition(cx, y + mine.height / 2);

    this.content.push(
      peng,
      title,
      tag,
      play,
      status,
      grid,
      mine,
      this.soundButton,
      this.musicButton,
      help
    );
    if (reopenLeaderboards) this.showLeaderboards(reopenHostPost);
  }

  /**
   * One centred line under Play: today's date and difficulty, or the player's
   * verified result, then their streak with a vector flame.
   */
  private buildStatusLine(cx: number): Phaser.GameObjects.Container {
    const line = this.add.container(cx, 0);
    const hub = this.hub;
    const date = hub?.date ?? dailyPuzzleDate();
    const first = hub?.solved
      ? `Solved \u2713  ${hub.solved.moves} ${hub.solved.moves === 1 ? 'move' : 'moves'}  ${'\u2605'.repeat(hub.solved.stars)}`
      : hub?.par
        ? `${formatPuzzleDate(date, true)} \u00B7 ${difficultyLabel(difficultyFromPar(hub.par))}`
        : formatPuzzleDate(date, true);
    const parts: Phaser.GameObjects.GameObject[] = [];
    const lead = this.text(0, 0, first, 13, {
      weight: '800',
      color: hub?.solved ? PALETTE.arrow : PALETTE.text,
    }).setOrigin(0, 0.5);
    let width = lead.width;
    parts.push(lead);
    if (hub && hub.streak > 0) {
      const dot = this.text(width, 0, '  \u00B7  ', 13, { weight: '800' }).setOrigin(0, 0.5).setAlpha(0.6);
      width += dot.width;
      const flame = this.add.graphics();
      drawFlame(flame, width + 6, 0, 13);
      width += 15;
      const streak = this.text(width, 0, `${hub.streak}-day streak`, 13, { weight: '800' }).setOrigin(0, 0.5);
      width += streak.width;
      parts.push(dot, flame, streak);
    }
    line.add(parts);
    for (const part of parts) {
      if (part instanceof Phaser.GameObjects.Text || part instanceof Phaser.GameObjects.Graphics) {
        part.setX(part.x - width / 2);
      }
    }
    line.setSize(width, 18);
    line.setAlpha(hub ? 0.92 : 0.7);
    return line;
  }

  /** A rounded icon tile with press feedback that activates on release. */
  private makeTile(
    x: number,
    y: number,
    width: number,
    height: number,
    tile: Tile,
    compact: boolean
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const paint = (pressed: boolean): void => {
      bg.clear();
      bg.fillStyle(0x06121f, 0.28);
      bg.fillRoundedRect(-width / 2, -height / 2 + 3, width, height, 18);
      bg.fillStyle(pressed ? TILE_FILL_PRESSED : TILE_FILL, 1);
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, 18);
      bg.lineStyle(1.5, TILE_BORDER, 0.9);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 18);
    };
    paint(false);
    const iconSize = compact ? 30 : 38;
    const icon = this.add.container(0, -height / 2 + SPACE.sm + iconSize / 2 + 2);
    tile.icon(this, icon, iconSize);
    const title = this.text(0, height / 2 - (compact ? 30 : 36), tile.title, compact ? 14 : 15, {
      weight: '800',
    }).setOrigin(0.5);
    const sub = this.text(0, height / 2 - (compact ? 14 : 17), tile.sub, 11, { weight: '700' })
      .setOrigin(0.5)
      .setAlpha(0.7);
    if (sub.width > width - SPACE.md) sub.setScale((width - SPACE.md) / sub.width);
    const zone = this.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    armTap(zone, {
      onPress: () => {
        paint(true);
        container.setScale(0.97);
      },
      onCancel: () => {
        paint(false);
        container.setScale(1);
      },
      onTap: () => {
        paint(false);
        container.setScale(1);
        tile.onTap();
      },
    });
    container.add([bg, icon, title, sub, zone]);
    container.setSize(width, height);
    return container;
  }

  /** Open the shared leaderboard overlay (guarded so it can't stack). */
  private showLeaderboards(hostPost = false): void {
    if (this.leaderboards?.active) return;
    this.leaderboardsHostPost = hostPost;
    this.leaderboards = showLeaderboard(this, {
      tab: 'daily',
      hostPost,
      onClose: () => {
        this.leaderboards = undefined;
      },
    });
  }

  private toggleSound(): void {
    const on = !isSoundOn();
    setSoundOn(on);
    this.soundButton.refresh();
    if (on) playHop();
  }

  private toggleMusic(): void {
    const on = !isMusicOn();
    setMusicOn(on);
    if (on) startMusic(); // this expanded-view click is the authorizing gesture
    this.musicButton.refresh();
  }

  /** Open the shared "How to play" overlay (the same card the play screen uses).
   *  Guarded so the "?" chip can't stack duplicates. */
  private showRules(): void {
    if (this.rules) return; // already open
    this.rules = showHowToPlay(
      this,
      () => {
        this.rules = undefined;
      },
      () => fadeToScene(this, 'GameScene', { tutorial: { step: 0 } })
    );
  }
}
