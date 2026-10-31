import { showLoginPrompt, showShareSheet, showToast } from '@devvit/web/client';
import type {
  DailySplashSnapshotV2,
  UgcSplashSnapshotV2,
} from '../shared/api';
import type { Board, Move, Piece } from '../shared/game/types';
import { parseDailyPuzzleId } from '../shared/daily';
import { legalMoves } from '../shared/game/moves';
import { applyMove, isSolved } from '../shared/game/rules';
import { slideStop } from '../shared/game/slide';
import {
  WIN_CELEBRATION_MS,
  WIN_CELEBRATION_REDUCED_MS,
  keepSelectedAfterMove,
  moveDurationMs,
  sealBlockedByWater,
} from '../shared/game/motion';
import { MAX_REPLAY_MOVES, replayMoves } from '../shared/game/replay';
import { validateBoardStructure } from '../shared/game/validation';
import { computeStars, starGoal, starGoalLabel } from '../shared/scoring';
import { buildShareText } from '../shared/share';
import { difficultyFromPar, type Difficulty } from '../shared/solver/difficulty';
import { clearDailyHandoff, saveDailyHandoff } from './dailyHandoff';
import { playHop, playSlide, playSplash, playWin, startMusic } from './audio';
import { trackClientEvent } from './telemetry';

const CELL = 44;
const PAD = 12;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_COUNT = 10_000_000;
const MAX_STREAK = 100_000;
const SEAL_TAP_SLOP_PX = 10;
/** Literal-typed so createElementNS returns specific SVG element types. */
const SVG_NS = 'http://www.w3.org/2000/svg';
/** How far past its last stop a seal must be pushed before it refuses water. */
const SEAL_REFUSE_PX = 14;

const runInlineAudio = (effect: () => void): void => {
  try {
    effect();
  } catch {
    // Optional audio must never interrupt authoritative puzzle state.
  }
};

export type InlinePuzzleKind = 'daily' | 'ugc';

type InlinePuzzleState =
  | 'preview'
  | 'loading'
  | 'playing'
  | 'animating'
  | 'awaiting-session'
  | 'verifying'
  | 'verified-win'
  | 'load-error'
  | 'verification-error';

export type InlineLaunchIntent = 'play' | 'home' | 'endless' | 'leaderboard';

export type InlineBoardRenderer = (
  board: Board,
  pieces: readonly Piece[],
  label: string
) => string;

type InlineSharedOptions = {
  readonly root: HTMLElement;
  readonly postId: string;
  readonly renderBoard: InlineBoardRenderer;
  readonly openExpanded: (
    event: MouseEvent,
    intent: InlineLaunchIntent,
    beforeRequest?: () => boolean
  ) => void;
  readonly onLegacyHydrationError?: () => void;
  readonly onHydrated?: () => void;
};

export type InlineDailyOptions = InlineSharedOptions & {
  readonly snapshot?: DailySplashSnapshotV2;
};

export type InlineCommunityOptions = InlineSharedOptions & {
  readonly snapshot?: UgcSplashSnapshotV2;
};

type InlinePuzzleOptions =
  | (InlineDailyOptions & { readonly kind: 'daily' })
  | (InlineCommunityOptions & { readonly kind: 'ugc' });

type InlineSnapshot = DailySplashSnapshotV2 | UgcSplashSnapshotV2;

export type InlinePuzzleController = {
  start(restoreKeyboardFocus?: boolean): void;
  applySnapshot(snapshot: InlineSnapshot): boolean;
  setExpansionPending(pending: boolean): void;
};

/** Backward-compatible name for callers that only construct Daily controllers. */
export type InlineDailyController = InlinePuzzleController;

type SolvedResult = {
  readonly moves: number;
  readonly stars: number;
};

type DailyInit = {
  readonly type: 'init';
  readonly kind: 'daily';
  readonly puzzleId: string;
  readonly date: string;
  readonly playId: string;
  readonly board: Board;
  readonly par: number;
  readonly difficulty: Difficulty;
  readonly username: string;
  readonly solved: boolean;
  readonly solvedResult?: SolvedResult;
  readonly subscribed: boolean;
  readonly subredditName?: string;
};

type DailyPuzzleDisplay = {
  readonly kind: 'daily';
  readonly puzzleId: string;
  readonly date: string;
  readonly board: Board;
  readonly par: number;
  readonly difficulty: Difficulty;
};

type CommunityPuzzleDisplay = {
  readonly kind: 'ugc';
  readonly id: string;
  readonly board: Board;
  readonly par: number;
  readonly difficulty: Difficulty;
  readonly creator: string;
};

type CommunityInit = {
  readonly type: 'init';
  readonly kind: 'ugc';
  readonly puzzle: CommunityPuzzleDisplay & {
    readonly votes: number;
    readonly solves: number;
  };
  readonly username: string;
  readonly solved: boolean;
  readonly subredditName?: string;
};

type InlineSession = DailyInit | CommunityInit;
type InlinePuzzleDisplay = DailyPuzzleDisplay | CommunityPuzzleDisplay;

type DailyVerifiedSolve = {
  readonly kind: 'daily';
  readonly accepted: true;
  readonly stars: number;
  readonly par: number;
  readonly moves: number;
  readonly bestMoves: number;
  readonly rank: number;
  readonly totalPlayers: number;
  readonly streak: number;
};

type CommunityVerifiedSolve = {
  readonly kind: 'ugc';
  readonly ok: true;
  readonly saved: boolean;
  readonly firstSolve: boolean;
};

type VerifiedSolve = DailyVerifiedSolve | CommunityVerifiedSolve;

type Point = { readonly x: number; readonly y: number };

type DragTarget = {
  readonly move: Move;
  readonly delta: number;
};

/** One short-lived board effect (a splash ripple or a puff of snow). */
type BoardEffect = {
  readonly kind: 'splash' | 'spray';
  readonly cell: number;
  /** Direction the snow drifts (opposite to the slide); 0,0 for splashes. */
  readonly dx: number;
  readonly dy: number;
  readonly at: number;
};

/** Effects keep animating across re-renders until they finish. */
const EFFECT_LIFETIME_MS = 700;
/** Shared period of the idle animations (LCM of 2.6s breathe, 3.4s shimmer). */
const IDLE_CLOCK_PERIOD_MS = 44_200;

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type SealDrag = {
  readonly pointerId: number;
  readonly pieceIndex: number;
  readonly orient: 'H' | 'V';
  readonly owner: HTMLElement;
  readonly control: HTMLButtonElement;
  readonly art: Element | null;
  readonly targets: readonly DragTarget[];
  readonly min: number;
  readonly max: number;
  readonly viewUnitsPerCssPixel: number;
  readonly startCoordinate: number;
  readonly clearSelection: () => void;
  current: number;
  moved: boolean;
};

const ACTIVE_POINTER_LISTENER_OPTIONS: AddEventListenerOptions = {
  passive: false,
};

const property = (value: object, key: string): unknown => Reflect.get(value, key);
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const readDifficulty = (value: unknown): Difficulty | null =>
  value === 'EASY' || value === 'MEDIUM' || value === 'HARD' || value === 'EXPERT'
    ? value
    : null;

const readInteger = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : null;

const readBoundedString = (value: unknown, maxLength: number): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;

const parseSolvedResult = (value: unknown, par: number): SolvedResult | null => {
  if (!isObject(value)) return null;
  const moves = readInteger(property(value, 'moves'), par, MAX_REPLAY_MOVES);
  const stars = readInteger(property(value, 'stars'), 1, 3);
  if (moves === null || stars === null || computeStars(moves, par) !== stars) return null;
  return { moves, stars };
};

const parseDailyInit = (value: unknown): DailyInit | null => {
  if (
    !isObject(value) ||
    property(value, 'type') !== 'init' ||
    property(value, 'kind') !== 'daily'
  ) {
    return null;
  }

  const puzzleId = readBoundedString(property(value, 'puzzleId'), 128);
  const puzzleRef = parseDailyPuzzleId(puzzleId);
  const date = property(value, 'date');
  const playId = readBoundedString(property(value, 'playId'), 512);
  const par = readInteger(property(value, 'par'), 1, MAX_REPLAY_MOVES);
  const difficulty = readDifficulty(property(value, 'difficulty'));
  const username = readBoundedString(property(value, 'username'), 100);
  const solved = property(value, 'solved');
  const subscribed = property(value, 'subscribed');
  const subredditNameValue = property(value, 'subredditName');
  const structure = validateBoardStructure(property(value, 'board'));
  if (
    !puzzleId ||
    !puzzleRef ||
    date !== puzzleRef.date ||
    !playId ||
    par === null ||
    !difficulty ||
    difficultyFromPar(par) !== difficulty ||
    !username ||
    typeof solved !== 'boolean' ||
    typeof subscribed !== 'boolean' ||
    (subredditNameValue !== undefined &&
      (typeof subredditNameValue !== 'string' || subredditNameValue.length > 100)) ||
    !structure.ok
  ) {
    return null;
  }

  const board = structure.board;
  const hopperCount = board.pieces.filter((piece) => piece.kind === 'HOPPER').length;
  if (
    hopperCount < 1 ||
    hopperCount !== board.holes.length ||
    isSolved(board, board.pieces)
  ) {
    return null;
  }

  const solvedResultValue = property(value, 'solvedResult');
  const solvedResult =
    solvedResultValue === undefined ? null : parseSolvedResult(solvedResultValue, par);
  if ((solved && !solvedResult) || (!solved && solvedResultValue !== undefined)) return null;

  const base: DailyInit = {
    type: 'init',
    kind: 'daily',
    puzzleId,
    date: puzzleRef.date,
    playId,
    board,
    par,
    difficulty,
    username,
    solved,
    subscribed,
  };
  if (solvedResult) {
    return subredditNameValue === undefined
      ? { ...base, solvedResult }
      : { ...base, solvedResult, subredditName: subredditNameValue };
  }
  return subredditNameValue === undefined
    ? base
    : { ...base, subredditName: subredditNameValue };
};

const parseCommunityInit = (value: unknown): CommunityInit | null => {
  if (
    !isObject(value) ||
    property(value, 'type') !== 'init' ||
    property(value, 'kind') !== 'ugc'
  ) {
    return null;
  }

  const puzzleValue = property(value, 'puzzle');
  if (!isObject(puzzleValue)) return null;
  const id = readBoundedString(property(puzzleValue, 'id'), 64);
  const par = readInteger(property(puzzleValue, 'par'), 1, MAX_REPLAY_MOVES);
  const difficulty = readDifficulty(property(puzzleValue, 'difficulty'));
  const creator = readBoundedString(property(puzzleValue, 'creator'), 100);
  const votes = readInteger(property(puzzleValue, 'votes'), 0, MAX_COUNT);
  const solves = readInteger(property(puzzleValue, 'solves'), 0, MAX_COUNT);
  const username = readBoundedString(property(value, 'username'), 100);
  const solved = property(value, 'solved');
  const subredditNameValue = property(value, 'subredditName');
  const structure = validateBoardStructure(property(puzzleValue, 'board'));
  if (
    !id ||
    par === null ||
    !difficulty ||
    difficultyFromPar(par) !== difficulty ||
    !creator ||
    votes === null ||
    solves === null ||
    !username ||
    typeof solved !== 'boolean' ||
    (subredditNameValue !== undefined &&
      (typeof subredditNameValue !== 'string' || subredditNameValue.length > 100)) ||
    !structure.ok
  ) {
    return null;
  }

  const board = structure.board;
  const hopperCount = board.pieces.filter((piece) => piece.kind === 'HOPPER').length;
  if (
    hopperCount < 1 ||
    hopperCount !== board.holes.length ||
    isSolved(board, board.pieces)
  ) {
    return null;
  }

  const base: CommunityInit = {
    type: 'init',
    kind: 'ugc',
    puzzle: {
      kind: 'ugc',
      id,
      board,
      par,
      difficulty,
      creator,
      votes,
      solves,
    },
    username,
    solved,
  };
  return subredditNameValue === undefined
    ? base
    : { ...base, subredditName: subredditNameValue };
};

const parseVerifiedSolve = (
  value: unknown,
  session: DailyInit,
  expectedMoves: number
): DailyVerifiedSolve | null => {
  if (!isObject(value) || property(value, 'accepted') !== true) return null;
  const stars = readInteger(property(value, 'stars'), 1, 3);
  const par = readInteger(property(value, 'par'), 1, MAX_REPLAY_MOVES);
  const moves = readInteger(property(value, 'moves'), 1, MAX_REPLAY_MOVES);
  const bestMoves = readInteger(property(value, 'bestMoves'), 1, MAX_REPLAY_MOVES);
  const totalPlayers = readInteger(property(value, 'totalPlayers'), 0, MAX_COUNT);
  const streak = readInteger(property(value, 'streak'), 0, MAX_STREAK);
  if (
    stars === null ||
    par === null ||
    moves === null ||
    bestMoves === null ||
    totalPlayers === null ||
    streak === null
  ) {
    return null;
  }
  const rank = readInteger(property(value, 'rank'), 0, totalPlayers);
  if (
    rank === null ||
    par !== session.par ||
    moves !== expectedMoves ||
    moves < par ||
    bestMoves < par ||
    bestMoves > moves ||
    computeStars(bestMoves, par) !== stars ||
    (session.username === 'anon' &&
      (rank !== 0 || totalPlayers !== 0 || streak !== 0))
  ) {
    return null;
  }
  return {
    kind: 'daily',
    accepted: true,
    stars,
    par,
    moves,
    bestMoves,
    rank,
    totalPlayers,
    streak,
  };
};

type ParsedMarkPlayedResponse =
  | CommunityVerifiedSolve
  | {
      readonly kind: 'ugc';
      readonly ok: false;
      readonly saved: false;
      readonly reason: string;
    };

