import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { Board, Move, Piece } from '../../shared/game/types';
import type {
  CommentScoreResponse,
  EndlessHintResponse,
  EndlessResponse,
  EndlessSolveResponse,
  EndlessTier,
  InitResponse,
  LeaderboardResponse,
  MarkPlayedResponse,
  SolveResultDTO,
  UgcListResponse,
  UgcSubmission,
  VoteResponse,
} from '../../shared/api';
import {
  buildAchievementSnapshot,
  qualifiedAchievementIds,
  type AchievementId,
  type AchievementSnapshot,
} from '../../shared/achievements';
import { boardSignature } from '../../shared/game/board';
import { legalMoves } from '../../shared/game/moves';
import { replayMoves } from '../../shared/game/replay';
import { applyMove, isSolved } from '../../shared/game/rules';
import { computeStars } from '../../shared/scoring';
import {
  guestDailyCompletionFor,
  mergeProgressCount,
  rememberGuestDailyCompletion,
} from '../../shared/progression';
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
  PillButton,
  IconButton,
  makeIconButton,
  drawSpeakerIcon,
  armTap,
  useCrispRendering,
  viewHeight,
  viewWidth,
  RENDER_SCALE,
  drawFlame,
  snowSpray,
  prefersReducedMotion,
} from '../art/theme';
import { slideStop } from '../../shared/game/slide';
import {
  WIN_CELEBRATION_MS,
  WIN_CELEBRATION_REDUCED_MS,
  keepSelectedAfterMove,
  moveDurationMs,
  sealBlockedByWater,
} from '../../shared/game/motion';
import { starGoal, starGoalLabel } from '../../shared/scoring';
import { formatPuzzleDate } from '../../shared/date';
import { difficultyFromPar, difficultyLabel } from '../../shared/solver/difficulty';
import { TUTORIAL_STEPS } from '../../shared/tutorial';
import { ACTION_BAR_GAP, actionBarSlots, playLayout, type PlayLayout } from '../../shared/playLayout';
import { context, showLoginPrompt, showShareSheet, showToast } from '@devvit/web/client';
import { isAnyAudioOn, playHop, playSlide, playSplash, playWin, setAllAudioOn } from '../audio';
import { consumeDailyHandoff } from '../dailyHandoff';
import { showHowToPlay } from '../howToPlay';
import { showLeaderboard } from '../leaderboard';
import { trackClientEvent } from '../telemetry';
import { parseDailyLeaderboard } from '../../shared/leaderboard';

type DragState = {
  pieceIndex: number;
  orient: 'H' | 'V';
  originX: number;
  originY: number;
  min: number;
  max: number;
  targets: { coord: number; move: Move }[];
};

/** A result screen's card metrics; its dim overlay and panel are drawn. */
type ResultCard = {
  readonly w: number;
  readonly h: number;
  readonly contentW: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly compact: boolean;
};

/** One tile in a result screen's stat row (rank, streak, par rate). */
type StatTile = {
  readonly value: string;
  readonly label: string;
  readonly flame?: boolean;
};

/** Everything a result card shows, top to bottom. */
type ResultSpec = {
  /** A bobbing penguin above the title, for cards without a star row. */
  readonly mascot?: boolean;
  readonly title: string;
  readonly blurb?: string;
  /** Stars earned (0-3); omit for no star row. */
  readonly stars?: number;
  /** Final move count for the "6 moves · par 6" line; omit for none. */
  readonly moves?: number;
  readonly countUp?: boolean;
  /** Height kept free under the score line for async content (status, tiles). */
  readonly slotHeight: number;
  readonly primary: PillButton;
  /** Two per row when every label fits, otherwise one per row. */
  readonly secondaries: readonly PillButton[];
  /** A quiet optional link under the primary (sign in, join). */
  readonly quiet?: PillButton;
};

/** The Daily win's async block, driven by the verified solve and leaderboard. */
type DailyResultView = {
  readonly isActive: () => boolean;
  readonly setNote: (text: string) => void;
  readonly setStats: (tiles: readonly StatTile[]) => void;
  readonly revealLeaderboard: (data: LeaderboardResponse) => void;
};

const STAT_TILE_HEIGHT = 56;
const RESULT_NOTE_HEIGHT = 22;

const responseProperty = (value: object, key: string): unknown => Reflect.get(value, key);
const isResponseObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const parseMarkPlayedResponse = (value: unknown): MarkPlayedResponse | null => {
  if (!isResponseObject(value) || typeof responseProperty(value, 'ok') !== 'boolean') {
    return null;
  }
  const ok = responseProperty(value, 'ok');
  const saved = responseProperty(value, 'saved');
  if (ok === true) {
    const firstSolve = responseProperty(value, 'firstSolve');
    return typeof saved === 'boolean' && typeof firstSolve === 'boolean'
      ? { ok: true, saved, firstSolve }
      : null;
  }
  const reason = responseProperty(value, 'reason');
  return saved === false && typeof reason === 'string' && reason.length > 0
    ? { ok: false, saved: false, reason }
    : null;
};

export class GameScene extends Scene {
  private board?: Board;
  private pieces: Piece[] = [];
  private par = 0;
  private moves = 0;
  /** Canonical legal moves committed for the current attempt. */
  private moveHistory: Move[] = [];
  private date = '';
  private dailyPuzzleId = '';
  private dailyPlayId = '';
  private selected: number | null = null;
  private busy = false;
  private won = false;
  /** True while the returning-player recap owns the interactive surface. */
  private dailyRecapOpen = false;
  /** One start per expanded Daily visit, emitted on its first committed move. */
  private dailyStartTracked = false;
  /** Whether the player has already posted their score to this post's comment
   *  thread (so "Comment my score" can't double-post). Reset for each puzzle. */
  private scorePosted = false;
  /** Completion save in flight; comments wait for this verified record. */
  private completionPromise?: Promise<void>;
  /** Whether the puzzle on screen came straight from the host post, so its
   *  thread, par and creator match context.postId. True only for a non-forced
   *  /api/init load; gates "Comment my score" so it can never post a mismatched
   *  comment after the player navigates to a different puzzle in the same
   *  webview (Next, a hub community puzzle, or a forced daily inside a UGC post). */
  private isHostPostPuzzle = false;
  private shareText = '';
  /** Whether we've recorded the viewer as subscribed (drives the Join CTA). */
  private subscribed = false;
  /** Current subreddit name, for the "Join r/{name}" CTA label. */
  private subredditName = '';
  private menuButton!: PillButton;
  private communityPuzzle?: { id: string; board: Board; par: number; creator: string; votes: number; solves: number };
  private isCommunity = false;
  /** Started from the in-app Community list or its Next/Skip (not the host post). */
  private fromCommunityList = false;
  private testBoard?: Board;
  private testPar = 0;
  private isTest = false;
  /** When set, load today's daily explicitly (via /api/init?daily=1) instead of
   *  the current post's puzzle - so the hub can reach the daily even from inside
   *  a community-puzzle post (where the post maps to a UGC puzzle). */
  private forceDaily = false;
  private isEndless = false;
  private endlessTier: EndlessTier = 'easy';
  private endlessIssueId = '';
  private endlessSolved = 0;
  private endlessSaveGeneration = 0;
  /** Invalidates async work whenever Phaser reuses this scene for a new puzzle. */
  private playGeneration = 0;
  /** Keep the warmed issue only for the explicit Endless "Next" transition. */
  private preserveEndlessPrefetch = false;
  private endlessBanner!: PillButton;
  private skipButton!: PillButton;
  private resetButton!: PillButton;
  private hintButton!: PillButton;
  private helpButton!: PillButton;
  private muteButton!: IconButton;
  /** The shared "How to play" overlay, when open (guards against stacking). */
  private howTo?: Phaser.GameObjects.Container;
  /** The shared leaderboard overlay on the Daily win screen, when open. */
  private leaderboardOverlay?: Phaser.GameObjects.Container;
  private hintLayer!: Phaser.GameObjects.Container;
  private hintStage = 0;
  private hintUsed = false;
  private hintRequestPending = false;
  private dragState: DragState | null = null;
  /** One flipper bump per drag when a seal is pushed toward open water. */
  private sealRefused = false;
  /** The current selection was kept automatically after a hop. */
  private keptSelection = false;
  /** The ~1s win beat (splash, dive, cheer) before the result card appears. */
  private celebrating = false;
  /**
   * Verified-completion requests started at the moment of the win, so leaving
   * during the celebration can never lose a solve. The result card's code
   * consumes each one exactly once (a later manual retry sends a fresh request).
   */
  private prefetchedCompletions = new Map<string, Promise<Response>>();
  /** Hands-on practice step (null outside the tutorial). */
  private tutorialStep: number | null = null;
  private undoButton!: PillButton;
  private goalText!: Phaser.GameObjects.Text;
  private tutorialText?: Phaser.GameObjects.Text;
  /** Transient splash / snow / cheer effects; never cleared by highlights. */
  private effectsLayer!: Phaser.GameObjects.Container;
  /** True once the current press turned into a seal drag (so it is not a tap). */
  private dragMoved = false;
  /** Whether the current press began on bare ice (tap-to-deselect on release). */
  private emptyPress = false;

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
  /** Current play-screen geometry (see playLayout.ts). */
  private geometry?: PlayLayout;
  /** Mode line under Moves/Par: "Daily · Fri, Oct 30 · Medium". */
  private contextText!: Phaser.GameObjects.Text;
  /** Viewport dimensions used when the active recap/win overlay was drawn. */
  private overlayBaseWidth = 0;
  private overlayBaseHeight = 0;
  private blockingShield?: Phaser.GameObjects.Rectangle;

  constructor() {
    super('GameScene');
  }

  init(data?: {
    community?: { id: string; board: Board; par: number; creator: string; votes: number; solves: number };
    test?: { board: Board; par: number };
    endless?: { tier: EndlessTier };
    daily?: boolean;
    tutorial?: { step: number };
  }): void {
    const step = data?.tutorial?.step;
    this.tutorialStep =
      typeof step === 'number' && Number.isSafeInteger(step) && step >= 0 && step < TUTORIAL_STEPS.length
        ? step
        : null;
    this.celebrating = false;
    this.sealRefused = false;
    this.keptSelection = false;
    this.prefetchedCompletions = new Map();
    this.tutorialText = undefined;
    this.communityPuzzle = data?.community;
    this.isCommunity = Boolean(data?.community);
    this.fromCommunityList = Boolean(data?.community);
    this.testBoard = data?.test?.board;
    this.testPar = data?.test?.par ?? 0;
    this.isTest = Boolean(data?.test);
    this.isEndless = Boolean(data?.endless);
    this.endlessTier = data?.endless?.tier ?? 'easy';
    this.forceDaily = Boolean(data?.daily);
    this.scorePosted = false;
    this.completionPromise = undefined;
    this.isHostPostPuzzle = false;
    this.dailyPuzzleId = '';
    this.dailyPlayId = '';
    this.endlessIssueId = '';
    this.endlessSolved = 0;
    this.endlessSaveGeneration += 1;
    this.playGeneration += 1;
    this.preserveEndlessPrefetch = false;
    // Scene instances are reused across restarts, so reset transient and
    // board-derived state before an asynchronous load can be resized.
    this.board = undefined;
    this.par = 0;
    this.date = '';
    this.pieces = [];
    this.moves = 0;
    this.moveHistory = [];
    this.selected = null;
    this.busy = false;
    this.won = false;
    this.dailyRecapOpen = false;
    this.dailyStartTracked = false;
    this.dragState = null;
    this.shareText = '';
    this.hintStage = 0;
    this.hintUsed = false;
    this.hintRequestPending = false;
    this.geometry = undefined;
    this.overlayBaseWidth = 0;
    this.overlayBaseHeight = 0;
    this.blockingShield = undefined;
    this.howTo = undefined;
    this.leaderboardOverlay = undefined;
    this.loadErrorViews = [];
  }

