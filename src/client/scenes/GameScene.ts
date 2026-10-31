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
  LeaderboardEntry,
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
import { parseDailyPuzzleId } from '../../shared/daily';
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
  stackColumn,
  PillButton,
  IconButton,
  makeIconButton,
  drawSpeakerIcon,
  armTap,
  useCrispText,
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
import { TUTORIAL_STEPS } from '../../shared/tutorial';
import { context, showLoginPrompt, showShareSheet, showToast } from '@devvit/web/client';
import { isAnyAudioOn, playHop, playSlide, playSplash, playWin, setAllAudioOn } from '../audio';
import { consumeDailyHandoff } from '../dailyHandoff';
import { showHowToPlay } from '../howToPlay';
import { trackClientEvent } from '../telemetry';

type DragState = {
  pieceIndex: number;
  orient: 'H' | 'V';
  originX: number;
  originY: number;
  min: number;
  max: number;
  targets: { coord: number; move: Move }[];
};

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

const parseLeaderboardEntry = (
  value: unknown,
  totalPlayers: number
): LeaderboardEntry | null => {
  if (!isResponseObject(value)) return null;
  const rank = responseProperty(value, 'rank');
  const username = responseProperty(value, 'username');
  const moves = responseProperty(value, 'moves');
  const timeMs = responseProperty(value, 'timeMs');
  if (
    typeof rank !== 'number' ||
    !Number.isSafeInteger(rank) ||
    rank < 1 ||
    rank > totalPlayers ||
    typeof username !== 'string' ||
    username.length === 0 ||
    typeof moves !== 'number' ||
    !Number.isSafeInteger(moves) ||
    moves < 1 ||
    typeof timeMs !== 'number' ||
    !Number.isSafeInteger(timeMs) ||
    timeMs < 0
  ) {
    return null;
  }
  return { rank, username, moves, timeMs };
};

const parseLeaderboardEntries = (
  value: unknown,
  totalPlayers: number,
  maxEntries: number
): LeaderboardEntry[] | null => {
  if (!Array.isArray(value) || value.length > maxEntries || value.length > totalPlayers) {
    return null;
  }
  const entries: LeaderboardEntry[] = [];
  for (const candidate of value) {
    const entry = parseLeaderboardEntry(candidate, totalPlayers);
    const previous = entries.at(-1);
    if (!entry || (previous && entry.rank !== previous.rank + 1)) return null;
    entries.push(entry);
  }
  return entries;
};

const entriesAreScoreOrdered = (entries: readonly LeaderboardEntry[]): boolean => {
  for (let index = 1; index < entries.length; index++) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (
      previous.moves > current.moves ||
      (previous.moves === current.moves && previous.timeMs > current.timeMs)
    ) {
      return false;
    }
  }
  return true;
};

const sameLeaderboardEntry = (
  left: LeaderboardEntry,
  right: LeaderboardEntry
): boolean =>
  left.rank === right.rank &&
  left.username === right.username &&
  left.moves === right.moves &&
  left.timeMs === right.timeMs;

const leaderboardSlicesAgree = (
  entries: readonly LeaderboardEntry[],
  nearbyEntries: readonly LeaderboardEntry[],
  viewerRank: number
): boolean => {
  const byRank = new Map<number, LeaderboardEntry>();
  const byUsername = new Map<string, number>();
  for (const entry of [...entries, ...nearbyEntries]) {
    const rankedEntry = byRank.get(entry.rank);
    const usernameRank = byUsername.get(entry.username);
    if (
      (rankedEntry && !sameLeaderboardEntry(rankedEntry, entry)) ||
      (usernameRank !== undefined && usernameRank !== entry.rank)
    ) {
      return false;
    }
    byRank.set(entry.rank, entry);
    byUsername.set(entry.username, entry.rank);
  }

  const knownEntries = [...byRank.values()].sort((left, right) => left.rank - right.rank);
  if (!entriesAreScoreOrdered(knownEntries)) return false;

  if (!context.username) return viewerRank === 0;
  const currentRank = byUsername.get(context.username);
  return viewerRank === 0
    ? currentRank === undefined
    : currentRank === viewerRank && byRank.get(viewerRank)?.username === context.username;
};