const parseMarkPlayedResponse = (value: unknown): ParsedMarkPlayedResponse | null => {
  if (!isObject(value) || typeof property(value, 'ok') !== 'boolean') return null;
  const ok = property(value, 'ok');
  const saved = property(value, 'saved');
  if (ok === true) {
    const firstSolve = property(value, 'firstSolve');
    return typeof saved === 'boolean' && typeof firstSolve === 'boolean'
      ? { kind: 'ugc', ok: true, saved, firstSolve }
      : null;
  }
  const reason = readBoundedString(property(value, 'reason'), 500);
  return saved === false && reason
    ? { kind: 'ugc', ok: false, saved: false, reason }
    : null;
};

type ParsedVoteResponse = {
  readonly ok: boolean;
  readonly votes: number;
  readonly reason?: string;
};

const parseVoteResponse = (value: unknown): ParsedVoteResponse | null => {
  if (!isObject(value) || typeof property(value, 'ok') !== 'boolean') return null;
  const ok = property(value, 'ok');
  const votes = readInteger(property(value, 'votes'), 0, MAX_COUNT);
  const reasonValue = property(value, 'reason');
  if (
    typeof ok !== 'boolean' ||
    votes === null ||
    (reasonValue !== undefined &&
      (typeof reasonValue !== 'string' || reasonValue.length < 1 || reasonValue.length > 500))
  ) {
    return null;
  }
  return reasonValue === undefined ? { ok, votes } : { ok, votes, reason: reasonValue };
};

const parseCommentScoreResponse = (
  value: unknown
): { readonly alreadyPosted: boolean } | null => {
  if (
    !isObject(value) ||
    property(value, 'type') !== 'commentScore' ||
    property(value, 'ok') !== true ||
    typeof property(value, 'alreadyPosted') !== 'boolean'
  ) {
    return null;
  }
  const alreadyPosted = property(value, 'alreadyPosted');
  return typeof alreadyPosted === 'boolean' ? { alreadyPosted } : null;
};

const isSubscribeSuccess = (value: unknown): boolean =>
  isObject(value) && property(value, 'status') === 'success';

const clonePiece = (piece: Piece): Piece =>
  piece.kind === 'SLIDER'
    ? { kind: piece.kind, cells: [...piece.cells], orient: piece.orient ?? 'H' }
    : { kind: piece.kind, cells: [...piece.cells] };

const cloneMove = (move: Move): Move => ({
  pieceIndex: move.pieceIndex,
  kind: move.kind,
  to: [...move.to],
});

const sameCells = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((cell, index) => cell === right[index]);

const sameMove = (left: Move, right: Move): boolean =>
  left.pieceIndex === right.pieceIndex &&
  left.kind === right.kind &&
  sameCells(left.to, right.to);

const samePieceInOrder = (left: Piece, right: Piece): boolean => {
  if (left.kind !== right.kind || !sameCells(left.cells, right.cells)) return false;
  return left.kind === 'SLIDER' && right.kind === 'SLIDER'
    ? left.orient === right.orient
    : true;
};

const sameBoardInOrder = (left: Board, right: Board): boolean =>
  left.width === right.width &&
  left.height === right.height &&
  sameCells(left.holes, right.holes) &&
  left.pieces.length === right.pieces.length &&
  left.pieces.every((piece, index) => {
    const other = right.pieces[index];
    return other !== undefined && samePieceInOrder(piece, other);
  });

const dailyPuzzleMatchesSnapshot = (
  puzzle: DailyPuzzleDisplay,
  snapshot: DailySplashSnapshotV2
): boolean =>
  puzzle.puzzleId === snapshot.puzzleId &&
  puzzle.date === snapshot.date &&
  puzzle.par === snapshot.par &&
  puzzle.difficulty === snapshot.difficulty &&
  sameBoardInOrder(puzzle.board, snapshot.board);

const communityPuzzleMatchesSnapshot = (
  puzzle: CommunityPuzzleDisplay,
  snapshot: UgcSplashSnapshotV2
): boolean =>
  puzzle.id === snapshot.id &&
  puzzle.par === snapshot.par &&
  puzzle.difficulty === snapshot.difficulty &&
  puzzle.creator === snapshot.creator &&
  sameBoardInOrder(puzzle.board, snapshot.board);

const snapshotsMatch = (left: InlineSnapshot, right: InlineSnapshot): boolean => {
  if (left.kind !== right.kind) return false;
  return left.kind === 'daily' && right.kind === 'daily'
    ? dailyPuzzleMatchesSnapshot(left, right)
    : left.kind === 'ugc' && right.kind === 'ugc'
      ? communityPuzzleMatchesSnapshot(left, right)
      : false;
};

const sessionMatchesSnapshot = (
  session: InlineSession,
  snapshot: InlineSnapshot
): boolean => {
  if (session.kind !== snapshot.kind) return false;
  return session.kind === 'daily' && snapshot.kind === 'daily'
    ? dailyPuzzleMatchesSnapshot(session, snapshot)
    : session.kind === 'ugc' && snapshot.kind === 'ugc'
      ? communityPuzzleMatchesSnapshot(session.puzzle, snapshot)
      : false;
};

const centerOfCells = (board: Board, cells: readonly number[]): Point => {
  let x = 0;
  let y = 0;
  for (const cell of cells) {
    x += PAD + (cell % board.width) * CELL + CELL / 2;
    y += PAD + Math.floor(cell / board.width) * CELL + CELL / 2;
  }
  return { x: x / cells.length, y: y / cells.length };
};

const viewSize = (board: Board): Point => ({
  x: board.width * CELL + PAD * 2,
  y: board.height * CELL + PAD * 2,
});

const cellPosition = (board: Board, cell: number): string =>
  `row ${Math.floor(cell / board.width) + 1}, column ${(cell % board.width) + 1}`;

const describeBoardState = (board: Board, pieces: readonly Piece[]): string => {
  const water = board.holes.map((cell) => cellPosition(board, cell));
  const rocks = pieces
    .filter((piece) => piece.kind === 'BLOCKER')
    .flatMap((piece) => piece.cells.map((cell) => cellPosition(board, cell)));
  const penguins = pieces
    .filter((piece) => piece.kind === 'HOPPER')
    .map((piece) => {
      const cell = piece.cells[0] ?? 0;
      return `${cellPosition(board, cell)}${board.holes.includes(cell) ? ', in water' : ''}`;
    });
  const seals = pieces
    .filter((piece) => piece.kind === 'SLIDER')
    .map((piece) => {
      const orientation = (piece.orient ?? 'H') === 'H' ? 'horizontal' : 'vertical';
      const positions = piece.cells.map((cell) => cellPosition(board, cell)).join(' and ');
      return `${orientation} at ${positions}`;
    });
  const list = (entries: readonly string[]): string =>
    entries.length > 0 ? entries.join('; ') : 'none';

  return [
    `Board dimensions: ${board.width} columns by ${board.height} rows.`,
    `Water holes: ${list(water)}.`,
    `Rocks: ${list(rocks)}.`,
    `Penguins: ${list(penguins)}.`,
    `Seals: ${list(seals)}.`,
  ].join(' ');
};

const titleDifficulty = (difficulty: Difficulty): string =>
  `${difficulty.slice(0, 1)}${difficulty.slice(1).toLowerCase()}`;

const formatDailyDate = (date: string): string =>
  new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const makeButton = (
  label: string,
  className: string,
  onClick: (event: MouseEvent) => void
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
};

const makeParagraph = (className: string, text: string): HTMLParagraphElement => {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
};

