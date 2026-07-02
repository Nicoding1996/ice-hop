import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { Board, Move, Piece } from '../../shared/game/types';
import type {
  EndlessResponse,
  EndlessSolvedResponse,
  EndlessTier,
  InitResponse,
  LeaderboardResponse,
  SolveResultDTO,
  UgcListResponse,
  UgcSubmission,
  VoteResponse,
} from '../../shared/api';
import { legalMoves } from '../../shared/game/moves';
import { applyMove, isSolved } from '../../shared/game/rules';
import { computeStars } from '../../shared/scoring';
import { buildShareText } from '../../shared/share';
import { solve } from '../../shared/solver/solver';
import {
  PALETTE as COLORS,
  FONT,
  SPACE,
  paintBackdrop,
  paintIceSheet,
  makeWaterHole,
  drawPenguinInto,
  drawPenguinSwimmingInto,
  drawSealInto,
  drawRockInto,
  splashBurst,
  sparkleBurst,
  auroraFlourish,
  fadeInScene,
  fadeToScene,
  makePill,
  makeBadge,
  makePanel,
  stackColumn,
  PillButton,
  IconButton,
  makeIconButton,
  drawSpeakerIcon,
} from '../art/theme';
import { context, showLoginPrompt, showShareSheet, showToast } from '@devvit/web/client';
import { isAnyAudioOn, playHop, playSlide, playSplash, playWin, setAllAudioOn } from '../audio';
import { showHowToPlay } from '../howToPlay';

type DragState = {
  pieceIndex: number;
  orient: 'H' | 'V';
  originX: number;
  originY: number;
  min: number;
  max: number;
  targets: { coord: number; move: Move }[];
};

export class GameScene extends Scene {
  private board?: Board;
  private pieces: Piece[] = [];
  private par = 0;
  private moves = 0;
  private date = '';
  private selected: number | null = null;
  private busy = false;
  private won = false;
  /** Whether the player has already posted their score to this post's comment
   *  thread (so "Comment my score" can't double-post). Reset for each puzzle. */
  private scorePosted = false;
  /** Whether the puzzle on screen came straight from the host post, so its
   *  thread, par and creator match context.postId. True only for a non-forced
   *  /api/init load; gates "Comment my score" so it can never post a mismatched
   *  comment after the player navigates to a different puzzle in the same
   *  webview (Next, a hub community puzzle, or a forced daily inside a UGC post). */
  private isHostPostPuzzle = false;
  private startTime = 0;
  private shareText = '';
  /** Whether we've recorded the viewer as subscribed (drives the Join CTA). */
  private subscribed = false;
  /** Current subreddit name, for the "Join r/{name}" CTA label. */
  private subredditName = '';
  private menuButton!: PillButton;
  private communityPuzzle?: { id: string; board: Board; par: number; creator: string; votes: number; solves: number };
  private isCommunity = false;
  private testBoard?: Board;
  private testPar = 0;
  private isTest = false;
  /** When set, load today's daily explicitly (via /api/init?daily=1) instead of
   *  the current post's puzzle - so the hub can reach the daily even from inside
   *  a community-puzzle post (where the post maps to a UGC puzzle). */
  private forceDaily = false;
  private isEndless = false;
  private endlessTier: EndlessTier = 'easy';
  private endlessSolved = 0;
  private endlessBanner!: PillButton;
  private skipButton!: PillButton;
  private resetButton!: PillButton;
  private hintButton!: PillButton;
  private helpButton!: PillButton;
  private muteButton!: IconButton;
  /** The shared "How to play" overlay, when open (guards against stacking). */
  private howTo?: Phaser.GameObjects.Container;
  private hintLayer!: Phaser.GameObjects.Container;
  private hintStage = 0;
  private hintUsed = false;
  private dragState: DragState | null = null;

  private bgLayer!: Phaser.GameObjects.Container;
  private boardLayer!: Phaser.GameObjects.Container;
  private pieceLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;
  private hudText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private loadingText!: Phaser.GameObjects.Text;
  private loadErrorViews: Phaser.GameObjects.GameObject[] = [];
  private pieceViews: Phaser.GameObjects.Container[] = [];

  private cell = 0;
  private originX = 0;
  private originY = 0;
  private hudHeight = 0;
  /** Vertical band reserved for the async score/leaderboard block on the daily
   *  win screen, between the result cluster and the bottom button stack. */
  private winStatusTop = 0;
  private winStatusBottom = 0;

  constructor() {
    super('GameScene');
  }

