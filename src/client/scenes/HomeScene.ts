import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import {
  PALETTE,
  FONT,
  SPACE,
  paintBackdrop,
  drawPenguinInto,
  fadeInScene,
  fadeToScene,
  makePill,
  measureColumn,
  stackColumn,
  PillButton,
  useCrispText,
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

/** The hub: pick the daily, build a puzzle, or browse the community stream. */
export class HomeScene extends Scene {
  private bgLayer!: Phaser.GameObjects.Container;
  private soundButton!: PillButton;
  private musicButton!: PillButton;
  private content: Phaser.GameObjects.GameObject[] = [];
  /** The "How to play" overlay, when open (so we can close it on rebuild). */
  private rules?: Phaser.GameObjects.Container;
  /** The leaderboard overlay, when open (rebuilt at the new size on resize). */
  private leaderboards?: Phaser.GameObjects.Container;
  /** Whether the open overlay shows the host post's Daily (feed link). */
  private leaderboardsHostPost = false;

  constructor() {
    super('HomeScene');
  }

  create(data?: { readonly leaderboard?: boolean }): void {
    useCrispText(this);
    this.rules = undefined;
    this.leaderboards = undefined;
    // The play HUD's speaker is a scene-local convenience; the hub returns to
    // the player's independently persisted channel choices without authorizing
    // music unless this expanded document already received a valid gesture.
    clearMasterAudioMute();
    this.cameras.main.setBackgroundColor(PALETTE.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
    this.build();
    // A feed win card's "Leaderboard" link opens the hub with the board for
    // that post's Daily already showing; closing it leaves the player here.
    if (data?.leaderboard) this.showLeaderboards(true);
    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      this.build();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global; drop our listener on shutdown so it doesn't
    // accumulate across scene visits and fire on destroyed objects.
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
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
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;

    const peng = this.add.container(cx, h * 0.2);
    drawPenguinInto(this, peng, Math.min(86, w * 0.22));
    this.tweens.add({ targets: peng, y: h * 0.2 - 6, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const title = this.add
      .text(cx, h * 0.36, 'ICE HOP', {
        fontFamily: FONT.display,
        fontSize: `${Math.round(Math.min(62, w * 0.155))}px`,
        fontStyle: '700',
        color: PALETTE.text,
      })
      .setOrigin(0.5);
    const tag = this.add
      .text(cx, title.y + title.height / 2 + SPACE.sm, 'Get every penguin into the water!', {
        fontFamily: FONT.ui,
        fontSize: '15px',
        fontStyle: '600',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    // Primary + secondary actions in an evenly-spaced, centred column.
    const wide = Math.min(300, w - 56);
    const play = makePill(this, {
      label: 'Play today\u2019s puzzle',
      variant: 'primary',
      size: 'lg',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    const endless = makePill(this, {
      label: 'Endless puzzles',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });
    const build = makePill(this, {
      label: 'Build a puzzle',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    // My puzzles and Leaderboards share one row of half-width pills, so the
    // column keeps its height on short viewports.
    const pairGap = SPACE.sm;
    const half = (wide - pairGap) / 2;
    const mine = makePill(this, {
      label: 'My puzzles',
      variant: 'secondary',
      minWidth: half,
      onClick: () => fadeToScene(this, 'MyPuzzlesScene'),
    });
    const ranks = makePill(this, {
      label: 'Leaderboards',
      variant: 'secondary',
      minWidth: half,
      onClick: () => this.showLeaderboards(),
    });
    const pair = this.add.container(0, 0, [mine, ranks]);
    const pairWidth = mine.width + pairGap + ranks.width;
    mine.setX(-pairWidth / 2 + mine.width / 2);
    ranks.setX(pairWidth / 2 - ranks.width / 2);
    pair.setSize(pairWidth, Math.max(mine.height, ranks.height));
    const community = makePill(this, {
      label: 'Community puzzles',
      variant: 'secondary',
      minWidth: wide,
      onClick: () => fadeToScene(this, 'CommunityScene'),
    });
    const buttons = [play, endless, build, pair, community];

    // Centre the button column in the space below the tagline so the gaps read
    // evenly on both tall phones and short desktop viewports.
    const gap = SPACE.md;
    const regionTop = tag.y + tag.height / 2 + SPACE.xl;
    const regionBottom = h - SPACE.xl;
    const colH = measureColumn(buttons, gap);
    const colTop = Math.max(regionTop, (regionTop + regionBottom) / 2 - colH / 2);
    stackColumn(buttons, cx, colTop, gap);

    // Sound toggle (top-right) and "How to play" (top-left) as chips. The game
    // is built to read without instructions, so "?" is a discoverable safety
    // net, not a wall.
    this.soundButton = makePill(this, {
      label: this.soundLabel(),
      variant: 'chip',
      size: 'sm',
      onClick: () => this.toggleSound(),
    });
    this.soundButton.setPosition(
      w - SPACE.md - this.soundButton.width / 2,
      SPACE.md + this.soundButton.height / 2
    );

    // Music toggle sits just under the sound chip (top-right). On by default;
    // it eases in on the first tap (never on a feed scroll) and an explicit
    // mute is remembered across sessions.
    this.musicButton = makePill(this, {
      label: this.musicLabel(),
      variant: 'chip',
      size: 'sm',
      onClick: () => this.toggleMusic(),
    });
    this.musicButton.setPosition(
      w - SPACE.md - this.musicButton.width / 2,
      this.soundButton.y + this.soundButton.height / 2 + SPACE.sm + this.musicButton.height / 2
    );

    const help = makePill(this, {
      label: '?',
      variant: 'chip',
      size: 'sm',
      minWidth: 40,
      onClick: () => this.showRules(),
    });
    help.setPosition(SPACE.md + help.width / 2, SPACE.md + help.height / 2);

    this.content.push(peng, title, tag, ...buttons, this.soundButton, this.musicButton, help);
    if (reopenLeaderboards) this.showLeaderboards(reopenHostPost);
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
    this.soundButton.setLabelText(this.soundLabel());
    if (on) playHop();
  }

  private soundLabel(): string {
    return isSoundOn() ? 'Sound: on' : 'Sound: off';
  }

  private toggleMusic(): void {
    const on = !isMusicOn();
    setMusicOn(on);
    if (on) startMusic(); // this expanded-view click is the authorizing gesture
    this.musicButton.setLabelText(this.musicLabel());
  }

  private musicLabel(): string {
    return isMusicOn() ? 'Music: on' : 'Music: off';
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
