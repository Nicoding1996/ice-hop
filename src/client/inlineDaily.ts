import { showLoginPrompt, showShareSheet, showToast } from '@devvit/web/client';
import type { DailySplashSnapshotV2 } from '../shared/api';
import type { Board, Move, Piece } from '../shared/game/types';
import { parseDailyPuzzleId } from '../shared/daily';
import { legalMoves } from '../shared/game/moves';
import { applyMove, isSolved } from '../shared/game/rules';
import { MAX_REPLAY_MOVES } from '../shared/game/replay';
import { validateBoardStructure } from '../shared/game/validation';
import { computeStars } from '../shared/scoring';
import { buildShareText } from '../shared/share';
import { difficultyFromPar, type Difficulty } from '../shared/solver/difficulty';
import { clearDailyHandoff, saveDailyHandoff } from './dailyHandoff';
import { trackClientEvent } from './telemetry';

const CELL = 44;
const PAD = 12;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_COUNT = 10_000_000;
const MAX_STREAK = 100_000;
const SEAL_TAP_SLOP_PX = 10;

type InlineDailyState =
  | 'preview'
  | 'loading'
  | 'solved-recap'
  | 'playing'
  | 'animating'
  | 'awaiting-session'
  | 'verifying'
  | 'verified-win'
  | 'load-error'
  | 'verification-error';

export type InlineLaunchIntent = 'play' | 'home' | 'endless';

export type InlineBoardRenderer = (
  board: Board,
  pieces: readonly Piece[],
  label: string
) => string;

export type InlineDailyOptions = {
  readonly root: HTMLElement;
  readonly postId: string;
  readonly snapshot?: DailySplashSnapshotV2;
  readonly renderBoard: InlineBoardRenderer;
  readonly openExpanded: (
    event: MouseEvent,
    intent: InlineLaunchIntent,
    beforeRequest?: () => boolean
  ) => void;
  readonly onLegacyHydrationError?: () => void;
  readonly onHydrated?: () => void;
};

export type InlineDailyController = {
  start(restoreKeyboardFocus?: boolean): void;
  applySnapshot(
    snapshot: DailySplashSnapshotV2,
    result: SolvedResult | null
  ): boolean;
  applySolvedPreview(result: SolvedResult | null): void;
  setExpansionPending(pending: boolean): void;
};

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
  readonly puzzleId: string;
  readonly date: string;
  readonly board: Board;
  readonly par: number;
  readonly difficulty: Difficulty;
};

type VerifiedSolve = {
  readonly accepted: true;
  readonly stars: number;
  readonly par: number;
  readonly moves: number;
  readonly bestMoves: number;
  readonly rank: number;
  readonly totalPlayers: number;
  readonly streak: number;
};

type Point = { readonly x: number; readonly y: number };

type DragTarget = {
  readonly move: Move;
  readonly delta: number;
};