const parseLeaderboardResponse = (
  value: unknown,
  expectedPuzzleId: string
): LeaderboardResponse | undefined => {
  if (!isResponseObject(value)) return undefined;
  const expectedRef = parseDailyPuzzleId(expectedPuzzleId);
  if (!expectedRef) return undefined;
  const puzzleId = responseProperty(value, 'puzzleId');
  const date = responseProperty(value, 'date');
  const totalPlayers = responseProperty(value, 'totalPlayers');
  const viewerRank = responseProperty(value, 'viewerRank');
  if (
    puzzleId !== expectedPuzzleId ||
    date !== expectedRef.date ||
    typeof totalPlayers !== 'number' ||
    !Number.isSafeInteger(totalPlayers) ||
    totalPlayers < 0 ||
    typeof viewerRank !== 'number' ||
    !Number.isSafeInteger(viewerRank) ||
    viewerRank < 0 ||
    viewerRank > totalPlayers
  ) {
    return undefined;
  }

  const entries = parseLeaderboardEntries(
    responseProperty(value, 'entries'),
    totalPlayers,
    10
  );
  const nearbyEntries = parseLeaderboardEntries(
    responseProperty(value, 'nearbyEntries'),
    totalPlayers,
    5
  );
  if (
    !entries ||
    !nearbyEntries ||
    !entriesAreScoreOrdered(entries) ||
    !entriesAreScoreOrdered(nearbyEntries) ||
    !leaderboardSlicesAgree(entries, nearbyEntries, viewerRank) ||
    entries.length !== Math.min(10, totalPlayers) ||
    entries.some((entry, index) => entry.rank !== index + 1) ||
    (viewerRank === 0
      ? nearbyEntries.length !== 0
      : nearbyEntries.length !== Math.min(5, totalPlayers) ||
        !nearbyEntries.some((entry) => entry.rank === viewerRank))
  ) {
    return undefined;
  }

  return {
    puzzleId: expectedPuzzleId,
    date: expectedRef.date,
    totalPlayers,
    viewerRank,
    entries,
    nearbyEntries,
  };
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
  /** Vertical band reserved for the async score/leaderboard block on the daily
   *  win screen, between the result cluster and the bottom button stack. */
  private winStatusTop = 0;
  private winStatusBottom = 0;
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
    this.overlayBaseWidth = 0;
    this.overlayBaseHeight = 0;
    this.blockingShield = undefined;
    this.howTo = undefined;
    this.loadErrorViews = [];
  }

  create(): void {
    useCrispText(this);
    this.dragMoved = false;
    this.emptyPress = false;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    fadeInScene(this);
    this.bgLayer = this.add.container(0, 0);
    paintBackdrop(this, this.bgLayer, this.scale.width, this.scale.height);
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
        wordWrap: { width: this.scale.width - 24 },
      })
      .setOrigin(0.5)
      .setAlpha(0.7);
    // Live "★★★ up to N" goal beside Moves/Par (same wording as the feed post).
    this.goalText = this.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '20px', fontStyle: '800', color: '#ffd166' })
      .setOrigin(0.5);
    this.uiLayer.add([this.hudText, this.hintText, this.goalText]);

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

    // Undo the last move (bottom strip, left of Restart). Every move has an
    // exact reverse and only the final move list is scored, so stepping back
    // is a convenience that never changes how a solve counts.
    this.undoButton = makePill(this, {
      label: '\u21B6 Undo',
      variant: 'chip',
      size: 'sm',
      onClick: () => this.undoMove(),
    });
    this.uiLayer.add(this.undoButton);

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
    this.input.dragDistanceThreshold = 8;
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
    this.overlayBaseWidth = this.scale.width;
    this.overlayBaseHeight = this.scale.height;
  }

  /** Uniformly fit an already-rendered modal and keep its input shield full-screen. */
  private fitBlockingOverlay(): void {
    if (this.overlayBaseWidth <= 0 || this.overlayBaseHeight <= 0) return;
    const scale = Math.min(
      this.scale.width / this.overlayBaseWidth,
      this.scale.height / this.overlayBaseHeight
    );
    const layerX = (this.scale.width - this.overlayBaseWidth * scale) / 2;
    const layerY = (this.scale.height - this.overlayBaseHeight * scale) / 2;
    this.fxLayer.setScale(scale);
    this.fxLayer.setPosition(layerX, layerY);

    if (this.blockingShield?.active) this.blockingShield.destroy();
    const shield = this.add
      .rectangle(
        (this.scale.width / 2 - layerX) / scale,
        (this.scale.height / 2 - layerY) / scale,
        this.scale.width / scale,
        this.scale.height / scale,
        0x000000,
        0.001
      )
      .setInteractive();
    this.fxLayer.addAt(shield, 0);
    this.blockingShield = shield;
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
    const w = this.scale.width;
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
        : this.scale.height - 76;
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
    caption.setPosition(this.scale.width / 2, this.scale.height - 70);
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
    const w = this.scale.width;
    // Two-tier top HUD: row 1 is the chrome chips near the top; row 2 is a
    // dedicated, full-width "Moves / Par" readout just below them, so the chips
    // can never crowd the readout again (the added mute chip was crushing the
    // old single-row centre to an unreadable sliver on narrow widths).
    const midY = 22;
    const statsMidY = this.hudHeight - 18;
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
    this.hintText.setPosition(w / 2, this.scale.height - 26);
    this.hintText.setVisible(this.moves === 0 && playing && !this.isCommunity && !practicing);
    // Undo + Restart (+ Hint in Endless) share the bottom strip once a move is
    // made; they swap in for the first-move hint.
    const bottomY = this.scale.height - 26;
    const showActions = this.moves > 0 && playing;
    const strip: PillButton[] = [this.undoButton, this.resetButton];
    if (this.isEndless) strip.push(this.hintButton);
    const stripGap = SPACE.md;
    const stripW = strip.reduce((sum, button) => sum + button.width, 0) + stripGap * (strip.length - 1);
    let stripX = w / 2 - stripW / 2;
    for (const button of strip) {
      button.setPosition(stripX + button.width / 2, bottomY);
      stripX += button.width + stripGap;
    }
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
    this.dailyRecapOpen = true;
    this.beginBlockingOverlay();
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
      onClick: () => {
        trackClientEvent('daily_to_endless');
        fadeToScene(this, 'EndlessScene');
      },
    });
    const communityBtn = makePill(this, {
      label: 'Community puzzles',
      variant: 'secondary',
      minWidth: Math.min(240, contentW),
      onClick: () => {
        trackClientEvent('daily_to_community');
        fadeToScene(this, 'CommunityScene');
      },
    });
    const replayBtn = makePill(this, {
      label: "Play today's again",
      variant: 'ghost',
      size: 'sm',
      // Shared replay path, which also restores the Moves/Par readout (it
      // used to stay hidden after leaving the recap).
      onClick: () => this.replayPuzzle(),
    });
    // Even-gap column for the three onward actions, centred below the subtext.
    stackColumn([endlessBtn, communityBtn, replayBtn], w / 2, h * 0.53, SPACE.md);

    this.fxLayer.add([overlay, card, menuChip, headline, sub, endlessBtn, communityBtn, replayBtn]);
    headline.setScale(0.95).setAlpha(0);
    this.tweens.add({ targets: headline, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
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
    let leaderboardData: LeaderboardResponse | undefined;
    const compareButton = makePill(this, {
      label: 'Compare',
      variant: 'chip',
      size: 'sm',
      onClick: () => {
        if (leaderboardData) this.showDailyLeaderboard(leaderboardData, 0);
      },
    });
    compareButton.setVisible(false);
    const copyButton = makePill(this, {
      label: 'Share result \u2197',
      variant: 'ghost',
      size: 'sm',
      x: w / 2,
      onClick: () => void this.copyResult(copyButton),
    });
    const revealLeaderboard = (data: LeaderboardResponse): void => {
      leaderboardData = data;
      if (data.totalPlayers <= 3) return;
      compareButton.setVisible(true);
      const gap = SPACE.sm;
      const rowWidth = compareButton.width + gap + copyButton.width;
      let x = w / 2 - rowWidth / 2;
      compareButton.setPosition(x + compareButton.width / 2, copyButton.y);
      x += compareButton.width + gap;
      copyButton.setX(x + copyButton.width / 2);
    };

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
      onClick: () => {
        trackClientEvent('daily_to_endless');
        fadeToScene(this, 'EndlessScene');
      },
    });

    const homeButton = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    homeButton.setPosition(cardLeft + SPACE.md + homeButton.width / 2, cardTop + SPACE.md + homeButton.height / 2);

    // Replay right here: "Try for ★★★" when there's room to improve. The
    // server keeps the best verified score, so trying again never hurts.
    const replayButton = makePill(this, {
      label: stars === 3 ? '\u21BA Play again' : '\u21BA Try for \u2605\u2605\u2605',
      variant: 'ghost',
      size: 'sm',
      x: w / 2,
      onClick: () => this.replayPuzzle(),
    });

    const winButtons: Phaser.GameObjects.GameObject[] = [
      status,
      compareButton,
      copyButton,
      morePuzzlesButton,
      homeButton,
      replayButton,
    ];
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
    // bottom): primary loop CTA, then the inward thread action (Comment my
    // score), then the quieter outward Share, then the opt-in nudge on top.
    const stack: PillButton[] = [morePuzzlesButton];
    if (postScoreButton) stack.push(postScoreButton);
    stack.push(copyButton, replayButton);
    if (cta) stack.push(cta);
    const stackTop = this.stackFromBottom(stack);

    const movesBottom = movesText.y + movesText.height / 2;
    this.winStatusTop = movesBottom + SPACE.md;
    this.winStatusBottom = stackTop - SPACE.md;
    this.positionWinStatus(status);

    this.completionPromise = this.submitSolve(status, revealLeaderboard);
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
    const playedId = this.communityPuzzle?.id ?? '';
    // Serialize the solved transcript once. Internal transport retries and the
    // visible manual retry must submit this identical immutable request body
    // (also identical to the request celebrateWin() already started).
    const completionBody = this.communityCompletionBody();
    const generation = this.playGeneration;
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
    // Let a signed solver drop their verified score into this exact puzzle's
    // thread. Creator and host-post gates remain unchanged.
    let scoreButton: PillButton | undefined;
    if (context.username && !isMine && this.isHostPostPuzzle) {
      scoreButton = makePill(this, {
        label: 'Comment my score',
        variant: 'secondary',
        minWidth: Math.min(240, contentW),
        onClick: () => {
          if (scoreButton) void this.postScore(scoreButton);
        },
      });
      scoreButton.setEnabled(false);
      buttons.push(scoreButton);
    }

    let verificationState: 'pending' | 'failed' | 'verified' = 'failed';
    let retryVerification: (() => void) | undefined;
    const moreButton = makePill(this, {
      label: 'Verifying solve\u2026',
      variant: 'primary',
      minWidth: Math.min(240, contentW),
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
      variant: 'ghost',
      size: 'sm',
      onClick: () => fadeToScene(this, 'GameScene', { daily: true }),
    });
    // Same replay offer as the Daily and the feed post.
    const communityStars = computeStars(this.moves, this.par);
    const replayButton = makePill(this, {
      label: communityStars === 3 ? '\u21BA Play again' : '\u21BA Try for \u2605\u2605\u2605',
      variant: 'ghost',
      size: 'sm',
      onClick: () => this.replayPuzzle(),
    });
    buttons.push(moreButton, replayButton, dailyButton);

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
    const w = this.scale.width;
    const h = this.scale.height;
    const showGuestPrompt = !context.username;
    const countY = h * 0.52;
    const signInY = h * 0.635;
    const nextY = h * (showGuestPrompt ? 0.74 : 0.7);
    const levelY = h * (showGuestPrompt ? 0.85 : 0.81);
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
        .text(w / 2, h * 0.43, `${this.moves} moves   (par ${this.par})`, {
          fontFamily: FONT.ui,
          fontSize: '18px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5);
      this.fxLayer.add(movesText);

      // The progression payoff: the lifetime solved count ticks up by one.
      const fromCount = this.endlessSolved;
      const countText = this.add
        .text(w / 2, countY, `Solved: ${fromCount}`, {
          fontFamily: FONT.ui,
          fontSize: '20px',
          fontStyle: '800',
          color: '#ffd166',
          align: 'center',
          lineSpacing: 4,
          wordWrap: { width: contentW },
        })
        .setOrigin(0.5);
      this.fxLayer.add(countText);

      this.time.delayedCall(520, () => sparkleBurst(this, this.fxLayer, w / 2, starY, Math.min(60, w * 0.16)));
      void this.recordEndless(countText, fromCount);
    } else {
      // Hinted solve: honest and encouraging, but it does not add to the total.
      const note = this.add
        .text(w / 2, h * 0.33, 'Solved with a hint', {
          fontFamily: FONT.ui,
          fontSize: '18px',
          fontStyle: '800',
          color: '#ffd166',
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(w / 2, h * 0.42, "This one doesn't add to your total \u2014 try the next one solo", {
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
        .text(w / 2, countY, `Solved: ${this.endlessSolved}`, {
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
      y: nextY,
      minWidth: Math.min(240, contentW),
      onClick: () => {
        trackClientEvent('endless_next');
        this.preserveEndlessPrefetch = true;
        fadeToScene(this, 'GameScene', { endless: { tier: this.endlessTier } });
      },
    });

    const levelButton = makePill(this, {
      label: 'Change level',
      variant: 'secondary',
      size: 'sm',
      x: w / 2,
      y: levelY,
      onClick: () => {
        trackClientEvent('endless_change_level');
        fadeToScene(this, 'EndlessScene');
      },
    });

    const homeButton = makePill(this, {
      label: '\u2039 Menu',
      variant: 'chip',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    homeButton.setPosition(cardLeft + SPACE.md + homeButton.width / 2, cardTop + SPACE.md + homeButton.height / 2);

    this.fxLayer.add([nextButton, levelButton, homeButton]);
    this.addSignInPrompt(signInY, 'Sign in to save your progress');
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
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(420, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    const panel = this.add
      .text(w / 2, h * 0.4, `Your puzzle works!\nYou solved it in ${this.moves} \u00B7 par ${this.testPar}`, {
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

  /** Practice step solved: on to the next rule, or off to the real puzzle. */
  private onWinTutorial(): void {
    const step = this.tutorialStep ?? 0;
    const last = step >= TUTORIAL_STEPS.length - 1;
    const w = this.scale.width;
    const h = this.scale.height;
    this.fxLayer.removeAll(true);
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x05131f, 0.55).setInteractive();
    const cardW = Math.min(420, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const contentW = cardW - SPACE.xl * 2;
    const card = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    const headline = this.add
      .text(
        w / 2,
        h * 0.36,
        last
          ? "You're ready!\nEvery puzzle uses just these moves."
          : `Nice!\nPractice ${step + 2} of ${TUTORIAL_STEPS.length} is next.`,
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
    const primary = makePill(this, {
      label: last ? 'Play today\u2019s puzzle' : 'Next \u25B6',
      variant: 'primary',
      minWidth: Math.min(240, contentW),
      onClick: () =>
        fadeToScene(this, 'GameScene', last ? { daily: true } : { tutorial: { step: step + 1 } }),
    });
    const secondary = makePill(this, {
      label: last ? '\u2039 Menu' : 'Skip practice',
      variant: 'ghost',
      size: 'sm',
      onClick: () => fadeToScene(this, 'HomeScene'),
    });
    stackColumn([primary, secondary], w / 2, h * 0.52, SPACE.md);
    this.fxLayer.add([overlay, card, headline, primary, secondary]);
    headline.setScale(0.92).setAlpha(0);
    this.tweens.add({ targets: headline, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
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
      button.setLabelText(data.ok ? `Upvoted! (${data.votes})` : data.reason ?? 'Already upvoted');
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
      button.setLabelText(result.alreadyPosted ? 'Already posted ✓' : 'Posted to comments ✓');
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

  private showStreamDone(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.won = true;
    this.beginBlockingOverlay();
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

  private async submitSolve(
    status: Phaser.GameObjects.Text,
    onLeaderboardLoaded: (leaderboard: LeaderboardResponse) => void
  ): Promise<void> {
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

      const lines: string[] = [];
      if (result.bestMoves < this.moves) {
        const rankSuffix =
          result.rank > 0
            ? ` · #${result.rank} of ${result.totalPlayers}`
            : '';
        lines.push(`Your best today: ${result.bestMoves} moves${rankSuffix}`);
      } else if (result.totalPlayers >= 2 && result.rank > 0) {
        lines.push(`You're #${result.rank} of ${result.totalPlayers} today`);
      } else if (result.rank > 0) {
        lines.push('You set today\u2019s pace - first one in!');
      } else {
        lines.push('Playing as a guest \u2014 scores aren\u2019t saved.');
      }
      if (result.streak > 1) lines.push(`Streak: ${result.streak} days`);

      if (!status.scene) return;
      status.setText(lines.join('\n'));
      this.positionWinStatus(status);

      // The verified completion promise must resolve here so an optional,
      // potentially slow leaderboard request can never block score comments.
      // Leaderboard enrichment continues independently behind generation guards.
      void this.loadDailyLeaderboard(status, lines, generation, onLeaderboardLoaded).catch(
        (error) => console.error(error)
      );
    } catch (error) {
      console.error(error);
      if (!this.isCurrentPlay(generation) || !status.scene) return;
      status.setText('Score could not be verified. Try again.');
      this.positionWinStatus(status);
    }
  }

  private async loadDailyLeaderboard(
    status: Phaser.GameObjects.Text,
    baseLines: readonly string[],
    generation: number,
    onLeaderboardLoaded: (leaderboard: LeaderboardResponse) => void
  ): Promise<void> {
    // Guests may compare after solving even though they are not ranked. The
    // response stays bounded to the top ten and, for signed players, five
    // nearby rows.
    const leaderboard = await this.fetchLeaderboard();
    if (!leaderboard || !this.isCurrentPlay(generation) || !status.scene) return;

    if (leaderboard.totalPlayers >= 2 && leaderboard.entries.length > 0) {
      const lines = [...baseLines, '', 'Top solvers today'];
      leaderboard.entries
        .slice(0, 3)
        .forEach((entry) =>
          lines.push(`${entry.rank}. ${entry.username} - ${entry.moves} moves`)
        );
      status.setText(lines.join('\n'));
      this.positionWinStatus(status);
    }
    onLeaderboardLoaded(leaderboard);
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

  private showDailyLeaderboard(data: LeaderboardResponse, requestedPage: number): void {
    const w = this.overlayBaseWidth || this.scale.width;
    const h = this.overlayBaseHeight || this.scale.height;
    const rowsPerPage = h < 400 ? 2 : h < 560 ? 3 : 5;
    type LeaderboardPage = {
      readonly label: string;
      readonly entries: LeaderboardResponse['entries'];
    };
    const pages: LeaderboardPage[] = [];
    const addPages = (section: string, entries: LeaderboardResponse['entries']): void => {
      for (let start = 0; start < entries.length; start += rowsPerPage) {
        const pageEntries = entries.slice(start, start + rowsPerPage);
        const first = pageEntries[0];
        const last = pageEntries.at(-1);
        if (!first || !last) continue;
        pages.push({
          label: `${section} \u00B7 #${first.rank}${last.rank === first.rank ? '' : `\u2013#${last.rank}`}`,
          entries: pageEntries,
        });
      }
    };

    // When the viewer is outside the first screenful, make one page-sized
    // local window the first page. Re-centre the server's five-row window for
    // short viewports so the page labelled "Around you" always contains You.
    if (data.viewerRank > rowsPerPage && data.nearbyEntries.length > 0) {
      const viewerIndex = data.nearbyEntries.findIndex(
        (entry) => entry.rank === data.viewerRank
      );
      if (viewerIndex >= 0) {
        const maxStart = Math.max(0, data.nearbyEntries.length - rowsPerPage);
        const aroundStart = Math.min(
          Math.max(0, viewerIndex - Math.floor(rowsPerPage / 2)),
          maxStart
        );
        const aroundEntries = data.nearbyEntries.slice(
          aroundStart,
          aroundStart + rowsPerPage
        );
        const first = aroundEntries[0];
        const last = aroundEntries.at(-1);
        if (first && last) {
          pages.push({
            label: `Around you \u00B7 #${first.rank}${last.rank === first.rank ? '' : `\u2013#${last.rank}`}`,
            entries: aroundEntries,
          });
        }
      }
    }
    addPages('Top solvers', data.entries);
    if (pages.length === 0) return;

    const pageIndex = Math.max(0, Math.min(requestedPage, pages.length - 1));
    const page = pages[pageIndex];
    const compact = h < 560;
    const cardW = Math.min(460, w - SPACE.lg * 2);
    const cardH = h - SPACE.lg * 2;
    const cardLeft = w / 2 - cardW / 2;
    const cardRight = cardLeft + cardW;
    const cardTop = h / 2 - cardH / 2;
    const cardBottom = cardTop + cardH;
    const modal = this.add.container(0, 0);

    const shade = this.add
      .rectangle(w / 2, h / 2, w, h, 0x05131f, 0.86)
      .setInteractive();
    const panel = makePanel(this, cardW, cardH).setPosition(w / 2, h / 2);
    const title = this.add
      .text(w / 2, cardTop + SPACE.xl, "Today's leaderboard", {
        fontFamily: FONT.display,
        fontSize: compact ? '21px' : '26px',
        fontStyle: '700',
        color: COLORS.text,
      })
      .setOrigin(0.5, 0);
    const summary = this.add
      .text(
        w / 2,
        title.y + title.height + SPACE.xs,
        data.viewerRank > 0
          ? `You're #${data.viewerRank} of ${data.totalPlayers}`
          : `${data.totalPlayers} verified ${data.totalPlayers === 1 ? 'solver' : 'solvers'}`,
        {
          fontFamily: FONT.ui,
          fontSize: compact ? '12px' : '14px',
          fontStyle: '800',
          color: COLORS.arrow,
        }
      )
      .setOrigin(0.5, 0);
    const rule = this.add
      .text(w / 2, summary.y + summary.height + SPACE.xs, 'Fewest moves wins \u00B7 verified time breaks ties', {
        fontFamily: FONT.ui,
        fontSize: compact ? '10px' : '11px',
        fontStyle: '600',
        color: COLORS.text,
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.68);
    const pageTitle = this.add
      .text(w / 2, rule.y + rule.height + SPACE.md, page.label, {
        fontFamily: FONT.ui,
        fontSize: compact ? '12px' : '13px',
        fontStyle: '800',
        color: COLORS.arrow,
      })
      .setOrigin(0.5, 0);
    modal.add([shade, panel, title, summary, rule, pageTitle]);

    const hasPager = pages.length > 1;
    const listTop = pageTitle.y + pageTitle.height + SPACE.sm;
    const listBottom = cardBottom - (hasPager ? 98 : 70);
    const availableListHeight = Math.max(1, listBottom - listTop);
    const rowHeight = Math.min(58, availableListHeight / Math.max(1, page.entries.length));
    const renderedListHeight = rowHeight * page.entries.length;
    const firstRowTop = listTop + (availableListHeight - renderedListHeight) / 2;
    const rowLeft = cardLeft + SPACE.xl;
    const rowWidth = cardW - SPACE.xl * 2;

    page.entries.forEach((entry, index) => {
      const rowTop = firstRowTop + index * rowHeight;
      const rowY = rowTop + rowHeight / 2;
      const isViewer = Boolean(context.username) && entry.username === context.username;
      const background = this.add.graphics();
      background.fillStyle(isViewer ? COLORS.gold : 0x0e2740, isViewer ? 0.16 : 0.72);
      background.fillRoundedRect(rowLeft, rowTop + 2, rowWidth, Math.max(28, rowHeight - 4), 11);
      if (isViewer) {
        background.lineStyle(1.5, COLORS.gold, 0.9);
        background.strokeRoundedRect(rowLeft, rowTop + 2, rowWidth, Math.max(28, rowHeight - 4), 11);
      }
      const rank = this.add
        .text(rowLeft + SPACE.md, rowY, `#${entry.rank}`, {
          fontFamily: FONT.ui,
          fontSize: compact ? '12px' : '13px',
          fontStyle: '800',
          color: isViewer ? COLORS.arrow : COLORS.text,
        })
        .setOrigin(0, 0.5);
      const usernameLimit = cardW < 320 ? 11 : cardW < 400 ? 15 : 20;
      const displayUsername =
        isViewer || entry.username.length <= usernameLimit
          ? isViewer
            ? 'You'
            : entry.username
          : `${entry.username.slice(0, usernameLimit - 1)}\u2026`;
      const username = this.add
        .text(rowLeft + 54, rowY, displayUsername, {
          fontFamily: FONT.ui,
          fontSize: compact ? '13px' : '15px',
          fontStyle: isViewer ? '800' : '700',
          color: COLORS.text,
        })
        .setOrigin(0, 0.5);
      const moves = this.add
        .text(
          cardRight - SPACE.xl - SPACE.md,
          rowY,
          `${entry.moves} ${entry.moves === 1 ? 'move' : 'moves'}`,
          {
            fontFamily: FONT.ui,
            fontSize: compact ? '12px' : '14px',
            fontStyle: '800',
            color: isViewer ? COLORS.arrow : COLORS.text,
          }
        )
        .setOrigin(1, 0.5);
      modal.add([background, rank, username, moves]);
    });

    const close = makePill(this, {
      label: 'Close',
      variant: 'chip',
      size: 'sm',
      x: w / 2,
      y: cardBottom - SPACE.xl,
      onClick: () => modal.destroy(true),
    });
    modal.add(close);

    if (hasPager) {
      const pagerY = cardBottom - 70;
      const pageCount = this.add
        .text(w / 2, pagerY, `${pageIndex + 1} / ${pages.length}`, {
          fontFamily: FONT.ui,
          fontSize: '12px',
          fontStyle: '700',
          color: COLORS.text,
        })
        .setOrigin(0.5)
        .setAlpha(0.72);
      modal.add(pageCount);
      if (pageIndex > 0) {
        const previous = makePill(this, {
          label: '\u2039 Prev',
          variant: 'chip',
          size: 'sm',
          onClick: () => {
            modal.destroy(true);
            this.showDailyLeaderboard(data, pageIndex - 1);
          },
        });
        previous.setPosition(cardLeft + SPACE.xl + previous.width / 2, pagerY);
        modal.add(previous);
      }
      if (pageIndex < pages.length - 1) {
        const next = makePill(this, {
          label: 'Next \u203A',
          variant: 'chip',
          size: 'sm',
          onClick: () => {
            modal.destroy(true);
            this.showDailyLeaderboard(data, pageIndex + 1);
          },
        });
        next.setPosition(cardRight - SPACE.xl - next.width / 2, pagerY);
        modal.add(next);
      }
    }

    // Add the modal last so its interactive shade blocks every underlying win
    // action while preserving the fitted base-coordinate system on resize.
    this.fxLayer.add(modal);
  }

  private async fetchLeaderboard(): Promise<LeaderboardResponse | undefined> {
    try {
      const response = await fetch(
        `/api/leaderboard?puzzleId=${encodeURIComponent(this.dailyPuzzleId)}`
      );
      if (!response.ok) return undefined;
      const value: unknown = await response.json();
      return parseLeaderboardResponse(value, this.dailyPuzzleId);
    } catch {
      return undefined;
    }
  }
}