  create(): void {
    useCrispRendering(this);
    this.dragMoved = false;
    this.emptyPress = false;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
    this.boardLayer = this.add.container(0, 0);
    this.pieceLayer = this.add.container(0, 0);
    this.effectsLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.hintLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    this.hudText = this.add
      .text(0, 0, 'Moves 0    Par 0', { fontFamily: FONT.ui, fontSize: '20px', fontStyle: '800', color: COLORS.text })
      .setOrigin(0.5);
    this.hintText = this.add
      .text(0, 0, 'Tap a penguin, then a gold dot. Drag or tap a seal.\nGet every penguin into the water.', {
        fontFamily: FONT.ui,
        fontSize: '13px',
        fontStyle: '600',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 3,
        wordWrap: { width: viewWidth(this) - 24 },
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    // Live "★★★ up to N" goal beside Moves/Par (same wording as the feed post).
    this.goalText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '20px', fontStyle: '800', color: '#ffd166' })
      .setOrigin(0.5);
    // Mode line: names what is being played (and by whom) with its difficulty,
    // matching the feed header, so a Community board credits its creator.
    this.contextText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '13px', fontStyle: '700', color: COLORS.text })
      .setOrigin(0.5)
      .setAlpha(0.72);
    this.uiLayer.add([this.hudText, this.hintText, this.goalText, this.contextText]);

    // Back goes up one level: Test to the editor, a puzzle picked from the
    // Community list back to that list, everything else to the hub.
    this.menuButton = makePill(this, {
      label: this.isTest ? '\u2039 Edit' : this.fromCommunityList ? '\u2039 Community' : '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => {
        if (this.isTest) fadeToScene(this, 'EditorScene');
        else if (this.fromCommunityList) fadeToScene(this, 'CommunityScene', { resume: true });
        else fadeToScene(this, 'HomeScene');
      },
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

    // Undo the last move (action bar, left of Restart). Every move has an
    // exact reverse and only the final move list is scored, so stepping back
    // is a convenience that never changes how a solve counts.
    this.undoButton = makePill(this, {
      label: '\u21B6 Undo',
      variant: 'chip',
      size: 'md',
      onClick: () => this.undoMove(),
    });
    this.uiLayer.add(this.undoButton);

    // Restart the current board (action bar). Shown from the start, disabled
    // until the first move, so the bar never jumps when play begins.
    this.resetButton = makePill(this, {
      label: '\u21BA Restart',
      variant: 'chip',
      size: 'md',
      onClick: () => this.resetPuzzle(),
    });
    this.uiLayer.add(this.resetButton);

    // Hint (Endless only): reveals the solver's best next move, available from
    // the start. Using it means the solve won't count.
    this.hintButton = makePill(this, {
      label: '\u2726 Hint',
      variant: 'chip',
      size: 'md',
      onClick: () => void this.showHint(),
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
    if (this.tutorialStep !== null) {
      // Practice shows its progress where Endless shows "Solved".
      this.endlessBanner.setLabelText(`Practice ${this.tutorialStep + 1} of ${TUTORIAL_STEPS.length}`);
    }

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

    // Tapping empty ice clears the current selection. Like every other tap it
    // acts on release, and only when the press also began on bare ice.
    this.input.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        this.emptyPress = currentlyOver.length === 0;
      }
    );
    this.input.on(
      'pointerup',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        const pressedEmpty = this.emptyPress;
        this.emptyPress = false;
        if (
          pressedEmpty &&
          !this.busy &&
          !this.won &&
          !this.dailyRecapOpen &&
          currentlyOver.length === 0 &&
          this.selected !== null
        ) {
          this.selected = null;
          this.renderHighlights();
        }
      }
    );

    // Seal dragging. A small threshold keeps a tap a tap: tapping a seal
    // selects it and shows its lane stops, exactly like the feed post.
    // Phaser measures this in canvas pixels, so scale it to stay 8 CSS px.
    this.input.dragDistanceThreshold = 8 * RENDER_SCALE;
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
      paintBackdrop(this, this.bgLayer, viewWidth(this), viewHeight(this));
      if (this.loadingText) this.loadingText.setPosition(viewWidth(this) / 2, viewHeight(this) / 2);
      if (!this.board) return;
      if (this.won || this.dailyRecapOpen) {
        this.fitBlockingOverlay();
        return;
      }
      this.resetFxTransform();
      this.layout();
      this.renderBoard();
      this.updateHud();
      if (this.tutorialStep !== null) this.showTutorialGuide();
    };
    this.scale.on('resize', onResize);
    // The ScaleManager is global and outlives the scene, so a listener left
    // attached would pile up on every scene (re)start - endless restarts this
    // same scene on each "Next" - firing stale handlers on destroyed objects.
    // Remove it when the scene shuts down.
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      // A board abandoned before its win should not occupy a server issue slot.
      if (this.isEndless && !this.won && this.endlessIssueId) {
        this.releaseEndlessIssue(this.endlessIssueId);
        this.endlessIssueId = '';
      }
      if (this.isEndless && !this.preserveEndlessPrefetch) {
        this.abandonPrefetchedEndless();
      }
    });

    // Hide the UI behind a calm loading state until the board is ready, so the
    // half-built frame (empty backdrop + unpositioned HUD) never flashes.
    this.uiLayer.setVisible(false);
    this.loadingText = this.add
      .text(viewWidth(this) / 2, viewHeight(this) / 2, 'Getting the penguins ready\u2026', {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '600',
        color: COLORS.text,
      })
      .setOrigin(0.5)
      .setAlpha(0.85);

    void this.loadPuzzle();
  }

  private isCurrentPlay(generation: number): boolean {
    return generation === this.playGeneration && this.sys.isActive();
  }

  private async loadPuzzle(): Promise<void> {
    const generation = this.playGeneration;
    this.clearLoadError();
    this.moveHistory = [];
    if (this.tutorialStep !== null) {
      const step = TUTORIAL_STEPS[this.tutorialStep];
      this.board = step.board;
      this.pieces = step.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = solve(step.board).par;
      this.date = '';
      this.moves = 0;
      this.layout();
      this.renderBoard();
      this.updateHud();
      this.showTutorialGuide();
      return;
    }
    if (this.isTest && this.testBoard) {
      this.board = this.testBoard;
      this.pieces = this.testBoard.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = this.testPar;
      this.date = '';
      this.moves = 0;

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

      this.layout();
      this.renderBoard();
      this.updateHud();
      trackClientEvent('community_started');
      return;
    }
    if (this.isEndless) {
      try {
        const data = await this.takeOrFetchEndless();
        if (!this.isCurrentPlay(generation)) {
          this.releaseEndlessIssue(data.issueId);
          return;
        }
        this.board = data.board;
        this.pieces = data.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
        this.par = data.par;
        this.endlessIssueId = data.issueId;
        // Issue and completion responses can race; preserve the highest
        // server-confirmed/session total regardless of which response arrives last.
        this.endlessSolved = mergeProgressCount(
          this.registry.get('endless.solved'),
          data.solved
        );
        this.registry.set('endless.solved', this.endlessSolved);
        this.date = '';
        this.moves = 0;

        this.layout();
        this.renderBoard();
        this.updateHud();
        trackClientEvent('endless_started');
        // Warm the next puzzle in the background so "Next" is instant. The short
        // delay avoids competing with this board's first render and skips the
        // fetch if the player immediately bounces.
        this.time.delayedCall(500, () => this.prefetchNextEndless());
      } catch (error) {
        console.error(error);
        if (this.isCurrentPlay(generation)) {
          this.showLoadError('Could not load an endless puzzle.');
        }
      }
      return;
    }
    try {
      const url = this.forceDaily ? '/api/init?daily=1' : '/api/init';
      const response = await this.fetchWithTimeout(url);
      if (!this.isCurrentPlay(generation)) return;
      if (!response.ok) throw new Error(`init failed: ${response.status}`);
      const data: InitResponse = await response.json();
      if (!this.isCurrentPlay(generation)) return;
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

        this.layout();
        this.renderBoard();
        this.updateHud();
        trackClientEvent('community_started');
        return;
      }
      this.board = data.board;
      this.pieces = data.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
      this.par = data.par;
      this.date = data.date;
      this.dailyPuzzleId = data.puzzleId;
      this.dailyPlayId = data.playId;
      this.subscribed = data.subscribed;
      this.subredditName = data.subredditName ?? '';
      this.moves = 0;

      const guestResult = context.username
        ? null
        : guestDailyCompletionFor(
            this.registry.get('daily.solved.guest'),
            data.puzzleId
          );
      const hasVerifiedRecap = data.solved || guestResult !== null;
      let restoredProgress = false;
      // Inline continuity is scoped to this Reddit tab and exact host-post
      // Daily. The authoritative init supplies every trusted field; storage
      // contributes only a bounded transcript that must legally replay.
      const hostPostId = typeof context.postId === 'string' ? context.postId : '';
      const handoff =
        this.forceDaily || !hostPostId
          ? null
          : consumeDailyHandoff({
              auth: data.username === 'anon' ? 'guest' : 'signed',
              postId: hostPostId,
              puzzleId: data.puzzleId,
              ...(data.username === 'anon' ? {} : { playId: data.playId }),
            });
      if (handoff && handoff.moves.length > 0) {
        const replay = replayMoves(data.board, handoff.moves);
        if (replay.ok && !replay.solved) {
          this.dailyStartTracked = true;
          this.pieces = replay.pieces.map((piece) => ({
            ...piece,
            cells: [...piece.cells],
          }));
          this.moveHistory = replay.moves.map((move) => ({
            pieceIndex: move.pieceIndex,
            kind: move.kind,
            to: [...move.to],
          }));
          this.moves = replay.moveCount;
          restoredProgress = replay.moveCount > 0;
          // Guest init tokens are intentionally regenerated on each disclosure;
          // retain the earlier guest bearer token so the original inline clock
          // remains authoritative. Signed players must match the stable init ID.
          if (data.username === 'anon' && handoff.auth === 'guest') {
            this.dailyPlayId = handoff.playId;
          }
        }
      }

      this.layout();
      this.renderBoard();
      this.updateHud();
      if (hasVerifiedRecap && !restoredProgress) {
        this.showDailySolvedRecap(data.solvedResult ?? guestResult ?? undefined);
      } else if (!restoredProgress) {
        this.maybeAutoShowHowTo();
      }
    } catch (error) {
      console.error(error);
      if (this.isCurrentPlay(generation)) {
        this.showLoadError('Could not load today\u2019s puzzle.');
      }
    }
  }

  /** Show a recovery UI when a puzzle fails to load, so a network/API error is
   *  never a dead end: the player can retry or head back to the hub. */
  private showLoadError(message: string): void {
    this.clearLoadError();
    if (this.loadingText) this.loadingText.setText(message).setVisible(true);
    const w = viewWidth(this);
    const h = viewHeight(this);
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
    this.howTo = showHowToPlay(
      this,
      () => {
        this.howTo = undefined;
      },
      this.tutorialStep === null
        ? () => fadeToScene(this, 'GameScene', { tutorial: { step: 0 } })
        : undefined
    );
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
  private async takeOrFetchEndless(): Promise<EndlessResponse> {
    const stash: EndlessResponse | undefined = this.registry.get('endless.prefetch');
    if (stash && stash.tier === this.endlessTier && stash.board) {
      this.registry.remove('endless.prefetch');
      return stash;
    }
    // A stash for a different tier is abandoned; release its server slot.
    if (stash) {
      this.registry.remove('endless.prefetch');
      this.releaseEndlessIssue(stash.issueId);
    }
    return this.fetchEndless(this.endlessTier);
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

  /**
   * Send a verified completion, reusing the request already started at the
   * win (consumed once, so a later manual retry always sends a fresh one).
   */
  private postCompletionWithRetries(url: string, body: string): Promise<Response> {
    const key = `${url}\n${body}`;
    const prefetched = this.prefetchedCompletions.get(key);
    if (prefetched) {
      this.prefetchedCompletions.delete(key);
      return prefetched;
    }
    return this.sendCompletionWithRetries(url, body);
  }

  /** Retry idempotent verified-completion POSTs with the exact same transcript. */
  private async sendCompletionWithRetries(url: string, body: string): Promise<Response> {
    let lastError: Error = new Error('completion request failed');
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (response.ok) return response;
        lastError = new Error(`completion failed: ${response.status}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('completion request failed');
      } finally {
        clearTimeout(timer);
      }
      if (attempt < 2) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async fetchEndless(tier: EndlessTier): Promise<EndlessResponse> {
    const response = await this.fetchWithTimeout(`/api/endless?tier=${encodeURIComponent(tier)}`);
    if (!response.ok) throw new Error(`endless failed: ${response.status}`);
    const data: EndlessResponse = await response.json();
    return data;
  }

  /** Best-effort release of a signed user's abandoned issued board. */
  private releaseEndlessIssue(issueId: string): void {
    if (!context.username || !issueId) return;
    void fetch('/api/endless/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId }),
    }).catch((error) => console.error(error));
  }

  /** Release a warmed board when navigation abandons Endless instead of using Next. */
  private abandonPrefetchedEndless(): void {
    const stash: EndlessResponse | undefined = this.registry.get('endless.prefetch');
    if (!stash) return;
    this.registry.remove('endless.prefetch');
    this.releaseEndlessIssue(stash.issueId);
  }

  /** Fetch the next puzzle for the current tier and stash it so "Next" is instant. */
  private prefetchNextEndless(): void {
    if (!this.isEndless) return;
    const existing: EndlessResponse | undefined = this.registry.get('endless.prefetch');
    if (existing && existing.tier === this.endlessTier) return;
    if (existing) {
      this.registry.remove('endless.prefetch');
      this.releaseEndlessIssue(existing.issueId);
    }

    const generation = this.playGeneration;
    const tier = this.endlessTier;
    void this.fetchEndless(tier)
      .then((data) => {
        if (!this.isCurrentPlay(generation) || !this.isEndless || tier !== this.endlessTier) {
          this.releaseEndlessIssue(data.issueId);
          return;
        }
        const current: EndlessResponse | undefined = this.registry.get('endless.prefetch');
        if (current) {
          // Another request won the stash race. Keep its board and release ours.
          this.releaseEndlessIssue(data.issueId);
          return;
        }
        this.registry.set('endless.prefetch', data);
      })
      .catch((error) => console.error(error));
  }

  private resetFxTransform(): void {
    this.fxLayer.setPosition(0, 0);
    this.fxLayer.setScale(1);
  }

  private beginBlockingOverlay(): void {
    if (this.blockingShield?.active) this.blockingShield.destroy();
    this.blockingShield = undefined;
    this.resetFxTransform();
    this.overlayBaseWidth = viewWidth(this);
    this.overlayBaseHeight = viewHeight(this);
  }

  /** Uniformly fit an already-rendered modal and keep its input shield full-screen. */
  private fitBlockingOverlay(): void {
    if (this.overlayBaseWidth <= 0 || this.overlayBaseHeight <= 0) return;
    const scale = Math.min(
      viewWidth(this) / this.overlayBaseWidth,
      viewHeight(this) / this.overlayBaseHeight
    );
    const layerX = (viewWidth(this) - this.overlayBaseWidth * scale) / 2;
    const layerY = (viewHeight(this) - this.overlayBaseHeight * scale) / 2;
    this.fxLayer.setScale(scale);
    this.fxLayer.setPosition(layerX, layerY);

    if (this.blockingShield?.active) this.blockingShield.destroy();
    const shield = this.add
      .rectangle(
        (viewWidth(this) / 2 - layerX) / scale,
        (viewHeight(this) / 2 - layerY) / scale,
        viewWidth(this) / scale,
        viewHeight(this) / scale,
        0x000000,
        0.001
      )
      .setInteractive();
    this.fxLayer.addAt(shield, 0);
    this.blockingShield = shield;
  }

  private layout(): void {
    if (!this.board) return;
    // Shared with the UI smoke test (src/client/playLayout.ts): a three-row
    // HUD, then the board with its action bar and tip docked underneath.
    this.geometry = playLayout({
      width: viewWidth(this),
      height: viewHeight(this),
      cols: this.board.width,
      rows: this.board.height,
    });
    this.cell = this.geometry.cell;
    this.originX = this.geometry.originX;
    this.originY = this.geometry.originY;
    this.hudHeight = this.geometry.hudBottom;
  }

  /** The mode line under Moves/Par: what this board is and how hard. */
  private contextLabel(): string {
    if (this.tutorialStep !== null) return '';
    if (this.isTest) return 'Test play \u00B7 solve it to unlock Submit';
    const band = difficultyLabel(difficultyFromPar(this.par));
    if (this.isCommunity) {
      const creator = this.communityPuzzle?.creator;
      return creator ? `Community \u00B7 by ${creator} \u00B7 ${band}` : `Community \u00B7 ${band}`;
    }
    if (this.isEndless) {
      return `Endless \u00B7 ${this.endlessTier.charAt(0).toUpperCase()}${this.endlessTier.slice(1)}`;
    }
    return this.date
      ? `Daily \u00B7 ${formatPuzzleDate(this.date, true)} \u00B7 ${band}`
      : `Daily \u00B7 ${band}`;
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
      this.dragMoved = false;
    });
    armTap(container, {
      canPress: () => !this.busy && !this.won && !this.dailyRecapOpen,
      onTap: () => {
        // A press that became a seal drag is a move attempt, not a selection.
        if (this.dragMoved || this.busy || this.won || this.dailyRecapOpen || this.dragState) {
          return;
        }
        if (this.selected === idx && this.keptSelection) {
          // The penguin stayed selected after its hop; a habitual tap on it
          // keeps it selected instead of hiding its moves.
          this.keptSelection = false;
          return;
        }
        this.keptSelection = false;
        this.selected = this.selected === idx ? null : idx;
        this.renderHighlights();
      },
    });
  }

  private renderHighlights(): void {
    if (!this.board || this.won || this.dailyRecapOpen) return;
    this.blockingShield = undefined;
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
    const moves = legalMoves(this.board, this.pieces).filter((m) => m.pieceIndex === this.selected);

    if (sel.kind === 'HOPPER') {
      const ring = this.add.circle(selCenter.x, selCenter.y, this.cell * 0.46);
      ring.setFillStyle(0, 0);
      ring.setStrokeStyle(3, COLORS.select);
      this.fxLayer.add(ring);
      for (const move of moves) {
        const center = this.pieceCenterPx(move.to);
        const dot = this.add.circle(center.x, center.y, this.cell * 0.18, COLORS.hint, 0.9);
        dot.setStrokeStyle(2, 0xffffff);
        // The whole destination cell is the target (the dot is only the cue),
        // so a near-miss on a phone still hops instead of clearing the choice.
        const zone = this.add.zone(center.x, center.y, this.cell, this.cell).setInteractive();
        armTap(zone, { onTap: () => this.doMove(move) });
        this.fxLayer.add([dot, zone]);
      }
    } else if (sel.kind === 'SLIDER') {
      this.drawSealLane(sel, selCenter, moves);
    }
  }

  /**
   * A selected seal shows the same cues as the feed post: a gold outline on its
   * exact 1x2 footprint, one lane outline spanning every reachable position,
   * and a one-cell stop (chevron) per legal slide. Pressing a stop previews the
   * landing footprint; releasing on it commits that slide. Dragging the seal
   * along its lane still works too.
   */
  private drawSealLane(
    piece: Piece,
    center: { x: number; y: number },
    moves: readonly Move[]
  ): void {
    if (!this.board) return;
    const s = this.cell;
    const horizontal = (piece.orient ?? 'H') === 'H';
    const footW = horizontal ? s * 2 : s;
    const footH = horizontal ? s : s * 2;
    const radius = s * 0.24;

    if (moves.length > 0) {
      const axis = [
        horizontal ? center.x : center.y,
        ...moves.map((move) => {
          const destination = this.pieceCenterPx(move.to);
          return horizontal ? destination.x : destination.y;
        }),
      ];
      const low = Math.min(...axis) - s;
      const high = Math.max(...axis) + s;
      const lane = this.add.graphics();
      lane.lineStyle(3, COLORS.iceHi, 0.82);
      if (horizontal) lane.strokeRoundedRect(low, center.y - s * 0.42, high - low, s * 0.84, s * 0.28);
      else lane.strokeRoundedRect(center.x - s * 0.42, low, s * 0.84, high - low, s * 0.28);
      this.fxLayer.add(lane);
    }

    const outline = this.add.graphics();
    outline.lineStyle(3, COLORS.select, 1);
    outline.strokeRoundedRect(center.x - footW / 2 + 3, center.y - footH / 2 + 3, footW - 6, footH - 6, radius);
    this.fxLayer.add(outline);

    for (const move of moves) {
      const stop = slideStop(piece, move, this.board.width);
      if (!stop) continue;
      const at = this.cellCenter(stop.leadingCell);
      const landing = this.pieceCenterPx(move.to);

      const preview = this.add.graphics();
      preview.fillStyle(COLORS.ice, 0.34);
      preview.fillRoundedRect(landing.x - footW / 2 + 4, landing.y - footH / 2 + 4, footW - 8, footH - 8, radius);
      preview.lineStyle(2, COLORS.iceHi, 0.96);
      preview.strokeRoundedRect(landing.x - footW / 2 + 4, landing.y - footH / 2 + 4, footW - 8, footH - 8, radius);
      preview.setVisible(false);

      const dx = stop.direction === 'right' ? 1 : stop.direction === 'left' ? -1 : 0;
      const dy = stop.direction === 'down' ? 1 : stop.direction === 'up' ? -1 : 0;
      const k = s * 0.12;
      const chevron = this.add.graphics();
      chevron.lineStyle(Math.max(3, s * 0.06), COLORS.iceHi, 1);
      chevron.beginPath();
      chevron.moveTo(at.x - dx * k - dy * k, at.y - dy * k + dx * k);
      chevron.lineTo(at.x + dx * k, at.y + dy * k);
      chevron.lineTo(at.x - dx * k + dy * k, at.y - dy * k - dx * k);
      chevron.strokePath();

      const zone = this.add.zone(at.x, at.y, s, s).setInteractive();
      armTap(zone, {
        onPress: () => preview.setVisible(true),
        onCancel: () => preview.setVisible(false),
        onTap: () => this.doMove(move),
      });
      this.fxLayer.add([preview, chevron, zone]);
    }
  }

  private onSealDragStart(obj: Phaser.GameObjects.GameObject): void {
    if (!this.board || this.busy || this.won || this.dailyRecapOpen) return;
    if (obj.getData('slider') !== true) return;
    // Phaser only reports a drag after the pointer moves past the threshold,
    // so the release that ends it must not also count as a tap.
    this.dragMoved = true;
    this.sealRefused = false;
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
    const raw = ds.orient === 'H' ? dragX : dragY;
    const clamped = Phaser.Math.Clamp(raw, ds.min, ds.max);
    if (ds.orient === 'H') {
      view.x = clamped;
      view.y = ds.originY;
    } else {
      view.y = clamped;
      view.x = ds.originX;
    }
    // Pushing past the last stop toward open water: the seal refuses with a
    // flipper bump (once per drag), which teaches "seals won't enter water".
    const overshoot = raw - clamped;
    if (!this.sealRefused && Math.abs(overshoot) > this.cell * 0.25) {
      const direction = overshoot > 0 ? 1 : -1;
      if (this.sealStopsAtWater(ds, direction)) {
        this.sealRefused = true;
        this.bumpSeal(view, ds.orient, direction);
      }
    }
  }

  /** Whether the seal's farthest reachable stop in `direction` faces water. */
  private sealStopsAtWater(ds: DragState, direction: 1 | -1): boolean {
    const piece = this.pieces[ds.pieceIndex];
    if (!this.board || !piece) return false;
    const originCoord = ds.orient === 'H' ? ds.originX : ds.originY;
    let farthest: Piece = piece;
    let best = 0;
    for (const target of ds.targets) {
      const offset = (target.coord - originCoord) * direction;
      if (offset > best) {
        best = offset;
        farthest = { ...piece, cells: target.move.to };
      }
    }
    return sealBlockedByWater(this.board, farthest, direction);
  }

  private bumpSeal(view: Phaser.GameObjects.Container, orient: 'H' | 'V', direction: 1 | -1): void {
    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (!art) return;
    const distance = -direction * this.cell * 0.08;
    const done = (): void => {
      art.x = 0;
      art.y = 0;
    };
    if (orient === 'H') {
      this.tweens.add({ targets: art, x: distance, duration: 70, yoyo: true, repeat: 1, ease: 'Sine.easeInOut', onComplete: done });
    } else {
      this.tweens.add({ targets: art, y: distance, duration: 70, yoyo: true, repeat: 1, ease: 'Sine.easeInOut', onComplete: done });
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
    if (!this.board || this.busy || this.won || this.dailyRecapOpen) return;
    this.busy = true;
    this.fxLayer.removeAll(true);
    this.clearHint();
    const board = this.board;
    const piece = this.pieces[move.pieceIndex];
    const view = this.pieceViews[move.pieceIndex];
    const target = this.pieceCenterPx(move.to);
    const landsInWater = move.to.every((cell) => board.holes.includes(cell));
    const reduced = prefersReducedMotion();
    // Longer hops take a little longer (shared with the feed post).
    const duration = piece ? moveDurationMs(board, piece, move) : 240;

    const commit = (): void => {
      if (!this.board) return;
      if (landsInWater) {
        // Effects get their own layer: renderHighlights() clears fxLayer,
        // which used to delete every splash in the same frame it was drawn.
        splashBurst(this, this.effectsLayer, target.x, target.y, this.cell);
        playSplash();
      }
      this.pieces = applyMove(this.pieces, move);
      this.moves += 1;
      this.moveHistory.push({ pieceIndex: move.pieceIndex, kind: move.kind, to: [...move.to] });
      if (
        !this.isTest &&
        !this.isEndless &&
        !this.isCommunity &&
        this.tutorialStep === null &&
        !this.dailyStartTracked
      ) {
        this.dailyStartTracked = true;
        trackClientEvent('daily_started');
      }
      const solved = isSolved(this.board, this.pieces);
      const canContinue = legalMoves(this.board, this.pieces).some(
        (candidate) => candidate.pieceIndex === move.pieceIndex
      );
      // A penguin that can keep hopping stays selected (one tap per hop).
      this.selected =
        !solved && keepSelectedAfterMove(this.board, move, canContinue) ? move.pieceIndex : null;
      this.keptSelection = this.selected !== null;
      this.busy = false;
      // Rebuild only the moved piece's art (its outer view is already tweened to
      // the destination); every other piece keeps its idle animation running.
      const movedView = this.pieceViews[move.pieceIndex];
      if (movedView) this.buildPieceArt(movedView, this.pieces[move.pieceIndex], move.pieceIndex);
      this.updateHud();
      this.renderHighlights();
      const movedArt: Phaser.GameObjects.Container | undefined = movedView?.getData('art');
      if (movedArt && move.kind === 'HOPPER' && !reduced) {
        if (landsInWater) {
          // Dive-pop: a penguin that just entered the water bobs up from below.
          movedArt.setScale(1.12, 0.6);
          this.tweens.add({ targets: movedArt, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
        } else {
          // Landing squash, settling back to the selection emphasis if any.
          const rest = this.selected === move.pieceIndex ? 1.1 : 1;
          movedArt.setScale(rest * 1.1, rest * 0.86);
          this.tweens.add({ targets: movedArt, scaleX: rest, scaleY: rest, duration: 170, ease: 'Back.easeOut' });
        }
      }
      if (solved) this.celebrateWin();
      else if (this.tutorialStep !== null) this.showTutorialGuide();
    };

    if (!view) {
      commit();
      return;
    }

    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (art) this.tweens.killTweensOf(art);

    if (move.kind === 'HOPPER') playHop();
    else playSlide();
    this.tweens.add({ targets: view, x: target.x, y: target.y, duration, ease: 'Quad.easeOut', onComplete: commit });

    if (art && move.kind === 'HOPPER') {
      // Lift through an arc with a squash on take-off and landing.
      this.tweens.add({ targets: art, y: -this.cell * 0.45, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: art, scaleX: 0.86, scaleY: 1.2, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
    } else if (art) {
      // Seal slide: a brief squash in the direction of travel, plus a puff of
      // snow kicked up behind its tail.
      this.tweens.add({ targets: art, scaleX: 1.12, scaleY: 0.9, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
      if (piece && !reduced) this.spraySnowBehind(view, piece, move);
    }
  }

  private spraySnowBehind(view: Phaser.GameObjects.Container, piece: Piece, move: Move): void {
    const from = this.pieceCenterPx(piece.cells);
    const to = this.pieceCenterPx(move.to);
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    if (dx === 0 && dy === 0) return;
    snowSpray(
      this,
      this.effectsLayer,
      view.x - dx * this.cell * 0.9,
      view.y - dy * this.cell * 0.9 + this.cell * 0.2,
      -dx,
      -dy,
      this.cell
    );
  }

  /**
   * Step back one move. Every legal move has an exact reverse, and servers
   * score only the final transcript, so Undo is the same as replaying the
   * earlier moves from the start: it never changes how a solve counts.
   */
  private undoMove(): void {
    if (!this.board || this.busy || this.won || this.celebrating || this.dailyRecapOpen) return;
    const last = this.moveHistory[this.moveHistory.length - 1];
    if (!last) return;
    const remaining = this.moveHistory.slice(0, -1);
    const replay = replayMoves(this.board, remaining);
    if (!replay.ok) return;
    this.busy = true;
    this.selected = null;
    this.fxLayer.removeAll(true);
    this.clearHint();
    const before = replay.pieces[last.pieceIndex];
    const view = this.pieceViews[last.pieceIndex];
    const commit = (): void => {
      this.pieces = replay.pieces.map((piece) => ({ ...piece, cells: [...piece.cells] }));
      this.moveHistory = remaining.map((move) => ({ ...move, to: [...move.to] }));
      this.moves = this.moveHistory.length;
      this.busy = false;
      if (view && before) this.buildPieceArt(view, before, last.pieceIndex);
      this.updateHud();
      this.renderHighlights();
      if (this.tutorialStep !== null) this.showTutorialGuide();
    };
    if (!view || !before) {
      commit();
      return;
    }
    const art: Phaser.GameObjects.Container | undefined = view.getData('art');
    if (art) this.tweens.killTweensOf(art);
    const target = this.pieceCenterPx(before.cells);
    const duration = Math.round(moveDurationMs(this.board, before, last) * 0.8);
    if (last.kind === 'HOPPER') playHop();
    else playSlide();
    this.tweens.add({ targets: view, x: target.x, y: target.y, duration, ease: 'Quad.easeOut', onComplete: commit });
    if (art && last.kind === 'HOPPER') {
      this.tweens.add({ targets: art, y: -this.cell * 0.3, duration: duration / 2, yoyo: true, ease: 'Sine.easeOut' });
    }
  }

  /**
   * The win beat: the last splash and dive play out, every penguin cheers with
   * a sparkle, the win cue sounds, and only then does the result card fade in.
   * The verified-completion request starts immediately, so even leaving during
   * this second cannot lose the solve.
   */
  private celebrateWin(): void {
    if (this.celebrating || this.won) return;
    this.celebrating = true;
    this.busy = true;
    this.selected = null;
    this.fxLayer.removeAll(true);
    this.clearHint();
    this.tutorialText?.destroy();
    this.tutorialText = undefined;
    this.prefetchCompletion();
    this.updateHud();
    const reduced = prefersReducedMotion();
    const generation = this.playGeneration;
    this.time.delayedCall(reduced ? 0 : 320, () => {
      if (!this.isCurrentPlay(generation) || !this.celebrating) return;
      playWin();
      if (!reduced) this.cheerPenguins();
    });
    this.time.delayedCall(reduced ? WIN_CELEBRATION_REDUCED_MS : WIN_CELEBRATION_MS, () => {
      if (!this.isCurrentPlay(generation) || !this.celebrating) return;
      this.celebrating = false;
      this.busy = false;
      this.onWin();
      if (!reduced) {
        this.fxLayer.setAlpha(0);
        this.tweens.add({ targets: this.fxLayer, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
      }
    });
  }

  /** Every penguin pops with a sparkle, one after another. */
  private cheerPenguins(): void {
    let order = 0;
    this.pieces.forEach((piece, index) => {
      if (piece.kind !== 'HOPPER') return;
      const view = this.pieceViews[index];
      const art: Phaser.GameObjects.Container | undefined = view?.getData('art');
      if (!view || !art) return;
      const delay = order * 90;
      order += 1;
      // Scale only: the idle bob keeps animating y, so the two never fight.
      this.tweens.add({ targets: art, scaleX: 1.16, scaleY: 1.16, duration: 150, delay, yoyo: true, repeat: 1, ease: 'Sine.easeOut' });
      this.time.delayedCall(delay, () => {
        if (view.active) sparkleBurst(this, this.effectsLayer, view.x, view.y - this.cell * 0.1, this.cell * 0.9);
      });
    });
  }

  private transcript(): Move[] {
    return this.moveHistory.map((move) => ({
      pieceIndex: move.pieceIndex,
      kind: move.kind,
      to: [...move.to],
    }));
  }

  // Completion bodies are built in one place, so the request started at the
  // win and the result card's request are byte-identical.
  private dailyCompletionBody(): string {
    return JSON.stringify({
      puzzleId: this.dailyPuzzleId,
      playId: this.dailyPlayId,
      moves: this.transcript(),
    });
  }

  private communityCompletionBody(): string {
    return JSON.stringify({ id: this.communityPuzzle?.id ?? '', moves: this.transcript() });
  }

  private endlessCompletionBody(): string {
    return JSON.stringify({ issueId: this.endlessIssueId, moves: this.transcript() });
  }

  private prefetchCompletion(): void {
    if (this.isTest || this.tutorialStep !== null) return;
    if (this.isCommunity) {
      this.prefetchCompletionRequest('/api/ugc/played', this.communityCompletionBody());
      return;
    }
    if (this.isEndless) {
      if (!this.hintUsed && context.username && this.endlessIssueId) {
        this.prefetchCompletionRequest('/api/endless/solved', this.endlessCompletionBody());
      }
      return;
    }
    if (this.dailyPuzzleId) this.prefetchCompletionRequest('/api/solve', this.dailyCompletionBody());
  }

  private prefetchCompletionRequest(url: string, body: string): void {
    const key = `${url}\n${body}`;
    if (this.prefetchedCompletions.has(key)) return;
    const request = this.sendCompletionWithRetries(url, body);
    // Observed here as well; whoever consumes it reports the failure.
    request.catch(() => undefined);
    this.prefetchedCompletions.set(key, request);
  }

  /**
   * Play the same puzzle again from the start (Daily/Community win screens and
   * the solved-Daily recap). The server keeps the best verified score.
   */
  private replayPuzzle(): void {
    if (!this.board) return;
    this.won = false;
    this.celebrating = false;
    this.busy = false;
    this.dailyRecapOpen = false;
    this.resetFxTransform();
    this.fxLayer.removeAll(true);
    this.fxLayer.setAlpha(1);
    this.effectsLayer.removeAll(true);
    this.blockingShield = undefined;
    this.pieces = this.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
    this.moves = 0;
    this.moveHistory = [];
    this.selected = null;
    this.hintStage = 0;
    this.layout();
    this.renderBoard();
    this.updateHud();
  }

  /** Practice guidance: the step's caption and a glow on the piece to touch. */
  private showTutorialGuide(): void {
    if (this.tutorialStep === null || !this.board || this.won || this.celebrating) return;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    const w = viewWidth(this);
    this.tutorialText?.destroy();
    this.tutorialText = undefined;
    const text = this.add
      .text(0, 0, step.caption, {
        fontFamily: FONT.ui,
        fontSize: '16px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        lineSpacing: 4,
        wordWrap: { width: Math.min(360, w - 48) },
      })
      .setOrigin(0.5);
    // Prefer the empty band above the board; fall back to just above the
    // action strip on short (landscape/desktop) screens.
    const bandTop = this.hudHeight + SPACE.sm;
    const bandBottom = this.originY - this.cell * 0.16 - SPACE.md;
    const y =
      bandBottom - bandTop >= text.height + SPACE.sm
        ? (bandTop + bandBottom) / 2
        : (this.geometry?.tipY ?? viewHeight(this) - 76);
    text.setPosition(w / 2, y);
    this.uiLayer.add(text);
    this.tutorialText = text;
    if (this.moves === 0 && this.selected === null) this.glowHintPiece(step.focusPiece);
  }

  /**
   * Restore the current board to its starting layout. Once a signed-in player
   * has received a server hint, this issued puzzle remains ineligible; only a
   * newly issued puzzle can clear knowledge of that hint.
   */
  private resetPuzzle(): void {
    if (!this.board || this.busy || this.won || this.dailyRecapOpen || this.moves === 0) return;
    this.pieces = this.board.pieces.map((p) => ({ ...p, cells: [...p.cells] }));
    this.moves = 0;
    this.moveHistory = [];
    this.selected = null;

    this.renderBoard();
    this.updateHud();
  }

  /**
   * Reveal the solver's best next move progressively. Signed-in hints are
   * computed from a server replay of this issue and atomically make the issue
   * ineligible before the move is returned. Guest hints remain session-local.
   */
  private async showHint(): Promise<void> {
    if (!this.board || this.busy || this.won || this.hintRequestPending) return;
    const generation = this.playGeneration;
    this.hintRequestPending = true;
    this.busy = true;
    this.hintButton.setEnabled(false);
    try {
      const move = await this.getHintMove();
      if (!this.isCurrentPlay(generation)) return;
      if (!move) {
        this.showStrandedHint();
        return;
      }
      this.hintUsed = true;
      // The hint caption takes the tip's slot under the action bar.
      this.hintText.setVisible(false);
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
    } catch (error) {
      console.error(error);
      if (this.isCurrentPlay(generation)) {
        showToast('Hint unavailable. Please try again.');
      }
    } finally {
      if (this.isCurrentPlay(generation)) {
        this.busy = false;
        this.hintRequestPending = false;
        if (this.hintButton.active) this.hintButton.setEnabled(true);
      }
    }
  }

  private async getHintMove(): Promise<Move | null> {
    if (!this.board) return null;
    if (!context.username) {
      const result = solve({ ...this.board, pieces: this.pieces }, { maxStates: 60_000 });
      return result.solvable ? result.solution[0] ?? null : null;
    }
    if (!this.endlessIssueId) throw new Error('missing Endless issue id');
    const response = await fetch('/api/endless/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId: this.endlessIssueId, moves: this.moveHistory }),
    });
    if (!response.ok) throw new Error(`endless hint failed: ${response.status}`);
    const result: EndlessHintResponse = await response.json();
    return result.move;
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
    caption.setPosition(viewWidth(this) / 2, this.geometry?.tipY ?? viewHeight(this) - 70);
    this.hintLayer.add(caption);
    return caption;
  }

  /** When the board is unsolvable from here, point the player at Restart. */
  private showStrandedHint(): void {
    this.clearHintGraphics();
    // Every move can be undone by its reverse, so a position is never truly
    // stuck; a missing hint only means the solver ran out of budget here.
    const msg = this.addHintCaption('No hint found from here \u2014 try again or \u21BA Restart');
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

  /** Master mute for the play HUD: silence both channels or restore their prior
   *  independent mix, then redraw the speaker icon to match the new state. */
  private toggleMute(): void {
    const on = !isAnyAudioOn();
    setAllAudioOn(on);
    if (on) playHop(); // a tiny confirmation blip when turning sound back on
    this.muteButton.refresh();
  }

  private updateHud(): void {
    const w = viewWidth(this);
    const geometry = this.geometry;
    // Three-tier top HUD: row 1 is the chrome chips near the top; row 2 is a
    // dedicated, full-width "Moves / Par" readout just below them, so the chips
    // can never crowd the readout again; row 3 names the mode, date/creator,
    // and difficulty.
    const midY = geometry?.chromeY ?? 22;
    const statsMidY = geometry?.statsY ?? this.hudHeight - 18;
    // During the ~1s win beat the board is the whole show: no chrome.
    const playing = !this.won && !this.celebrating;
    this.menuButton.setPosition(SPACE.md + this.menuButton.width / 2, midY);
    this.menuButton.setVisible(playing);
    // Master mute sits just right of Menu; always available during play so a
    // feed-first player can silence audio without a trip back to the hub.
    this.muteButton.setPosition(
      this.menuButton.x + this.menuButton.width / 2 + SPACE.sm + this.muteButton.width / 2,
      midY
    );
    this.muteButton.setVisible(playing);
    const skipVisible = this.isCommunity && playing;
    this.skipButton.setPosition(w - SPACE.md - this.skipButton.width / 2, midY);
    this.skipButton.setVisible(skipVisible);
    const practicing = this.tutorialStep !== null;
    const bannerVisible = (this.isEndless || practicing) && playing;
    this.endlessBanner.setLabelText(
      practicing
        ? `Practice ${(this.tutorialStep ?? 0) + 1} of ${TUTORIAL_STEPS.length}`
        : `Solved: ${this.endlessSolved}`
    );
    this.endlessBanner.setPosition(w - SPACE.md - this.endlessBanner.width / 2, midY);
    this.endlessBanner.setVisible(bannerVisible);
    // "?" help chip (top-right), shown on the daily/test screen where the corner
    // is free. Endless owns that corner with the Solved banner, community with
    // Skip, and practice with its progress badge.
    const helpVisible = !this.isEndless && !this.isCommunity && !practicing && playing;
    this.helpButton.setPosition(w - SPACE.md - this.helpButton.width / 2, midY);
    this.helpButton.setVisible(helpVisible);

    // Moves / Par plus the live star goal: their own centred row beneath the
    // chrome, using the full width. Shrink both together only if they truly
    // overflow, never below a readable floor.
    this.hudText.setScale(1);
    this.goalText.setScale(1);
    this.hudText.setText(`Moves ${this.moves}    Par ${this.par}`);
    const showGoal = this.par > 0;
    // A solved board shows the stars earned, not a goal for a move that will
    // never happen (same as the feed post).
    const solvedNow = this.board ? isSolved(this.board, this.pieces) : false;
    this.goalText.setText(
      !showGoal
        ? ''
        : solvedNow
          ? `${'\u2605'.repeat(computeStars(this.moves, this.par))} earned`
          : starGoalLabel(starGoal(this.moves, this.par))
    );
    const statsGap = showGoal ? SPACE.lg + SPACE.sm : 0;
    const naturalW = this.hudText.width + statsGap + (showGoal ? this.goalText.width : 0);
    const maxStatsW = w - SPACE.lg * 2;
    const statsScale = naturalW > maxStatsW ? Math.max(0.6, maxStatsW / naturalW) : 1;
    this.hudText.setScale(statsScale);
    this.goalText.setScale(statsScale);
    const statsLeft = w / 2 - (naturalW * statsScale) / 2;
    this.hudText.setPosition(statsLeft + (this.hudText.width * statsScale) / 2, statsMidY);
    this.goalText.setPosition(
      statsLeft + naturalW * statsScale - (this.goalText.width * statsScale) / 2,
      statsMidY
    );
    // Visible again after a replay from the win screen or solved-Daily recap.
    const statsVisible = !this.won && !this.dailyRecapOpen;
    this.hudText.setVisible(statsVisible);
    this.goalText.setVisible(statsVisible && showGoal);
    const context = this.contextLabel();
    this.contextText.setText(context);
    this.contextText.setScale(1);
    if (this.contextText.width > w - SPACE.lg * 2) {
      this.contextText.setScale(Math.max(0.7, (w - SPACE.lg * 2) / this.contextText.width));
    }
    this.contextText.setPosition(w / 2, geometry?.contextY ?? statsMidY + 26);
    this.contextText.setVisible(statsVisible && playing && context !== '');
    const tipY = geometry?.tipY ?? viewHeight(this) - 26;
    this.hintText.setPosition(w / 2, tipY);
    this.hintText.setVisible(
      this.moves === 0 && !this.hintUsed && playing && !this.isCommunity && !practicing
    );
    // Undo + Restart (+ Hint in Endless) sit in one bar docked under the
    // board for the whole play. Undo/Restart wait, disabled, for a first move
    // so the layout never jumps and the controls are always discoverable.
    const actionsY = geometry?.actionsY ?? viewHeight(this) - 26;
    const showActions = playing && !this.dailyRecapOpen;
    const strip: PillButton[] = [this.undoButton, this.resetButton];
    if (this.isEndless) strip.push(this.hintButton);
    const slots = actionBarSlots(w, strip.length, geometry?.maxBarWidth ?? w - SPACE.lg * 2);
    for (const button of strip) button.setMinWidth(slots.slotWidth);
    const stripW =
      strip.reduce((sum, button) => sum + button.width, 0) + ACTION_BAR_GAP * (strip.length - 1);
    let stripX = w / 2 - stripW / 2;
    for (const button of strip) {
      button.setPosition(stripX + button.width / 2, actionsY);
      stripX += button.width + ACTION_BAR_GAP;
    }
    const hasMoves = this.moves > 0;
    this.undoButton.setEnabled(hasMoves);
    this.resetButton.setEnabled(hasMoves);
    this.undoButton.setVisible(showActions);
    this.resetButton.setVisible(showActions);
    this.hintButton.setVisible(showActions && this.isEndless);
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
      variant: 'ghost',
      size: 'sm',
      x: viewWidth(this) / 2,
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
      variant: 'ghost',
      size: 'sm',
      x: viewWidth(this) / 2,
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
    this.dailyRecapOpen = true;
    this.beginBlockingOverlay();
    // uiLayer renders above the card, so every play control must hide.
    this.hudText.setVisible(false);
    this.goalText.setVisible(false);
    this.contextText.setVisible(false);
    this.hintText.setVisible(false);
    this.undoButton.setVisible(false);
    this.resetButton.setVisible(false);
    this.hintButton.setVisible(false);
    this.menuButton.setVisible(false);
    this.muteButton.setVisible(false);
    this.helpButton.setVisible(false);

    const card = this.openResultCard(440);
    this.addCardMenuChip(card);
    const endlessBtn = makePill(this, {
      label: 'Endless puzzles \u25B6',
      variant: 'primary',
      onClick: () => {
        trackClientEvent('daily_to_endless');
        fadeToScene(this, 'EndlessScene');
      },
    });
    const communityBtn = makePill(this, {
      label: 'Community puzzles',
      variant: 'chip',
      size: 'sm',
      onClick: () => {
        trackClientEvent('daily_to_community');
        fadeToScene(this, 'CommunityScene');
      },
    });
    const leaderboardBtn = makePill(this, {
      label: 'Leaderboard',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.openLeaderboard(),
    });
    const replayBtn = makePill(this, {
      label: "Play today's again",
      variant: 'ghost',
      size: 'sm',
      // Shared replay path, which also restores the Moves/Par readout (it
      // used to stay hidden after leaving the recap).
      onClick: () => this.replayPuzzle(),
    });
    this.composeResultCard(card, {
      mascot: !result,
      title: 'You\u2019ve solved today\u2019s puzzle!',
      blurb: 'A fresh puzzle drops tomorrow.',
      ...(result ? { stars: result.stars, moves: result.moves } : {}),
      slotHeight: 0,
      primary: endlessBtn,
      secondaries: [communityBtn, leaderboardBtn],
      quiet: replayBtn,
    });
  }

  /** Clear the fx layer and draw a result card's dim overlay and panel. */
  private openResultCard(maxWidth = 460): ResultCard {
    const w = viewWidth(this);
    const h = viewHeight(this);
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(maxWidth, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const panel = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    this.fxLayer.add([overlay, panel]);
    return {
      w,
      h,
      contentW: cardW - SPACE.xl * 2,
      left: w / 2 - cardW / 2,
      top: h / 2 - cardH / 2,
      bottom: h / 2 + cardH / 2,
      compact: h < 680,
    };
  }

  /** "‹ Menu" in the card's top-left corner, the same on every result screen. */
  private addCardMenuChip(card: ResultCard): void {
    const chip = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    chip.setPosition(card.left + SPACE.md + chip.width / 2, card.top + SPACE.md + chip.height / 2);
    this.fxLayer.add(chip);
  }

  /** Three stars that pop in one by one (earned ones spin and sparkle). */
  private addStarRow(stars: number, y: number, outer: number): void {
    const w = viewWidth(this);
    const gap = Math.min(54, w * 0.16, outer * 2.3);
    for (let i = 0; i < 3; i++) {
      const earned = i < stars;
      const star = this.add
        .star(w / 2 + (i - 1) * gap, y, 5, outer * 0.45, outer, earned ? COLORS.gold : 0x32485c)
        .setStrokeStyle(2, earned ? 0xffe9a8 : 0x4a6377)
        .setScale(0);
      this.fxLayer.add(star);
      this.tweens.add({ targets: star, scale: 1, duration: 300, delay: 300 + i * 180, ease: 'Back.easeOut' });
      if (earned) {
        this.tweens.add({ targets: star, angle: 360, duration: 500, delay: 300 + i * 180, ease: 'Cubic.easeOut' });
      }
    }
    if (stars > 0) {
      this.time.delayedCall(520, () => sparkleBurst(this, this.fxLayer, w / 2, y, Math.min(60, w * 0.16)));
    }
  }

  /**
   * Lay out a result card: title, blurb, stars, score, a reserved slot for
   * async content, then the actions (secondaries in a two-column grid above a
   * full-width primary, a quiet link last). Header and actions form one block,
   * centred when it fits so a tall phone never strands the buttons far below
   * the result; otherwise the actions sit on the card's bottom edge.
   * Returns the top of the reserved slot.
   */
  private composeResultCard(card: ResultCard, spec: ResultSpec): number {
    const cx = card.w / 2;
    const gap = SPACE.sm + 2;

    // Actions: measure rows before placing anything. Neighbours share a row
    // when both labels fit half the width; a long label takes a row alone.
    const half = (card.contentW - gap) / 2;
    const rows: PillButton[][] = [];
    for (let index = 0; index < spec.secondaries.length; ) {
      const first = spec.secondaries[index];
      const second = spec.secondaries[index + 1];
      if (!first) break;
      if (second && first.width <= half && second.width <= half) {
        rows.push([first, second]);
        index += 2;
      } else {
        rows.push([first]);
        index += 1;
      }
    }
    const rowHeight = (row: readonly PillButton[]): number =>
      Math.max(0, ...row.map((button) => button.height));
    const actionsH =
      rows.reduce((sum, row) => sum + rowHeight(row) + gap, 0) +
      spec.primary.height +
      (spec.quiet ? SPACE.xs + spec.quiet.height : 0);

    // Header: create and measure.
    const vGap = card.compact ? 8 : 12;
    const title = this.add
      .text(cx, 0, spec.title, {
        fontFamily: FONT.display,
        fontSize: card.compact ? '21px' : '24px',
        fontStyle: '700',
        color: COLORS.text,
        align: 'center',
        wordWrap: { width: card.contentW },
      })
      .setOrigin(0.5, 0);
    const blurb = spec.blurb
      ? this.add
          .text(cx, 0, spec.blurb, {
            fontFamily: FONT.display,
            fontSize: card.compact ? '16px' : '18px',
            fontStyle: '600',
            color: COLORS.text,
            align: 'center',
            wordWrap: { width: card.contentW },
          })
          .setOrigin(0.5, 0)
          .setAlpha(0.85)
      : undefined;
    const outer = card.compact ? 20 : 24;
    const score =
      spec.moves === undefined
        ? undefined
        : this.add
            .text(cx, 0, this.scoreLine(spec.countUp ? 0 : spec.moves), {
              fontFamily: FONT.ui,
              fontSize: card.compact ? '17px' : '19px',
              fontStyle: '800',
              color: COLORS.text,
            })
            .setOrigin(0.5, 0);
    const mascotSize = card.compact ? 54 : 68;
    const mascotH = spec.mascot ? mascotSize + vGap : 0;
    const headerH =
      mascotH +
      title.height +
      (blurb ? SPACE.xs + blurb.height : 0) +
      (spec.stars !== undefined ? vGap + outer * 2 + 6 : 0) +
      (score ? vGap + score.height : 0) +
      (spec.slotHeight > 0 ? vGap + spec.slotHeight : 0);

    // Placement: one centred block when it fits.
    const regionTop = card.top + 58;
    const regionBottom = card.bottom - SPACE.lg;
    const blockGap = card.compact ? 18 : 30;
    const total = headerH + blockGap + actionsH;
    let headerTop: number;
    let actionsTop: number;
    if (total <= regionBottom - regionTop) {
      headerTop = regionTop + (regionBottom - regionTop - total) / 2;
      actionsTop = headerTop + headerH + blockGap;
    } else {
      actionsTop = regionBottom - actionsH;
      headerTop = Math.max(regionTop, actionsTop - blockGap - headerH);
    }

    let y = headerTop;
    if (spec.mascot) {
      const mascot = this.add.container(cx, y + mascotSize / 2);
      drawPenguinInto(this, mascot, mascotSize);
      this.fxLayer.add(mascot);
      this.tweens.add({
        targets: mascot,
        y: mascot.y - 5,
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      y += mascotH;
    }
    title.setY(y);
    y += title.height;
    if (blurb) {
      y += SPACE.xs;
      blurb.setY(y);
      y += blurb.height;
    }
    if (spec.stars !== undefined) {
      y += vGap + 6;
      this.addStarRow(spec.stars, y + outer, outer);
      y += outer * 2;
    }
    if (score && spec.moves !== undefined) {
      y += vGap;
      score.setY(y);
      y += score.height;
      if (spec.countUp) {
        const finalMoves = spec.moves;
        const counter = { v: 0 };
        this.tweens.add({
          targets: counter,
          v: finalMoves,
          duration: 600,
          delay: 250,
          ease: 'Cubic.easeOut',
          onUpdate: () => {
            if (score.scene) score.setText(this.scoreLine(Math.round(counter.v)));
          },
        });
      }
    }
    const slotTop = y + (spec.slotHeight > 0 ? vGap : 0);
    const headerParts: Phaser.GameObjects.GameObject[] = [title];
    if (blurb) headerParts.push(blurb);
    if (score) headerParts.push(score);
    this.fxLayer.add(headerParts);
    const titleY = title.y;
    title.setAlpha(0).setY(titleY + 8);
    this.tweens.add({ targets: title, alpha: 1, y: titleY, duration: 300, ease: 'Quad.easeOut' });

    let rowTop = actionsTop;
    for (const row of rows) {
      const height = rowHeight(row);
      const cy = rowTop + height / 2;
      const [first, second] = row;
      if (first && second) {
        first.setMinWidth(half).setPosition(cx - gap / 2 - half / 2, cy);
        second.setMinWidth(half).setPosition(cx + gap / 2 + half / 2, cy);
      } else if (first) {
        first.setMinWidth(card.contentW).setPosition(cx, cy);
      }
      rowTop += height + gap;
    }
    spec.primary.setMinWidth(card.contentW).setPosition(cx, rowTop + spec.primary.height / 2);
    rowTop += spec.primary.height;
    if (spec.quiet) spec.quiet.setPosition(cx, rowTop + SPACE.xs + spec.quiet.height / 2);
    this.fxLayer.add([spec.primary, ...spec.secondaries, ...(spec.quiet ? [spec.quiet] : [])]);
    return slotTop;
  }

  private scoreLine(moves: number): string {
    return `${moves} ${moves === 1 ? 'move' : 'moves'} \u00B7 par ${this.par}`;
  }

  /** A row of equal stat tiles at `top`; rebuilt whenever its data changes. */
  private drawStatTiles(
    card: ResultCard,
    top: number,
    tiles: readonly StatTile[]
  ): Phaser.GameObjects.Container {
    const layer = this.add.container(0, 0);
    const gap = SPACE.sm;
    const count = Math.max(1, tiles.length);
    const tileW = Math.min(112, (card.contentW - gap * (count - 1)) / count);
    const total = tileW * tiles.length + gap * (tiles.length - 1);
    let x = card.w / 2 - total / 2;
    for (const tile of tiles) {
      const cx = x + tileW / 2;
      const box = this.add.graphics();
      box.fillStyle(0x0e2740, 0.9);
      box.fillRoundedRect(x, top, tileW, STAT_TILE_HEIGHT, 14);
      box.lineStyle(1.5, 0x2f5c7a, 1);
      box.strokeRoundedRect(x, top, tileW, STAT_TILE_HEIGHT, 14);
      const value = this.add
        .text(cx, top + 20, tile.value, {
          fontFamily: FONT.display,
          fontSize: '22px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5);
      layer.add([box, value]);
      if (tile.flame) {
        const flameSize = 15;
        const width = flameSize + SPACE.xs + value.width;
        const flameX = cx - width / 2 + flameSize / 2;
        const flame = this.add.graphics();
        drawFlame(flame, flameX, top + 20, flameSize);
        value.setX(flameX + flameSize / 2 + SPACE.xs + value.width / 2);
        layer.add(flame);
      }
      const label = this.add
        .text(cx, top + 42, tile.label, {
          fontFamily: FONT.ui,
          fontSize: '11px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.75);
      if (label.width > tileW - SPACE.sm) label.setScale((tileW - SPACE.sm) / label.width);
      layer.add(label);
      x += tileW + gap;
    }
    this.fxLayer.add(layer);
    return layer;
  }

  private onWin(): void {
    this.dailyRecapOpen = false;
    this.won = true;
    this.beginBlockingOverlay();
    this.menuButton.setVisible(false);
    this.muteButton.setVisible(false);
    this.skipButton.setVisible(false);
    this.endlessBanner.setVisible(false);
    this.resetButton.setVisible(false);
    this.undoButton.setVisible(false);
    this.hintButton.setVisible(false);
    this.helpButton.setVisible(false);
    // Hide the play HUD readout too: it lives in uiLayer, which renders above
    // the win card (in fxLayer), so it would otherwise float over the win
    // screen. (Every win type funnels through here, so this covers all of them.)
    // The win cue already played during celebrateWin().
    this.hudText.setVisible(false);
    this.goalText.setVisible(false);
    this.contextText.setVisible(false);
    this.hintText.setVisible(false);
    this.tutorialText?.destroy();
    this.tutorialText = undefined;
    this.clearHint();
    if (this.tutorialStep !== null) {
      this.onWinTutorial();
      return;
    }
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
    const stars = computeStars(this.moves, this.par);
    const blurb = stars === 3 ? 'A clean run!' : stars === 2 ? 'Nicely done!' : 'Can you do it in fewer?';
    this.shareText = buildShareText({
      date: this.date,
      moves: this.moves,
      par: this.par,
      stars,
      streak: 1,
      rank: 0,
      totalPlayers: 0,
    });

    const card = this.openResultCard();
    // Aurora curtains near the top only for a standout (3-star) win.
    if (stars === 3) auroraFlourish(this, this.fxLayer, card.w, card.h * 0.12);
    this.addCardMenuChip(card);

    // Outward share (native share sheet with a link back to the post) and the
    // inward thread action: the player's verified score as a reply under the
    // pinned leaderboard, only when this is the host post's own Daily so the
    // comment's par and thread always match what was solved.
    const shareButton = makePill(this, {
      label: 'Share result \u2197',
      variant: 'chip',
      size: 'sm',
      onClick: () => void this.copyResult(shareButton),
    });
    let postScoreButton: PillButton | undefined;
    if (this.isHostPostPuzzle) {
      postScoreButton = makePill(this, {
        label: 'Comment my score',
        variant: 'chip',
        size: 'sm',
        onClick: () => {
          if (postScoreButton) void this.postScore(postScoreButton);
        },
      });
    }
    // Replay right here: "Try for ★★★" when there's room to improve. The
    // server keeps the best verified score, so trying again never hurts.
    const replayButton = makePill(this, {
      label: stars === 3 ? '\u21BA Play again' : '\u21BA Try for \u2605\u2605\u2605',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.replayPuzzle(),
    });
    // The overlay loads its own data; a board already fetched here is reused.
    let leaderboardData: LeaderboardResponse | undefined;
    const leaderboardButton = makePill(this, {
      label: 'Leaderboard',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.openLeaderboard(leaderboardData),
    });
    // Forward navigation so the daily isn't a dead end (keeps the "one more"
    // loop). Endless is always full of fresh puzzles, so it's the better
    // post-daily CTA than the (possibly empty) community stream.
    const morePuzzlesButton = makePill(this, {
      label: 'More puzzles \u25B6',
      variant: 'primary',
      onClick: () => {
        trackClientEvent('daily_to_endless');
        fadeToScene(this, 'EndlessScene');
      },
    });
    // At most one optional nudge: sign in for guests, otherwise join for
    // signed-in non-members.
    const cta =
      this.addSignInPrompt(0, 'Sign in to save your streak') ?? this.addSubscribePrompt(0);

    const signedIn = Boolean(context.username);
    const tilesHeight = signedIn ? STAT_TILE_HEIGHT + SPACE.sm : 0;
    const slotTop = this.composeResultCard(card, {
      title: 'Everyone made it in!',
      blurb,
      stars,
      moves: this.moves,
      countUp: true,
      slotHeight: tilesHeight + RESULT_NOTE_HEIGHT,
      primary: morePuzzlesButton,
      secondaries: postScoreButton
        ? [shareButton, postScoreButton, replayButton, leaderboardButton]
        : [shareButton, leaderboardButton, replayButton],
      ...(cta ? { quiet: cta } : {}),
    });

    // Signed players get skeleton tiles at once (filled when the solve and the
    // board land); guests get a single status line.
    let tiles: Phaser.GameObjects.Container | undefined;
    const setStats = (items: readonly StatTile[]): void => {
      tiles?.destroy(true);
      tiles = this.drawStatTiles(card, slotTop, items);
    };
    if (signedIn) {
      setStats([
        { value: '\u2026', label: 'today' },
        { value: '\u2026', label: 'day streak', flame: true },
        { value: '\u2026', label: 'hit par' },
      ]);
    }
    const note = this.add
      .text(card.w / 2, slotTop + tilesHeight, 'Saving your score\u2026', {
        fontFamily: FONT.ui,
        fontSize: card.compact ? '13px' : '14px',
        fontStyle: '600',
        color: COLORS.text,
        align: 'center',
        wordWrap: { width: card.contentW },
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.85);
    this.fxLayer.add(note);

    this.completionPromise = this.submitSolve({
      isActive: () => Boolean(note.scene),
      setNote: (text) => {
        if (note.scene) note.setText(text);
      },
      setStats: (items) => {
        if (note.scene) setStats(items);
      },
      revealLeaderboard: (data) => {
        leaderboardData = data;
      },
    });
  }

  private onWinCommunity(): void {
    const playedId = this.communityPuzzle?.id ?? '';
    // Serialize the solved transcript once. Internal transport retries and the
    // visible manual retry must submit this identical immutable request body
    // (also identical to the request celebrateWin() already started).
    const completionBody = this.communityCompletionBody();
    const generation = this.playGeneration;
    const creator = this.communityPuzzle?.creator ?? 'a redditor';
    const isMine = Boolean(context.username) && this.communityPuzzle?.creator === context.username;
    const card = this.openResultCard();
    this.addCardMenuChip(card);

    let voteButton: PillButton | undefined;
    if (!isMine) {
      voteButton = makePill(this, {
        label: '\u25B2 Upvote',
        variant: 'mint',
        size: 'sm',
        onClick: () => {
          if (voteButton) void this.upvoteCurrent(voteButton);
        },
      });
    }
    // Let a signed solver drop their verified score into this exact puzzle's
    // thread. Creator and host-post gates remain unchanged.
    let scoreButton: PillButton | undefined;
    if (context.username && !isMine && this.isHostPostPuzzle) {
      scoreButton = makePill(this, {
        label: 'Comment my score',
        variant: 'chip',
        size: 'sm',
        onClick: () => {
          if (scoreButton) void this.postScore(scoreButton);
        },
      });
      scoreButton.setEnabled(false);
    }

    let verificationState: 'pending' | 'failed' | 'verified' = 'failed';
    let retryVerification: (() => void) | undefined;
    const moreButton = makePill(this, {
      label: 'Verifying solve\u2026',
      variant: 'primary',
      onClick: () => {
        if (verificationState === 'verified') {
          void this.nextCommunity();
        } else if (verificationState === 'failed') {
          retryVerification?.();
        }
      },
    });
    moreButton.setEnabled(false);
    const dailyButton = makePill(this, {
      label: 'Back to daily',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    // Same replay offer as the Daily and the feed post.
    const communityStars = computeStars(this.moves, this.par);
    const replayButton = makePill(this, {
      label: communityStars === 3 ? '\u21BA Play again' : '\u21BA Try for \u2605\u2605\u2605',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.replayPuzzle(),
    });
    const secondaries: PillButton[] = [];
    if (voteButton) secondaries.push(voteButton);
    if (scoreButton) secondaries.push(scoreButton);
    secondaries.push(replayButton, dailyButton);

    // Social proof from the stream-load snapshot: how this puzzle is doing.
    const votes = this.communityPuzzle?.votes ?? 0;
    const solves = this.communityPuzzle?.solves ?? 0;
    const statBits: string[] = [];
    if (solves > 0) statBits.push(`${solves} ${solves === 1 ? 'solve' : 'solves'}`);
    if (votes > 0) statBits.push(`\u25B2 ${votes}`);
    const statText = statBits.join('  \u00B7  ');
    const noteText = isMine
      ? statText
        ? `Your puzzle  \u00B7  ${statText}`
        : 'Your puzzle \u2014 nice build!'
      : statText;

    const slotTop = this.composeResultCard(card, {
      title: isMine ? 'Solved your own puzzle!' : `Solved ${creator}'s puzzle!`,
      stars: communityStars,
      moves: this.moves,
      countUp: true,
      slotHeight: noteText ? RESULT_NOTE_HEIGHT : 0,
      primary: moreButton,
      secondaries,
    });
    if (noteText) {
      const note = this.add
        .text(card.w / 2, slotTop, noteText, {
          fontFamily: FONT.ui,
          fontSize: '14px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.8);
      this.fxLayer.add(note);
    }

    const verifyCompletion = (): void => {
      if (verificationState === 'pending' || verificationState === 'verified') return;
      verificationState = 'pending';
      moreButton.setLabelText('Verifying solve\u2026').setEnabled(false);
      scoreButton?.setEnabled(false);
      const completion = this.markPlayed(playedId, completionBody);
      this.completionPromise = completion;
      // Keep markPlayed rejecting for callers, but always observe this promise so
      // a terminal background failure can never become an unhandled rejection.
      void completion.then(
        () => {
          if (!this.isCurrentPlay(generation) || !moreButton.active) return;
          verificationState = 'verified';
          moreButton.setLabelText('Next puzzle \u25B6').setEnabled(true);
          scoreButton?.setEnabled(true);
        },
        (error: unknown) => {
          console.error(error);
          if (!this.isCurrentPlay(generation) || !moreButton.active) return;
          verificationState = 'failed';
          moreButton.setLabelText('Retry verification').setEnabled(true);
          scoreButton?.setEnabled(false);
        }
      );
    };
    retryVerification = verifyCompletion;
    verifyCompletion();
  }

  private onWinEndless(): void {
    const counts = !this.hintUsed;
    if (!counts && this.endlessIssueId) {
      this.releaseEndlessIssue(this.endlessIssueId);
      this.endlessIssueId = '';
    }
    const stars = computeStars(this.moves, this.par);
    const blurb = counts
      ? stars === 3
        ? 'A clean run!'
        : stars === 2
          ? 'Nicely done!'
          : 'Got there in the end!'
      : 'You found the way with a hint.';
    const card = this.openResultCard();
    if (counts && stars === 3) auroraFlourish(this, this.fxLayer, card.w, card.h * 0.12);
    this.addCardMenuChip(card);

    const nextButton = makePill(this, {
      label: 'Next puzzle \u25B6',
      variant: 'primary',
      onClick: () => {
        trackClientEvent('endless_next');
        this.preserveEndlessPrefetch = true;
        fadeToScene(this, 'GameScene', { endless: { tier: this.endlessTier } });
      },
    });
    const levelButton = makePill(this, {
      label: 'Change level',
      variant: 'chip',
      size: 'sm',
      onClick: () => {
        trackClientEvent('endless_change_level');
        fadeToScene(this, 'EndlessScene');
      },
    });
    const signIn = this.addSignInPrompt(0, 'Sign in to save your progress');

    // The progression payoff (a count that ticks up by one, plus any award
    // unlocked) or, after a hint, an honest note that it does not count.
    const slotTop = this.composeResultCard(card, {
      title: 'Everyone made it in!',
      blurb,
      ...(counts ? { stars } : {}),
      moves: this.moves,
      countUp: counts,
      slotHeight: counts ? 54 : 62,
      primary: nextButton,
      secondaries: [levelButton],
      ...(signIn ? { quiet: signIn } : {}),
    });
    if (counts) {
      const fromCount = this.endlessSolved;
      const countText = this.add
        .text(card.w / 2, slotTop, `Solved: ${fromCount}`, {
          fontFamily: FONT.ui,
          fontSize: '20px',
          fontStyle: '800',
          color: '#ffd166',
          align: 'center',
          lineSpacing: 4,
          wordWrap: { width: card.contentW },
        })
        .setOrigin(0.5, 0);
      this.fxLayer.add(countText);
      void this.recordEndless(countText, fromCount);
    } else {
      const note = this.add
        .text(
          card.w / 2,
          slotTop,
          `Solved with a hint, so it doesn\u2019t add to your total.\nTry the next one solo!  \u00B7  Solved: ${this.endlessSolved}`,
          {
            fontFamily: FONT.ui,
            fontSize: '14px',
            fontStyle: '700',
            color: COLORS.text,
            align: 'center',
            lineSpacing: 6,
            wordWrap: { width: card.contentW },
          }
        )
        .setOrigin(0.5, 0)
        .setAlpha(0.9);
      this.fxLayer.add(note);
    }
  }

  private endlessSolvedLabel(solved: number, achievements: AchievementSnapshot): string {
    const first = achievements.newlyUnlocked[0];
    if (!first) return `Solved: ${solved}`;
    const extra = achievements.newlyUnlocked.length > 1
      ? ` +${achievements.newlyUnlocked.length - 1}`
      : '';
    return `Solved: ${solved}\nAward unlocked: ${first.title}${extra}`;
  }

  /** Verify the Endless solve server-side, or keep guest progress in this session. */
  private async recordEndless(countText: Phaser.GameObjects.Text, fromCount: number): Promise<void> {
    if (!context.username) {
      const solved = fromCount + 1;
      const tierKey = `endless.solved.${this.endlessTier}`;
      const previousTier = this.registry.get(tierKey);
      const nextTier = (typeof previousTier === 'number' ? previousTier : 0) + 1;
      this.endlessSolved = solved;
      this.registry.set('endless.solved', solved);
      this.registry.set(tierKey, nextTier);

      const easyValue = this.registry.get('endless.solved.easy');
      const mediumValue = this.registry.get('endless.solved.medium');
      const hardValue = this.registry.get('endless.solved.hard');
      const hardAtPar =
        this.registry.get('endless.hardAtPar') === true ||
        (this.endlessTier === 'hard' && this.moves === this.par);
      this.registry.set('endless.hardAtPar', hardAtPar);
      const stats = {
        solved,
        byTier: {
          easy: typeof easyValue === 'number' ? easyValue : 0,
          medium: typeof mediumValue === 'number' ? mediumValue : 0,
          hard: typeof hardValue === 'number' ? hardValue : 0,
        },
        hardAtPar,
      };
      const persisted: AchievementId[] = this.registry.get('endless.achievementIds') ?? [];
      const qualified = qualifiedAchievementIds(stats);
      const newlyUnlocked = qualified.filter((id) => !persisted.includes(id));
      const achievements = buildAchievementSnapshot(stats, qualified, newlyUnlocked);
      this.registry.set('endless.achievementIds', qualified);
      this.registry.set('endless.achievements', achievements);
      if (countText.scene) countText.setText(this.endlessSolvedLabel(solved, achievements));
      return;
    }

    const generation = this.endlessSaveGeneration;
    const issueId = this.endlessIssueId;
    try {
      if (!issueId) throw new Error('missing Endless issue id');
      // Identical to the request celebrateWin() already started.
      const response = await this.postCompletionWithRetries(
        '/api/endless/solved',
        this.endlessCompletionBody()
      );
      const result: EndlessSolveResponse = await response.json();
      const knownValue = this.registry.get('endless.solved');
      const known = typeof knownValue === 'number' ? knownValue : 0;
      const solved = Math.max(known, result.solved);
      const mergeTier = (tier: EndlessTier, authoritative: number): void => {
        const key = `endless.solved.${tier}`;
        const current = this.registry.get(key);
        this.registry.set(key, Math.max(typeof current === 'number' ? current : 0, authoritative));
      };
      this.registry.set('endless.solved', solved);
      mergeTier('easy', result.byTier.easy);
      mergeTier('medium', result.byTier.medium);
      mergeTier('hard', result.byTier.hard);
      const persistedIds: AchievementId[] =
        this.registry.get('endless.achievementIds') ?? [];
      const resultIds = result.achievements.progress
        .filter((achievement) => achievement.unlocked)
        .map((achievement) => achievement.id);
      const mergedIds = [...new Set<AchievementId>([...persistedIds, ...resultIds])];
      const mergedEasy = this.registry.get('endless.solved.easy');
      const mergedMedium = this.registry.get('endless.solved.medium');
      const mergedHard = this.registry.get('endless.solved.hard');
      const mergedAchievements = buildAchievementSnapshot(
        {
          solved,
          byTier: {
            easy: typeof mergedEasy === 'number' ? mergedEasy : 0,
            medium: typeof mergedMedium === 'number' ? mergedMedium : 0,
            hard: typeof mergedHard === 'number' ? mergedHard : 0,
          },
          hardAtPar: mergedIds.includes('cold-logic'),
        },
        mergedIds
      );
      this.registry.set('endless.achievements', mergedAchievements);
      this.registry.set('endless.achievementIds', mergedIds);
      if (generation !== this.endlessSaveGeneration) return;

      this.endlessSolved = solved;
      if (!countText.scene) return;
      const counter = { v: fromCount };
      this.tweens.add({
        targets: counter,
        v: solved,
        duration: 500,
        ease: 'Cubic.easeOut',
        onUpdate: () => {
          if (countText.scene) countText.setText(`Solved: ${Math.round(counter.v)}`);
        },
        onComplete: () => {
          if (countText.scene) {
            countText.setText(this.endlessSolvedLabel(solved, result.achievements));
          }
        },
      });
    } catch (error) {
      console.error(error);
      this.releaseEndlessIssue(issueId);
      if (generation !== this.endlessSaveGeneration) return;
      const currentValue = this.registry.get('endless.solved');
      // Signed play never increments optimistically. Preserve any newer solve
      // confirmed by another in-flight request instead of rolling it backward.
      const preserved = mergeProgressCount(currentValue, fromCount);
      this.endlessSolved = preserved;
      this.registry.set('endless.solved', preserved);
      if (countText.scene) countText.setText(`Solved: ${preserved}`);
    }
  }

  private onWinTest(): void {
    if (this.testBoard) {
      this.registry.set('editor.proof', {
        signature: boardSignature(this.testBoard),
        moves: this.moveHistory.map((move) => ({
          pieceIndex: move.pieceIndex,
          kind: move.kind,
          to: [...move.to],
        })),
      });
    }
    trackClientEvent('creator_test_solved');
    const card = this.openResultCard(420);
    const back = makePill(this, {
      label: 'Back to editing',
      variant: 'primary',
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    this.composeResultCard(card, {
      title: 'Your puzzle works!',
      blurb: 'You solved it, so Submit is unlocked.',
      stars: computeStars(this.moves, this.testPar),
      moves: this.moves,
      slotHeight: 0,
      primary: back,
      secondaries: [],
    });
  }

  /** Practice step solved: on to the next rule, or off to the real puzzle. */
  private onWinTutorial(): void {
    const step = this.tutorialStep ?? 0;
    const last = step >= TUTORIAL_STEPS.length - 1;
    const card = this.openResultCard(420);
    const primary = makePill(this, {
      label: last ? 'Play today\u2019s puzzle' : 'Next \u25B6',
      variant: 'primary',
      onClick: () =>
        fadeToScene(this, 'GameScene', last ? { daily: true } : { tutorial: { step: step + 1 } }),
    });
    const secondary = makePill(this, {
      label: last ? '\u2039 Menu' : 'Skip practice',
      variant: 'ghost',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    this.composeResultCard(card, {
      mascot: true,
      title: last ? 'You\u2019re ready!' : 'Nice!',
      blurb: last
        ? 'Every puzzle uses just these moves.'
        : `Practice ${step + 2} of ${TUTORIAL_STEPS.length} is next.`,
      slotHeight: 0,
      primary,
      secondaries: [],
      quiet: secondary,
    });
  }

  private async markPlayed(id: string, body: string): Promise<void> {
    const response = await this.postCompletionWithRetries('/api/ugc/played', body);
    const value: unknown = await response.json();
    const result = parseMarkPlayedResponse(value);
    if (!result) throw new Error('community completion response was malformed');
    if (!result.ok) throw new Error(result.reason);
    if (context.username ? !result.saved : result.saved) {
      throw new Error('community completion save state did not match the player');
    }

    // Both signed and guest solves are remembered only after the server has
    // verified the exact transcript. Guest memory remains Phaser-session local.
    const locallyPlayed: string[] = this.registry.get('ugc.played.local') ?? [];
    if (!locallyPlayed.includes(id)) {
      this.registry.set('ugc.played.local', [...locallyPlayed, id]);
    }
  }

  private async upvoteCurrent(button: PillButton): Promise<void> {
    const generation = this.playGeneration;
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
      if (!this.isCurrentPlay(generation) || !button.active) return;
      // Short labels keep the grid button its size; any reason goes to a toast.
      button.setLabelText(data.ok ? `Upvoted! (${data.votes})` : 'Already upvoted');
      if (!data.ok && data.reason) showToast(data.reason);
      button.setEnabled(false);
    } catch (error) {
      console.error(error);
      if (!this.isCurrentPlay(generation) || !button.active) return;
      button.setLabelText('Could not upvote');
    }
  }

  /** Post the player's score into this post's comment thread, authored by the
   *  player (the server posts with runAs: 'USER'). Spoiler-free, worded as moves
   *  vs par. The scorePosted guard blocks a double-tap within this win screen. */
  private async postScore(button: PillButton): Promise<void> {
    if (this.scorePosted) return;
    const generation = this.playGeneration;
    // Commenting needs an account; prompt right on the tap (intent-driven).
    if (!context.username) {
      showLoginPrompt();
      return;
    }
    button.setLabelText('Posting…').setEnabled(false);
    try {
      if (this.completionPromise) await this.completionPromise;
      if (!this.isCurrentPlay(generation) || !button.active) return;
      const response = await fetch('/api/comment-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`comment failed: ${response.status}`);
      const result: CommentScoreResponse = await response.json();
      if (!this.isCurrentPlay(generation) || !button.active) return;
      if (!result.ok) throw new Error('comment was not accepted');
      this.scorePosted = true;
      button.setLabelText(result.alreadyPosted ? 'Already posted ✓' : 'Posted ✓');
      showToast(result.alreadyPosted ? 'Your score is already in the comments.' : 'Your score is in the comments!');
    } catch (error) {
      console.error(error);
      if (!this.isCurrentPlay(generation) || !button.active) return;
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
    const generation = this.playGeneration;
    trackClientEvent('community_next');
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
    if (!this.isCurrentPlay(generation)) return;
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
      const locallyPlayed: string[] = this.registry.get('ugc.played.local') ?? [];
      return data.submissions.filter(
        (submission) => submission.id !== excludeId && !locallyPlayed.includes(submission.id)
      );
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  /** The stream ran dry: a closing card that keeps the player playing. */
  private showStreamDone(): void {
    this.won = true;
    this.selected = null;
    this.clearHint();
    this.beginBlockingOverlay();
    // Skip can land here mid-play, and the play controls (uiLayer) draw above
    // the card, so let the HUD hide them for the won state.
    this.updateHud();
    const card = this.openResultCard(440);
    this.addCardMenuChip(card);
    const endlessBtn = makePill(this, {
      label: 'Play Endless \u25B6',
      variant: 'primary',
      onClick: () => fadeToScene(this, 'EndlessScene'),
    });
    const buildBtn = makePill(this, {
      label: 'Build a puzzle',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'EditorScene'),
    });
    const dailyBtn = makePill(this, {
      label: 'Back to daily',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    this.composeResultCard(card, {
      mascot: true,
      title: 'You\u2019re all caught up!',
      blurb: 'New community puzzles appear as players build them.',
      slotHeight: 0,
      primary: endlessBtn,
      secondaries: [buildBtn, dailyBtn],
    });
  }

  private async submitSolve(view: DailyResultView): Promise<void> {
    const generation = this.playGeneration;
    const puzzleId = this.dailyPuzzleId;
    // Identical to the request celebrateWin() already started.
    const body = this.dailyCompletionBody();
    try {
      const response = await this.postCompletionWithRetries('/api/solve', body);
      const result: SolveResultDTO = await response.json();
      if (!context.username) {
        this.registry.set(
          'daily.solved.guest',
          rememberGuestDailyCompletion(this.registry.get('daily.solved.guest'), {
            puzzleId,
            moves: result.moves,
            stars: result.stars,
          })
        );
      }
      if (!this.isCurrentPlay(generation)) {
        // Phaser reuses this scene instance. If an immediate guest reopen loaded
        // the same Daily before this verified response arrived, reconcile that
        // already-active board instead of waiting for another navigation.
        if (
          !context.username &&
          this.sys.isActive() &&
          this.dailyPuzzleId === puzzleId &&
          !this.won &&
          !this.dailyRecapOpen
        ) {
          this.showDailySolvedRecap({ moves: result.moves, stars: result.stars });
        }
        return;
      }

      const attemptIsRankedBest = result.bestMoves === this.moves;
      this.shareText = buildShareText({
        date: this.date,
        moves: this.moves,
        par: this.par,
        stars: computeStars(this.moves, this.par),
        streak: result.streak,
        rank: attemptIsRankedBest ? result.rank : 0,
        totalPlayers: attemptIsRankedBest ? result.totalPlayers : 0,
      });

      if (!view.isActive()) return;
      const ranked = result.rank > 0;
      // Rank and streak describe the materialized best (it may beat this run).
      const tiles = (atPar: string): StatTile[] => [
        { value: `#${result.rank}`, label: `of ${result.totalPlayers} today` },
        { value: String(result.streak), label: 'day streak', flame: true },
        { value: atPar, label: 'hit par' },
      ];
      if (ranked) view.setStats(tiles('\u2026'));
      view.setNote(
        result.bestMoves < this.moves
          ? `Your best today stays ${result.bestMoves} moves (${'\u2605'.repeat(result.stars)}).`
          : ranked && result.totalPlayers === 1
            ? 'You set today\u2019s pace \u2014 first one in!'
            : ranked
              ? 'Score saved.'
              : 'Verified! Guest scores aren\u2019t saved.'
      );

      // The verified completion promise must resolve here so an optional,
      // potentially slow leaderboard request can never block score comments.
      // Leaderboard enrichment continues independently behind generation guards.
      void this.loadDailyLeaderboard(view, generation, ranked ? tiles : null).catch((error) =>
        console.error(error)
      );
    } catch (error) {
      console.error(error);
      if (!this.isCurrentPlay(generation) || !view.isActive()) return;
      view.setNote('Score could not be verified. Try again.');
    }
  }

  private async loadDailyLeaderboard(
    view: DailyResultView,
    generation: number,
    tiles: ((atPar: string) => StatTile[]) | null
  ): Promise<void> {
    // Guests may compare after solving even though they are not ranked. The
    // response stays bounded to the top ten and, for signed players, five
    // nearby rows.
    const leaderboard = await this.fetchLeaderboard();
    if (!this.isCurrentPlay(generation) || !view.isActive()) return;
    if (!leaderboard) {
      if (tiles) view.setStats(tiles('\u2013'));
      return;
    }
    if (tiles) view.setStats(tiles(String(leaderboard.distribution[0]?.players ?? 0)));
    view.revealLeaderboard(leaderboard);
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
      button.setLabelText('Copied!');
      showToast('Copied \u2014 paste it in the comments.');
    } catch (error) {
      console.error(error);
      button.setLabelText('Copy failed');
      showToast('Could not copy your result.');
    }
  }

  /**
   * Open the shared leaderboard overlay on this Daily. It joins the fitted win
   * layer (base coordinates) so it scales with the win card on resize, and is
   * added last so its backdrop blocks every win action underneath.
   */
  private openLeaderboard(preloaded?: LeaderboardResponse): void {
    if (this.leaderboardOverlay?.active) return;
    this.leaderboardOverlay = showLeaderboard(this, {
      tab: 'daily',
      puzzleId: this.dailyPuzzleId,
      ...(preloaded ? { preloaded } : {}),
      parent: this.fxLayer,
      width: this.overlayBaseWidth || viewWidth(this),
      height: this.overlayBaseHeight || viewHeight(this),
      onClose: () => {
        this.leaderboardOverlay = undefined;
      },
    });
  }

  private async fetchLeaderboard(): Promise<LeaderboardResponse | undefined> {
    try {
      const response = await fetch(
        `/api/leaderboard?puzzleId=${encodeURIComponent(this.dailyPuzzleId)}`
      );
      if (!response.ok) return undefined;
      const value: unknown = await response.json();
      return (
        parseDailyLeaderboard(value, {
          puzzleId: this.dailyPuzzleId,
          ...(context.username ? { viewer: context.username } : {}),
        }) ?? undefined
      );
    } catch {
      return undefined;
    }
  }
}