  init(data?: {
    community?: { id: string; board: Board; par: number; creator: string; votes: number; solves: number };
    test?: { board: Board; par: number };
    endless?: { tier: EndlessTier };
    daily?: boolean;
  }): void {
    this.communityPuzzle = data?.community;
    this.isCommunity = Boolean(data?.community);
    this.testBoard = data?.test?.board;
    this.testPar = data?.test?.par ?? 0;
    this.isTest = Boolean(data?.test);
    this.isEndless = Boolean(data?.endless);
    this.endlessTier = data?.endless?.tier ?? 'easy';
    this.forceDaily = Boolean(data?.daily);
    this.scorePosted = false;
    this.isHostPostPuzzle = false;
    this.endlessSolved = 0;
    // Scene instances are reused across restarts, so reset transient state here.
    this.pieces = [];
    this.moves = 0;
    this.selected = null;
    this.busy = false;
    this.won = false;
    this.dragState = null;
    this.shareText = '';
    this.hintStage = 0;
    this.hintUsed = false;
    this.howTo = undefined;
    this.loadErrorViews = [];
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
    this.boardLayer = this.add.container(0, 0);
    this.pieceLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.hintLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    this.hudText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '20px', fontStyle: '800', color: COLORS.text })
      .setOrigin(0.5);
    this.hintText = this.add
      .text(0, 0, 'Tap a penguin to hop, drag a seal to slide.\nGet every penguin into the water.', {
        fontFamily: FONT.ui,
        fontSize: '13px',
        fontStyle: '600',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 3,
        wordWrap: { width: this.scale.width - 24 },
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    this.uiLayer.add([this.hudText, this.hintText]);

    this.menuButton = makePill(this, {
      label: this.isTest ? '\u2039 Edit' : '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, this.isTest ? 'EditorScene' : 'HomeScene'),
    });
    this.uiLayer.add(this.menuButton);

    this.skipButton = makePill(this, {
      label: 'Skip \u25B6',
      variant: 'chip',
      size: 'sm',
      onClick: () => void this.nextCommunity(),
    });
    this.uiLayer.add(this.skipButton);

    // Endless progression banner (top-right): lifetime puzzles solved.
    this.endlessBanner = makeBadge(this, 'Solved: 0', 'gold', 'sm');
    this.uiLayer.add(this.endlessBanner);

    // Restart the current board (bottom strip). Only relevant once a move has
    // been made, so it stays hidden on a fresh board and swaps in for the hint.
    this.resetButton = makePill(this, {
      label: '\u21BA Restart',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.resetPuzzle(),
    });
    this.uiLayer.add(this.resetButton);

    // Hint (Endless only): reveals the solver's best next move. Lives next to
    // Restart in the bottom strip; using it means the solve won't count.
    this.hintButton = makePill(this, {
      label: 'Hint',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.showHint(),
    });
    this.uiLayer.add(this.hintButton);

    // "?" help chip (top-right). Shown on the daily/test screen, where a
    // first-time player lands (Boot opens GameScene directly, so they never see
    // the hub's "?"). Opens the same shared How-to-play card.
    this.helpButton = makePill(this, {
      label: '?',
      variant: 'chip',
      size: 'sm',
      minWidth: 40,
      onClick: () => this.openHowTo(),
    });
    this.uiLayer.add(this.helpButton);

    // Master mute (top-left, beside Menu). Feed-first players land straight on
    // the board and never see the hub's sound/music toggles, so this compact
    // speaker icon gives them a one-tap way to silence everything (SFX + music).
    this.muteButton = makeIconButton(this, {
      variant: 'chip',
      size: 'sm',
      draw: (g, size) => drawSpeakerIcon(g, size, isAnyAudioOn()),
      onClick: () => this.toggleMute(),
    });
    this.uiLayer.add(this.muteButton);

    // Tapping empty ice clears the current selection.
    this.input.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (!this.busy && !this.won && currentlyOver.length === 0 && this.selected !== null) {
          this.selected = null;
          this.renderHighlights();
        }
      }
    );

    // Seal dragging.
    this.input.on('dragstart', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) =>
      this.onSealDragStart(obj)
    );
    this.input.on(
      'drag',
      (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number) =>
        this.onSealDrag(obj, dragX, dragY)
    );
    this.input.on('dragend', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) =>
      this.onSealDragEnd(obj)
    );

    const onResize = (): void => {
      paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
      if (this.loadingText) this.loadingText.setPosition(this.scale.width / 2, this.scale.height / 2);
      if (!this.board) return;
      this.layout();
      this.renderBoard();
      this.updateHud();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global and outlives the scene, so a listener left
    // attached would pile up on every scene (re)start - endless restarts this
    // same scene on each "Next" - firing stale handlers on destroyed objects.
    // Remove it when the scene shuts down.
    this.events.once('shutdown', () => this.scale.off('resize', onResize));

    // Hide the UI behind a calm loading state until the board is ready, so the
    // half-built frame (empty backdrop + unpositioned HUD) never flashes.
    this.uiLayer.setVisible(false);
    this.loadingText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Getting the penguins ready\u2026', {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '600',
        color: COLORS.text,
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    void this.loadPuzzle();
  }

  private async loadPuzzle(): Promise<void> {
    this.clearLoadError();
    if (this.isTest && this.testBoard) {
      this.board = this.testBoard;
      this.pieces = this.testBoard.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = this.testPar;
      this.date = '';
      this.moves = 0;
      this.startTime = Date.now();
      this.layout();
      this.renderBoard();
      this.updateHud();
      return;
    }
    if (this.communityPuzzle) {
      this.board = this.communityPuzzle.board;
      this.pieces = this.communityPuzzle.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = this.communityPuzzle.par;
      this.date = '';
      this.moves = 0;
      this.startTime = Date.now();
      this.layout();
      this.renderBoard();
      this.updateHud();
      return;
    }
    if (this.isEndless) {
      try {
        const { data, fromPrefetch } = await this.takeOrFetchEndless();
        this.board = data.board;
        this.pieces = data.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
        this.par = data.par;
        // On a fresh fetch the server count is authoritative; on a prefetched
        // board it predates this session's solves, so prefer the locally tracked
        // count (kept in the registry, updated on every solve).
        if (fromPrefetch) {
          const known = this.registry.get('endless.solved');
          this.endlessSolved = typeof known === 'number' ? known : data.solved;
        } else {
          this.endlessSolved = data.solved;
        }
        this.registry.set('endless.solved', this.endlessSolved);
        this.date = '';
        this.moves = 0;
        this.startTime = Date.now();
        this.layout();
        this.renderBoard();
        this.updateHud();
        // Warm the next puzzle in the background so "Next" is instant. The short
        // delay avoids competing with this board's first render and skips the
        // fetch if the player immediately bounces.
        this.time.delayedCall(500, () => this.prefetchNextEndless());
      } catch (error) {
        console.error(error);
        this.showLoadError('Could not load an endless puzzle.');
      }
      return;
    }
    try {
      const url = this.forceDaily ? '/api/init?daily=1' : '/api/init';
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) throw new Error(`init failed: ${response.status}`);
      const data: InitResponse = await response.json();
      // The puzzle matches the host post (its thread, par and creator) only on a
      // non-forced load. A forced daily (?daily=1) reached from inside a UGC post
      // must NOT be treated as the host post's own puzzle.
      this.isHostPostPuzzle = !this.forceDaily;
      if (data.kind === 'ugc') {
        // This post *is* a community puzzle: play it as one, so winning offers
        // Upvote / Next / Back to daily and the solve is recorded + credited to
        // its maker (the same flow as the in-app community stream).
        this.isCommunity = true;
        this.communityPuzzle = { ...data.puzzle };
        this.subredditName = data.subredditName ?? '';
        this.board = data.puzzle.board;
        this.pieces = data.puzzle.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
        this.par = data.puzzle.par;
        this.date = '';
        this.moves = 0;
        this.startTime = Date.now();
        this.layout();
        this.renderBoard();
        this.updateHud();
        return;
      }
      this.board = data.board;
      this.pieces = data.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = data.par;
      this.date = data.date;
      this.subscribed = data.subscribed;
      this.subredditName = data.subredditName ?? '';
      this.moves = 0;
      this.startTime = Date.now();
      this.layout();
      this.renderBoard();
      this.updateHud();
      if (data.solved) this.showDailySolvedRecap(data.solvedResult);
      else this.maybeAutoShowHowTo();
    } catch (error) {
      console.error(error);
      this.showLoadError('Could not load today\u2019s puzzle.');
    }
  }

  /** Show a recovery UI when a puzzle fails to load, so a network/API error is
   *  never a dead end: the player can retry or head back to the hub. */
  private showLoadError(message: string): void {
    this.clearLoadError();
    if (this.loadingText) this.loadingText.setText(message).setVisible(true);
    const w = this.scale.width;
    const h = this.scale.height;
    const retry = makePill(this, {
      label: 'Try again',
      variant: 'primary',
      x: w / 2,
      y: h * 0.56,
      onClick: () => {
        if (this.loadingText) this.loadingText.setText('Getting the penguins ready\u2026');
        this.clearLoadError();
        void this.loadPuzzle();
      },
    });
    const menu = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      x: w / 2,
      y: h * 0.56 + SPACE.xxl,
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    this.loadErrorViews.push(retry, menu);
  }

  private clearLoadError(): void {
    for (const v of this.loadErrorViews) v.destroy();
    this.loadErrorViews = [];
  }

  /** Open the shared How-to-play overlay (guarded against stacking). */
  private openHowTo(): void {
    if (this.howTo) return;
    this.howTo = showHowToPlay(this, () => {
      this.howTo = undefined;
    });
  }

  /** Show the rules once for a first-time player. They land on the daily (Boot
   *  opens GameScene directly), so this is their first touch-point; a
   *  localStorage flag means returning players drop straight into the board. */
  private maybeAutoShowHowTo(): void {
    if (this.isEndless || this.isCommunity || this.isTest) return;
    let seen = false;
    try {
      seen = localStorage.getItem('icehop.howto.seen') === '1';
    } catch {
      /* localStorage unavailable - just skip the one-time intro */
    }
    if (seen) return;
    try {
      localStorage.setItem('icehop.howto.seen', '1');
    } catch {
      /* ignore */
    }
    this.openHowTo();
  }

  /** Use a prefetched endless puzzle if one is warmed for this tier, else fetch. */
  private async takeOrFetchEndless(): Promise<{ data: EndlessResponse; fromPrefetch: boolean }> {
    const stash: EndlessResponse | undefined = this.registry.get('endless.prefetch');
    if (stash && stash.tier === this.endlessTier && stash.board) {
      this.registry.remove('endless.prefetch');
      return { data: stash, fromPrefetch: true };
    }
    // A stash for a different tier is stale (the player changed level) - drop it.
    if (stash) this.registry.remove('endless.prefetch');
    const data = await this.fetchEndless(this.endlessTier);
    return { data, fromPrefetch: false };
  }

  /** fetch() with an abort timeout, so a stalled request fails fast (-> the
   *  load-error recovery UI) instead of leaving the player on the loading screen
   *  forever. */
  private async fetchWithTimeout(url: string, timeoutMs = 12_000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchEndless(tier: EndlessTier): Promise<EndlessResponse> {
    const response = await this.fetchWithTimeout(`/api/endless?tier=${encodeURIComponent(tier)}`);
    if (!response.ok) throw new Error(`endless failed: ${response.status}`);
    const data: EndlessResponse = await response.json();
    return data;
  }

  /** Fetch the next puzzle for the current tier and stash it so "Next" is instant. */
  private prefetchNextEndless(): void {
    if (!this.isEndless) return;
    const existing: EndlessResponse | undefined = this.registry.get('endless.prefetch');
    if (existing && existing.tier === this.endlessTier) return; // already warmed
    const tier = this.endlessTier;
    void this.fetchEndless(tier)
      .then((data) => this.registry.set('endless.prefetch', data))
      .catch((error) => console.error(error));
  }

  private layout(): void {
    if (!this.board) return;
    const w = this.scale.width;
    const h = this.scale.height;
    // The top band holds two rows - a chrome row (Menu / mute / help|banner|skip)
    // and a dedicated Moves/Par readout beneath it - so it's a touch taller than
    // a single row.
    this.hudHeight = Math.min(84, Math.max(72, h * 0.14));
    // Reserve a strip at the bottom for the hint / breathing room so the board
    // never sits under it (was clipping the hint on large/desktop screens).
    const bottomStrip = 50;
    const pad = 16;
    const availW = w - pad * 2;
    const regionH = h - this.hudHeight - bottomStrip;
    const availH = regionH - pad * 2;
    this.cell = Math.max(24, Math.floor(Math.min(availW / this.board.width, availH / this.board.height)));
    const gridW = this.cell * this.board.width;
    const gridH = this.cell * this.board.height;
    this.originX = (w - gridW) / 2;
    this.originY = this.hudHeight + (regionH - gridH) / 2;
  }

  private cellCenter(index: number): { x: number; y: number } {
    if (!this.board) return { x: 0, y: 0 };
    const row = Math.floor(index / this.board.width);
    const col = index % this.board.width;
    return {
      x: this.originX + col * this.cell + this.cell / 2,
      y: this.originY + row * this.cell + this.cell / 2,
    };
  }

  private pieceCenterPx(cells: readonly number[]): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      const p = this.cellCenter(c);
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / cells.length, y: sy / cells.length };
  }

  private renderBoard(): void {
    if (!this.board) return;
    this.boardLayer.removeAll(true);
    this.pieceLayer.removeAll(true);
    this.pieceViews = [];
    const s = this.cell;
    const holes = new Set(this.board.holes);

    // One connected ice sheet under the whole grid (not loose tiles).
    paintIceSheet(this, this.boardLayer, this.originX, this.originY, this.board.width, this.board.height, s);
    // Carve the water holes into the sheet.
    for (const hole of holes) {
      const { x, y } = this.cellCenter(hole);
      this.boardLayer.add(makeWaterHole(this, x, y, s));
    }

    this.pieces.forEach((piece, idx) => {
      const { x, y } = this.pieceCenterPx(piece.cells);
      const container = this.add.container(x, y);
      // Inner art node: idle/move animation lives here so the outer container is
      // free to own position, hit-area, and dragging.
      const art = this.add.container(0, 0);
      container.add(art);
      container.setData('art', art);

      if (piece.kind === 'HOPPER') {
        this.makeSelectable(container, s * 0.82, s * 0.82, idx);
      } else if (piece.kind === 'SLIDER') {
        const orient = piece.orient ?? 'H';
        const w = orient === 'H' ? s * 1.8 : s * 0.82;
        const hgt = orient === 'H' ? s * 0.82 : s * 1.8;
        this.makeSelectable(container, w, hgt, idx);
        container.setData('pieceIndex', idx);
        container.setData('slider', true);
        this.input.setDraggable(container);
      }
      this.pieceLayer.add(container);
      this.pieceViews[idx] = container;
      this.buildPieceArt(container, piece, idx);
    });

    this.renderHighlights();
  }

  /** Start the gentle idle breathing bob on a piece's art node. */
  private startBob(art: Phaser.GameObjects.Container, idx: number, amp: number): void {
    this.tweens.add({
      targets: art,
      y: -this.cell * amp,
      duration: 1300 + (idx % 3) * 180,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** (Re)draw one piece's art in place: penguin (standing, or swimming when on a
   *  hole), seal, or rock. Only this piece is touched, so other pieces' idle
   *  animations and the water shimmer keep running across moves. */
  private buildPieceArt(view: Phaser.GameObjects.Container, piece: Piece, idx: number): void {
    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (!art) return;
    this.tweens.killTweensOf(art);
    art.removeAll(true);
    art.setScale(1);
    art.setRotation(0);
    art.y = 0;
    const s = this.cell;
    if (piece.kind === 'HOPPER') {
      if (this.board?.holes.includes(piece.cells[0])) {
        drawPenguinSwimmingInto(this, art, s);
        this.startBob(art, idx, 0.03);
      } else {
        drawPenguinInto(this, art, s);
        this.startBob(art, idx, 0.05);
      }
    } else if (piece.kind === 'SLIDER') {
      drawSealInto(this, art, s, piece.orient ?? 'H');
    } else {
      drawRockInto(this, art, s);
    }
  }

  private makeSelectable(
    container: Phaser.GameObjects.Container,
    w: number,
    h: number,
    idx: number
  ): void {
    container.setInteractive(
      new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains
    );
    container.on('pointerdown', () => {
      if (this.busy || this.won || this.dragState) return;
      this.selected = this.selected === idx ? null : idx;
      this.renderHighlights();
    });
  }

  private renderHighlights(): void {
    if (!this.board) return;
    this.fxLayer.removeAll(true);
    this.clearHint();
    // Reset selection emphasis on every piece.
    this.pieceViews.forEach((v) => {
      const a: Phaser.GameObjects.Container | undefined = v?.getData('art');
      if (a) a.setScale(1);
    });
    if (this.selected === null) return;

    const selArt: Phaser.GameObjects.Container | undefined = this.pieceViews[this.selected]?.getData('art');
    if (selArt) selArt.setScale(1.1);

    const sel = this.pieces[this.selected];
    const selCenter = this.pieceCenterPx(sel.cells);
    const ring = this.add.circle(selCenter.x, selCenter.y, this.cell * 0.46);
    ring.setFillStyle(0, 0);
    ring.setStrokeStyle(3, COLORS.select);
    this.fxLayer.add(ring);

    const moves = legalMoves(this.board, this.pieces).filter((m) => m.pieceIndex === this.selected);

    if (sel.kind === 'HOPPER') {
      for (const move of moves) {
        const center = this.pieceCenterPx(move.to);
        const dot = this.add.circle(center.x, center.y, this.cell * 0.18, COLORS.hint, 0.9);
        dot.setStrokeStyle(2, 0xffffff);
        dot.setInteractive();
        dot.on(
          'pointerdown',
          (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
            event.stopPropagation();
            this.doMove(move);
          }
        );
        this.fxLayer.add(dot);
      }
    } else if (sel.kind === 'SLIDER') {
      // Seals are dragged; show arrow hints on the directions it can slide.
      this.drawSealDragHint(sel, selCenter, moves);
    }
  }

  private drawSealDragHint(
    piece: Piece,
    center: { x: number; y: number },
    moves: readonly Move[]
  ): void {
    const orient = piece.orient ?? 'H';
    const s = this.cell;
    const mk = (x: number, y: number, ch: string): Phaser.GameObjects.Text =>
      this.add
        .text(x, y, ch, { fontFamily: FONT.ui, fontSize: `${Math.round(s * 0.4)}px`, color: COLORS.arrow })
        .setOrigin(0.5);

    if (orient === 'H') {
      const canLeft = moves.some((m) => this.pieceCenterPx(m.to).x < center.x - 1);
      const canRight = moves.some((m) => this.pieceCenterPx(m.to).x > center.x + 1);
      if (canLeft) this.fxLayer.add(mk(center.x - s, center.y, '\u25C0'));
      if (canRight) this.fxLayer.add(mk(center.x + s, center.y, '\u25B6'));
    } else {
      const canUp = moves.some((m) => this.pieceCenterPx(m.to).y < center.y - 1);
      const canDown = moves.some((m) => this.pieceCenterPx(m.to).y > center.y + 1);
      if (canUp) this.fxLayer.add(mk(center.x, center.y - s, '\u25B2'));
      if (canDown) this.fxLayer.add(mk(center.x, center.y + s, '\u25BC'));
    }
  }

  private onSealDragStart(obj: Phaser.GameObjects.GameObject): void {
    if (!this.board || this.busy || this.won) return;
    if (obj.getData('slider') !== true) return;
    const pieceIndex: number = obj.getData('pieceIndex');
    const piece = this.pieces[pieceIndex];
    if (!piece) return;

    const orient = piece.orient ?? 'H';
    const origin = this.pieceCenterPx(piece.cells);
    const targets = legalMoves(this.board, this.pieces)
      .filter((m) => m.pieceIndex === pieceIndex)
      .map((m) => {
        const c = this.pieceCenterPx(m.to);
        return { coord: orient === 'H' ? c.x : c.y, move: m };
      });
    const originCoord = orient === 'H' ? origin.x : origin.y;
    const coords = [originCoord, ...targets.map((t) => t.coord)];

    this.dragState = {
      pieceIndex,
      orient,
      originX: origin.x,
      originY: origin.y,
      min: Math.min(...coords),
      max: Math.max(...coords),
      targets,
    };
    this.selected = null;
    this.fxLayer.removeAll(true);
    this.clearHint();
  }

  private onSealDrag(_obj: Phaser.GameObjects.GameObject, dragX: number, dragY: number): void {
    const ds = this.dragState;
    if (!ds) return;
    const view = this.pieceViews[ds.pieceIndex];
    if (!view) return;
    if (ds.orient === 'H') {
      view.x = Phaser.Math.Clamp(dragX, ds.min, ds.max);
      view.y = ds.originY;
    } else {
      view.y = Phaser.Math.Clamp(dragY, ds.min, ds.max);
      view.x = ds.originX;
    }
  }

  private onSealDragEnd(_obj: Phaser.GameObjects.GameObject): void {
    const ds = this.dragState;
    this.dragState = null;
    if (!ds || !this.board) return;
    const view = this.pieceViews[ds.pieceIndex];
    const current = ds.orient === 'H'
      ? view
        ? view.x
        : ds.originX
      : view
        ? view.y
        : ds.originY;

    const originCoord = ds.orient === 'H' ? ds.originX : ds.originY;
    let bestMove: Move | null = null;
    let bestDist = Math.abs(current - originCoord);
    for (const t of ds.targets) {
      const d = Math.abs(current - t.coord);
      if (d < bestDist) {
        bestDist = d;
        bestMove = t.move;
      }
    }

    if (bestMove) {
      this.doMove(bestMove);
    } else if (view) {
      // Snap back to the start position.
      view.x = ds.originX;
      view.y = ds.originY;
    }
  }

  private doMove(move: Move): void {
    if (!this.board || this.busy || this.won) return;
    this.busy = true;
    this.fxLayer.removeAll(true);
    const view = this.pieceViews[move.pieceIndex];
    const target = this.pieceCenterPx(move.to);
    const landsInWater = move.to.every((cell) => this.board?.holes.includes(cell));

    const commit = (): void => {
      if (!this.board) return;
      if (landsInWater) {
        splashBurst(this, this.fxLayer, target.x, target.y, this.cell);
        playSplash();
      }
      this.pieces = applyMove(this.pieces, move);
      this.moves += 1;
      this.selected = null;
      this.busy = false;
      // Rebuild only the moved piece's art (its outer view is already tweened to
      // the destination); every other piece keeps its idle animation running.
      const movedView = this.pieceViews[move.pieceIndex];
      if (movedView) this.buildPieceArt(movedView, this.pieces[move.pieceIndex], move.pieceIndex);
      this.updateHud();
      this.renderHighlights();
      // Dive-pop after highlights (which resets scales), so a penguin that just
      // entered the water bobs up from below.
      if (landsInWater && move.kind === 'HOPPER' && movedView) {
        const movedArt: Phaser.GameObjects.Container | undefined = movedView.getData('art');
        if (movedArt) {
          movedArt.setScale(1.12, 0.6);
          this.tweens.add({ targets: movedArt, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
        }
      }
      if (isSolved(this.board, this.pieces)) this.onWin();
    };

    if (!view) {
      commit();
      return;
    }

    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (art) this.tweens.killTweensOf(art);

    const duration = move.kind === 'HOPPER' ? 240 : 200;
    if (move.kind === 'HOPPER') playHop();
    else playSlide();
    this.tweens.add({ targets: view, x: target.x, y: target.y, duration, ease: 'Quad.easeOut', onComplete: commit });

    if (art && move.kind === 'HOPPER') {
      // Lift through an arc with a squash on take-off and landing.
      this.tweens.add({ targets: art, y: -this.cell * 0.45, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: art, scaleX: 0.86, scaleY: 1.2, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
    } else if (art) {
      // Seal slide: a brief squash in the direction of travel.
      this.tweens.add({ targets: art, scaleX: 1.12, scaleY: 0.9, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
    }
  }

  /** Restore the current board to its starting layout (moves -> 0, timer reset). */
  private resetPuzzle(): void {
    if (!this.board || this.busy || this.won || this.moves === 0) return;
    this.pieces = this.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
    this.moves = 0;
    this.selected = null;
    this.hintUsed = false;
    this.startTime = Date.now();
    this.renderBoard();
    this.updateHud();
  }

  /**
   * Reveal the solver's best next move, progressively: the first tap glows the
   * piece to move, the second shows a translucent ghost of where it goes. The
   * move is recomputed from the CURRENT board so it stays valid after any number
   * of moves. Using a hint flags the puzzle so its solve won't count toward the
   * Endless "Solved" total (cleared by Restart / a new puzzle).
   */
  private showHint(): void {
    if (!this.board || this.busy || this.won) return;
    // Bound the search so the hint can never block the main thread on a
    // pathological board (a long synchronous solve would freeze input and could
    // stall an in-flight scene fade). Real endless boards explore only a few
    // thousand states, far under this cap; if it is ever exceeded the position
    // is effectively stuck, so the stranded hint (-> Restart) is the right call.
    const result = solve({ ...this.board, pieces: this.pieces }, { maxStates: 60_000 });
    if (!result.solvable || result.solution.length === 0) {
      this.showStrandedHint();
      return;
    }
    const move = result.solution[0];
    this.hintUsed = true;
    this.selected = null;
    this.fxLayer.removeAll(true);
    this.clearHintGraphics();
    this.hintStage = this.hintStage >= 1 ? 2 : 1;
    this.glowHintPiece(move.pieceIndex);
    if (this.hintStage === 1) {
      this.addHintCaption('Tap Hint again to see the move');
    } else {
      this.showHintDestination(move);
    }
  }

  /** A pulsing gold outline around the piece the player should move. */
  private glowHintPiece(pieceIndex: number): void {
    const piece = this.pieces[pieceIndex];
    if (!piece) return;
    const center = this.pieceCenterPx(piece.cells);
    const orient = piece.orient ?? 'H';
    const w = piece.kind === 'SLIDER' && orient === 'H' ? this.cell * 1.7 : this.cell * 0.82;
    const h = piece.kind === 'SLIDER' && orient === 'V' ? this.cell * 1.7 : this.cell * 0.82;
    const g = this.add.graphics();
    g.lineStyle(4, COLORS.gold, 1);
    g.strokeRoundedRect(center.x - w / 2, center.y - h / 2, w, h, Math.min(w, h) * 0.32);
    this.hintLayer.add(g);
    this.tweens.add({ targets: g, alpha: 0.25, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** A translucent ghost of the piece sitting on its destination cell(s). */
  private showHintDestination(move: Move): void {
    const piece = this.pieces[move.pieceIndex];
    if (!piece) return;
    const dest = this.pieceCenterPx(move.to);
    const ghost = this.add.container(dest.x, dest.y);
    ghost.setAlpha(0.5);
    if (piece.kind === 'SLIDER') drawSealInto(this, ghost, this.cell, piece.orient ?? 'H');
    else drawPenguinInto(this, ghost, this.cell);
    this.hintLayer.add(ghost);
    this.tweens.add({ targets: ghost, alpha: 0.22, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /**
   * A transient hint caption on a dark 'chip' pill (matching the HUD chrome).
   * The backdrop is what makes it legible on BOTH layouts: in portrait the
   * board is short and this lands on the dark backdrop, but on desktop/landscape
   * the board fills the height and this sits over the near-white ice sheet -
   * where the old plain light text vanished. Sits a row above the Restart/Hint
   * buttons (which are at height - 26), lifted enough to clear the pill.
   */
  private addHintCaption(text: string): PillButton {
    const caption = makeBadge(this, text, 'chip', 'sm');
    caption.setPosition(this.scale.width / 2, this.scale.height - 70);
    this.hintLayer.add(caption);
    return caption;
  }

  /** When the board is unsolvable from here, point the player at Restart. */
  private showStrandedHint(): void {
    this.clearHintGraphics();
    const msg = this.addHintCaption('No way through from here \u2014 tap \u21BA Restart');
    this.time.delayedCall(2600, () => {
      if (msg.active) {
        this.tweens.add({ targets: msg, alpha: 0, duration: 400, onComplete: () => msg.destroy() });
      }
    });
  }

  /** Remove hint visuals (kills their tweens first so nothing tweens a dead node). */
  private clearHintGraphics(): void {
    if (!this.hintLayer) return;
    this.tweens.killTweensOf(this.hintLayer.list);
    this.hintLayer.removeAll(true);
  }

  /** Clear hint visuals and reset the progressive stage (next hint starts fresh). */
  private clearHint(): void {
    this.clearHintGraphics();
    this.hintStage = 0;
  }

  /** Master mute for the play HUD: silence or restore both SFX and music, then
   *  redraw the speaker icon (waves vs. slash) to match the new state. */
  private toggleMute(): void {
    const on = !isAnyAudioOn();
    setAllAudioOn(on);
    if (on) playHop(); // a tiny confirmation blip when turning sound back on
    this.muteButton.refresh();
  }

  private updateHud(): void {
    const w = this.scale.width;
    // Two-tier top HUD: row 1 is the chrome chips near the top; row 2 is a
    // dedicated, full-width "Moves / Par" readout just below them, so the chips
    // can never crowd the readout again (the added mute chip was crushing the
    // old single-row centre to an unreadable sliver on narrow widths).
    const midY = 22;
    const statsMidY = this.hudHeight - 18;
    this.menuButton.setPosition(SPACE.md + this.menuButton.width / 2, midY);
    this.menuButton.setVisible(!this.won);
    // Master mute sits just right of Menu; always available during play so a
    // feed-first player can silence audio without a trip back to the hub.
    this.muteButton.setPosition(
      this.menuButton.x + this.menuButton.width / 2 + SPACE.sm + this.muteButton.width / 2,
      midY
    );
    this.muteButton.setVisible(!this.won);
    const skipVisible = this.isCommunity && !this.won;
    this.skipButton.setPosition(w - SPACE.md - this.skipButton.width / 2, midY);
    this.skipButton.setVisible(skipVisible);
    const bannerVisible = this.isEndless && !this.won;
    this.endlessBanner.setLabelText(`Solved: ${this.endlessSolved}`);
    this.endlessBanner.setPosition(w - SPACE.md - this.endlessBanner.width / 2, midY);
    this.endlessBanner.setVisible(bannerVisible);
    // "?" help chip (top-right), shown on the daily/test screen where the corner
    // is free. Endless owns that corner with the Solved banner and community
    // with Skip, and players reach those via the hub (which has its own "?").
    const helpVisible = !this.isEndless && !this.isCommunity && !this.won;
    this.helpButton.setPosition(w - SPACE.md - this.helpButton.width / 2, midY);
    this.helpButton.setVisible(helpVisible);

    // Moves / Par: its own centred row beneath the chrome, using the full width,
    // so the chrome chips can't crush it. It only shrinks if it somehow exceeds
    // the whole row (never on real screens), so it always reads at full size.
    this.hudText.setScale(1);
    this.hudText.setText(`Moves ${this.moves}    Par ${this.par}`);
    const maxStatsW = w - SPACE.lg * 2;
    if (this.hudText.width > maxStatsW) this.hudText.setScale(maxStatsW / this.hudText.width);
    this.hudText.setPosition(w / 2, statsMidY);
    this.hintText.setPosition(w / 2, this.scale.height - 26);
    this.hintText.setVisible(this.moves === 0 && !this.won && !this.isCommunity);
    // Restart sits in the bottom strip and only appears once a move is made
    // (swaps in for the first-move hint, which hides as soon as moves > 0). In
    // Endless it's paired with the Hint button; otherwise it stays centered.
    const bottomY = this.scale.height - 26;
    const showReset = this.moves > 0 && !this.won;
    const showHint = this.isEndless && this.moves > 0 && !this.won;
    if (showHint) {
      const pairGap = SPACE.md;
      const total = this.resetButton.width + pairGap + this.hintButton.width;
      const left = w / 2 - total / 2;
      this.resetButton.setPosition(left + this.resetButton.width / 2, bottomY);
      this.hintButton.setPosition(left + this.resetButton.width + pairGap + this.hintButton.width / 2, bottomY);
    } else {
      this.resetButton.setPosition(w / 2, bottomY);
    }
    this.resetButton.setVisible(showReset);
    this.hintButton.setVisible(showHint);
    // The board is ready: drop the loading state and reveal the UI.
    if (this.loadingText) this.loadingText.setVisible(false);
    this.clearLoadError();
    this.uiLayer.setVisible(true);
  }

  /** A "sign in to save" CTA shown only to logged-out players, placed on a win
   *  screen (a natural breakpoint). showLoginPrompt reloads the page, so we only
   *  trigger it here, never mid-puzzle. */
  private addSignInPrompt(y: number, label: string): PillButton | undefined {
    if (context.username) return undefined; // already signed in - nothing to gain
    const btn = makePill(this, {
      label,
      variant: 'secondary',
      size: 'sm',
      x: this.scale.width / 2,
      y,
      onClick: () => showLoginPrompt(),
    });
    this.fxLayer.add(btn);
    return btn;
  }

  /** A "Join the community" CTA on the daily win screen, shown to a signed-in
   *  player we haven't already recorded as subscribed. Per Reddit's user-actions
   *  policy it's a distinct, optional action that never gates play; tapping
   *  subscribes them to the subreddit on their behalf so tomorrow's daily finds
   *  them. Sits in the same slot as the (logged-out-only) sign-in prompt, so the
   *  two are mutually exclusive. */
  private addSubscribePrompt(y: number): PillButton | undefined {
    if (!context.username || this.subscribed) return undefined;
    const label = this.subredditName ? `Join r/${this.subredditName}` : 'Join the community';
    const btn = makePill(this, {
      label,
      variant: 'secondary',
      size: 'sm',
      x: this.scale.width / 2,
      y,
      onClick: () => void this.subscribeToCommunity(btn),
    });
    this.fxLayer.add(btn);
    return btn;
  }

  /** Calls the server to subscribe the viewer, then confirms and hides the CTA. */
  private async subscribeToCommunity(btn: PillButton): Promise<void> {
    btn.setEnabled(false);
    btn.setLabelText('Joining\u2026');
    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`subscribe failed: ${response.status}`);
      this.subscribed = true;
      btn.setLabelText('Joined \u2713');
      showToast('Thanks for joining \u2014 see you tomorrow!');
    } catch (error) {
      console.error(error);
      btn.setLabelText('Tap to try again');
      btn.setEnabled(true);
    }
  }

  /** Returning-player recap: when you re-open a daily you've already solved,
   *  acknowledge it and funnel onward (Endless / Community) rather than silently
   *  dropping you back into a beaten board. "Play again" dismisses it to replay.
   *  We don't set `won` - the board stays playable; the interactive overlay just
   *  blocks accidental taps until the player chooses. */
  private showDailySolvedRecap(result?: { moves: number; stars: number }): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    this.hudText.setVisible(false);
    this.hintText.setVisible(false);
    this.resetButton.setVisible(false);
    this.hintButton.setVisible(false);
    this.menuButton.setVisible(false);
    this.muteButton.setVisible(false);
    this.helpButton.setVisible(false);

    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(440, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const cardLeft = w / 2 - cardW / 2;
    const cardTop = h / 2 - cardH / 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);

    // Menu lives inside the card's top-left corner (consistent with the win
    // screen), rather than the play-HUD chip floating above the card.
    const menuChip = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    menuChip.setPosition(cardLeft + SPACE.md + menuChip.width / 2, cardTop + SPACE.md + menuChip.height / 2);

    const headline = this.add
      .text(w / 2, h * 0.3, "You've solved today's puzzle!", {
        fontFamily: FONT.display,
        fontSize: '24px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5);
    const subText = result
      ? `${result.moves} moves   ${'\u2605'.repeat(result.stars)}\nA fresh puzzle drops tomorrow.`
      : 'A fresh puzzle drops tomorrow.';
    const sub = this.add
      .text(w / 2, h * 0.41, subText, {
        fontFamily: FONT.ui,
        fontSize: '15px',
        fontStyle: '600',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5)
      .setAlpha(0.9);

    const endlessBtn = makePill(this, {
      label: 'Endless puzzles \u25B6',
      variant: 'primary',
      minWidth: Math.min(240, contentW),
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });
    const communityBtn = makePill(this, {
      label: 'Community puzzles',
      variant: 'secondary',
      minWidth: Math.min(240, contentW),
      onClick: () => fadeToScene(this, 'CommunityScene'),
    });
    const replayBtn = makePill(this, {
      label: "Play today's again",
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        this.fxLayer.removeAll(true);
        this.hudText.setVisible(true);
        this.updateHud();
      },
    });
    // Even-gap column for the three onward actions, centred below the subtext.
    stackColumn([endlessBtn, communityBtn, replayBtn], w / 2, h * 0.53, SPACE.md);

    this.fxLayer.add([overlay, card, menuChip, headline, sub, endlessBtn, communityBtn, replayBtn]);
    headline.setScale(0.95).setAlpha(0);
    this.tweens.add({ targets: headline, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
  }

  private onWin(): void {
    this.won = true;
    this.menuButton.setVisible(false);
    this.muteButton.setVisible(false);
    this.skipButton.setVisible(false);
    this.endlessBanner.setVisible(false);
    this.resetButton.setVisible(false);
    this.hintButton.setVisible(false);
    this.helpButton.setVisible(false);
    // Hide the play HUD readout too: it lives in uiLayer, which renders above
    // the win card (in fxLayer), so it would otherwise float over the win
    // screen. (Every win type funnels through here, so this covers all of them.)
    this.hudText.setVisible(false);
    this.hintText.setVisible(false);
    this.clearHint();
    if (this.isTest) {
      this.onWinTest();
      return;
    }
    if (this.isCommunity) {
      this.onWinCommunity();
      return;
    }
    if (this.isEndless) {
      this.onWinEndless();
      return;
    }
    playWin();
    const stars = computeStars(this.moves, this.par);
    const blurb = stars === 3 ? 'A clean run!' : stars === 2 ? 'Nicely done!' : 'Can you do it in fewer?';
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);

    this.shareText = buildShareText({
      date: this.date,
      moves: this.moves,
      par: this.par,
      stars,
      streak: 1,
      rank: 0,
      totalPlayers: 0,
    });

    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(460, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const cardLeft = w / 2 - cardW / 2;
    const cardTop = h / 2 - cardH / 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    this.fxLayer.add([overlay, card]);

    // Aurora curtains near the top only for a standout (3-star) win.
    if (stars === 3) auroraFlourish(this, this.fxLayer, w, h * 0.12);

    const headline = this.add
      .text(w / 2, h * 0.2, `Everyone made it in!\n${blurb}`, {
        fontFamily: FONT.display,
        fontSize: '24px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.fxLayer.add(headline);
    this.tweens.add({ targets: headline, alpha: 1, y: h * 0.18, duration: 300, ease: 'Quad.easeOut' });

    // Stars pop in one by one (earned spin); empty ones stay dim.
    const starY = h * 0.32;
    const gap = Math.min(54, w * 0.16);
    const outer = Math.min(24, w * 0.07);
    for (let i = 0; i < 3; i++) {
      const earned = i < stars;
      const star = this.add
        .star(w / 2 + (i - 1) * gap, starY, 5, outer * 0.45, outer, earned ? COLORS.gold : 0x32485c)
        .setStrokeStyle(2, earned ? 0xffe9a8 : 0x4a6377)
        .setScale(0);
      this.fxLayer.add(star);
      this.tweens.add({ targets: star, scale: 1, duration: 300, delay: 300 + i * 180, ease: 'Back.easeOut' });
      if (earned) {
        this.tweens.add({ targets: star, angle: 360, duration: 500, delay: 300 + i * 180, ease: 'Cubic.easeOut' });
      }
    }

    // Moves count up to the final tally.
    const movesText = this.add
      .text(w / 2, h * 0.44, `0 moves   (par ${this.par})`, {
        fontFamily: FONT.ui,
        fontSize: '19px',
        fontStyle: '700',
        color: COLORS.text,
      })
      .setOrigin(0.5);
    this.fxLayer.add(movesText);
    const counter = { v: 0 };
    this.tweens.add({
      targets: counter,
      v: this.moves,
      duration: 600,
      delay: 250,
      ease: 'Cubic.easeOut',
      onUpdate: () => movesText.setText(`${Math.round(counter.v)} moves   (par ${this.par})`),
    });

    // Celebration sparkles once the stars are landing.
    this.time.delayedCall(520, () => sparkleBurst(this, this.fxLayer, w / 2, starY, Math.min(60, w * 0.16)));

    const status = this.add
      .text(w / 2, h * 0.55, 'Saving your score\u2026', {
        fontFamily: FONT.ui,
        fontSize: '15px',
        fontStyle: '600',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 5,
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    // Outward share: the native share sheet (plus a link back to the post that
    // pulls new players in). A quieter ghost treatment with an "out" arrow so it
    // reads as distinct from the inward "Comment my score" - not a second
    // identical secondary pill (the two used to be indistinguishable).
    const copyButton = makePill(this, {
      label: 'Share result \u2197',
      variant: 'ghost',
      x: w / 2,
      onClick: () => void this.copyResult(copyButton),
    });

    // Drop the result straight into this post's comment thread (the comment
    // scoreboard / "how'd you do it in N?" culture), authored by the player.
    // Only when this is the host post's own daily, so the comment's par + thread
    // always match what was solved (never a daily reached from inside a UGC post).
    let postScoreButton: PillButton | undefined;
    if (this.isHostPostPuzzle) {
      postScoreButton = makePill(this, {
        label: 'Comment my score',
        variant: 'secondary',
        x: w / 2,
        onClick: () => {
          if (postScoreButton) void this.postScore(postScoreButton);
        },
      });
    }

    // Forward navigation so the daily isn't a dead end (keeps the "one more"
    // loop). Endless is always full of fresh puzzles, so it's the better
    // post-daily CTA than the (possibly empty) community stream.
    const morePuzzlesButton = makePill(this, {
      label: 'More puzzles \u25B6',
      variant: 'primary',
      x: w / 2,
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });

    const homeButton = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    homeButton.setPosition(cardLeft + SPACE.md + homeButton.width / 2, cardTop + SPACE.md + homeButton.height / 2);

    const winButtons: Phaser.GameObjects.GameObject[] = [status, copyButton, morePuzzlesButton, homeButton];
    if (postScoreButton) winButtons.push(postScoreButton);
    this.fxLayer.add(winButtons);

    // At most one CTA shows: a sign-in nudge for guests, otherwise a join nudge
    // for signed-in non-members. Capture whichever renders so it joins the
    // bottom button stack instead of sitting at a fixed y that the growing
    // leaderboard text used to overlap.
    const cta =
      this.addSignInPrompt(0, 'Sign in to save your streak') ?? this.addSubscribePrompt(0);

    // Stack the action buttons up from the bottom with even gaps, then let the
    // score/leaderboard block fill the gap above them. Anchoring to the bottom
    // keeps them clear of the leaderboard no matter how many lines it grows to
    // once submitSolve resolves. Order is lowest-first (best thumb reach at the
    // bottom): primary loop CTA, then the inward Reddity action (Comment my
    // score), then the quieter outward Share, then the opt-in nudge on top.
    const stack: PillButton[] = [morePuzzlesButton];
    if (postScoreButton) stack.push(postScoreButton);
    stack.push(copyButton);
    if (cta) stack.push(cta);
    const stackTop = this.stackFromBottom(stack);

    const movesBottom = movesText.y + movesText.height / 2;
    this.winStatusTop = movesBottom + SPACE.md;
    this.winStatusBottom = stackTop - SPACE.md;
    this.positionWinStatus(status);

    void this.submitSolve(status);
  }

  /** Lay out win-screen action buttons stacked up from the bottom of the screen
   *  with consistent gaps (pass them lowest-first). Returns the y of the top
   *  edge of the topmost button so the variable-height status block above can be
   *  placed without ever overlapping the buttons. */
  private stackFromBottom(buttons: PillButton[]): number {
    const h = this.scale.height;
    const gap = SPACE.md;
    let bottom = h - Math.max(SPACE.lg, h * 0.03);
    let top = bottom;
    for (const btn of buttons) {
      const hgt = btn.height;
      btn.setY(bottom - hgt / 2);
      top = bottom - hgt;
      bottom = top - gap;
    }
    return top;
  }

  /** Anchor the async, variable-height score/leaderboard block to the TOP of its
   *  reserved band so it hugs the moves tally. On a first solve (one short line)
   *  that keeps it part of the top content group instead of floating marooned in
   *  the middle of the card; a tall leaderboard is shrunk to fit so it still
   *  never slides under the bottom buttons. */
  private positionWinStatus(status: Phaser.GameObjects.Text): void {
    if (!status.scene) return; // destroyed (player navigated away mid-fetch)
    const top = this.winStatusTop;
    const bottom = this.winStatusBottom;
    const band = bottom - top;
    // The leaderboard is capped at 3 names, but the full block (rank + streak +
    // best + 3 solvers, plus any wrapped long usernames) can still be taller
    // than its band on a short viewport. Shrink it to fit so it can never spill
    // onto the buttons; the floor keeps the text legible.
    status.setScale(1);
    if (band > 0 && status.height > band) {
      status.setScale(Math.max(0.62, band / status.height));
    }
    // Top-anchored: place the block's top edge at winStatusTop (origin is
    // centred, so offset by half its scaled height).
    status.setY(top + status.displayHeight / 2);
  }

  private onWinCommunity(): void {
    const playedId = this.communityPuzzle?.id;
    if (playedId) void this.markPlayed(playedId);
    playWin();
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const creator = this.communityPuzzle?.creator ?? 'a redditor';
    const isMine = Boolean(context.username) && this.communityPuzzle?.creator === context.username;

    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(440, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);

    const headline = this.add
      .text(
        w / 2,
        h * 0.3,
        `${isMine ? 'Solved your own puzzle!' : `Solved ${creator}'s puzzle!`}\n${this.moves} moves`,
        {
          fontFamily: FONT.display,
          fontSize: '23px',
          fontStyle: '700',
          color: COLORS.text,
          align: 'center',
          lineSpacing: 8,
          wordWrap: { width: contentW },
        }
      )
      .setOrigin(0.5);

    const buttons: PillButton[] = [];
    let voteButton: PillButton | undefined;
    if (!isMine) {
      voteButton = makePill(this, {
        label: 'Upvote this puzzle',
        variant: 'mint',
        minWidth: Math.min(240, contentW),
        onClick: () => {
          if (voteButton) void this.upvoteCurrent(voteButton);
        },
      });
      buttons.push(voteButton);
    }
    // Let the solver drop their score into the puzzle's thread (creator feedback
    // + the "beat my count" loop). Only for other people's puzzles, and only when
    // this IS the host post's puzzle (not a "Next" puzzle in the same webview),
    // so the comment lands in the right thread with the right par/creator.
    let scoreButton: PillButton | undefined;
    if (!isMine && this.isHostPostPuzzle) {
      scoreButton = makePill(this, {
        label: 'Comment my score',
        variant: 'secondary',
        minWidth: Math.min(240, contentW),
        onClick: () => {
          if (scoreButton) void this.postScore(scoreButton);
        },
      });
      buttons.push(scoreButton);
    }
    const moreButton = makePill(this, {
      label: 'Next puzzle \u25B6',
      variant: 'primary',
      minWidth: Math.min(240, contentW),
      onClick: () => void this.nextCommunity(),
    });
    const dailyButton = makePill(this, {
      label: 'Back to daily',
      variant: 'ghost',
      size: 'sm',
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    buttons.push(moreButton, dailyButton);

    const extras: Phaser.GameObjects.GameObject[] = [];
    // Social proof from the stream-load snapshot: how this puzzle is doing.
    const votes = this.communityPuzzle?.votes ?? 0;
    const solves = this.communityPuzzle?.solves ?? 0;
    const statBits: string[] = [];
    if (solves > 0) statBits.push(`${solves} ${solves === 1 ? 'solve' : 'solves'}`);
    if (votes > 0) statBits.push(`\u25B2 ${votes}`);
    const statText = statBits.join('   \u00B7   ');
    if (isMine) {
      const note = this.add
        .text(w / 2, h * 0.44, statText ? `Your puzzle  \u00B7  ${statText}` : 'Your puzzle \u2014 nice build!', {
          fontFamily: FONT.ui,
          fontSize: '15px',
          fontStyle: '600',
          color: COLORS.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.9);
      extras.push(note);
    } else if (statText) {
      const note = this.add
        .text(w / 2, h * 0.44, statText, {
          fontFamily: FONT.ui,
          fontSize: '14px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.8);
      extras.push(note);
    }
    stackColumn(buttons, w / 2, h * 0.52, SPACE.md);

    this.fxLayer.add([overlay, card, headline, ...buttons, ...extras]);
    headline.setScale(0.92).setAlpha(0);
    this.tweens.add({ targets: headline, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    this.time.delayedCall(180, () => sparkleBurst(this, this.fxLayer, w / 2, h * 0.3, Math.min(48, w * 0.13)));
  }

  private onWinEndless(): void {
    playWin();
    const counts = !this.hintUsed;
    const stars = computeStars(this.moves, this.par);
    const blurb = counts
      ? stars === 3
        ? 'A clean run!'
        : stars === 2
          ? 'Nicely done!'
          : 'Got there in the end!'
      : 'You found the way with a hint.';
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);

    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(460, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const cardLeft = w / 2 - cardW / 2;
    const cardTop = h / 2 - cardH / 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    this.fxLayer.add([overlay, card]);
    if (counts && stars === 3) auroraFlourish(this, this.fxLayer, w, h * 0.12);

    const headline = this.add
      .text(w / 2, h * 0.2, `Everyone made it in!\n${blurb}`, {
        fontFamily: FONT.display,
        fontSize: '24px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.fxLayer.add(headline);
    this.tweens.add({ targets: headline, alpha: 1, y: h * 0.18, duration: 300, ease: 'Quad.easeOut' });

    if (counts) {
      // Stars pop in one by one (earned ones spin); empty ones stay dim.
      const starY = h * 0.32;
      const gap = Math.min(54, w * 0.16);
      const outer = Math.min(24, w * 0.07);
      for (let i = 0; i < 3; i++) {
        const earned = i < stars;
        const star = this.add
          .star(w / 2 + (i - 1) * gap, starY, 5, outer * 0.45, outer, earned ? COLORS.gold : 0x32485c)
          .setStrokeStyle(2, earned ? 0xffe9a8 : 0x4a6377)
          .setScale(0);
        this.fxLayer.add(star);
        this.tweens.add({ targets: star, scale: 1, duration: 300, delay: 300 + i * 180, ease: 'Back.easeOut' });
        if (earned) {
          this.tweens.add({ targets: star, angle: 360, duration: 500, delay: 300 + i * 180, ease: 'Cubic.easeOut' });
        }
      }

      const movesText = this.add
        .text(w / 2, h * 0.44, `${this.moves} moves   (par ${this.par})`, {
          fontFamily: FONT.ui,
          fontSize: '18px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5);
      this.fxLayer.add(movesText);

      // The progression payoff: the lifetime solved count ticks up by one.
      const fromCount = this.endlessSolved;
      // Optimistically record the increment so a fast "Next" (before the solve
      // POST resolves) still shows the correct banner; recordEndless reconciles it.
      this.registry.set('endless.solved', fromCount + 1);
      const countText = this.add
        .text(w / 2, h * 0.54, `Solved: ${fromCount}`, {
          fontFamily: FONT.ui,
          fontSize: '22px',
          fontStyle: '800',
          color: '#ffd166',
        })
        .setOrigin(0.5);
      this.fxLayer.add(countText);

      this.time.delayedCall(520, () => sparkleBurst(this, this.fxLayer, w / 2, starY, Math.min(60, w * 0.16)));
      void this.recordEndless(countText, fromCount);
    } else {
      // Hinted solve: honest and encouraging, but it does not add to the total.
      const note = this.add
        .text(w / 2, h * 0.34, 'Solved with a hint', {
          fontFamily: FONT.ui,
          fontSize: '18px',
          fontStyle: '800',
          color: '#ffd166',
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(w / 2, h * 0.44, "This one doesn't add to your total \u2014 try the next one solo", {
          fontFamily: FONT.ui,
          fontSize: '13px',
          fontStyle: '600',
          color: COLORS.text,
          align: 'center',
          wordWrap: { width: contentW },
        })
        .setOrigin(0.5)
        .setAlpha(0.85);
      const countText = this.add
        .text(w / 2, h * 0.54, `Solved: ${this.endlessSolved}`, {
          fontFamily: FONT.ui,
          fontSize: '18px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5);
      this.fxLayer.add([note, sub, countText]);
    }

    const nextButton = makePill(this, {
      label: 'Next puzzle \u25B6',
      variant: 'primary',
      x: w / 2,
      y: h * 0.7,
      minWidth: Math.min(240, contentW),
      onClick: () => fadeToScene(this, 'GameScene', { endless: { tier: this.endlessTier } }),
    });

    const levelButton = makePill(this, {
      label: 'Change level',
      variant: 'secondary',
      size: 'sm',
      x: w / 2,
      y: h * 0.81,
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });

    const homeButton = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    homeButton.setPosition(cardLeft + SPACE.md + homeButton.width / 2, cardTop + SPACE.md + homeButton.height / 2);

    this.fxLayer.add([nextButton, levelButton, homeButton]);
    this.addSignInPrompt(h * 0.62, 'Sign in to save your progress');
  }

  /** Record the endless solve server-side and tick the lifetime count up. */
  private async recordEndless(countText: Phaser.GameObjects.Text, fromCount: number): Promise<void> {
    try {
      const response = await fetch('/api/endless/solved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: this.endlessTier }),
      });
      if (!response.ok) throw new Error(`endless solve failed: ${response.status}`);
      const result: EndlessSolvedResponse = await response.json();
      this.endlessSolved = result.solved;
      // Persist the authoritative count so the next puzzle (which may load from
      // the prefetch cache, whose own count is stale) shows the right banner.
      this.registry.set('endless.solved', result.solved);
      // If the player already moved on (tapped Next / Menu) before this POST
      // resolved, the win-screen text is destroyed. Adding a tween that writes to
      // it would throw from inside the game loop and permanently kill Phaser's
      // render loop - the next puzzle would load and then freeze. Bail out; the
      // count is already stored above.
      if (!countText.scene) return;
      const counter = { v: fromCount };
      this.tweens.add({
        targets: counter,
        v: result.solved,
        duration: 500,
        ease: 'Cubic.easeOut',
        onUpdate: () => {
          if (countText.scene) countText.setText(`Solved: ${Math.round(counter.v)}`);
        },
        onComplete: () => {
          if (countText.scene) countText.setText(`Solved: ${result.solved}`);
        },
      });
    } catch (error) {
      console.error(error);
      // Non-fatal: leave the banner at the pre-solve count.
    }
  }

  private onWinTest(): void {
    playWin();
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(420, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    const panel = this.add
      .text(w / 2, h * 0.4, `Your puzzle works!\nSolvable in ${this.moves} moves`, {
        fontFamily: FONT.display,
        fontSize: '23px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 8,
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5);
    const back = makePill(this, {
      label: 'Back to editing',
      variant: 'primary',
      x: w / 2,
      y: h * 0.56,
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    this.fxLayer.add([overlay, card, panel, back]);
    panel.setScale(0.92).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    this.time.delayedCall(150, () => sparkleBurst(this, this.fxLayer, w / 2, h * 0.4, Math.min(48, w * 0.13)));
  }

  private async markPlayed(id: string): Promise<void> {
    try {
      await fetch('/api/ugc/played', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch (error) {
      console.error(error);
    }
  }

  private async upvoteCurrent(button: PillButton): Promise<void> {
    const id = this.communityPuzzle?.id;
    if (!id) return;
    // Guests can play freely; upvoting needs an account. Prompt right on the
    // tap (intent-driven) instead of showing a standing sign-in button.
    if (!context.username) {
      showLoginPrompt();
      return;
    }
    try {
      const response = await fetch('/api/ugc/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      // A non-OK status is a transient failure: fall through to the catch so the
      // button stays enabled (retryable). A definitive ok:false from the server
      // (already voted / own puzzle) comes back 200 and disables below.
      if (!response.ok) throw new Error(`vote failed: ${response.status}`);
      const data: VoteResponse = await response.json();
      button.setLabelText(data.ok ? `Upvoted! (${data.votes})` : data.reason ?? 'Already upvoted');
      button.setEnabled(false);
    } catch (error) {
      console.error(error);
      button.setLabelText('Could not upvote');
    }
  }

  /** Post the player's score into this post's comment thread, authored by the
   *  player (the server posts with runAs: 'USER'). Spoiler-free, worded as moves
   *  vs par. The scorePosted guard blocks a double-tap within this win screen. */
  private async postScore(button: PillButton): Promise<void> {
    if (this.scorePosted) return;
    // Commenting needs an account; prompt right on the tap (intent-driven).
    if (!context.username) {
      showLoginPrompt();
      return;
    }
    button.setLabelText('Posting\u2026').setEnabled(false);
    try {
      const response = await fetch('/api/comment-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves: this.moves }),
      });
      if (!response.ok) throw new Error(`comment failed: ${response.status}`);
      this.scorePosted = true;
      button.setLabelText('Posted to comments \u2713');
      showToast('Your score is in the comments!');
    } catch (error) {
      console.error(error);
      button.setLabelText('Comment my score').setEnabled(true);
      showToast('Could not post your score.');
    }
  }

  /** Hand off to a fresh GameScene for the given community puzzle. */
  private startCommunity(sub: UgcSubmission): void {
    fadeToScene(this, 'GameScene', {
      community: {
        id: sub.id,
        board: sub.board,
        par: sub.par,
        creator: sub.creator,
        votes: sub.votes,
        solves: sub.solves,
      },
    });
  }

  private async nextCommunity(): Promise<void> {
    const queue: UgcSubmission[] = this.registry.get('ugc.queue') ?? [];
    const idx = (this.registry.get('ugc.index') ?? 0) + 1;
    if (idx < queue.length) {
      this.registry.set('ugc.index', idx);
      this.startCommunity(queue[idx]);
      return;
    }
    // End of this batch. The server filters out puzzles we've solved and mixes
    // in resurfaced/discovery ones, so pull a fresh batch before declaring the
    // stream done - it shouldn't dead-end while unsolved puzzles still exist.
    const more = await this.fetchCommunityBatch(this.communityPuzzle?.id);
    if (more.length > 0) {
      this.registry.set('ugc.queue', more);
      this.registry.set('ugc.index', 0);
      this.startCommunity(more[0]);
    } else {
      this.showStreamDone();
    }
  }

  /** Fetch a fresh community batch, dropping the puzzle we just finished so it
   *  never repeats back-to-back. Returns [] on empty or error. */
  private async fetchCommunityBatch(excludeId?: string): Promise<UgcSubmission[]> {
    try {
      const response = await fetch('/api/ugc/list');
      if (!response.ok) throw new Error(`list failed: ${response.status}`);
      const data: UgcListResponse = await response.json();
      return data.submissions.filter((s) => s.id !== excludeId);
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  private showStreamDone(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.won = true;
    this.skipButton.setVisible(false);
    this.muteButton.setVisible(false);
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(420, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    const panel = this.add
      .text(w / 2, h * 0.36, "That's all the community puzzles for now!", {
        fontFamily: FONT.display,
        fontSize: '21px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 8,
        wordWrap: { width: contentW },
      })
      .setOrigin(0.5);
    const endlessBtn = makePill(this, {
      label: 'Play Endless',
      variant: 'primary',
      minWidth: Math.min(220, contentW),
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });
    const buildBtn = makePill(this, {
      label: 'Build a puzzle',
      variant: 'secondary',
      minWidth: Math.min(220, contentW),
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    const dailyBtn = makePill(this, {
      label: 'Back to daily',
      variant: 'ghost',
      size: 'sm',
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    stackColumn([endlessBtn, buildBtn, dailyBtn], w / 2, h * 0.5, SPACE.md);
    this.fxLayer.add([overlay, card, panel, endlessBtn, buildBtn, dailyBtn]);
  }

  private async submitSolve(status: Phaser.GameObjects.Text): Promise<void> {
    try {
      const timeMs = Date.now() - this.startTime;
      const response = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: this.date, moves: this.moves, timeMs }),
      });
      if (!response.ok) throw new Error(`solve failed: ${response.status}`);
      const result: SolveResultDTO = await response.json();

      this.shareText = buildShareText({
        date: this.date,
        moves: this.moves,
        par: this.par,
        stars: computeStars(this.moves, this.par),
        streak: result.streak,
        rank: result.rank,
        totalPlayers: result.totalPlayers,
      });

      const lines: string[] = [];
      if (result.totalPlayers >= 2 && result.rank > 0) {
        lines.push(`You're #${result.rank} of ${result.totalPlayers} today`);
      } else if (result.rank > 0) {
        lines.push('You set today\u2019s pace - first one in!');
      } else {
        lines.push('Playing as a guest \u2014 scores aren\u2019t saved.');
      }
      if (result.streak > 1) lines.push(`Streak: ${result.streak} days`);
      if (result.bestMoves < this.moves) lines.push(`Your best today: ${result.bestMoves} moves`);

      if (result.totalPlayers >= 2) {
        const top = await this.fetchLeaderboard();
        if (top.length > 0) {
          lines.push('');
          lines.push('Top solvers today');
          top.forEach((entry, i) => lines.push(`${i + 1}. ${entry.username} - ${entry.moves} moves`));
        }
      }
      status.setText(lines.join('\n'));
      this.positionWinStatus(status);
    } catch (error) {
      console.error(error);
      status.setText('Score saved. (Leaderboard unavailable.)');
      this.positionWinStatus(status);
    }
  }

  private async copyResult(button: PillButton): Promise<void> {
    if (!this.shareText) return;
    // Prefer the native share sheet (Devvit-recommended; it also shares a link to
    // the post, which brings new players in). Fall back to the clipboard so the
    // paste-into-the-comments flow still works on every platform.
    try {
      await showShareSheet({ title: 'Ice Hop', text: this.shareText });
      button.setLabelText('Shared!');
      return;
    } catch (error) {
      console.error(error);
    }
    try {
      await navigator.clipboard.writeText(this.shareText);
      button.setLabelText('Copied! Paste it in the comments');
    } catch (error) {
      console.error(error);
      button.setLabelText('Copy failed \u2014 select the text manually');
    }
  }

  private async fetchLeaderboard(): Promise<{ username: string; moves: number }[]> {
    try {
      const response = await fetch(`/api/leaderboard?date=${encodeURIComponent(this.date)}`);
      if (!response.ok) return [];
      const data: LeaderboardResponse = await response.json();
      return data.entries.slice(0, 3).map((e) => ({ username: e.username, moves: e.moves }));
    } catch {
      return [];
    }
  }
}