type SealDrag = {
  readonly pointerId: number;
  readonly pieceIndex: number;
  readonly orient: 'H' | 'V';
  readonly control: HTMLButtonElement;
  readonly art: Element | null;
  readonly targets: readonly DragTarget[];
  readonly min: number;
  readonly max: number;
  readonly viewUnitsPerCssPixel: number;
  current: number;
  lastCoordinate: number;
  moved: boolean;
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

const parseVerifiedSolve = (
  value: unknown,
  session: DailyInit,
  expectedMoves: number
): VerifiedSolve | null => {
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

const puzzleMatchesSnapshot = (
  puzzle: DailyPuzzleDisplay,
  snapshot: DailySplashSnapshotV2
): boolean =>
  puzzle.puzzleId === snapshot.puzzleId &&
  puzzle.date === snapshot.date &&
  puzzle.par === snapshot.par &&
  puzzle.difficulty === snapshot.difficulty &&
  sameBoardInOrder(puzzle.board, snapshot.board);

const snapshotsMatch = (
  left: DailySplashSnapshotV2,
  right: DailySplashSnapshotV2
): boolean => puzzleMatchesSnapshot(left, right);

const sessionMatchesSnapshot = (
  session: DailyInit,
  snapshot: DailySplashSnapshotV2
): boolean => puzzleMatchesSnapshot(session, snapshot);

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

class InlineDailyControllerImpl implements InlineDailyController {
  private readonly stage: HTMLElement;
  private readonly contextText: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly topOpenButton: HTMLButtonElement;
  private state: InlineDailyState = 'preview';
  private started = false;
  private hydrationPending = false;
  private hydrationError = '';
  private dailyStartTracked = false;
  private recapDismissed = false;
  private session: DailyInit | null = null;
  private pieces: readonly Piece[] = [];
  private history: Move[] = [];
  private selected: number | null = null;
  private previewSolvedResult: SolvedResult | null = null;
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
  private suppressedClickPiece: number | null = null;
  private suppressedClickUntil = 0;
  private loadErrorMessage = 'Today’s puzzle could not be loaded safely.';
  private expansionPending = false;
  private scorePosted = false;
  private commentPending = false;
  private joined = false;
  private joinPending = false;
  private snapshot: DailySplashSnapshotV2 | null;

  constructor(private readonly options: InlineDailyOptions) {
    this.snapshot = options.snapshot ?? null;
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
      throw new Error('Inline Daily markup is incomplete.');
    }
    this.stage = stage;
    this.contextText = contextText;
    this.liveRegion = liveRegion;
    this.topOpenButton = topOpenButton;
    this.topOpenButton.addEventListener('click', (event) => {
      const intent: InlineLaunchIntent =
        this.state === 'verified-win' || this.state === 'solved-recap' ? 'home' : 'play';
      this.openExpanded(event, intent);
    });
  }

  private currentPuzzle(): DailyPuzzleDisplay | null {
    return this.session ?? this.snapshot;
  }

  start(restoreKeyboardFocus = false): void {
    if (this.started) {
      // A second explicit start only belongs to the legacy fallback. Exact
      // snapshots hydrate on the first deliberate board interaction instead.
      if (!this.snapshot && !this.session && !this.hydrationPending) {
        this.hydrateDaily(restoreKeyboardFocus);
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
    this.previewSolvedResult = null;
    this.verified = null;
    this.solveBody = null;
    this.verificationExpired = false;
    this.completionKeyboardFocus = false;
    this.hydrationKeyboardFocus = false;
    this.scorePosted = false;
    this.commentPending = false;
    this.joined = false;
    this.joinPending = false;
    this.recapDismissed = false;
    this.hydrationError = '';
    this.loadErrorMessage = 'Today’s puzzle could not be loaded safely.';

    if (this.snapshot) {
      this.state = 'playing';
      this.showRoot();
      this.render();
      if (restoreKeyboardFocus) this.focusFirstPieceControl();
      this.announce(`Daily ready. Par ${this.snapshot.par}.`);
    } else {
      // The only no-snapshot start is an explicit click on the offline legacy
      // fallback. Normal Daily posts bind `/api/init` before revealing a board.
      this.state = 'loading';
      this.hydrateDaily(restoreKeyboardFocus);
    }
  }

  applySnapshot(
    snapshot: DailySplashSnapshotV2,
    result: SolvedResult | null
  ): boolean {
    const existing = this.snapshot;
    if (
      (existing && !snapshotsMatch(existing, snapshot)) ||
      (this.session && !sessionMatchesSnapshot(this.session, snapshot))
    ) {
      return false;
    }

    this.snapshot = snapshot;
    if (!this.started) {
      this.start();
    } else if (!existing && !this.session) {
      // A legacy Play may have started /api/init just before the read-only
      // preview returned. Adopt the exact board immediately and leave that
      // already-deliberate request in flight for identity verification.
      this.pieces = snapshot.board.pieces.map(clonePiece);
      this.history = [];
      this.selected = null;
      this.previewSolvedResult = null;
      this.hydrationError = '';
      this.loadErrorMessage = 'Today’s puzzle could not be loaded safely.';
      this.state = 'playing';
      this.showRoot();
      this.render();
      this.announce(`Daily ready. Par ${snapshot.par}.`);
    }

    this.applySolvedPreview(result);
    return true;
  }

  applySolvedPreview(result: SolvedResult | null): void {
    const snapshot = this.snapshot;
    if (
      !result ||
      !snapshot ||
      result.moves < snapshot.par ||
      computeStars(result.moves, snapshot.par) !== result.stars ||
      !this.started ||
      this.session ||
      this.recapDismissed ||
      this.state !== 'playing' ||
      this.history.length > 0 ||
      this.selected !== null ||
      this.drag
    ) {
      return;
    }
    const restoreFocus = this.stage.contains(document.activeElement);
    this.previewSolvedResult = result;
    this.state = 'solved-recap';
    this.render();
    if (restoreFocus) this.focusStageHeading();
    this.announce("You've already solved this Daily.");
  }

  setExpansionPending(pending: boolean): void {
    this.expansionPending = pending;
    const stateLocked = this.expansionIsLocked();
    const buttons = this.options.root.querySelectorAll('.inline-open-button');
    for (const element of Array.from(buttons)) {
      if (!(element instanceof HTMLButtonElement)) continue;
      const idleLabel = element.dataset.idleLabel;
      element.disabled = pending || stateLocked;
      if (pending) {
        if (!idleLabel) element.dataset.idleLabel = element.textContent ?? 'Open full game';
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
    this.generation += 1;
    this.transitionSequence += 1;
    this.announcementSequence += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.hydrationPending = false;
    this.hydrationKeyboardFocus = false;
    this.completionKeyboardFocus = false;
    this.verificationExpired = false;
    this.drag = null;
    this.suppressedClickPiece = null;
    this.suppressedClickUntil = 0;
    return this.generation;
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

  private hydrateDaily(restoreKeyboardFocus = false): void {
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
        if (!response.ok) throw new Error(`Daily init failed: ${response.status}`);
        const value: unknown = await response.json();
        if (!this.requestIsCurrent(generation, request.id)) return;
        this.hydrationPending = false;
        this.requestController = null;

        if (isObject(value) && property(value, 'kind') === 'ugc') {
          this.showFatalLoadError(
            'This post contains a Community puzzle. Open the full game to play it.'
          );
          return;
        }
        const session = parseDailyInit(value);
        if (!session) throw new Error('The Daily response was incomplete.');
        const snapshot = this.snapshot;
        if (snapshot && !sessionMatchesSnapshot(session, snapshot)) {
          this.showFatalLoadError(
            'The post snapshot did not match the authoritative Daily.'
          );
          return;
        }

        const hydratedState = this.state;
        const restoreHydrationFocus = this.hydrationKeyboardFocus;
        this.hydrationKeyboardFocus = false;
        const hasLocalProgress =
          this.history.length > 0 ||
          this.selected !== null ||
          this.drag !== null ||
          hydratedState === 'animating' ||
          hydratedState === 'awaiting-session' ||
          hydratedState === 'solved-recap';
        this.session = session;
        this.joined = session.subscribed;
        this.options.onHydrated?.();

        if (!snapshot) {
          this.pieces = session.board.pieces.map(clonePiece);
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

        // A read-only solved preview may win a response race with this init.
        // Preserve the visible recap instead of letting stale unsolved init data
        // switch the controller to playing behind that card.
        if (hydratedState === 'solved-recap') {
          this.state = 'solved-recap';
          this.render();
          if (restoreHydrationFocus) this.focusStageHeading();
          return;
        }

        if (!hasLocalProgress && session.solved && !this.recapDismissed) {
          this.pieces = session.board.pieces.map(clonePiece);
          this.selected = null;
          this.state = 'solved-recap';
          this.render();
          if (restoreHydrationFocus) this.focusStageHeading();
          this.announce("You've already solved this Daily.");
          return;
        }

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
          this.prepareOpenButton(
            this.topOpenButton,
            this.history.length > 0 ? 'Continue full game' : 'Open full game'
          );
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
        this.showHydrationError('Could not connect to verify this Daily yet.');
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
    this.options.root.dataset.state = this.state;
    const busy =
      this.state === 'loading' ||
      this.state === 'animating' ||
      (this.state === 'awaiting-session' && !this.hydrationError) ||
      this.state === 'verifying';
    if (busy) this.options.root.setAttribute('aria-busy', 'true');
    else this.options.root.removeAttribute('aria-busy');

    const puzzle = this.currentPuzzle();
    if (puzzle) {
      this.contextText.textContent = `${formatDailyDate(puzzle.date)} · ${titleDifficulty(puzzle.difficulty)}`;
    } else {
      this.contextText.textContent = 'Daily puzzle';
    }

    if (this.state === 'loading') this.renderSessionLoading();
    else if (this.state === 'load-error') this.renderLoadError();
    else if (this.state === 'solved-recap') this.renderRecap();
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
        this.state === 'verified-win' || this.state === 'solved-recap'
          ? '‹ Menu'
          : this.state === 'animating'
            ? 'Moving…'
            : this.state === 'playing' && this.history.length > 0 && !this.session
              ? 'Connecting progress…'
              : this.state === 'playing' && this.history.length > 0
                ? 'Continue full game'
                : 'Open full game';
      this.prepareOpenButton(this.topOpenButton, topLabel);
    }
  }

  private expansionIsLocked(): boolean {
    return (
      this.state === 'loading' ||
      this.state === 'animating' ||
      this.state === 'awaiting-session' ||
      this.state === 'verifying' ||
      this.state === 'verification-error' ||
      (this.state === 'playing' && this.history.length > 0 && !this.session)
    );
  }

  private prepareOpenButton(button: HTMLButtonElement, label: string): void {
    const stateLocked = this.expansionIsLocked();
    button.classList.add('inline-open-button');
    button.textContent = this.expansionPending ? 'Opening…' : label;
    button.disabled = this.expansionPending || stateLocked;
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
      if (intent === 'endless') trackClientEvent('daily_to_endless');
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
    if (intent === 'play' && this.state === 'playing' && this.history.length > 0) {
      return this.persistHandoff();
    }

    // A fresh/restarted attempt or a route away from play must not inherit a
    // transcript left by an earlier expansion that failed or was cancelled.
    this.clearCurrentHandoff();
    return true;
  }

  private clearCurrentHandoff(): void {
    const puzzle = this.currentPuzzle();
    if (puzzle && this.options.postId) {
      clearDailyHandoff(this.options.postId, puzzle.puzzleId);
    }
  }

  private persistHandoff(): boolean {
    if (this.history.length === 0) return true;
    if (!this.session || !this.options.postId) {
      this.hydrateDaily();
      this.announce('Still connecting. Your progress remains on this board.');
      showToast('Still connecting — your progress is safe here.');
      return false;
    }
    const saved = saveDailyHandoff({
      auth: this.session.username === 'anon' ? 'guest' : 'signed',
      postId: this.options.postId,
      puzzleId: this.session.puzzleId,
      playId: this.session.playId,
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
    const eyebrow = makeParagraph('inline-eyebrow', 'Daily puzzle');
    const heading = document.createElement('h2');
    heading.textContent = 'Getting a fresh play ready…';
    const status = document.createElement('div');
    status.className = 'inline-saving-status';
    status.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'inline-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = 'Starting the play clock…';
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
    const eyebrow = makeParagraph('inline-eyebrow', 'Daily complete');
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
    text.textContent = 'Saving your score…';
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
        'Your score is waiting to save',
        'Your completed move history is safe. Reconnect to save it.',
        'Retry saving',
        (event) => {
          if (event.detail === 0) this.completionKeyboardFocus = true;
          this.hydrateDaily(event.detail === 0);
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
    title.textContent = 'Could not connect this play';
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
      (event) => this.hydrateDaily(event.detail === 0)
    );
    const open = this.makeOpenButton('Open full game', 'play');
    open.classList.add('inline-button--compact');
    actions.append(retry, open);
    footer.append(copy, actions);
    const surface = this.buildPlaySurface(false, footer);
    if (surface) this.stage.replaceChildren(surface);
  }

  private renderRecap(): void {
    const puzzle = this.currentPuzzle();
    const result = this.session?.solvedResult ?? this.previewSolvedResult;
    if (!puzzle || !result) {
      this.showFatalLoadError('The saved Daily result was incomplete.');
      return;
    }
    const card = document.createElement('div');
    card.className = 'inline-message-card inline-message-card--recap';
    const eyebrow = makeParagraph('inline-eyebrow', 'Daily complete');
    const heading = document.createElement('h2');
    heading.textContent = 'You already helped everyone in!';
    const stars = document.createElement('div');
    stars.className = 'inline-stars';
    stars.textContent = '★'.repeat(result.stars);
    stars.setAttribute('aria-label', `${result.stars} stars`);
    const score = makeParagraph(
      'inline-result-score',
      `${result.moves} moves · par ${puzzle.par}`
    );
    const detail = makeParagraph(
      'inline-message-copy',
      'A fresh puzzle drops tomorrow. Replay here or explore more Ice Hop.'
    );
    const actions = document.createElement('div');
    actions.className = 'inline-card-actions';
    const more = this.makeOpenButton('More puzzles', 'endless');
    more.classList.remove('inline-button--secondary');
    more.classList.add('inline-button--primary');
    const replay = makeButton(
      'Play again',
      'inline-button inline-button--secondary',
      (event) => this.restartAttempt(event.detail === 0)
    );
    actions.append(more, replay);
    card.append(eyebrow, heading, stars, score, detail, actions);
    this.stage.replaceChildren(card);
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
    hud.setAttribute('aria-label', `Moves ${this.history.length}, par ${puzzle.par}`);
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
    hud.append(moves, par);

    footer.id = 'inline-board-instructions';
    footer.classList.add('inline-bottom-strip');

    const frame = document.createElement('div');
    frame.className = 'inline-board-frame';
    const board = this.buildBoard(interactive);
    frame.append(board);

    play.append(hud, frame, footer);
    return play;
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
        (event) => this.hydrateDaily(event.detail === 0)
      );
      actions.append(retry);
      if (this.history.length > 0) {
        actions.append(
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
      const restart = makeButton(
        '↺ Restart',
        'inline-button inline-button--quiet',
        (event) => this.restartAttempt(event.detail === 0)
      );
      footer.append(restart);
    } else {
      const instructions = makeParagraph(
        'inline-instructions',
        'Tap a penguin to hop, drag a seal to slide.'
      );
      instructions.append(
        document.createElement('br'),
        document.createTextNode('Get every penguin into the water.')
      );
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
    shell.setAttribute('role', 'group');
    shell.setAttribute('aria-label', 'Daily puzzle board');
    shell.setAttribute(
      'aria-describedby',
      'inline-board-instructions inline-board-state'
    );

    const visual = document.createElement('div');
    visual.className = 'inline-board-visual';
    visual.innerHTML = this.options.renderBoard(board, this.pieces, 'Daily puzzle board');
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
    if (selectedPiece?.kind === 'HOPPER') {
      visual
        .querySelector(`[data-inline-piece-inner="${this.selected}"]`)
        ?.classList.add('is-selected');
    }

    const description = document.createElement('p');
    description.id = 'inline-board-state';
    description.className = 'visually-hidden';
    description.textContent = describeBoardState(board, this.pieces);
    shell.append(visual, description);

    if (!interactive) return shell;

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
    };

    this.pieces.forEach((piece, pieceIndex) => {
      if (piece.kind === 'BLOCKER') return;
      const center = centerOfCells(board, piece.cells);
      const control = document.createElement('button');
      control.type = 'button';
      control.className = `inline-piece-control inline-piece--${piece.kind === 'HOPPER' ? 'hopper' : 'slider'}`;
      control.dataset.pieceControl = pieceIndex.toString();
      control.setAttribute('aria-pressed', this.selected === pieceIndex ? 'true' : 'false');
      const firstCell = piece.cells[0] ?? 0;
      const row = Math.floor(firstCell / board.width) + 1;
      const column = (firstCell % board.width) + 1;
      control.setAttribute(
        'aria-label',
        `${piece.kind === 'HOPPER' ? 'Penguin' : 'Seal'} at row ${row}, column ${column}`
      );
      this.positionControl(
        control,
        center,
        piece.kind === 'SLIDER' && piece.orient === 'H' ? CELL * 1.8 : CELL * 0.82,
        piece.kind === 'SLIDER' && piece.orient === 'V' ? CELL * 1.8 : CELL * 0.82,
        size
      );
      if (this.selected === pieceIndex) control.classList.add('is-selected');
      control.addEventListener('click', (event) => {
        if (this.clickIsSuppressed(pieceIndex)) return;
        if (piece.kind === 'SLIDER' && event.detail !== 0) {
          control.blur();
          this.announce('Drag the seal along the ice.');
          return;
        }
        this.selectPiece(pieceIndex, event.detail === 0);
      });
      if (piece.kind === 'SLIDER') {
        control.addEventListener('pointerdown', (event) =>
          this.beginSealDrag(
            event,
            control,
            pieceIndex,
            clearSelectionInPlace
          )
        );
        control.addEventListener('pointermove', (event) => this.moveSealDrag(event));
        control.addEventListener('pointerup', (event) => this.endSealDrag(event));
        control.addEventListener('pointercancel', (event) => this.cancelSealDrag(event));
        control.addEventListener('lostpointercapture', (event) =>
          this.loseSealPointerCapture(event)
        );
      }
      controls.append(control);
    });

    if (this.selected !== null) {
      const selectedPiece = this.pieces[this.selected];
      if (selectedPiece) {
        const destinations = allMoves.filter((move) => move.pieceIndex === this.selected);
        for (const move of destinations) {
          // Seal destinations stay invisible to pointer users because seals are
          // drag-only. They remain labelled, focusable keyboard targets and the
          // focused target receives the standard visible focus outline.
          let targetCells: readonly number[] = move.to;
          if (selectedPiece.kind === 'SLIDER') {
            const origin = centerOfCells(board, selectedPiece.cells);
            const destination = centerOfCells(board, move.to);
            const movesForward =
              selectedPiece.orient === 'V'
                ? destination.y > origin.y
                : destination.x > origin.x;
            const leadingCell = movesForward
              ? move.to[move.to.length - 1]
              : move.to[0];
            if (leadingCell !== undefined) targetCells = [leadingCell];
          }
          const center = centerOfCells(board, targetCells);
          const target = document.createElement('button');
          target.type = 'button';
          target.className = `inline-target inline-target--${selectedPiece.kind === 'HOPPER' ? 'hop' : 'slide'}`;
          const firstCell = targetCells[0] ?? move.to[0] ?? 0;
          const row = Math.floor(firstCell / board.width) + 1;
          const column = (firstCell % board.width) + 1;
          const landsInWater =
            selectedPiece.kind === 'HOPPER' && board.holes.includes(firstCell);
          target.setAttribute(
            'aria-label',
            landsInWater
              ? `Hop penguin into water at row ${row}, column ${column}`
              : `${selectedPiece.kind === 'HOPPER' ? 'Hop penguin' : 'Slide seal'} to row ${row}, column ${column}`
          );
          this.positionControl(
            target,
            center,
            CELL * 0.96,
            CELL * 0.96,
            size
          );
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

    if (this.selected === null) return effects;
    const selectedPiece = this.pieces[this.selected];
    if (!selectedPiece || selectedPiece.kind !== 'HOPPER') return effects;
    const center = centerOfCells(board, selectedPiece.cells);
    const destinations = allMoves.filter((move) => move.pieceIndex === this.selected);

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
    if (!this.session && !this.hydrationPending) this.hydrateDaily();
    const piece = this.pieces[pieceIndex];
    if (!piece || piece.kind === 'BLOCKER') return;
    const destinations = legalMoves(puzzle.board, this.pieces).filter(
      (move) => move.pieceIndex === pieceIndex
    );
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
    if (!this.session && !this.hydrationPending) this.hydrateDaily();
    const legal = legalMoves(puzzle.board, this.pieces);
    const move = legal.find((entry) => sameMove(entry, candidate));
    if (!move) {
      this.announce('That move is no longer legal. Choose another destination.');
      return;
    }
    const canonical = cloneMove(move);
    this.state = 'animating';
    this.selected = null;
    this.options.root.dataset.state = this.state;
    this.options.root.setAttribute('aria-busy', 'true');
    this.prepareOpenButton(this.topOpenButton, 'Moving…');
    const instruction = this.stage.querySelector('.inline-instructions');
    if (instruction) instruction.textContent = canonical.kind === 'HOPPER' ? 'Penguin hopping…' : 'Seal sliding…';
    const buttons = this.stage.querySelectorAll('button');
    for (const element of Array.from(buttons)) {
      if (element instanceof HTMLButtonElement) element.disabled = true;
    }
    this.animateMove(canonical, restoreKeyboardFocus);
  }

  private animateMove(move: Move, restoreKeyboardFocus: boolean): void {
    const puzzle = this.currentPuzzle();
    if (!puzzle) return;
    const transition = ++this.transitionSequence;
    const piece = this.pieces[move.pieceIndex];
    if (!piece) return;
    const from = centerOfCells(puzzle.board, piece.cells);
    const to = centerOfCells(puzzle.board, move.to);
    const size = viewSize(puzzle.board);
    const boardElement = this.stage.querySelector('.inline-board');
    const rect = boardElement?.getBoundingClientRect();
    const viewDx = to.x - from.x;
    const viewDy = to.y - from.y;
    const cssDx = rect ? (viewDx / size.x) * rect.width : 0;
    const cssDy = rect ? (viewDy / size.y) * rect.height : 0;
    const art = this.stage.querySelector(`[data-inline-piece-art="${move.pieceIndex}"]`);
    const control = this.stage.querySelector(`[data-piece-control="${move.pieceIndex}"]`);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : move.kind === 'HOPPER' ? 220 : 180;

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
      this.commitMove(move, restoreKeyboardFocus);
    }, duration + 20);
  }

  private commitMove(move: Move, restoreKeyboardFocus: boolean): void {
    const puzzle = this.currentPuzzle();
    if (!puzzle || this.state !== 'animating') return;
    this.pieces = applyMove(this.pieces, move).map(clonePiece);
    this.history.push(cloneMove(move));
    if (!this.dailyStartTracked) {
      this.dailyStartTracked = true;
      trackClientEvent('daily_started');
    }
    this.selected = null;
    if (isSolved(puzzle.board, this.pieces)) {
      this.beginVerification(restoreKeyboardFocus);
      return;
    }
    this.state = 'playing';
    this.render();
    if (restoreKeyboardFocus) this.focusPieceControl(move.pieceIndex);
    this.announce(
      move.kind === 'HOPPER'
        ? `Penguin moved. ${this.history.length} ${this.history.length === 1 ? 'move' : 'moves'}.`
        : `Seal moved. ${this.history.length} ${this.history.length === 1 ? 'move' : 'moves'}.`
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
    const dismissingRecap = this.state === 'solved-recap';
    const needsFreshSession = this.verificationExpired;
    if (needsFreshSession && !this.snapshot) {
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
      this.recapDismissed = true;
      this.commentPending = false;
      this.joinPending = false;
      this.pieces = puzzle.board.pieces.map(clonePiece);
      this.history = [];
      this.selected = null;
      this.previewSolvedResult = null;
      this.verified = null;
      this.solveBody = null;
      this.state = 'loading';
      this.completionKeyboardFocus = restoreKeyboardFocus;
      this.render();
      this.announce('Getting a fresh play session.');
      this.hydrateDaily(restoreKeyboardFocus);
      return;
    }

    const needsHydration = !this.session;
    this.beginGeneration();
    if (dismissingRecap) this.recapDismissed = true;
    this.commentPending = false;
    this.joinPending = false;
    this.pieces = puzzle.board.pieces.map(clonePiece);
    this.history = [];
    this.selected = null;
    this.previewSolvedResult = null;
    this.verified = null;
    this.solveBody = null;
    this.state = 'playing';
    this.render();
    if (restoreKeyboardFocus) this.focusFirstPieceControl();
    this.announce('Puzzle restarted.');
    if (needsHydration) this.hydrateDaily(restoreKeyboardFocus);
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
      this.announce('Everyone is in. Saving your score.');
      if (!this.hydrationPending) this.hydrateDaily();
      return;
    }
    const transcript = this.history.map(cloneMove);
    this.solveBody = JSON.stringify({
      puzzleId: session.puzzleId,
      playId: session.playId,
      moves: transcript,
    });
    this.state = 'verifying';
    this.render();
    this.announce('Everyone is in. Saving your score.');
    this.verifySolve(this.solveBody);
  }

  private verifySolve(body: string): void {
    if (this.state !== 'verifying' || body !== this.solveBody) return;
    const session = this.session;
    if (!session) return;
    const generation = this.generation;
    const request = this.beginRequest();
    const expectedMoves = this.history.length;
    const timer = window.setTimeout(() => request.controller.abort(), REQUEST_TIMEOUT_MS);
    void fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: request.controller.signal,
    })
      .then(async (response) => {
        if (!this.requestIsCurrent(generation, request.id)) return;
        if (response.status === 410) {
          this.verificationExpired = true;
          this.state = 'verification-error';
          this.render();
          this.announce(
            'This play session expired. Start a fresh attempt to save another score.'
          );
          return;
        }
        if (!response.ok) throw new Error(`Daily solve failed: ${response.status}`);
        const value: unknown = await response.json();
        if (!this.requestIsCurrent(generation, request.id)) return;
        const result = parseVerifiedSolve(value, session, expectedMoves);
        if (!result) throw new Error('Daily solve response was malformed.');
        const attemptStars = computeStars(result.moves, result.par);
        this.verificationExpired = false;
        this.verified = result;
        this.state = 'verified-win';
        this.render();
        this.announce(`Solve verified. ${result.moves} moves and ${attemptStars} stars.`);
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
      'Your score was not saved',
      'Your completed move history is safe. Retry sends the same moves.',
      'Retry saving',
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
    if (!session || !result) {
      this.state = 'verification-error';
      this.renderVerificationError();
      return;
    }
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
    const details = document.createElement('div');
    details.className = 'inline-verified-details';
    if (session.username === 'anon') {
      details.append(
        makeParagraph(
          'inline-message-copy',
          'Verified for this play. Guest scores are not saved to the leaderboard or a streak.'
        )
      );
    } else {
      details.append(makeParagraph('inline-message-copy', 'Score verified and saved.'));
      if (result.bestMoves < result.moves) {
        const rankSuffix =
          result.rank > 0
            ? ` · rank #${result.rank} of ${result.totalPlayers}`
            : '';
        details.append(
          makeParagraph(
            'inline-result-detail',
            `Best today: ${result.bestMoves} moves (${result.stars}★)${rankSuffix}`
          )
        );
      } else if (result.rank > 0) {
        details.append(
          makeParagraph(
            'inline-result-detail',
            `Rank #${result.rank} of ${result.totalPlayers} today`
          )
        );
      }
      if (result.streak > 0) {
        details.append(
          makeParagraph('inline-result-detail', `${result.streak}-day streak`)
        );
      }
    }

    const actions = document.createElement('div');
    actions.className = 'inline-card-actions inline-card-actions--win';
    const more = this.makeOpenButton('More puzzles', 'endless');
    more.classList.remove('inline-button--secondary');
    more.classList.add('inline-button--primary');
    const share = makeButton(
      'Share result',
      'inline-button inline-button--secondary',
      () => void this.shareVerifiedResult(share)
    );
    actions.append(more, share);

    if (session.username === 'anon') {
      const signIn = makeButton(
        'Sign in to save progress',
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
        const join = makeButton(
          joinLabel,
          'inline-button inline-button--quiet inline-button--compact',
          () => void this.joinCommunity(join, joinLabel)
        );
        actions.append(join);
      }
    }

    const again = makeButton(
      'Play again',
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
    if (!session || !result || this.state !== 'verified-win') return;
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

  private beginSealDrag(
    event: PointerEvent,
    control: HTMLButtonElement,
    pieceIndex: number,
    clearSelection: () => void
  ): void {
    event.preventDefault();
    if (this.expansionPending || this.drag) return;
    const puzzle = this.currentPuzzle();
    if (this.state !== 'playing' || !puzzle || event.button !== 0) return;
    if (!this.session && !this.hydrationPending) this.hydrateDaily();
    const piece = this.pieces[pieceIndex];
    if (!piece || piece.kind !== 'SLIDER') return;
    clearSelection();
    control.blur();
    const boardElement = control.closest('.inline-board');
    if (!(boardElement instanceof HTMLElement)) return;
    const rect = boardElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
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
    this.drag = {
      pointerId: event.pointerId,
      pieceIndex,
      orient,
      control,
      art,
      targets,
      min: Math.min(...values),
      max: Math.max(...values),
      viewUnitsPerCssPixel,
      current: 0,
      lastCoordinate: orient === 'H' ? event.clientX : event.clientY,
      moved: false,
    };
    control.setPointerCapture(event.pointerId);
    control.classList.add('is-dragging');
    if (art) art.classList.add('is-dragging');
  }

  private moveSealDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const coordinate = drag.orient === 'H' ? event.clientX : event.clientY;
    const movement = coordinate - drag.lastCoordinate;
    drag.lastCoordinate = coordinate;
    drag.current = Math.max(drag.min, Math.min(drag.max, drag.current + movement));
    if (!drag.moved && Math.abs(drag.current) > SEAL_TAP_SLOP_PX) {
      drag.moved = true;
    }
    this.paintDrag(drag, drag.current);
  }

  private endSealDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    this.drag = null;
    this.releasePointer(drag);
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
    if (tapLike) {
      this.suppressNextClick(drag.pieceIndex);
      this.snapDragBack(drag);
      this.announce('Drag the seal along the ice.');
      return;
    }
    this.suppressNextClick(drag.pieceIndex);
    if (best) {
      this.attemptMove(best.move);
    } else {
      this.snapDragBack(drag);
    }
  }

  private cancelSealDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    this.drag = null;
    this.releasePointer(drag);
    this.suppressNextClick(drag.pieceIndex);
    this.snapDragBack(drag);
    this.announce('Seal returned to its starting place.');
  }

  private loseSealPointerCapture(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.suppressNextClick(drag.pieceIndex);
    this.snapDragBack(drag);
    this.announce('Seal drag ended before a move was chosen.');
  }

  private paintDrag(drag: SealDrag, value: number): void {
    const cssX = drag.orient === 'H' ? value : 0;
    const cssY = drag.orient === 'V' ? value : 0;
    drag.control.style.setProperty('--drag-x', `${cssX}px`);
    drag.control.style.setProperty('--drag-y', `${cssY}px`);
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

  private releasePointer(drag: SealDrag): void {
    drag.control.classList.remove('is-dragging');
    if (drag.art) drag.art.classList.remove('is-dragging');
    if (drag.control.hasPointerCapture(drag.pointerId)) {
      drag.control.releasePointerCapture(drag.pointerId);
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

export const createInlineDaily = (options: InlineDailyOptions): InlineDailyController =>
  new InlineDailyControllerImpl(options);