class InlinePuzzleControllerImpl implements InlinePuzzleController {
  private readonly stage: HTMLElement;
  private readonly contextText: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly topOpenButton: HTMLButtonElement;
  private state: InlinePuzzleState = 'preview';
  private started = false;
  private hydrationPending = false;
  private hydrationError = '';
  private startTracked = false;
  private session: InlineSession | null = null;
  private pieces: readonly Piece[] = [];
  private history: Move[] = [];
  private selected: number | null = null;
  private verified: VerifiedSolve | null = null;
  private solveBody: string | null = null;
  private verificationExpired = false;
  private completionKeyboardFocus = false;
  private hydrationKeyboardFocus = false;
  private generation = 0;
  private requestSequence = 0;
  private transitionSequence = 0;
  private announcementSequence = 0;
  private requestController: AbortController | null = null;
  private drag: SealDrag | null = null;
  /** The last splash or snow puff, drawn until it finishes animating. */
  private boardEffect: BoardEffect | null = null;
  /** The ~1s win beat (final splash, penguins cheer) before the result card. */
  private celebrating = false;
  private celebrationRendered = false;
  private celebrationTimer: number | undefined;
  /** One flipper bump per drag when a seal is pushed toward open water. */
  private sealRefused = false;
  /** The current selection was kept automatically after a hop. */
  private keptSelection = false;
  private suppressedClickPiece: number | null = null;
  private suppressedClickUntil = 0;
  private readonly handleActiveSealPointerMove = (event: PointerEvent): void => {
    this.moveSealPointerDrag(event);
  };
  private readonly handleActiveSealPointerUp = (event: PointerEvent): void => {
    this.endSealPointerDrag(event);
  };
  private readonly handleActiveSealPointerCancel = (event: PointerEvent): void => {
    this.cancelSealPointerDrag(event);
  };
  private readonly handleActiveSealPointerOut = (event: PointerEvent): void => {
    const drag = this.drag;
    if (
      !drag ||
      event.pointerId !== drag.pointerId ||
      event.relatedTarget !== null
    ) {
      return;
    }
    this.abortActiveSealDrag(true);
  };
  private readonly handleActiveSealWindowExit = (): void => {
    this.abortActiveSealDrag(false);
  };
  private readonly handleSealPointerCaptureLost = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.abortActiveSealDrag(true);
  };
  private loadErrorMessage: string;
  private expansionPending = false;
  private scorePosted = false;
  private commentPending = false;
  private joined = false;
  private joinPending = false;
  private snapshot: InlineSnapshot | null;

  constructor(private readonly options: InlinePuzzleOptions) {
    this.snapshot = options.snapshot ?? null;
    this.loadErrorMessage = this.defaultLoadErrorMessage();
    const stage = options.root.querySelector('#inline-stage');
    const contextText = options.root.querySelector('#inline-context');
    const liveRegion = options.root.querySelector('#inline-live');
    const topOpenButton = options.root.querySelector('#inline-open-button');
    if (
      !(stage instanceof HTMLElement) ||
      !(contextText instanceof HTMLElement) ||
      !(liveRegion instanceof HTMLElement) ||
      !(topOpenButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Inline puzzle markup is incomplete.');
    }
    this.stage = stage;
    this.contextText = contextText;
    this.liveRegion = liveRegion;
    this.topOpenButton = topOpenButton;
    this.topOpenButton.addEventListener('click', (event) => {
      const intent: InlineLaunchIntent =
        this.state === 'verified-win' ? 'home' : 'play';
      this.openExpanded(event, intent);
    });
  }

  private defaultLoadErrorMessage(): string {
    return this.options.kind === 'daily'
      ? 'Today’s puzzle could not be loaded safely.'
      : 'This Community puzzle could not be loaded safely.';
  }

  private modeLabel(): string {
    return this.options.kind === 'daily' ? 'Daily' : 'Community';
  }

  private currentPuzzle(): InlinePuzzleDisplay | null {
    if (this.session?.kind === 'ugc') return this.session.puzzle;
    return this.session ?? this.snapshot;
  }

  start(restoreKeyboardFocus = false): void {
    if (this.started) {
      // A second explicit start only belongs to a legacy fallback. Exact
      // snapshots hydrate on the first deliberate board interaction instead.
      if (!this.snapshot && !this.session && !this.hydrationPending) {
        this.hydrateSession(restoreKeyboardFocus);
      }
      return;
    }

    this.started = true;
    this.beginGeneration();
    this.session = null;
    this.pieces = this.snapshot
      ? this.snapshot.board.pieces.map(clonePiece)
      : [];
    this.history = [];
    this.selected = null;
    this.verified = null;
    this.solveBody = null;
    this.verificationExpired = false;
    this.completionKeyboardFocus = false;
    this.hydrationKeyboardFocus = false;
    this.scorePosted = false;
    this.commentPending = false;
    this.joined = false;
    this.joinPending = false;
    this.hydrationError = '';
    this.loadErrorMessage = this.defaultLoadErrorMessage();

    if (this.snapshot) {
      this.state = 'playing';
      this.showRoot();
      this.render();
      if (restoreKeyboardFocus) this.focusFirstPieceControl();
      this.announce(`${this.modeLabel()} ready. Par ${this.snapshot.par}.`);
    } else {
      // A no-snapshot start belongs to an explicit click on a legacy fallback.
      // `/api/init` supplies and verifies the exact host puzzle before play.
      this.state = 'loading';
      this.hydrateSession(restoreKeyboardFocus);
    }
  }

  applySnapshot(snapshot: InlineSnapshot): boolean {
    const existing = this.snapshot;
    const kindMismatch = snapshot.kind !== this.options.kind;
    if (
      kindMismatch ||
      (existing && !snapshotsMatch(existing, snapshot)) ||
      (this.session && !sessionMatchesSnapshot(this.session, snapshot))
    ) {
      // Preserve only the board that was already visible. A session-only legacy
      // play needs a read-only snapshot before its authority is cleared so the
      // fatal surface can keep that exact board frozen while Retry re-runs init.
      const session = this.session;
      if (!existing && session) {
        this.snapshot =
          session.kind === 'daily'
            ? {
                version: 2,
                kind: 'daily',
                puzzleId: session.puzzleId,
                date: session.date,
                board: session.board,
                par: session.par,
                difficulty: session.difficulty,
              }
            : {
                version: 2,
                kind: 'ugc',
                id: session.puzzle.id,
                board: session.puzzle.board,
                par: session.puzzle.par,
                difficulty: session.puzzle.difficulty,
                creator: session.puzzle.creator,
              };
      }
      this.beginGeneration();
      this.session = null;
      this.selected = null;
      this.verified = null;
      this.solveBody = null;
      this.scorePosted = false;
      this.commentPending = false;
      this.joined = false;
      this.joinPending = false;
      this.hydrationError = '';
      this.showFatalLoadError(
        kindMismatch
          ? `The post preview did not match the expected ${this.modeLabel()} puzzle.`
          : `The post preview did not match the active ${this.modeLabel()} puzzle.`
      );
      return false;
    }

    this.snapshot = snapshot;
    if (!this.started) {
      this.start();
    } else if (!existing && !this.session) {
      // A legacy Play may have started /api/init just before the read-only
      // preview returned. Adopt the exact board immediately and leave that
      // already-deliberate request in flight for identity/order verification.
      this.pieces = snapshot.board.pieces.map(clonePiece);
      this.history = [];
      this.selected = null;
      this.hydrationError = '';
      this.loadErrorMessage = this.defaultLoadErrorMessage();
      this.state = 'playing';
      this.showRoot();
      this.render();
      this.announce(`${this.modeLabel()} ready. Par ${snapshot.par}.`);
    }

    return true;
  }

  setExpansionPending(pending: boolean): void {
    this.expansionPending = pending;
    // Expansion may be triggered by a second input modality while a mouse or
    // pen still owns the board pointer. Return that purely visual preview to
    // its canonical origin before move input is locked.
    if (pending) this.abortActiveSealDrag(false);
    const stateLocked = this.expansionIsLocked();
    const buttons = this.options.root.querySelectorAll('.inline-open-button');
    for (const element of Array.from(buttons)) {
      if (!(element instanceof HTMLButtonElement)) continue;
      const idleLabel = element.dataset.idleLabel;
      element.disabled = pending || stateLocked;
      if (pending) {
        if (!idleLabel) element.dataset.idleLabel = element.textContent ?? 'Full game';
        element.textContent = 'Opening…';
        element.setAttribute('aria-busy', 'true');
      } else {
        if (idleLabel) element.textContent = idleLabel;
        if (
          this.state === 'awaiting-session' ||
          this.state === 'verifying'
        ) {
          element.setAttribute('aria-busy', 'true');
        } else {
          element.removeAttribute('aria-busy');
        }
        delete element.dataset.idleLabel;
      }
    }
  }

  private showRoot(): void {
    const active = document.activeElement;
    const restoreFocus =
      active instanceof HTMLElement &&
      !this.options.root.contains(active) &&
      active !== document.body;
    this.options.root.hidden = false;
    document.body.classList.add('inline-daily-active');
    if (restoreFocus) {
      // Static-to-inline upgrades replace the focused launch card. Move focus
      // to the equivalent visible action after the new surface is rendered.
      queueMicrotask(() => {
        if (!this.options.root.contains(document.activeElement)) {
          this.topOpenButton.focus();
        }
      });
    }
  }

  private beginGeneration(): number {
    this.abortActiveSealDrag(false);
    this.generation += 1;
    this.transitionSequence += 1;
    this.announcementSequence += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.hydrationPending = false;
    this.hydrationKeyboardFocus = false;
    this.completionKeyboardFocus = false;
    this.verificationExpired = false;
    this.suppressedClickPiece = null;
    this.suppressedClickUntil = 0;
    this.endCelebration();
    this.boardEffect = null;
    return this.generation;
  }

  /** Cancel a running win beat without rendering (a new generation took over). */
  private endCelebration(): void {
    if (this.celebrationTimer !== undefined) window.clearTimeout(this.celebrationTimer);
    this.celebrationTimer = undefined;
    this.celebrating = false;
    this.celebrationRendered = false;
  }

  /**
   * The win beat: the board stays up for about a second so the last penguin
   * visibly dives in and everyone cheers. Verification runs during it, and
   * the result card (with the verified win cue) appears when both are done.
   */
  private startCelebration(): void {
    this.endCelebration();
    this.celebrating = true;
    const generation = this.generation;
    this.celebrationTimer = window.setTimeout(
      () => {
        this.celebrationTimer = undefined;
        if (generation !== this.generation) return;
        this.celebrating = false;
        this.celebrationRendered = false;
        this.render();
      },
      prefersReducedMotion() ? WIN_CELEBRATION_REDUCED_MS : WIN_CELEBRATION_MS
    );
  }

  private isCompletionState(): boolean {
    return (
      this.state === 'awaiting-session' ||
      this.state === 'verifying' ||
      this.state === 'verified-win' ||
      this.state === 'verification-error'
    );
  }

  private renderCelebration(): void {
    const footer = document.createElement('div');
    footer.className = 'inline-play-footer';
    footer.append(makeParagraph('inline-instructions inline-celebration-note', 'Everyone made it in!'));
    const surface = this.buildPlaySurface(false, footer);
    if (!surface) return;
    surface.classList.add('inline-play--celebrating');
    this.stage.replaceChildren(surface);
    this.celebrationRendered = true;
  }

  private beginRequest(): { readonly id: number; readonly controller: AbortController } {
    this.requestSequence += 1;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    return { id: this.requestSequence, controller };
  }

  private requestIsCurrent(generation: number, requestId: number): boolean {
    return generation === this.generation && requestId === this.requestSequence;
  }

  private hydrateSession(restoreKeyboardFocus = false): void {
    if (restoreKeyboardFocus) this.hydrationKeyboardFocus = true;
    if (this.session || this.hydrationPending) return;
    const generation = this.generation;
    const request = this.beginRequest();
    const wasRecovering = this.hydrationError.length > 0 || this.state === 'load-error';
    this.hydrationPending = true;
    this.hydrationError = '';

    const timer = window.setTimeout(() => request.controller.abort(), REQUEST_TIMEOUT_MS);
    void fetch('/api/init', {
      cache: 'no-store',
      signal: request.controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${this.modeLabel()} init failed: ${response.status}`);
        }
        const value: unknown = await response.json();
        if (!this.requestIsCurrent(generation, request.id)) return;
        this.hydrationPending = false;
        this.requestController = null;

        const responseKind = isObject(value) ? property(value, 'kind') : undefined;
        if (
          (responseKind === 'daily' || responseKind === 'ugc') &&
          responseKind !== this.options.kind
        ) {
          this.showFatalLoadError(
            `This host post did not match the expected ${this.modeLabel()} puzzle.`
          );
          return;
        }
        const session =
          this.options.kind === 'daily'
            ? parseDailyInit(value)
            : parseCommunityInit(value);
        if (!session) {
          throw new Error(`The ${this.modeLabel()} response was incomplete.`);
        }
        const snapshot = this.snapshot;
        if (snapshot && !sessionMatchesSnapshot(session, snapshot)) {
          this.showFatalLoadError(
            `The post snapshot did not match the authoritative ${this.modeLabel()} puzzle.`
          );
          return;
        }

        const hydratedState = this.state;
        const restoreHydrationFocus = this.hydrationKeyboardFocus;
        this.hydrationKeyboardFocus = false;
        this.session = session;
        this.joined = session.kind === 'daily' && session.subscribed;
        this.options.onHydrated?.();

        if (!snapshot) {
          const puzzle = session.kind === 'daily' ? session : session.puzzle;
          this.pieces = puzzle.board.pieces.map(clonePiece);
          this.history = [];
          this.selected = null;
        }

        this.showRoot();
        if (hydratedState === 'awaiting-session') {
          if (restoreHydrationFocus) this.completionKeyboardFocus = true;
          this.beginVerification();
          return;
        }
        // Do not interrupt a move whose animation began against the matching
        // immutable snapshot. Its commit will render with the hydrated session.
        if (hydratedState === 'animating') return;

        // Feed posts always remain puzzle surfaces. Prior completion status is
        // reserved for the expanded game and never replaces this board.
        this.state = 'playing';
        // The exact snapshot is already the live surface. A normal hydration
        // must not rebuild it underneath a pointer gesture or steal focus.
        if (
          !snapshot ||
          hydratedState === 'loading' ||
          (wasRecovering && !this.drag && this.selected === null)
        ) {
          this.render();
        } else {
          this.prepareOpenButton(this.topOpenButton, this.playOpenButtonLabel());
        }
        if (restoreHydrationFocus) this.focusFirstPieceControl();
      })
      .catch((error) => {
        if (!this.requestIsCurrent(generation, request.id)) return;
        this.hydrationPending = false;
        this.requestController = null;
        const restoreHydrationFocus = this.hydrationKeyboardFocus;
        this.hydrationKeyboardFocus = false;
        console.error(error);
        this.showHydrationError(
          `Could not connect to verify this ${this.modeLabel()} puzzle yet.`
        );
        if (restoreHydrationFocus) {
          if (!this.focusFirstRecoveryAction()) this.focusStageHeading();
        }
      })
      .finally(() => window.clearTimeout(timer));
  }

  private showHydrationError(message: string): void {
    this.hydrationError = message;
    if (this.snapshot) {
      if (this.state === 'loading') {
        this.loadErrorMessage = message;
        this.state = 'load-error';
        this.render();
      } else if (
        !this.drag &&
        this.selected === null &&
        (this.state === 'playing' || this.state === 'awaiting-session')
      ) {
        this.render();
      }
    } else {
      this.options.onLegacyHydrationError?.();
    }
    this.announce(message);
  }

  private showFatalLoadError(message: string): void {
    this.loadErrorMessage = message;
    this.state = 'load-error';
    if (this.snapshot) {
      this.showRoot();
      this.render();
    } else {
      this.options.onLegacyHydrationError?.();
    }
    this.announce(message);
  }

  private render(): void {
    // Any stage replacement is terminal for the active pointer surface.
    this.abortActiveSealDrag(false);
    this.options.root.dataset.state = this.state;
    const busy =
      this.state === 'loading' ||
      this.state === 'animating' ||
      (this.state === 'awaiting-session' && !this.hydrationError) ||
      this.state === 'verifying';
    if (busy) this.options.root.setAttribute('aria-busy', 'true');
    else this.options.root.removeAttribute('aria-busy');

    const puzzle = this.currentPuzzle();
    if (puzzle?.kind === 'daily') {
      // Difficulty first: if a narrow card truncates the line, the date or the
      // creator name loses its tail, never the difficulty.
      this.contextText.textContent = `${titleDifficulty(puzzle.difficulty)} · ${formatDailyDate(puzzle.date)}`;
    } else if (puzzle) {
      this.contextText.textContent = `${titleDifficulty(puzzle.difficulty)} · by u/${puzzle.creator}`;
    } else {
      this.contextText.textContent = `${this.modeLabel()} puzzle`;
    }

    if (this.celebrating && this.isCompletionState()) {
      // Hold the solved board during the win beat; draw it only once so the
      // cheer never restarts when verification finishes mid-celebration.
      if (!this.celebrationRendered) this.renderCelebration();
    } else if (this.state === 'loading') this.renderSessionLoading();
    else if (this.state === 'load-error') this.renderLoadError();
    else if (this.state === 'playing') this.renderPlaying(null);
    else if (this.state === 'awaiting-session') this.renderAwaitingSession();
    else if (this.state === 'verifying') this.renderVerifying();
    else if (this.state === 'verification-error') this.renderVerificationError();
    else if (this.state === 'verified-win') this.renderVerifiedWin();

    const hideTopOpenButton =
      this.state === 'loading' ||
      this.state === 'awaiting-session' ||
      this.state === 'verifying' ||
      this.state === 'verification-error';
    this.topOpenButton.hidden = hideTopOpenButton;
    if (hideTopOpenButton) {
      this.topOpenButton.disabled = true;
      this.topOpenButton.removeAttribute('aria-busy');
      delete this.topOpenButton.dataset.idleLabel;
    } else {
      const topLabel =
        this.state === 'verified-win' ? 'Full game' : this.playOpenButtonLabel();
      this.prepareOpenButton(this.topOpenButton, topLabel);
    }
  }

  /** One short top-bar label so the header keeps room for difficulty/credit.
   *  A Daily attempt still continues into the full game through the handoff. */
  private playOpenButtonLabel(): string {
    if (this.options.kind === 'daily' && this.history.length > 0 && !this.session) {
      return 'Connecting…';
    }
    return 'Full game';
  }

  /** Why the top button is disabled after a Community move (no transcript
   *  handoff exists, so expansion would silently drop this attempt). */
  private openButtonLockReason(): string {
    return this.options.kind === 'ugc' &&
      this.state === 'playing' &&
      this.history.length > 0
      ? 'Restart this board to open the full game.'
      : '';
  }

  private expansionIsLocked(): boolean {
    return (
      this.state === 'loading' ||
      this.state === 'animating' ||
      this.state === 'awaiting-session' ||
      this.state === 'verifying' ||
      this.state === 'verification-error' ||
      (this.state === 'playing' &&
        this.history.length > 0 &&
        (this.options.kind === 'ugc' || !this.session))
    );
  }

  private prepareOpenButton(button: HTMLButtonElement, label: string): void {
    const stateLocked = this.expansionIsLocked();
    button.classList.add('inline-open-button');
    button.textContent = this.expansionPending ? 'Opening…' : label;
    button.disabled = this.expansionPending || stateLocked;
    const lockReason = this.openButtonLockReason();
    if (lockReason) {
      button.title = lockReason;
      button.setAttribute('aria-label', `${label}. ${lockReason}`);
    } else {
      button.removeAttribute('title');
      button.removeAttribute('aria-label');
    }
    if (this.expansionPending) {
      button.dataset.idleLabel = label;
      button.setAttribute('aria-busy', 'true');
    } else {
      delete button.dataset.idleLabel;
      button.removeAttribute('aria-busy');
    }
  }

  private makeOpenButton(label: string, intent: InlineLaunchIntent): HTMLButtonElement {
    const button = makeButton(label, 'inline-button inline-button--secondary inline-open-button', (event) => {
      if (this.options.kind === 'daily' && intent === 'endless') {
        trackClientEvent('daily_to_endless');
      }
      this.openExpanded(event, intent);
    });
    this.prepareOpenButton(button, label);
    return button;
  }

  private openExpanded(event: MouseEvent, intent: InlineLaunchIntent): void {
    if (this.expansionPending || this.expansionIsLocked()) return;
    this.options.openExpanded(event, intent, () => this.prepareHandoff(intent));
  }

  private prepareHandoff(intent: InlineLaunchIntent): boolean {
    if (this.options.kind === 'ugc') {
      // Community has no transcript handoff. Once a local move exists, keep the
      // player on this exact host board rather than implying expansion resumes it.
      return !(intent === 'play' && this.state === 'playing' && this.history.length > 0);
    }
    if (intent === 'play' && this.state === 'playing' && this.history.length > 0) {
      return this.persistDailyHandoff();
    }

    // A fresh/restarted attempt or a route away from play must not inherit a
    // transcript left by an earlier Daily expansion that failed or was cancelled.
    this.clearCurrentHandoff();
    return true;
  }

  private clearCurrentHandoff(): void {
    const puzzle = this.currentPuzzle();
    if (puzzle?.kind === 'daily' && this.options.postId) {
      clearDailyHandoff(this.options.postId, puzzle.puzzleId);
    }
  }

  private persistDailyHandoff(): boolean {
    if (this.history.length === 0) return true;
    const session = this.session;
    if (session?.kind !== 'daily' || !this.options.postId) {
      this.hydrateSession();
      this.announce('Still connecting. Your progress remains on this board.');
      showToast('Still connecting — your progress is safe here.');
      return false;
    }
    const saved = saveDailyHandoff({
      auth: session.username === 'anon' ? 'guest' : 'signed',
      postId: this.options.postId,
      puzzleId: session.puzzleId,
      playId: session.playId,
      moves: this.history.map(cloneMove),
    });
    if (!saved) {
      this.announce('Progress could not be carried into the full game.');
      showToast('Could not carry this attempt into the full game.');
    }
    return saved;
  }

  private renderSessionLoading(): void {
    const card = document.createElement('div');
    card.className = 'inline-message-card';
    const eyebrow = makeParagraph('inline-eyebrow', `${this.modeLabel()} puzzle`);
    const heading = document.createElement('h2');
    heading.textContent =
      this.options.kind === 'daily'
        ? 'Getting a fresh play ready…'
        : 'Getting the Community puzzle ready…';
    const status = document.createElement('div');
    status.className = 'inline-saving-status';
    status.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'inline-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent =
      this.options.kind === 'daily'
        ? 'Starting the play clock…'
        : 'Checking the exact host puzzle…';
    status.append(spinner, text);
    card.append(eyebrow, heading, status);
    this.stage.replaceChildren(card);
    if (this.completionKeyboardFocus) this.focusStageHeading();
  }

  private buildCompletionCard(content: HTMLElement): HTMLElement | null {
    const puzzle = this.currentPuzzle();
    if (!puzzle) return null;
    const moves = this.history.length;
    const attemptStars = computeStars(moves, puzzle.par);
    const card = document.createElement('div');
    card.className =
      'inline-message-card inline-message-card--win inline-message-card--pending';
    const eyebrow = makeParagraph(
      'inline-eyebrow',
      `${this.modeLabel()} complete`
    );
    const heading = document.createElement('h2');
    heading.textContent = 'Everyone made it in!';
    const stars = document.createElement('div');
    stars.className = 'inline-stars';
    stars.textContent = '★'.repeat(attemptStars);
    stars.setAttribute('aria-label', `${attemptStars} stars`);
    const score = makeParagraph(
      'inline-result-score',
      `${moves} moves · par ${puzzle.par}`
    );
    card.append(eyebrow, heading, stars, score, content);
    return card;
  }

  private renderPendingCompletion(): void {
    const status = document.createElement('div');
    status.className = 'inline-saving-status';
    status.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'inline-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent =
      this.options.kind === 'daily'
        ? 'Saving your score…'
        : 'Verifying your move history…';
    status.append(spinner, text);
    const card = this.buildCompletionCard(status);
    if (card) {
      this.stage.replaceChildren(card);
      if (this.completionKeyboardFocus) this.focusStageHeading();
    }
  }

  private renderCompletionRecovery(
    titleText: string,
    detailText: string,
    primaryLabel: string,
    primaryAction: (event: MouseEvent) => void,
    includeRestart = true
  ): void {
    const recovery = document.createElement('div');
    recovery.className = 'inline-completion-recovery';
    recovery.setAttribute('role', 'alert');
    const title = document.createElement('strong');
    title.textContent = titleText;
    const detail = makeParagraph('inline-message-copy', detailText);
    const actions = document.createElement('div');
    actions.className = 'inline-card-actions inline-card-actions--recovery';
    const primary = makeButton(
      primaryLabel,
      'inline-button inline-button--primary',
      primaryAction
    );
    actions.append(primary);
    if (includeRestart) {
      actions.append(
        makeButton(
          '↺ Restart',
          'inline-button inline-button--secondary',
          (event) => this.restartAttempt(event.detail === 0)
        )
      );
    }
    recovery.append(title, detail, actions);
    const card = this.buildCompletionCard(recovery);
    if (card) {
      this.stage.replaceChildren(card);
      if (this.completionKeyboardFocus) this.focusStageHeading();
    }
  }

  private renderAwaitingSession(): void {
    if (this.hydrationError) {
      this.renderCompletionRecovery(
        this.options.kind === 'daily'
          ? 'Your score is waiting to save'
          : 'Your solve is waiting to verify',
        'Your completed move history is safe. Reconnect to send these same moves.',
        'Retry verification',
        (event) => {
          if (event.detail === 0) this.completionKeyboardFocus = true;
          this.hydrateSession(event.detail === 0);
        }
      );
      return;
    }
    this.renderPendingCompletion();
  }

  private renderLoadError(): void {
    if (!this.snapshot) return;
    const footer = document.createElement('div');
    footer.className =
      'inline-verification-status inline-verification-status--error inline-hydration-error';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `Could not verify this ${this.modeLabel()} puzzle`;
    const detail = makeParagraph(
      'inline-verification-copy inline-error-detail',
      this.loadErrorMessage
    );
    copy.append(title, detail);
    const actions = document.createElement('div');
    actions.className = 'inline-verification-actions';
    const retry = makeButton(
      'Retry',
      'inline-button inline-button--primary inline-button--compact',
      (event) => this.hydrateSession(event.detail === 0)
    );
    const open = this.makeOpenButton('Open full game', 'play');
    open.classList.add('inline-button--compact');
    actions.append(retry, open);
    footer.append(copy, actions);
    const surface = this.buildPlaySurface(false, footer);
    if (surface) this.stage.replaceChildren(surface);
  }

  private renderPlaying(focusPieceIndex: number | null): void {
    const surface = this.buildPlaySurface(true, this.buildPlayingFooter());
    if (!surface) return;
    this.stage.replaceChildren(surface);
    if (focusPieceIndex !== null) {
      const control = surface.querySelector(`[data-piece-control="${focusPieceIndex}"]`);
      if (control instanceof HTMLButtonElement) control.focus();
    }
  }

  private buildPlaySurface(interactive: boolean, footer: HTMLElement): HTMLElement | null {
    const puzzle = this.currentPuzzle();
    if (!puzzle) return null;
    const play = document.createElement('div');
    play.className = interactive ? 'inline-play' : 'inline-play inline-play--frozen';

    // Match the expanded game: Moves and Par share one quiet, centred row.
    // The player goal belongs in the first-move strip below the board, not
    // wedged between two unrelated pills.
    const hud = document.createElement('div');
    hud.className = 'inline-hud';
    // Live star goal, same wording as the full game. On a solved board it shows
    // the stars earned instead of a goal for a move that will never happen.
    const solvedNow = isSolved(puzzle.board, this.pieces);
    const goal = starGoal(this.history.length, puzzle.par);
    const earned = computeStars(this.history.length, puzzle.par);
    const goalLabel = solvedNow ? `${'\u2605'.repeat(earned)} earned` : starGoalLabel(goal);
    const spokenGoal = solvedNow
      ? `${earned} ${earned === 1 ? 'star' : 'stars'} earned`
      : goal.maxMoves === null
        ? '1 star for any solve'
        : `${goal.stars} stars up to ${goal.maxMoves} moves`;
    hud.setAttribute(
      'aria-label',
      `Moves ${this.history.length}, par ${puzzle.par}. ${spokenGoal}.`
    );
    const moves = document.createElement('span');
    moves.className = 'inline-stat';
    moves.append('Moves ');
    const movesValue = document.createElement('strong');
    movesValue.textContent = this.history.length.toString();
    moves.append(movesValue);
    const par = document.createElement('span');
    par.className = 'inline-stat';
    par.append('Par ');
    const parValue = document.createElement('strong');
    parValue.textContent = puzzle.par.toString();
    par.append(parValue);
    const goalStat = document.createElement('span');
    goalStat.className = 'inline-stat inline-stat--goal';
    goalStat.setAttribute('aria-hidden', 'true');
    goalStat.textContent = goalLabel;
    hud.append(moves, par, goalStat);

    footer.id = 'inline-board-instructions';
    footer.classList.add('inline-bottom-strip');

    const frame = document.createElement('div');
    frame.className = 'inline-board-frame';
    const board = this.buildBoard(interactive);
    frame.append(board);

    play.append(hud, frame, footer);
    return play;
  }

  private firstMoveInstruction(): string {
    const puzzle = this.currentPuzzle();
    const selectedPiece = this.selected === null ? undefined : this.pieces[this.selected];
    const selectedSealHasMoves =
      puzzle !== null &&
      selectedPiece?.kind === 'SLIDER' &&
      legalMoves(puzzle.board, this.pieces).some(
        (move) => move.pieceIndex === this.selected
      );
    return selectedSealHasMoves
      ? 'Drag the seal along its lane, or tap where it should stop.'
      : 'Tap a penguin, then a gold dot. Drag or tap a seal.';
  }

  private populateFirstMoveInstructions(instructions: HTMLElement): void {
    instructions.replaceChildren(
      document.createTextNode(this.firstMoveInstruction()),
      document.createElement('br'),
      document.createTextNode('Get every penguin into the water.')
    );
  }

  private buildPlayingFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'inline-play-footer';

    if (this.hydrationError) {
      const status = document.createElement('div');
      status.className = 'inline-connection-status';
      const copy = document.createElement('span');
      copy.textContent = 'Progress is local until the connection returns.';
      const actions = document.createElement('span');
      actions.className = 'inline-connection-actions';
      const retry = makeButton(
        'Retry',
        'inline-button inline-button--secondary inline-button--compact',
        (event) => this.hydrateSession(event.detail === 0)
      );
      actions.append(retry);
      if (this.history.length > 0) {
        actions.append(
          makeButton(
            '↶ Undo',
            'inline-button inline-button--quiet inline-button--compact',
            (event) => this.undoMove(event.detail === 0)
          ),
          makeButton(
            '↺ Restart',
            'inline-button inline-button--quiet inline-button--compact',
            (event) => this.restartAttempt(event.detail === 0)
          )
        );
      }
      status.append(copy, actions);
      footer.append(status);
      return footer;
    }

    if (this.history.length > 0) {
      const actions = document.createElement('div');
      actions.className = 'inline-play-actions';
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', 'Move controls');
      const undo = makeButton(
        '↶ Undo',
        'inline-button inline-button--quiet',
        (event) => this.undoMove(event.detail === 0)
      );
      const restart = makeButton(
        '↺ Restart',
        'inline-button inline-button--quiet',
        (event) => this.restartAttempt(event.detail === 0)
      );
      actions.append(undo, restart);
      footer.append(actions);
    } else {
      const instructions = makeParagraph('inline-instructions', '');
      this.populateFirstMoveInstructions(instructions);
      footer.append(instructions);
    }
    return footer;
  }

  private buildBoard(interactive: boolean): HTMLElement {
    const puzzle = this.currentPuzzle();
    if (!puzzle) return document.createElement('div');
    const board = puzzle.board;
    const size = viewSize(board);
    const shell = document.createElement('div');
    shell.className = 'inline-board';
    shell.style.aspectRatio = `${size.x} / ${size.y}`;
    shell.style.setProperty('--inline-board-ratio', (size.x / size.y).toString());
    shell.style.setProperty('--inline-natural-width', `${size.x}px`);
    shell.style.setProperty('--inline-cell-width', `${(CELL / size.x) * 100}%`);
    shell.style.setProperty('--inline-cell-height', `${(CELL / size.y) * 100}%`);
    const boardLabel = `${this.modeLabel()} puzzle board`;
    shell.setAttribute('role', 'group');
    shell.setAttribute('aria-label', boardLabel);
    shell.setAttribute(
      'aria-describedby',
      'inline-board-instructions inline-board-state'
    );

    const visual = document.createElement('div');
    visual.className = 'inline-board-visual';
    visual.innerHTML = this.options.renderBoard(board, this.pieces, boardLabel);
    const svg = visual.querySelector('svg');
    if (svg) {
      // Static preview sizing must never participate in the interactive board.
      // The controls and this SVG now share the exact same square shell.
      svg.classList.remove('preview-art');
      svg.classList.add('inline-board-svg');
      if (interactive) {
        // The named board group and its controls provide the accessible model;
        // avoid announcing the same SVG illustration as a duplicate object.
        svg.setAttribute('aria-hidden', 'true');
        svg.removeAttribute('role');
        svg.removeAttribute('aria-label');
      }
    }
    const selectedPiece = this.selected === null ? undefined : this.pieces[this.selected];
    if (selectedPiece && selectedPiece.kind !== 'BLOCKER') {
      visual
        .querySelector(`[data-inline-piece-inner="${this.selected}"]`)
        ?.classList.add('is-selected');
    }

    const description = document.createElement('p');
    description.id = 'inline-board-state';
    description.className = 'visually-hidden';
    description.textContent = describeBoardState(board, this.pieces);
    shell.append(visual, description);
    // Phase-lock the idle animations to one clock: the board is rebuilt after
    // every tap, and a shared negative delay resumes each breath and shimmer
    // exactly where it was instead of restarting it.
    shell.style.setProperty(
      '--idle-clock',
      `${-Math.round(performance.now() % IDLE_CLOCK_PERIOD_MS)}ms`
    );

    if (!interactive) {
      if (this.celebrating) shell.append(this.buildBoardEffects(board, size, []));
      return shell;
    }

    const allMoves = legalMoves(board, this.pieces);
    const effects = this.buildBoardEffects(board, size, allMoves);
    const controls = document.createElement('div');
    controls.className = 'inline-board-controls';
    shell.append(effects, controls);

    const clearSelectionInPlace = (): void => {
      if (this.selected === null) return;
      this.selected = null;
      effects.replaceChildren();
      for (const target of Array.from(controls.querySelectorAll('.inline-target'))) {
        target.remove();
      }
      for (const control of Array.from(controls.querySelectorAll('.inline-piece-control'))) {
        control.classList.remove('is-selected');
        control.setAttribute('aria-pressed', 'false');
      }
      for (const art of Array.from(visual.querySelectorAll('[data-inline-piece-inner]'))) {
        art.classList.remove('is-selected');
      }
      const instructions = this.stage.querySelector('.inline-instructions');
      if (instructions instanceof HTMLElement) {
        this.populateFirstMoveInstructions(instructions);
      }
    };

    this.pieces.forEach((piece, pieceIndex) => {
      if (piece.kind === 'BLOCKER') return;
      const center = centerOfCells(board, piece.cells);
      const control = document.createElement('button');
      control.type = 'button';
      control.className =
        piece.kind === 'HOPPER'
          ? 'inline-piece-control inline-piece--hopper'
          : `inline-piece-control inline-piece--slider inline-piece--slider-${(piece.orient ?? 'H') === 'H' ? 'h' : 'v'}`;
      control.dataset.pieceControl = pieceIndex.toString();
      control.setAttribute('aria-pressed', this.selected === pieceIndex ? 'true' : 'false');
      const firstCell = piece.cells[0] ?? 0;
      const row = Math.floor(firstCell / board.width) + 1;
      const column = (firstCell % board.width) + 1;
      control.setAttribute(
        'aria-label',
        `${piece.kind === 'HOPPER' ? 'Penguin' : 'Seal'} at row ${row}, column ${column}`
      );
      const controlWidth =
        piece.kind === 'SLIDER'
          ? (piece.orient ?? 'H') === 'H'
            ? CELL * 2
            : CELL
          : CELL * 0.82;
      const controlHeight =
        piece.kind === 'SLIDER'
          ? (piece.orient ?? 'H') === 'V'
            ? CELL * 2
            : CELL
          : CELL * 0.82;
      this.positionControl(control, center, controlWidth, controlHeight, size);
      if (this.selected === pieceIndex) control.classList.add('is-selected');
      control.addEventListener('click', (event) => {
        if (this.clickIsSuppressed(pieceIndex)) return;
        this.selectPiece(pieceIndex, event.detail === 0);
      });
      if (piece.kind === 'SLIDER') {
        // Touch uses native tap selection because Reddit owns feed-pan gestures.
        // Mouse and pen keep direct drag as an optional desktop enhancement.
        control.addEventListener('pointerdown', (event) =>
          this.beginSealPointerDrag(
            event,
            control,
            pieceIndex,
            clearSelectionInPlace
          )
        );
      }
      controls.append(control);
    });

    if (this.selected !== null) {
      const selectedPiece = this.pieces[this.selected];
      if (selectedPiece) {
        const destinations = allMoves.filter((move) => move.pieceIndex === this.selected);
        for (const move of destinations) {
          // Every legal seal offset maps to a distinct leading-cell button.
          // Shared visual metadata keeps the lane, hit target, and spoken
          // direction aligned without overlapping full-footprint controls.
          const sliderVisual =
            selectedPiece.kind === 'SLIDER'
              ? slideStop(selectedPiece, move, board.width)
              : null;
          const targetCells: readonly number[] = sliderVisual
            ? [sliderVisual.leadingCell]
            : move.to;
          const center = centerOfCells(board, targetCells);
          const target = document.createElement('button');
          target.type = 'button';
          target.className = `inline-target inline-target--${selectedPiece.kind === 'HOPPER' ? 'hop' : 'slide'}`;
          if (sliderVisual) {
            target.classList.add(`inline-target--slide-${sliderVisual.direction}`);
          }
          const firstCell = targetCells[0] ?? move.to[0] ?? 0;
          const row = Math.floor(firstCell / board.width) + 1;
          const column = (firstCell % board.width) + 1;
          const landsInWater =
            selectedPiece.kind === 'HOPPER' && board.holes.includes(firstCell);
          const sliderLabel = sliderVisual
            ? `Slide seal ${sliderVisual.direction} ${sliderVisual.distance} ${sliderVisual.distance === 1 ? 'cell' : 'cells'}`
            : null;
          target.setAttribute(
            'aria-label',
            sliderLabel ??
              (landsInWater
                ? `Hop penguin into water at row ${row}, column ${column}`
                : `Hop penguin to row ${row}, column ${column}`)
          );
          const targetSize = sliderVisual ? CELL : CELL * 0.96;
          this.positionControl(target, center, targetSize, targetSize, size);
          if (sliderVisual) {
            const clearPreview = (): void => {
              target.classList.remove('is-previewing');
              window.removeEventListener('blur', clearPreview);
              window.removeEventListener('pagehide', clearPreview);
            };
            target.addEventListener('pointerdown', (event) => {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              target.classList.add('is-previewing');
              // A host focus change or suspended iframe is not guaranteed to
              // dispatch pointerup/cancel back to this destination button.
              window.addEventListener('blur', clearPreview);
              window.addEventListener('pagehide', clearPreview);
            });
            target.addEventListener('pointerup', clearPreview);
            target.addEventListener('pointercancel', clearPreview);
            target.addEventListener('pointerleave', clearPreview);
            target.addEventListener('blur', clearPreview);
          }
          target.addEventListener('click', (event) =>
            this.attemptMove(move, event.detail === 0)
          );
          controls.append(target);
        }
      }
    }

    // Like the expanded board, tapping bare ice dismisses the current choice.
    shell.addEventListener('click', (event) => {
      const target = event.target;
      if (this.selected === null || (target instanceof Element && target.closest('button'))) {
        return;
      }
      clearSelectionInPlace();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.announce('Selection cleared.');
    });

    return shell;
  }

  private buildBoardEffects(
    board: Board,
    size: Point,
    allMoves: readonly Move[]
  ): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const effects = document.createElementNS(namespace, 'svg');
    effects.classList.add('inline-board-effects');
    effects.setAttribute('viewBox', `0 0 ${size.x} ${size.y}`);
    effects.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    effects.setAttribute('aria-hidden', 'true');
    this.appendTransientEffects(effects, board);

    if (this.selected === null) return effects;
    const selectedPiece = this.pieces[this.selected];
    if (!selectedPiece) return effects;
    const center = centerOfCells(board, selectedPiece.cells);
    const destinations = allMoves.filter((move) => move.pieceIndex === this.selected);

    if (selectedPiece.kind === 'SLIDER') {
      const orient = selectedPiece.orient ?? 'H';
      const destinationCenters = destinations.map((move) => centerOfCells(board, move.to));
      const axisValues = [
        orient === 'H' ? center.x : center.y,
        ...destinationCenters.map((destination) =>
          orient === 'H' ? destination.x : destination.y
        ),
      ];
      const axisMin = Math.min(...axisValues);
      const axisMax = Math.max(...axisValues);
      const lane = document.createElementNS(namespace, 'rect');
      const laneX = orient === 'H' ? axisMin - CELL : center.x - CELL * 0.42;
      const laneY = orient === 'V' ? axisMin - CELL : center.y - CELL * 0.42;
      const laneWidth =
        orient === 'H' ? axisMax - axisMin + CELL * 2 : CELL * 0.84;
      const laneHeight =
        orient === 'V' ? axisMax - axisMin + CELL * 2 : CELL * 0.84;
      lane.classList.add('inline-seal-lane');
      lane.setAttribute('x', laneX.toString());
      lane.setAttribute('y', laneY.toString());
      lane.setAttribute('width', laneWidth.toString());
      lane.setAttribute('height', laneHeight.toString());
      lane.setAttribute('rx', (CELL * 0.28).toString());
      lane.setAttribute('fill', 'none');
      lane.setAttribute('stroke', '#e8f7ff');
      lane.setAttribute('stroke-opacity', '0.82');
      lane.setAttribute('stroke-width', '3');
      lane.setAttribute('vector-effect', 'non-scaling-stroke');
      effects.append(lane);

      for (const move of destinations) {
        const visual = slideStop(selectedPiece, move, board.width);
        if (!visual) continue;
        const stopCenter = centerOfCells(board, [visual.leadingCell]);
        const notch = document.createElementNS(namespace, 'line');
        notch.classList.add('inline-seal-stop');
        if (orient === 'H') {
          notch.setAttribute('x1', stopCenter.x.toString());
          notch.setAttribute('x2', stopCenter.x.toString());
          notch.setAttribute('y1', (stopCenter.y - CELL * 0.2).toString());
          notch.setAttribute('y2', (stopCenter.y + CELL * 0.2).toString());
        } else {
          notch.setAttribute('x1', (stopCenter.x - CELL * 0.2).toString());
          notch.setAttribute('x2', (stopCenter.x + CELL * 0.2).toString());
          notch.setAttribute('y1', stopCenter.y.toString());
          notch.setAttribute('y2', stopCenter.y.toString());
        }
        notch.setAttribute('stroke', '#e8f7ff');
        notch.setAttribute('stroke-opacity', '0.9');
        notch.setAttribute('stroke-width', '4');
        notch.setAttribute('stroke-linecap', 'round');
        notch.setAttribute('vector-effect', 'non-scaling-stroke');
        effects.append(notch);
      }
      return effects;
    }

    if (selectedPiece.kind !== 'HOPPER') return effects;

    const ring = document.createElementNS(namespace, 'circle');
    ring.setAttribute('cx', center.x.toString());
    ring.setAttribute('cy', center.y.toString());
    ring.setAttribute('r', (CELL * 0.46).toString());
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#ffd166');
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('vector-effect', 'non-scaling-stroke');
    effects.append(ring);

    for (const move of destinations) {
      const destination = centerOfCells(board, move.to);
      const dot = document.createElementNS(namespace, 'circle');
      dot.setAttribute('cx', destination.x.toString());
      dot.setAttribute('cy', destination.y.toString());
      dot.setAttribute('r', (CELL * 0.18).toString());
      dot.setAttribute('fill', '#ffd166');
      dot.setAttribute('fill-opacity', '0.9');
      dot.setAttribute('stroke', '#ffffff');
      dot.setAttribute('stroke-width', '2');
      dot.setAttribute('vector-effect', 'non-scaling-stroke');
      effects.append(dot);
    }
    return effects;
  }

  /**
   * The last splash ripple or snow puff, plus win sparkles while celebrating.
   * A negative animation-delay of the effect's age lets it keep playing
   * smoothly when the board is rebuilt (for example by a quick follow-up tap).
   */
  private appendTransientEffects(effects: SVGSVGElement, board: Board): void {
    if (prefersReducedMotion()) return;
    const now = performance.now();
    const effect = this.boardEffect;
    if (effect && now - effect.at < EFFECT_LIFETIME_MS) {
      const age = Math.round(now - effect.at);
      const at = centerOfCells(board, [effect.cell]);
      if (effect.kind === 'splash') {
        for (let ring = 0; ring < 2; ring++) {
          const circle = document.createElementNS(SVG_NS, 'circle');
          circle.classList.add('inline-fx-ripple');
          circle.setAttribute('cx', at.x.toString());
          circle.setAttribute('cy', at.y.toString());
          circle.setAttribute('r', (CELL * 0.3).toString());
          circle.style.animationDelay = `${ring * 130 - age}ms`;
          effects.append(circle);
        }
        for (let drop = 0; drop < 6; drop++) {
          const angle = (Math.PI * 2 * drop) / 6 - Math.PI / 2;
          effects.append(
            this.makeParticle('inline-fx-drop', at, Math.cos(angle) * CELL * 0.5, Math.sin(angle) * CELL * 0.42 - CELL * 0.12, CELL * 0.06, -age)
          );
        }
      } else {
        for (let flake = 0; flake < 5; flake++) {
          const spread = (flake - 2) * 0.32;
          const px = effect.dx - effect.dy * spread;
          const py = effect.dy + effect.dx * spread;
          const reach = CELL * (0.28 + (flake % 3) * 0.08);
          // Start at the tail's outer edge (the drift side) of the tail cell.
          const origin = { x: at.x + effect.dx * CELL * 0.45, y: at.y + effect.dy * CELL * 0.45 + CELL * 0.2 };
          effects.append(
            this.makeParticle('inline-fx-snow', origin, px * reach, py * reach - CELL * 0.06, CELL * (0.035 + (flake % 2) * 0.02), -age)
          );
        }
      }
    } else if (effect) {
      this.boardEffect = null;
    }
    if (!this.celebrating) return;
    // Win sparkles over every hole, timed with the CSS cheer (splash.css).
    board.holes.forEach((hole, order) => {
      const at = centerOfCells(board, [hole]);
      for (let spark = 0; spark < 6; spark++) {
        const angle = (Math.PI * 2 * spark) / 6 + order;
        effects.append(
          this.makeParticle('inline-fx-spark', { x: at.x, y: at.y - CELL * 0.08 }, Math.cos(angle) * CELL * 0.48, Math.sin(angle) * CELL * 0.48, CELL * 0.055, 320 + order * 90)
        );
      }
    });
  }

  private makeParticle(
    className: string,
    at: Point,
    dx: number,
    dy: number,
    radius: number,
    delayMs: number
  ): SVGCircleElement {
    const particle = document.createElementNS(SVG_NS, 'circle');
    particle.classList.add(className);
    particle.setAttribute('cx', at.x.toString());
    particle.setAttribute('cy', at.y.toString());
    particle.setAttribute('r', radius.toString());
    particle.style.setProperty('--dx', `${Math.round(dx * 10) / 10}px`);
    particle.style.setProperty('--dy', `${Math.round(dy * 10) / 10}px`);
    particle.style.animationDelay = `${delayMs}ms`;
    return particle;
  }

  private positionControl(
    control: HTMLElement,
    center: Point,
    width: number,
    height: number,
    size: Point
  ): void {
    control.style.left = `${(center.x / size.x) * 100}%`;
    control.style.top = `${(center.y / size.y) * 100}%`;
    control.style.width = `${(width / size.x) * 100}%`;
    control.style.height = `${(height / size.y) * 100}%`;
  }

  private focusPieceControl(pieceIndex: number): void {
    const control = this.stage.querySelector(`[data-piece-control="${pieceIndex}"]`);
    if (control instanceof HTMLButtonElement) control.focus({ preventScroll: true });
  }

  private focusFirstPieceControl(): void {
    const control = this.stage.querySelector('.inline-piece-control');
    if (control instanceof HTMLButtonElement) control.focus({ preventScroll: true });
  }

  private focusFirstMoveTarget(): boolean {
    const target = this.stage.querySelector('.inline-target');
    if (!(target instanceof HTMLButtonElement)) return false;
    target.focus({ preventScroll: true });
    return true;
  }

  private focusFirstRecoveryAction(): boolean {
    const action = this.stage.querySelector(
      '.inline-completion-recovery button, .inline-connection-actions button, .inline-verification-actions button'
    );
    if (!(action instanceof HTMLButtonElement)) return false;
    action.focus({ preventScroll: true });
    return true;
  }

  private focusStageHeading(): void {
    const heading = this.stage.querySelector('.inline-message-card h2');
    if (!(heading instanceof HTMLElement)) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  private selectPiece(pieceIndex: number, focusSelected = false): void {
    const puzzle = this.currentPuzzle();
    if (this.expansionPending || this.state !== 'playing' || !puzzle) return;
    if (!this.session && !this.hydrationPending) this.hydrateSession();
    const piece = this.pieces[pieceIndex];
    if (!piece || piece.kind === 'BLOCKER') return;
    const destinations = legalMoves(puzzle.board, this.pieces).filter(
      (move) => move.pieceIndex === pieceIndex
    );
    if (this.selected === pieceIndex && this.keptSelection) {
      // The penguin stayed selected after its hop; a habitual tap on it keeps
      // it selected instead of hiding its moves.
      this.keptSelection = false;
      return;
    }
    this.keptSelection = false;
    this.selected = this.selected === pieceIndex ? null : pieceIndex;
    if (this.selected === null) {
      this.announce('Selection cleared.');
    } else {
      const count = destinations.length;
      this.announce(
        count > 0
          ? `${piece.kind === 'HOPPER' ? 'Penguin' : 'Seal'} selected. ${count} legal ${count === 1 ? 'move' : 'moves'}.`
          : 'That piece has no legal moves right now.'
      );
    }
    const focusSealDestination =
      focusSelected &&
      this.selected !== null &&
      piece.kind === 'SLIDER' &&
      destinations.length > 0;
    this.renderPlaying(focusSealDestination ? null : focusSelected ? pieceIndex : null);
    if (focusSealDestination && !this.focusFirstMoveTarget()) {
      this.focusPieceControl(pieceIndex);
    }
  }

  private attemptMove(candidate: Move, restoreKeyboardFocus = false): void {
    const puzzle = this.currentPuzzle();
    if (
      this.expansionPending ||
      this.state !== 'playing' ||
      !puzzle ||
      this.history.length >= MAX_REPLAY_MOVES
    ) {
      return;
    }
    if (!this.session && !this.hydrationPending) this.hydrateSession();
    const legal = legalMoves(puzzle.board, this.pieces);
    const move = legal.find((entry) => sameMove(entry, candidate));
    if (!move) {
      this.announce('That move is no longer legal. Choose another destination.');
      return;
    }
    const canonical = cloneMove(move);
    // A legal destination click/pointer release is the deliberate gesture that
    // unlocks inline Web Audio. Preferences still gate each channel.
    runInlineAudio(() => {
      startMusic();
      if (canonical.kind === 'HOPPER') playHop();
      else playSlide();
    });
    this.state = 'animating';
    this.selected = null;
    this.options.root.dataset.state = this.state;
    this.options.root.setAttribute('aria-busy', 'true');
    this.prepareOpenButton(this.topOpenButton, this.playOpenButtonLabel());
    const instruction = this.stage.querySelector('.inline-instructions');
    if (instruction) instruction.textContent = canonical.kind === 'HOPPER' ? 'Penguin hopping…' : 'Seal sliding…';
    const buttons = this.stage.querySelectorAll('button');
    for (const element of Array.from(buttons)) {
      if (element instanceof HTMLButtonElement) element.disabled = true;
    }
    this.animateMove(canonical, restoreKeyboardFocus);
  }

  private animateMove(move: Move, restoreKeyboardFocus: boolean): void {
    this.animatePiece(move.pieceIndex, move.to, move.kind, 1, () =>
      this.commitMove(move, restoreKeyboardFocus)
    );
  }

  /**
   * Glide one piece to `toCells`, then run `onDone`. Penguins also hop: the
   * inner art arcs up with a squash on take-off and landing (splash.css
   * .is-hopping), the same feel as the full game. `speed` scales the shared
   * distance-based duration (Undo plays a little faster).
   */
  private animatePiece(
    pieceIndex: number,
    toCells: readonly number[],
    kind: Move['kind'],
    speed: number,
    onDone: () => void
  ): void {
    const puzzle = this.currentPuzzle();
    if (!puzzle) return;
    const transition = ++this.transitionSequence;
    const piece = this.pieces[pieceIndex];
    if (!piece) return;
    const from = centerOfCells(puzzle.board, piece.cells);
    const to = centerOfCells(puzzle.board, toCells);
    const size = viewSize(puzzle.board);
    const boardElement = this.stage.querySelector('.inline-board');
    const rect = boardElement?.getBoundingClientRect();
    const viewDx = to.x - from.x;
    const viewDy = to.y - from.y;
    const cssDx = rect ? (viewDx / size.x) * rect.width : 0;
    const cssDy = rect ? (viewDy / size.y) * rect.height : 0;
    const art = this.stage.querySelector(`[data-inline-piece-art="${pieceIndex}"]`);
    const control = this.stage.querySelector(`[data-piece-control="${pieceIndex}"]`);
    const duration = prefersReducedMotion()
      ? 0
      : Math.round(moveDurationMs(puzzle.board, piece, { pieceIndex, kind, to: toCells }) * speed);
    if (kind === 'HOPPER' && duration > 0) {
      const inner = this.stage.querySelector(`[data-inline-piece-inner="${pieceIndex}"]`);
      if (inner instanceof SVGElement) {
        inner.classList.remove('is-selected');
        inner.style.setProperty('--move-ms', `${duration}ms`);
        inner.classList.add('is-hopping');
      }
    }

    if (art instanceof HTMLElement || art instanceof SVGElement) {
      art.classList.add('is-moving');
      art.style.transitionDuration = `${duration}ms`;
    }
    if (control instanceof HTMLElement) {
      control.classList.add('is-moving');
      control.style.transitionDuration = `${duration}ms`;
    }
    if (boardElement instanceof HTMLElement) void boardElement.offsetWidth;
    if (art instanceof SVGElement) {
      art.style.transform = `translate(${viewDx}px, ${viewDy}px)`;
    } else if (art instanceof HTMLElement) {
      art.style.transform = `translate(${cssDx}px, ${cssDy}px)`;
    }
    if (control instanceof HTMLElement) {
      control.style.setProperty('--drag-x', `${cssDx}px`);
      control.style.setProperty('--drag-y', `${cssDy}px`);
    }

    window.setTimeout(() => {
      if (transition !== this.transitionSequence || this.state !== 'animating') return;
      onDone();
    }, duration + 20);
  }

  /** A puff of snow behind a seal's tail, drifting opposite to its slide. */
  private sprayEffect(board: Board, before: Piece, move: Move): BoardEffect | null {
    const stop = slideStop(before, move, board.width);
    if (!stop) return null;
    const dx = stop.direction === 'right' ? 1 : stop.direction === 'left' ? -1 : 0;
    const dy = stop.direction === 'down' ? 1 : stop.direction === 'up' ? -1 : 0;
    const sorted = [...move.to].sort((a, b) => a - b);
    const tail = dx + dy > 0 ? sorted[0] : sorted[sorted.length - 1];
    if (tail === undefined) return null;
    return { kind: 'spray', cell: tail, dx: -dx, dy: -dy, at: performance.now() };
  }

  /**
   * Step back one move. Every legal move has an exact reverse and the server
   * scores only the final transcript, so Undo is the same as replaying the
   * earlier moves from the start: it never changes how a solve counts.
   */
  private undoMove(restoreKeyboardFocus = false): void {
    const puzzle = this.currentPuzzle();
    if (
      this.expansionPending ||
      this.state !== 'playing' ||
      !puzzle ||
      this.history.length === 0
    ) {
      return;
    }
    const last = this.history[this.history.length - 1];
    const remaining = this.history.slice(0, -1).map(cloneMove);
    const replay = replayMoves(puzzle.board, remaining);
    if (!last || !replay.ok) return;
    const before = replay.pieces[last.pieceIndex];
    if (!before) return;
    runInlineAudio(() => (last.kind === 'HOPPER' ? playHop() : playSlide()));
    this.state = 'animating';
    this.selected = null;
    this.options.root.dataset.state = this.state;
    this.options.root.setAttribute('aria-busy', 'true');
    this.prepareOpenButton(this.topOpenButton, this.playOpenButtonLabel());
    for (const element of Array.from(this.stage.querySelectorAll('button'))) {
      if (element instanceof HTMLButtonElement) element.disabled = true;
    }
    this.animatePiece(last.pieceIndex, before.cells, last.kind, 0.8, () => {
      if (this.state !== 'animating') return;
      this.pieces = replay.pieces.map(clonePiece);
      this.history = remaining;
      this.boardEffect = null;
      this.state = 'playing';
      this.render();
      if (restoreKeyboardFocus) this.focusPieceControl(last.pieceIndex);
      this.announce(
        `Move undone. ${this.history.length} ${this.history.length === 1 ? 'move' : 'moves'}.`
      );
    });
  }

  private commitMove(move: Move, restoreKeyboardFocus: boolean): void {
    const puzzle = this.currentPuzzle();
    if (!puzzle || this.state !== 'animating') return;
    const landsInWater =
      move.kind === 'HOPPER' &&
      move.to.every((cell) => puzzle.board.holes.includes(cell));
    const before = this.pieces[move.pieceIndex];
    this.pieces = applyMove(this.pieces, move).map(clonePiece);
    this.history.push(cloneMove(move));
    if (landsInWater) runInlineAudio(playSplash);
    this.boardEffect = landsInWater
      ? { kind: 'splash', cell: move.to[0] ?? 0, dx: 0, dy: 0, at: performance.now() }
      : move.kind === 'SLIDER' && before
        ? this.sprayEffect(puzzle.board, before, move)
        : null;
    if (!this.startTracked) {
      this.startTracked = true;
      trackClientEvent(
        this.options.kind === 'daily' ? 'daily_started' : 'community_started'
      );
    }
    const solved = isSolved(puzzle.board, this.pieces);
    const canContinue = legalMoves(puzzle.board, this.pieces).some(
      (candidate) => candidate.pieceIndex === move.pieceIndex
    );
    // A penguin that can keep hopping stays selected (one tap per hop).
    this.selected =
      !solved && keepSelectedAfterMove(puzzle.board, move, canContinue) ? move.pieceIndex : null;
    this.keptSelection = this.selected !== null;
    if (solved) {
      // Hold the solved board for the win beat while verification runs.
      this.startCelebration();
      this.beginVerification(restoreKeyboardFocus);
      return;
    }
    this.state = 'playing';
    this.render();
    if (restoreKeyboardFocus) this.focusPieceControl(move.pieceIndex);
    const count = `${this.history.length} ${this.history.length === 1 ? 'move' : 'moves'}`;
    const still = this.selected === move.pieceIndex ? ' Still selected.' : '';
    this.announce(
      move.kind === 'HOPPER'
        ? `Penguin moved. ${count}.${still}`
        : `Seal moved. ${count}.`
    );
  }

  private restartAttempt(restoreKeyboardFocus = false): void {
    const puzzle = this.currentPuzzle();
    if (
      this.expansionPending ||
      !puzzle ||
      this.state === 'loading' ||
      this.state === 'verifying'
    ) {
      return;
    }
    this.clearCurrentHandoff();
    const needsFreshSession =
      this.options.kind === 'daily' && this.verificationExpired;
    if (needsFreshSession && !this.snapshot && puzzle.kind === 'daily') {
      this.snapshot = {
        version: 2,
        kind: 'daily',
        puzzleId: puzzle.puzzleId,
        date: puzzle.date,
        board: puzzle.board,
        par: puzzle.par,
        difficulty: puzzle.difficulty,
      };
    }

    if (needsFreshSession) {
      this.session = null;
      this.beginGeneration();
      this.commentPending = false;
      this.joinPending = false;
      this.pieces = puzzle.board.pieces.map(clonePiece);
      this.history = [];
      this.selected = null;
      this.verified = null;
      this.solveBody = null;
      this.state = 'loading';
      this.completionKeyboardFocus = restoreKeyboardFocus;
      this.render();
      this.announce('Getting a fresh play session.');
      this.hydrateSession(restoreKeyboardFocus);
      return;
    }

    const needsHydration = !this.session;
    this.beginGeneration();
    this.commentPending = false;
    this.joinPending = false;
    this.pieces = puzzle.board.pieces.map(clonePiece);
    this.history = [];
    this.selected = null;
    this.verified = null;
    this.solveBody = null;
    this.state = 'playing';
    this.render();
    if (restoreKeyboardFocus) this.focusFirstPieceControl();
    this.announce('Puzzle restarted.');
    if (needsHydration) this.hydrateSession(restoreKeyboardFocus);
  }

  private beginVerification(restoreKeyboardFocus = false): void {
    if (restoreKeyboardFocus) this.completionKeyboardFocus = true;
    this.verificationExpired = false;
    const puzzle = this.currentPuzzle();
    if (!puzzle) return;
    const session = this.session;
    if (!session) {
      this.state = 'awaiting-session';
      this.render();
      this.announce(
        this.options.kind === 'daily'
          ? 'Everyone is in. Saving your score.'
          : 'Everyone is in. Connecting to verify these moves.'
      );
      if (!this.hydrationPending) this.hydrateSession();
      return;
    }
    const transcript = this.history.map(cloneMove);
    this.solveBody =
      session.kind === 'daily'
        ? JSON.stringify({
            puzzleId: session.puzzleId,
            playId: session.playId,
            moves: transcript,
          })
        : JSON.stringify({ id: session.puzzle.id, moves: transcript });
    this.state = 'verifying';
    this.render();
    this.announce(
      session.kind === 'daily'
        ? 'Everyone is in. Saving your score.'
        : 'Everyone is in. Verifying your move history.'
    );
    this.verifySolve(this.solveBody);
  }

  private verifySolve(body: string): void {
    if (this.state !== 'verifying' || body !== this.solveBody) return;
    const session = this.session;
    if (!session) return;
    const generation = this.generation;
    const request = this.beginRequest();
    const expectedMoves = this.history.length;
    const path = session.kind === 'daily' ? '/api/solve' : '/api/ugc/played';
    const timer = window.setTimeout(() => request.controller.abort(), REQUEST_TIMEOUT_MS);
    void fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: request.controller.signal,
    })
      .then(async (response) => {
        if (!this.requestIsCurrent(generation, request.id)) return;
        if (session.kind === 'daily' && response.status === 410) {
          this.verificationExpired = true;
          this.state = 'verification-error';
          this.render();
          this.announce(
            'This play session expired. Start a fresh attempt to save another score.'
          );
          return;
        }

        const value: unknown = await response.json();
        if (!this.requestIsCurrent(generation, request.id)) return;
        if (session.kind === 'daily') {
          if (!response.ok) throw new Error(`Daily solve failed: ${response.status}`);
          const result = parseVerifiedSolve(value, session, expectedMoves);
          if (!result) throw new Error('Daily solve response was malformed.');
          const attemptStars = computeStars(result.moves, result.par);
          this.verificationExpired = false;
          this.verified = result;
          this.state = 'verified-win';
          this.render();
          this.announce(
            `Solve verified. ${result.moves} moves and ${attemptStars} stars.`
          );
          return;
        }

        const result = parseMarkPlayedResponse(value);
        if (!result) throw new Error('Community completion response was malformed.');
        if (!response.ok || !result.ok) {
          throw new Error(result.ok ? 'Community completion failed.' : result.reason);
        }
        const savedMatchesIdentity =
          session.username === 'anon' ? !result.saved : result.saved;
        if (!savedMatchesIdentity) {
          throw new Error('Community completion save state did not match the player.');
        }
        this.verificationExpired = false;
        this.verified = result;
        this.state = 'verified-win';
        this.render();
        this.announce(`Community solve verified in ${expectedMoves} moves.`);
      })
      .catch((error) => {
        if (!this.requestIsCurrent(generation, request.id)) return;
        console.error(error);
        this.verificationExpired = false;
        this.state = 'verification-error';
        this.render();
        this.announce('The solve could not be verified. Retry sends the same move history.');
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (this.requestIsCurrent(generation, request.id)) this.requestController = null;
      });
  }

  private renderVerifying(): void {
    this.renderPendingCompletion();
  }

  private renderVerificationError(): void {
    if (this.verificationExpired) {
      this.renderCompletionRecovery(
        'This play session expired',
        'That completed attempt can no longer be saved. Start fresh with a new play session.',
        'Start fresh',
        (event) => this.restartAttempt(event.detail === 0),
        false
      );
      return;
    }

    this.renderCompletionRecovery(
      this.options.kind === 'daily'
        ? 'Your score was not saved'
        : 'Your Community solve was not verified',
      'Your completed move history is safe. Retry sends the same frozen moves.',
      'Retry verification',
      (event) => {
        if (!this.solveBody || this.state !== 'verification-error') return;
        if (event.detail === 0) this.completionKeyboardFocus = true;
        this.state = 'verifying';
        this.render();
        this.verifySolve(this.solveBody);
      }
    );
  }

  private renderVerifiedWin(): void {
    const session = this.session;
    const result = this.verified;
    if (!session || !result || session.kind !== result.kind) {
      this.state = 'verification-error';
      this.renderVerificationError();
      return;
    }
    // The server has replayed and accepted the exact transcript. Celebrate only
    // now so a local solved board never produces a false authoritative win cue.
    runInlineAudio(playWin);
    if (session.kind === 'ugc' && result.kind === 'ugc') {
      this.renderCommunityVerifiedWin(session, result);
      return;
    }
    if (session.kind === 'daily' && result.kind === 'daily') {
      this.renderDailyVerifiedWin(session, result);
      return;
    }
    this.state = 'verification-error';
    this.renderVerificationError();
  }

  private renderDailyVerifiedWin(
    session: DailyInit,
    result: DailyVerifiedSolve
  ): void {
    const card = document.createElement('div');
    card.className = 'inline-message-card inline-message-card--win';
    const eyebrow = makeParagraph('inline-eyebrow', 'Verified Daily');
    const heading = document.createElement('h2');
    heading.textContent = 'Everyone made it in!';
    const attemptStars = computeStars(result.moves, result.par);
    const stars = document.createElement('div');
    stars.className = 'inline-stars';
    stars.textContent = '★'.repeat(attemptStars);
    stars.setAttribute('aria-label', `${attemptStars} stars`);
    const score = makeParagraph(
      'inline-result-score',
      `${result.moves} moves · par ${result.par}`
    );
    // One compact status line keeps the card inside a tall feed post.
    const details = document.createElement('div');
    details.className = 'inline-verified-details';
    if (session.username === 'anon') {
      details.append(
        makeParagraph(
          'inline-message-copy',
          'Verified. Sign in to keep your score and streak.'
        )
      );
    } else {
      // The status line doubles as the way into the full leaderboard, so the
      // card keeps its height: "#7 of 42 today · 3-day streak · Leaderboard ›".
      const parts: string[] = [];
      if (result.bestMoves < result.moves) {
        parts.push(`best ${result.bestMoves} moves (${result.stars}★)`);
      }
      parts.push(
        result.rank > 0 ? `#${result.rank} of ${result.totalPlayers} today` : 'Score saved'
      );
      if (result.streak > 0) parts.push(`${result.streak}-day streak`);
      const link = this.makeOpenButton(`${parts.join(' · ')} · Leaderboard ›`, 'leaderboard');
      link.className = 'inline-result-link inline-open-button';
      details.append(link);
    }

    // Primary action, then two secondary actions per row (see splash.css).
    const actions = document.createElement('div');
    actions.className = 'inline-card-actions inline-card-actions--win';
    const more = this.makeOpenButton('More puzzles', 'endless');
    more.classList.remove('inline-button--secondary');
    more.classList.add('inline-button--primary');
    const share = makeButton(
      'Share',
      'inline-button inline-button--secondary',
      () => void this.shareVerifiedResult(share)
    );
    actions.append(more, share);

    let join: HTMLButtonElement | null = null;
    if (session.username === 'anon') {
      const signIn = makeButton(
        'Sign in to save',
        'inline-button inline-button--secondary',
        () => showLoginPrompt()
      );
      actions.append(signIn);
    } else {
      const comment = makeButton(
        this.scorePosted ? 'Score posted ✓' : 'Comment my score',
        'inline-button inline-button--secondary',
        () => void this.commentVerifiedScore(comment)
      );
      comment.disabled = this.scorePosted;
      actions.append(comment);

      if (!this.joined) {
        const joinLabel = session.subredditName
          ? `Join r/${session.subredditName}`
          : 'Join the community';
        const joinButton = makeButton(
          joinLabel,
          'inline-button inline-button--quiet inline-join-button',
          () => void this.joinCommunity(joinButton, joinLabel)
        );
        join = joinButton;
      }
    }

    const again = makeButton(
      attemptStars === 3 ? 'Play again' : 'Try for ★★★',
      'inline-button inline-button--secondary',
      (event) => this.restartAttempt(event.detail === 0)
    );
    actions.append(again);
    // Join is the optional extra: last, and the first thing a short card drops.
    if (join) actions.append(join);
    card.append(eyebrow, heading, stars, score, details, actions);
    this.stage.replaceChildren(card);
    if (this.completionKeyboardFocus) this.focusStageHeading();
  }

  private renderCommunityVerifiedWin(
    session: CommunityInit,
    result: CommunityVerifiedSolve
  ): void {
    const puzzle = session.puzzle;
    const moves = this.history.length;
    const attemptStars = computeStars(moves, puzzle.par);
    const isCreator =
      session.username !== 'anon' &&
      session.username.toLowerCase() === puzzle.creator.toLowerCase();
    const card = document.createElement('div');
    card.className = 'inline-message-card inline-message-card--win';
    const eyebrow = makeParagraph('inline-eyebrow', 'Verified Community solve');
    const heading = document.createElement('h2');
    heading.textContent = isCreator
      ? 'Solved your own puzzle!'
      : `Solved u/${puzzle.creator}’s puzzle!`;
    const stars = document.createElement('div');
    stars.className = 'inline-stars';
    stars.textContent = '★'.repeat(attemptStars);
    stars.setAttribute('aria-label', `${attemptStars} stars`);
    const score = makeParagraph(
      'inline-result-score',
      `${moves} moves · par ${puzzle.par}`
    );
    const details = document.createElement('div');
    details.className = 'inline-verified-details';
    details.append(
      makeParagraph(
        'inline-message-copy',
        session.username === 'anon'
          ? 'Verified. Sign in to save your progress.'
          : result.saved
            ? 'Solve verified and saved.'
            : 'Solve verified for this play.'
      )
    );

    const actions = document.createElement('div');
    actions.className = 'inline-card-actions inline-card-actions--win';
    const explore = this.makeOpenButton('Explore more puzzles', 'home');
    explore.classList.remove('inline-button--secondary');
    explore.classList.add('inline-button--primary');
    actions.append(explore);

    if (!isCreator) {
      const upvote = makeButton(
        'Upvote',
        'inline-button inline-button--secondary',
        () => void this.upvoteCommunity(upvote, session)
      );
      actions.append(upvote);
      if (session.username !== 'anon') {
        const comment = makeButton(
          this.scorePosted ? 'Score posted ✓' : 'Comment my score',
          'inline-button inline-button--secondary',
          () => void this.commentVerifiedScore(comment)
        );
        comment.disabled = this.scorePosted;
        actions.append(comment);
      }
    }

    const again = makeButton(
      attemptStars === 3 ? 'Play again' : 'Try for ★★★',
      'inline-button inline-button--secondary',
      (event) => this.restartAttempt(event.detail === 0)
    );
    actions.append(again);
    card.append(eyebrow, heading, stars, score, details, actions);
    this.stage.replaceChildren(card);
    if (this.completionKeyboardFocus) this.focusStageHeading();
  }

  private async postEmptyJson(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
      const value: unknown = await response.json();
      return value;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private actionIsCurrent(generation: number, button: HTMLButtonElement): boolean {
    return (
      generation === this.generation &&
      this.state === 'verified-win' &&
      button.isConnected
    );
  }

  private async shareVerifiedResult(button: HTMLButtonElement): Promise<void> {
    const session = this.session;
    const result = this.verified;
    if (
      session?.kind !== 'daily' ||
      result?.kind !== 'daily' ||
      this.state !== 'verified-win'
    ) {
      return;
    }
    const generation = this.generation;
    const attemptIsRankedBest = result.bestMoves === result.moves;
    const text = buildShareText({
      date: session.date,
      moves: result.moves,
      par: result.par,
      stars: computeStars(result.moves, result.par),
      streak: result.streak,
      rank: attemptIsRankedBest ? result.rank : 0,
      totalPlayers: attemptIsRankedBest ? result.totalPlayers : 0,
    });
    button.disabled = true;
    button.textContent = 'Sharing…';
    try {
      await showShareSheet({ title: 'Ice Hop', text });
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = 'Shared ✓';
      return;
    } catch (error) {
      console.error(error);
    }

    try {
      await navigator.clipboard.writeText(text);
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = 'Copied ✓';
      showToast('Copied — paste it in the comments.');
    } catch (error) {
      console.error(error);
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = 'Retry share';
      button.disabled = false;
      showToast('Could not share your result.');
    }
  }

  private async upvoteCommunity(
    button: HTMLButtonElement,
    session: CommunityInit
  ): Promise<void> {
    if (this.state !== 'verified-win') return;
    if (session.username === 'anon') {
      showLoginPrompt();
      return;
    }
    const generation = this.generation;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    button.disabled = true;
    button.textContent = 'Upvoting…';
    try {
      const response = await fetch('/api/ugc/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: session.puzzle.id }),
        signal: controller.signal,
      });
      const value: unknown = await response.json();
      const result = parseVoteResponse(value);
      if (!result) throw new Error('Vote response was malformed.');
      if (!response.ok) throw new Error(`Vote failed: ${response.status}`);
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = result.ok
        ? `Upvoted! (${result.votes})`
        : result.reason ?? 'Already upvoted';
      button.disabled = true;
      showToast(result.ok ? 'Puzzle upvoted!' : result.reason ?? 'Vote not added.');
    } catch (error) {
      console.error(error);
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = 'Retry upvote';
      button.disabled = false;
      showToast('Could not confirm the upvote.');
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async commentVerifiedScore(button: HTMLButtonElement): Promise<void> {
    if (
      this.state !== 'verified-win' ||
      this.scorePosted ||
      this.commentPending
    ) {
      return;
    }
    const generation = this.generation;
    this.commentPending = true;
    button.disabled = true;
    button.textContent = 'Posting…';
    try {
      const value = await this.postEmptyJson('/api/comment-score');
      const result = parseCommentScoreResponse(value);
      if (!result) throw new Error('Comment response was malformed.');
      this.scorePosted = true;
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = result.alreadyPosted ? 'Already posted ✓' : 'Posted ✓';
      showToast(
        result.alreadyPosted
          ? 'Your score is already in the comments.'
          : 'Your score is in the comments!'
      );
    } catch (error) {
      console.error(error);
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = 'Retry comment';
      button.disabled = false;
      showToast('Could not confirm the comment. Retry is safe.');
    } finally {
      this.commentPending = false;
    }
  }

  private async joinCommunity(
    button: HTMLButtonElement,
    idleLabel: string
  ): Promise<void> {
    if (this.state !== 'verified-win' || this.joined || this.joinPending) return;
    const generation = this.generation;
    this.joinPending = true;
    button.disabled = true;
    button.textContent = 'Joining…';
    try {
      const value = await this.postEmptyJson('/api/subscribe');
      if (!isSubscribeSuccess(value)) throw new Error('Subscribe response was malformed.');
      this.joined = true;
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = 'Joined ✓';
      showToast('Thanks for joining — see you tomorrow!');
    } catch (error) {
      console.error(error);
      if (!this.actionIsCurrent(generation, button)) return;
      button.textContent = `Retry ${idleLabel}`;
      button.disabled = false;
      showToast('Could not confirm that you joined.');
    } finally {
      this.joinPending = false;
    }
  }

  private beginSealPointerDrag(
    event: PointerEvent,
    control: HTMLButtonElement,
    pieceIndex: number,
    clearSelection: () => void
  ): void {
    if (event.button !== 0 || !event.isPrimary) return;
    if (event.pointerType === 'touch') {
      // Vertical swipes belong to Reddit's feed. A horizontal seal's control
      // uses `touch-action: pan-y`, so a sideways drag reaches this handler
      // while an up/down swipe still scrolls the feed (the browser cancels the
      // drag and the seal snaps home). A vertical seal is dragged once it is
      // selected: only its selected control switches to `touch-action: none`,
      // a bounded state the player entered with a deliberate tap.
      const piece = this.pieces[pieceIndex];
      if ((piece?.orient ?? 'H') === 'V' && this.selected !== pieceIndex) return;
    }
    const drag = this.startSealDrag(
      control,
      pieceIndex,
      clearSelection,
      event.pointerId,
      event.clientX,
      event.clientY
    );
    if (!drag) return;
    if (event.cancelable) event.preventDefault();
    drag.owner.addEventListener(
      'lostpointercapture',
      this.handleSealPointerCaptureLost
    );
    this.startSealPointerTracking();
    if (typeof drag.owner.setPointerCapture === 'function') {
      try {
        drag.owner.setPointerCapture(event.pointerId);
      } catch {
        // Active window listeners still track this pointer inside the iframe.
      }
    }
  }

  private startSealDrag(
    control: HTMLButtonElement,
    pieceIndex: number,
    clearSelection: () => void,
    pointerId: number,
    clientX: number,
    clientY: number
  ): SealDrag | null {
    if (this.expansionPending || this.drag) return null;
    const puzzle = this.currentPuzzle();
    if (this.state !== 'playing' || !puzzle) return null;
    if (!this.session && !this.hydrationPending) this.hydrateSession();
    const piece = this.pieces[pieceIndex];
    if (!piece || piece.kind !== 'SLIDER') return null;
    control.blur();
    const boardElement = control.closest('.inline-board');
    if (!(boardElement instanceof HTMLElement)) return null;
    const rect = boardElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const size = viewSize(puzzle.board);
    const origin = centerOfCells(puzzle.board, piece.cells);
    const orient = piece.orient ?? 'H';
    const viewUnitsPerCssPixel =
      orient === 'H' ? size.x / rect.width : size.y / rect.height;
    const targets = legalMoves(puzzle.board, this.pieces)
      .filter((move) => move.pieceIndex === pieceIndex)
      .map((move) => {
        const destination = centerOfCells(puzzle.board, move.to);
        const delta =
          orient === 'H'
            ? ((destination.x - origin.x) / size.x) * rect.width
            : ((destination.y - origin.y) / size.y) * rect.height;
        return { move: cloneMove(move), delta };
      });
    const values = [0, ...targets.map((target) => target.delta)];
    const art = this.stage.querySelector(`[data-inline-piece-art="${pieceIndex}"]`);
    const startCoordinate = orient === 'H' ? clientX : clientY;
    this.sealRefused = false;
    const drag: SealDrag = {
      pointerId,
      pieceIndex,
      orient,
      owner: boardElement,
      control,
      art,
      targets,
      min: Math.min(...values),
      max: Math.max(...values),
      viewUnitsPerCssPixel,
      startCoordinate,
      clearSelection,
      current: 0,
      moved: false,
    };
    this.drag = drag;
    control.classList.add('is-dragging');
    if (art) art.classList.add('is-dragging');
    return drag;
  }

  private moveSealPointerDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.cancelable) event.preventDefault();
    this.updateSealDragPosition(drag, event.clientX, event.clientY);
  }

  private updateSealDragPosition(
    drag: SealDrag,
    clientX: number,
    clientY: number
  ): void {
    const coordinate = drag.orient === 'H' ? clientX : clientY;
    const displacement = coordinate - drag.startCoordinate;
    drag.current = Math.max(drag.min, Math.min(drag.max, displacement));
    if (!drag.moved && Math.abs(displacement) > SEAL_TAP_SLOP_PX) {
      drag.moved = true;
      drag.clearSelection();
    }
    this.paintDrag(drag, drag.current);
    // Pushed past the last stop toward open water: the seal refuses with a
    // flipper bump (once per drag), the same cue as the full game.
    const overshoot = displacement - drag.current;
    if (!this.sealRefused && drag.moved && Math.abs(overshoot) > SEAL_REFUSE_PX) {
      const direction = overshoot > 0 ? 1 : -1;
      if (this.sealDragFacesWater(drag, direction)) {
        this.sealRefused = true;
        this.bumpInlineSeal(drag, direction);
      }
    }
  }

  private sealDragFacesWater(drag: SealDrag, direction: 1 | -1): boolean {
    const puzzle = this.currentPuzzle();
    const piece = this.pieces[drag.pieceIndex];
    if (!puzzle || !piece) return false;
    let farthest: Piece = piece;
    let best = 0;
    for (const target of drag.targets) {
      const offset = target.delta * direction;
      if (offset > best) {
        best = offset;
        farthest = { ...piece, cells: target.move.to };
      }
    }
    return sealBlockedByWater(puzzle.board, farthest, direction);
  }

  private bumpInlineSeal(drag: SealDrag, direction: 1 | -1): void {
    const inner = this.stage.querySelector(`[data-inline-piece-inner="${drag.pieceIndex}"]`);
    if (!(inner instanceof SVGElement)) return;
    const nudge = `${-direction * 4}px`;
    inner.style.setProperty('--refuse-x', drag.orient === 'H' ? nudge : '0px');
    inner.style.setProperty('--refuse-y', drag.orient === 'V' ? nudge : '0px');
    inner.classList.remove('is-refusing');
    void inner.getBoundingClientRect();
    inner.classList.add('is-refusing');
    window.setTimeout(() => inner.classList.remove('is-refusing'), 340);
  }

  private endSealPointerDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.cancelable) event.preventDefault();
    this.finishSealDrag(drag, event.clientX, event.clientY);
  }

  private finishSealDrag(
    drag: SealDrag,
    clientX: number,
    clientY: number
  ): void {
    if (this.drag !== drag) return;
    // Pointer implementations can coalesce the final movement into pointerup.
    // Sampling its coordinate keeps a real mouse/pen drag from becoming a tap.
    this.updateSealDragPosition(drag, clientX, clientY);
    this.drag = null;
    this.stopSealInputTracking();
    this.releaseSealInput(drag);
    let best: DragTarget | null = null;
    let bestDistance = Math.abs(drag.current);
    for (const target of drag.targets) {
      const distance = Math.abs(drag.current - target.delta);
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    const tapLike = !drag.moved;
    this.suppressNextClick(drag.pieceIndex);
    if (tapLike) {
      this.snapDragBack(drag);
      this.selectPiece(drag.pieceIndex);
      return;
    }
    if (best) {
      this.attemptMove(best.move);
    } else {
      this.snapDragBack(drag);
    }
  }

  private cancelSealPointerDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.cancelable) event.preventDefault();
    this.abortActiveSealDrag(true);
  }

  private abortActiveSealDrag(announce: boolean): void {
    const drag = this.drag;
    this.drag = null;
    this.stopSealInputTracking();
    if (!drag) return;
    this.releaseSealInput(drag);
    this.suppressNextClick(drag.pieceIndex);
    this.snapDragBack(drag);
    // A touch that turned into a feed scroll never moved the seal; stay quiet.
    if (announce && drag.moved) this.announce('Seal returned to its starting place.');
  }

  private paintDrag(drag: SealDrag, value: number): void {
    const cssX = drag.orient === 'H' ? value : 0;
    const cssY = drag.orient === 'V' ? value : 0;
    if (drag.art instanceof SVGElement) {
      const viewValue = value * drag.viewUnitsPerCssPixel;
      const viewX = drag.orient === 'H' ? viewValue : 0;
      const viewY = drag.orient === 'V' ? viewValue : 0;
      drag.art.style.transform = `translate(${viewX}px, ${viewY}px)`;
    } else if (drag.art instanceof HTMLElement) {
      drag.art.style.transform = `translate(${cssX}px, ${cssY}px)`;
    }
  }

  private snapDragBack(drag: SealDrag): void {
    drag.control.classList.remove('is-dragging');
    drag.control.classList.add('is-snapping');
    if (drag.art) {
      drag.art.classList.remove('is-dragging');
      drag.art.classList.add('is-snapping');
    }
    this.paintDrag(drag, 0);
    window.setTimeout(() => {
      drag.control.classList.remove('is-snapping');
      if (drag.art) drag.art.classList.remove('is-snapping');
    }, 150);
  }

  private startSealPointerTracking(): void {
    this.stopSealInputTracking();
    window.addEventListener(
      'pointermove',
      this.handleActiveSealPointerMove,
      ACTIVE_POINTER_LISTENER_OPTIONS
    );
    window.addEventListener(
      'pointerup',
      this.handleActiveSealPointerUp,
      ACTIVE_POINTER_LISTENER_OPTIONS
    );
    window.addEventListener(
      'pointercancel',
      this.handleActiveSealPointerCancel,
      ACTIVE_POINTER_LISTENER_OPTIONS
    );
    window.addEventListener(
      'pointerout',
      this.handleActiveSealPointerOut,
      ACTIVE_POINTER_LISTENER_OPTIONS
    );
    window.addEventListener('blur', this.handleActiveSealWindowExit);
    window.addEventListener('pagehide', this.handleActiveSealWindowExit);
  }

  private stopSealInputTracking(): void {
    window.removeEventListener('pointermove', this.handleActiveSealPointerMove);
    window.removeEventListener('pointerup', this.handleActiveSealPointerUp);
    window.removeEventListener('pointercancel', this.handleActiveSealPointerCancel);
    window.removeEventListener('pointerout', this.handleActiveSealPointerOut);
    window.removeEventListener('blur', this.handleActiveSealWindowExit);
    window.removeEventListener('pagehide', this.handleActiveSealWindowExit);
  }

  private releaseSealInput(drag: SealDrag): void {
    drag.control.classList.remove('is-dragging');
    if (drag.art) drag.art.classList.remove('is-dragging');
    drag.owner.removeEventListener(
      'lostpointercapture',
      this.handleSealPointerCaptureLost
    );
    if (typeof drag.owner.hasPointerCapture !== 'function') return;
    try {
      if (drag.owner.hasPointerCapture(drag.pointerId)) {
        drag.owner.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Capture may already have been revoked by the embedded browser.
    }
  }

  private clickIsSuppressed(pieceIndex: number): boolean {
    if (
      this.suppressedClickPiece !== pieceIndex ||
      Date.now() >= this.suppressedClickUntil
    ) {
      if (Date.now() >= this.suppressedClickUntil) {
        this.suppressedClickPiece = null;
        this.suppressedClickUntil = 0;
      }
      return false;
    }
    return true;
  }

  private suppressNextClick(pieceIndex: number): void {
    const until = Date.now() + 800;
    this.suppressedClickPiece = pieceIndex;
    this.suppressedClickUntil = until;
    window.setTimeout(() => {
      if (
        this.suppressedClickPiece === pieceIndex &&
        this.suppressedClickUntil === until
      ) {
        this.suppressedClickPiece = null;
        this.suppressedClickUntil = 0;
      }
    }, 850);
  }

  private announce(message: string): void {
    const announcement = ++this.announcementSequence;
    const generation = this.generation;
    this.liveRegion.textContent = '';
    window.setTimeout(() => {
      if (
        announcement === this.announcementSequence &&
        generation === this.generation
      ) {
        this.liveRegion.textContent = message;
      }
    }, 0);
  }
}

export const createInlineDaily = (
  options: InlineDailyOptions
): InlinePuzzleController =>
  new InlinePuzzleControllerImpl({ ...options, kind: 'daily' });

export const createInlineCommunity = (
  options: InlineCommunityOptions
): InlinePuzzleController =>
  new InlinePuzzleControllerImpl({ ...options, kind: 'ugc' });
