import { context, requestExpandedMode } from '@devvit/web/client';
import {
  createInlineCommunity,
  createInlineDaily,
  type InlinePuzzleController,
} from './inlineDaily';
import type {
  DailySplashSnapshotV2,
  PostPreviewResponse,
  SplashPostData,
  UgcSplashSnapshotV2,
} from '../shared/api';
import { POST_DATA_SPLASH_KEY } from '../shared/api';
import { todayUtc } from '../shared/date';
import { isDailyDate, parseDailyPuzzleId } from '../shared/daily';
import type { Board, Piece } from '../shared/game/types';
import { MAX_REPLAY_MOVES } from '../shared/game/replay';
import { isSolved } from '../shared/game/rules';
import { validateBoardStructure } from '../shared/game/validation';
import { difficultyFromPar, type Difficulty } from '../shared/solver/difficulty';

// --- Launch actions ----------------------------------------------------------

const startElement = document.getElementById('start-button');
const startButton = startElement instanceof HTMLButtonElement ? startElement : null;
const exploreElement = document.getElementById('explore-button');
const exploreButton = exploreElement instanceof HTMLButtonElement ? exploreElement : null;
type ExpandedModeEvent = Parameters<typeof requestExpandedMode>[0];
type LaunchIntent = 'play' | 'home' | 'endless';

const launchStorageKey =
  typeof context.postId === 'string' && context.postId.length > 0
    ? `icehop.launch:${context.postId}`
    : 'icehop.launch:no-post';

let launchPending = false;
let launchResetTimer: number | undefined;
let inlinePuzzle: InlinePuzzleController | null = null;
let inlinePuzzleKind: 'daily' | 'ugc' | null = null;
let idleStartLabel = startButton?.textContent ?? "Play today's puzzle";

const clearLaunchIntent = (): void => {
  try {
    sessionStorage.removeItem(launchStorageKey);
  } catch {
    /* sessionStorage is an optimization; default launch still opens the post */
  }
};

const setIdleStartLabel = (label: string): void => {
  idleStartLabel = label;
  if (!launchPending && startButton) startButton.textContent = label;
};

const resetLaunchState = (clearIntent = false): void => {
  if (launchResetTimer !== undefined) window.clearTimeout(launchResetTimer);
  launchResetTimer = undefined;
  if (clearIntent) clearLaunchIntent();
  launchPending = false;
  inlinePuzzle?.setExpansionPending(false);
  document.body.classList.remove('opening');
  startButton?.removeAttribute('aria-busy');
  exploreButton?.removeAttribute('aria-busy');
  if (startButton) {
    startButton.disabled = false;
    startButton.textContent = idleStartLabel;
  }
  if (exploreButton) exploreButton.disabled = false;
};

const openExpanded = (
  event: ExpandedModeEvent,
  intent: LaunchIntent,
  beforeRequest?: () => boolean
): void => {
  if (launchPending) return;
  // A continuation may require a durable one-shot transcript. Never navigate
  // when that handoff could not be saved.
  if (beforeRequest && !beforeRequest()) return;
  launchPending = true;
  inlinePuzzle?.setExpansionPending(true);
  document.body.classList.add('opening');
  if (startButton) startButton.disabled = true;
  if (exploreButton) exploreButton.disabled = true;

  if (intent === 'play') {
    clearLaunchIntent();
    startButton?.setAttribute('aria-busy', 'true');
    if (startButton) startButton.textContent = 'Opening puzzle...';
  } else {
    exploreButton?.setAttribute('aria-busy', 'true');
    try {
      sessionStorage.setItem(launchStorageKey, intent);
    } catch {
      /* sessionStorage unavailable - Boot will play the host post */
    }
  }

  try {
    // Keep expansion in this click stack so Reddit retains the user gesture.
    requestExpandedMode(event, 'game');
    // If expansion fails silently, restore this card. Keep the one-shot route
    // and handoff until the expanded entrypoint consumes them or a later user
    // action replaces them; its own init timeout is longer than this UI reset.
    launchResetTimer = window.setTimeout(() => resetLaunchState(false), 4000);
  } catch (error) {
    console.error(error);
    resetLaunchState(true);
  }
};

startButton?.addEventListener('click', (event) => {
  if (renderedKind && inlinePuzzle) {
    beginInlinePuzzle(event.detail === 0);
    return;
  }
  openExpanded(event, 'play');
});
exploreButton?.addEventListener('click', (event) => openExpanded(event, 'home'));
window.addEventListener('pageshow', () => resetLaunchState(true));

// --- Meta line (date / hello) ------------------------------------------------

const meta = document.getElementById('meta');
if (meta) {
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  meta.textContent = context.username ? `${date}  -  hi ${context.username}` : date;
}

// --- Feed-card puzzle preview -----------------------------------------------
// Daily and Community cards both render their exact immutable board. Daily
// snapshots become playable inline immediately; `/api/init` is still required
// before an authoritative solve can be submitted.
// All previews mirror the in-game Phaser draw helpers (art/theme.ts), emitted as
// static SVG so the inline entrypoint stays Phaser-free and fast.

const C = {
  sheet: '#d4ecf7',
  sheetEdge: '#7fb4d4',
  grid: '#a6cee0',
  waterRim: '#9ccfe2',
  water: '#0e3a55',
  holeRim: '#08293c',
  shimmer: '#7fe0ff',
  pen: '#2b3440',
  penOut: '#141a22',
  belly: '#f4f9fc',
  beak: '#f6a623',
  beakOut: '#c77f15',
  seal: '#7d8c9b',
  sealOut: '#3a4654',
  sealBelly: '#b9c6d2',
  sealNose: '#2a333d',
  rock: '#a7c0d0',
  rockOut: '#5c7488',
  rockFacet: '#d2e6f1',
  rockSnow: '#ffffff',
  eye: '#15202b',
  eyeWhite: '#ffffff',
} as const;

const CELL = 44;
const PAD = 12;

// postData and fetch responses are trust boundaries even though their TypeScript
// contracts are shared with the server. Parse them before drawing any board.
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

const parseDailySplashSnapshotV2 = (value: object): DailySplashSnapshotV2 | null => {
  // Exact snapshots are untrusted feed data. Validate identity, structure, par,
  // and piece order before allowing the board to become interactive.
  if (
    property(value, 'version') !== 2 ||
    property(value, 'kind') !== 'daily'
  ) {
    return null;
  }

  const puzzleIdValue = property(value, 'puzzleId');
  if (typeof puzzleIdValue !== 'string' || puzzleIdValue.length > 128) return null;
  const puzzleId = puzzleIdValue;
  const date = property(value, 'date');
  const par = property(value, 'par');
  const difficulty = readDifficulty(property(value, 'difficulty'));
  const puzzleRef = parseDailyPuzzleId(puzzleId);
  const structure = validateBoardStructure(property(value, 'board'));
  if (
    !puzzleRef ||
    !isDailyDate(date) ||
    puzzleRef.date !== date ||
    typeof par !== 'number' ||
    !Number.isSafeInteger(par) ||
    par < 1 ||
    par > MAX_REPLAY_MOVES ||
    !difficulty ||
    difficultyFromPar(par) !== difficulty ||
    !structure.ok
  ) {
    return null;
  }

  const board = structure.board;
  const hoppers = board.pieces.filter((piece) => piece.kind === 'HOPPER').length;
  if (hoppers < 1 || hoppers !== board.holes.length || isSolved(board, board.pieces)) {
    return null;
  }

  return {
    version: 2,
    kind: 'daily',
    puzzleId,
    date,
    board,
    par,
    difficulty,
  };
};

const parseUgcSplashSnapshotV2 = (value: object): UgcSplashSnapshotV2 | null => {
  if (property(value, 'version') !== 2 || property(value, 'kind') !== 'ugc') {
    return null;
  }

  const id = property(value, 'id');
  const par = readInteger(property(value, 'par'), 1, MAX_REPLAY_MOVES);
  const difficulty = readDifficulty(property(value, 'difficulty'));
  const creator = property(value, 'creator');
  const structure = validateBoardStructure(property(value, 'board'));
  if (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 64 ||
    par === null ||
    !difficulty ||
    difficultyFromPar(par) !== difficulty ||
    typeof creator !== 'string' ||
    creator.length < 1 ||
    creator.length > 100 ||
    !structure.ok
  ) {
    return null;
  }

  const board = structure.board;
  const hoppers = board.pieces.filter((piece) => piece.kind === 'HOPPER').length;
  if (hoppers < 1 || hoppers !== board.holes.length || isSolved(board, board.pieces)) {
    return null;
  }

  return {
    version: 2,
    kind: 'ugc',
    id,
    board,
    par,
    difficulty,
    creator,
  };
};

const parseSplashPostData = (value: unknown): SplashPostData | null => {
  if (!isObject(value)) return null;
  const version = property(value, 'version');
  if (version !== undefined) {
    if (version !== 2) return null;
    const kind = property(value, 'kind');
    return kind === 'daily'
      ? parseDailySplashSnapshotV2(value)
      : kind === 'ugc'
        ? parseUgcSplashSnapshotV2(value)
        : null;
  }

  const kind = property(value, 'kind');
  const difficulty = readDifficulty(property(value, 'difficulty'));
  if (!difficulty) return null;

  if (kind === 'daily') {
    const dateValue = property(value, 'date');
    if (dateValue !== undefined && !isDailyDate(dateValue)) return null;
    return dateValue === undefined
      ? { kind, difficulty }
      : { kind, date: dateValue, difficulty };
  }
  if (kind !== 'ugc') return null;

  const creator = property(value, 'creator');
  const structure = validateBoardStructure(property(value, 'board'));
  if (
    typeof creator !== 'string' ||
    creator.length < 1 ||
    creator.length > 100 ||
    !structure.ok
  ) {
    return null;
  }
  return { kind, board: structure.board, difficulty, creator };
};

const parsePostPreviewResponse = (value: unknown): PostPreviewResponse | null => {
  if (!isObject(value) || property(value, 'type') !== 'post-preview') return null;
  const kind = property(value, 'kind');
  const difficulty = readDifficulty(property(value, 'difficulty'));
  if (!difficulty) return null;

  if (kind === 'daily') {
    const snapshot = parseDailySplashSnapshotV2(value);
    return snapshot ? { type: 'post-preview', ...snapshot } : null;
  }
  if (kind !== 'ugc') return null;

  const snapshot = parseUgcSplashSnapshotV2(value);
  const solves = readInteger(property(value, 'solves'), 0, 10_000_000);
  const solved = property(value, 'solved');
  if (!snapshot || solves === null || typeof solved !== 'boolean') return null;
  return { type: 'post-preview', ...snapshot, solves, solved };
};

// --- tiny SVG builders (mirror Phaser's ellipse/circle/rect/triangle) --------
// Phaser ellipse/rect take full width/height; circle takes a radius; rotations
// are radians (positive = clockwise, same as SVG). We round to keep markup small.
const n = (x: number): string => (Math.round(x * 100) / 100).toString();

type ShapeOpts = { stroke?: string; sw?: number; rot?: number; opacity?: number };
const extra = (o: ShapeOpts, ox: number, oy: number): string => {
  let a = '';
  if (o.stroke) a += ` stroke="${o.stroke}" stroke-width="${n(o.sw ?? 1)}"`;
  if (o.opacity !== undefined) a += ` opacity="${o.opacity}"`;
  if (o.rot) a += ` transform="rotate(${n((o.rot * 180) / Math.PI)} ${n(ox)} ${n(oy)})"`;
  return a;
};
const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, o: ShapeOpts = {}): string =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"${extra(o, cx, cy)} />`;
const cir = (cx: number, cy: number, rad: number, fill: string, o: ShapeOpts = {}): string =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rad)}" fill="${fill}"${extra(o, cx, cy)} />`;
const box = (x: number, y: number, w: number, h: number, rad: number, fill: string, o: ShapeOpts = {}): string =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rad)}" fill="${fill}"${extra(o, x, y)} />`;
const tri = (pts: ReadonlyArray<readonly [number, number]>, fill: string, o: ShapeOpts = {}): string =>
  `<polygon points="${pts.map(([px, py]) => `${n(px)},${n(py)}`).join(' ')}" fill="${fill}"${
    o.stroke ? ` stroke="${o.stroke}" stroke-width="${n(o.sw ?? 1)}" stroke-linejoin="round"` : ''
  } />`;

// --- creatures: direct ports of theme.ts draw helpers ------------------------
/** Water hole carved into the ice (makeWaterHole): wet rim, deep pool, lip shadow, reflection. */
const holeArt = (x: number, y: number, s: number): string =>
  cir(x, y, 0.36 * s, C.waterRim) +
  cir(x, y, 0.3 * s, C.water) +
  ell(x, y - 0.07 * s, 0.25 * s, 0.17 * s, C.holeRim, { opacity: 0.5 }) +
  ell(x + 0.04 * s, y + 0.1 * s, 0.07 * s, 0.035 * s, C.shimmer, { opacity: 0.5 });

/** Chubby outlined penguin with webbed feet, flippers, big eyes (drawPenguinInto). */
const penguinArt = (x: number, y: number, s: number): string => {
  const sw = Math.max(1.5, 0.04 * s);
  const fsw = Math.max(1, 0.025 * s);
  const eyeY = y - 0.17 * s;
  return (
    ell(x - 0.17 * s, y + 0.39 * s, 0.15 * s, 0.085 * s, C.beak, { stroke: C.beakOut, sw: fsw, rot: -0.22 }) +
    ell(x + 0.17 * s, y + 0.39 * s, 0.15 * s, 0.085 * s, C.beak, { stroke: C.beakOut, sw: fsw, rot: 0.22 }) +
    ell(x - 0.38 * s, y + 0.04 * s, 0.1 * s, 0.26 * s, C.pen, { stroke: C.penOut, sw, rot: 0.16 }) +
    ell(x + 0.38 * s, y + 0.04 * s, 0.1 * s, 0.26 * s, C.pen, { stroke: C.penOut, sw, rot: -0.16 }) +
    ell(x, y - 0.02 * s, 0.42 * s, 0.45 * s, C.pen, { stroke: C.penOut, sw }) +
    ell(x, y + 0.2 * s, 0.27 * s, 0.29 * s, C.belly) +
    ell(x - 0.15 * s, eyeY, 0.11 * s, 0.13 * s, C.eyeWhite) +
    ell(x + 0.15 * s, eyeY, 0.11 * s, 0.13 * s, C.eyeWhite) +
    cir(x - 0.13 * s, eyeY + 0.02 * s, 0.07 * s, C.eye) +
    cir(x + 0.13 * s, eyeY + 0.02 * s, 0.07 * s, C.eye) +
    cir(x - 0.1 * s, eyeY - 0.02 * s, 0.025 * s, C.eyeWhite) +
    cir(x + 0.16 * s, eyeY - 0.02 * s, 0.025 * s, C.eyeWhite) +
    tri(
      [
        [x - 0.06 * s, y - 0.05 * s],
        [x + 0.06 * s, y - 0.05 * s],
        [x, y + 0.04 * s],
      ],
      C.beak,
      { stroke: C.beakOut, sw: Math.max(1, 0.02 * s) }
    )
  );
};

/** Compact head, shoulders, and ripple used once a penguin reaches a hole. */
const swimmingPenguinArt = (x: number, y: number, s: number): string => {
  const sw = Math.max(1.5, 0.04 * s);
  const eyeY = y - 0.1 * s;
  return (
    ell(x, y + 0.2 * s, 0.28 * s, 0.09 * s, 'transparent', {
      stroke: C.shimmer,
      sw: Math.max(1, 0.03 * s),
      opacity: 0.55,
    }) +
    ell(x, y - 0.02 * s, 0.28 * s, 0.28 * s, C.pen, { stroke: C.penOut, sw }) +
    ell(x, y + 0.06 * s, 0.18 * s, 0.17 * s, C.belly) +
    ell(x - 0.12 * s, eyeY, 0.095 * s, 0.115 * s, C.eyeWhite) +
    ell(x + 0.12 * s, eyeY, 0.095 * s, 0.115 * s, C.eyeWhite) +
    cir(x - 0.1 * s, eyeY + 0.01 * s, 0.06 * s, C.eye) +
    cir(x + 0.1 * s, eyeY + 0.01 * s, 0.06 * s, C.eye) +
    cir(x - 0.07 * s, eyeY - 0.02 * s, 0.02 * s, C.eyeWhite) +
    cir(x + 0.13 * s, eyeY - 0.02 * s, 0.02 * s, C.eyeWhite) +
    tri(
      [
        [x - 0.055 * s, y - 0.02 * s],
        [x + 0.055 * s, y - 0.02 * s],
        [x, y + 0.06 * s],
      ],
      C.beak
    )
  );
};

/** Faceted ice block with snow cap and a soft ground shadow (drawRockInto). */
const rockArt = (x: number, y: number, s: number): string =>
  ell(x, y + 0.33 * s, 0.31 * s, 0.08 * s, '#0a2233', { opacity: 0.3 }) +
  box(x - 0.33 * s, y - 0.2 * s, 0.66 * s, 0.52 * s, 0.12 * s, C.rock, { stroke: C.rockOut, sw: Math.max(2, 0.04 * s) }) +
  ell(x, y - 0.16 * s, 0.29 * s, 0.11 * s, C.rockFacet, { stroke: C.rockOut, sw: Math.max(1, 0.025 * s) }) +
  ell(x, y - 0.2 * s, 0.2 * s, 0.065 * s, C.rockSnow);

/** Seal lying on the ice: tail fluke, body, belly, flipper, raised head, whiskers
 *  (drawSealInto). Drawn horizontally, then rotated a quarter-turn for a vertical seal. */
const sealArt = (x: number, y: number, s: number, vertical: boolean): string => {
  const sw = Math.max(1.5, 0.04 * s);
  const fsw = Math.max(1, 0.03 * s);
  const wh = Math.max(1, 0.012 * s);
  const whisker = (dy: number, rad: number): string => {
    const wx = x + 0.95 * s;
    const wy = y + dy;
    return `<rect x="${n(wx)}" y="${n(wy - wh / 2)}" width="${n(0.22 * s)}" height="${n(wh)}" fill="${C.sealOut}" transform="rotate(${n((rad * 180) / Math.PI)} ${n(wx)} ${n(wy)})" />`;
  };
  const art =
    ell(x - 0.64 * s, y - 0.13 * s, 0.17 * s, 0.1 * s, C.seal, { stroke: C.sealOut, sw: fsw, rot: 0.55 }) +
    ell(x - 0.64 * s, y + 0.13 * s, 0.17 * s, 0.1 * s, C.seal, { stroke: C.sealOut, sw: fsw, rot: -0.55 }) +
    ell(x, y, 0.7 * s, 0.31 * s, C.seal, { stroke: C.sealOut, sw }) +
    ell(x, y + 0.12 * s, 0.5 * s, 0.16 * s, C.sealBelly) +
    ell(x + 0.14 * s, y + 0.24 * s, 0.17 * s, 0.08 * s, C.seal, { stroke: C.sealOut, sw: fsw, rot: 0.3 }) +
    ell(x + 0.62 * s, y - 0.16 * s, 0.31 * s, 0.28 * s, C.seal, { stroke: C.sealOut, sw }) +
    ell(x + 0.8 * s, y - 0.06 * s, 0.13 * s, 0.1 * s, C.sealBelly) +
    cir(x + 0.9 * s, y - 0.08 * s, 0.05 * s, C.sealNose) +
    cir(x + 0.56 * s, y - 0.26 * s, 0.055 * s, C.eye) +
    cir(x + 0.74 * s, y - 0.26 * s, 0.055 * s, C.eye) +
    cir(x + 0.58 * s, y - 0.28 * s, 0.02 * s, C.eyeWhite) +
    cir(x + 0.76 * s, y - 0.28 * s, 0.02 * s, C.eyeWhite) +
    whisker(-0.06 * s, -0.12) +
    whisker(-0.03 * s, 0);
  return vertical ? `<g transform="rotate(90 ${n(x)} ${n(y)})">${art}</g>` : art;
};

const renderBoardPreview = (
  board: Board,
  label: string,
  pieces: readonly Piece[] = board.pieces
): string => {
  const colOf = (i: number): number => i % board.width;
  const rowOf = (i: number): number => Math.floor(i / board.width);
  const cx = (i: number): number => PAD + colOf(i) * CELL + CELL / 2;
  const cy = (i: number): number => PAD + rowOf(i) * CELL + CELL / 2;
  const boardW = board.width * CELL;
  const boardH = board.height * CELL;
  const w = boardW + PAD * 2;
  const h = boardH + PAD * 2;
  // GameScene passes the full cell size into every art helper. Keeping the same
  // scale here makes holes, penguins, seals, and rocks identical at any viewport.
  const S = CELL;
  const parts: string[] = [];

  // One connected ice sheet (paintIceSheet): soft shadow, base, faint scored
  // grid lines, snowy rounded edge.
  const sp = CELL * 0.16;
  const sx = PAD - sp;
  const sy = PAD - sp;
  const sW = boardW + sp * 2;
  const sH = boardH + sp * 2;
  const sr = CELL * 0.34;
  const gsw = Math.max(1, CELL * 0.02);
  parts.push(box(sx + 4, sy + 9, sW, sH, sr, '#06121f', { opacity: 0.45 }));
  parts.push(box(sx, sy, sW, sH, sr, C.sheet));
  for (let c = 1; c < board.width; c++) {
    const gx = PAD + c * CELL;
    parts.push(
      `<line x1="${n(gx)}" y1="${n(PAD + CELL * 0.12)}" x2="${n(gx)}" y2="${n(PAD + boardH - CELL * 0.12)}" stroke="${C.grid}" stroke-width="${n(gsw)}" opacity="0.55" />`
    );
  }
  for (let r = 1; r < board.height; r++) {
    const gy = PAD + r * CELL;
    parts.push(
      `<line x1="${n(PAD + CELL * 0.12)}" y1="${n(gy)}" x2="${n(PAD + boardW - CELL * 0.12)}" y2="${n(gy)}" stroke="${C.grid}" stroke-width="${n(gsw)}" opacity="0.55" />`
    );
  }
  parts.push(
    `<rect x="${n(sx)}" y="${n(sy)}" width="${n(sW)}" height="${n(sH)}" rx="${n(sr)}" fill="none" stroke="${C.sheetEdge}" stroke-width="${n(Math.max(2, CELL * 0.05))}" />`
  );

  // Water holes.
  for (const hole of board.holes) parts.push(holeArt(cx(hole), cy(hole), S));

  // Pieces (penguins, seals, rocks). The outer wrapper owns movement/drag;
  // selection scales only the inner art, matching GameScene's persistent views.
  pieces.forEach((piece, pieceIndex) => {
    let art = '';
    if (piece.kind === 'BLOCKER') {
      art = rockArt(cx(piece.cells[0]), cy(piece.cells[0]), S);
    } else if (piece.kind === 'SLIDER') {
      const last = piece.cells[piece.cells.length - 1];
      const ax = (cx(piece.cells[0]) + cx(last)) / 2;
      const ay = (cy(piece.cells[0]) + cy(last)) / 2;
      const vertical = rowOf(piece.cells[0]) !== rowOf(last);
      art = sealArt(ax, ay, S, vertical);
    } else {
      art = board.holes.includes(piece.cells[0])
        ? swimmingPenguinArt(cx(piece.cells[0]), cy(piece.cells[0]), S)
        : penguinArt(cx(piece.cells[0]), cy(piece.cells[0]), S);
    }
    parts.push(
      `<g data-inline-piece-art="${pieceIndex}"><g data-inline-piece-inner="${pieceIndex}">${art}</g></g>`
    );
  });

  return `<svg class="preview-art" viewBox="0 0 ${w} ${h}" overflow="visible" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${parts.join('')}</svg>`;
};

// Difficulty-dot colours: a small colour-coded cue inside an otherwise cool
// badge, so the warm Play button stays the single dominant accent per screen.
const DIFFICULTY_DOT: Record<Difficulty, string> = {
  EASY: '#5ef0c0',
  MEDIUM: '#ffd166',
  HARD: '#ff8a5b',
  EXPERT: '#b59bff',
};

let renderedKind: 'daily' | 'ugc' | null = null;
let ugcBoardRendered = false;
let legacyKeyboardStartPending = false;

const paintBadge = (difficulty: Difficulty, prefix = ''): void => {
  const badge = document.getElementById('badge');
  if (badge) {
    badge.innerHTML = `<span class="dot" style="background:${DIFFICULTY_DOT[difficulty]}"></span>${prefix}${difficulty}`;
  }
  document.getElementById('credit')?.removeAttribute('hidden');
};

// Community layouts are not timed, so their exact board is the strongest feed
// thumbnail: players can understand the challenge before opening it.
const renderUgcStatic = (board: Board, difficulty: Difficulty, creator: string): void => {
  if (!ugcBoardRendered) {
    document.body.classList.add('puzzle-preview', 'ugc');
    const hero = document.getElementById('hero');
    if (hero) {
      hero.innerHTML = renderBoardPreview(board, 'Community puzzle board preview');
    }
    ugcBoardRendered = true;
  }

  paintBadge(difficulty);
  const byline = document.getElementById('byline');
  if (byline) byline.textContent = `by u/${creator}`;
  setIdleStartLabel('Play this puzzle');
  if (meta) meta.textContent = 'Community puzzle';
  renderedKind = 'ugc';
};

const applyUgcStatus = (solved: boolean, solves: number): void => {
  setIdleStartLabel(solved ? 'Play again' : 'Play this puzzle');
  if (meta) {
    meta.textContent =
      solves > 0
        ? `Community puzzle \u00B7 ${solves} ${solves === 1 ? 'solve' : 'solves'}`
        : 'Community puzzle \u00B7 be the first to solve!';
  }
};

const formatDailyDate = (date: string): string =>
  new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

const paintDailyMetadata = (
  difficulty: Difficulty,
  date?: string
): void => {
  const isToday = date === todayUtc();
  paintBadge(difficulty, isToday ? 'Today: ' : 'Daily: ');
  const byline = document.getElementById('byline');
  if (byline) byline.textContent = '';
  const tag = document.querySelector('.tag');
  if (tag) tag.textContent = 'Get every penguin into the water!';
  setIdleStartLabel(isToday ? "Play today's puzzle" : 'Play this puzzle');
  if (meta) {
    const label = date ? formatDailyDate(date) : 'Daily puzzle';
    meta.textContent = context.username ? `${label} \u00B7 hi ${context.username}` : label;
  }
  renderedKind = 'daily';
};

const setLegacyConnecting = (): void => {
  if (!startButton) return;
  setIdleStartLabel(`Connecting to ${renderedKind === 'ugc' ? 'Community' : 'Daily'}…`);
  startButton.disabled = true;
  startButton.setAttribute('aria-busy', 'true');
};

const beginInlinePuzzle = (restoreKeyboardFocus = false): void => {
  legacyKeyboardStartPending = restoreKeyboardFocus;
  if (!inlinePuzzle) return;
  setLegacyConnecting();
  inlinePuzzle.start(restoreKeyboardFocus);
};

const showLegacyHydrationError = (): void => {
  const restoreKeyboardFocus = legacyKeyboardStartPending;
  legacyKeyboardStartPending = false;
  if (!startButton) return;
  startButton.removeAttribute('aria-busy');
  startButton.disabled = false;
  setIdleStartLabel(
    `Retry inline ${renderedKind === 'ugc' ? 'Community puzzle' : 'Daily'}`
  );
  if (restoreKeyboardFocus) {
    queueMicrotask(() => startButton.focus({ preventScroll: true }));
  }
};

const renderDailyStatic = (snapshot: DailySplashSnapshotV2): void => {
  if (renderedKind === 'ugc') return;
  document.body.classList.add('puzzle-preview');
  document.body.classList.remove('ugc');
  const hero = document.getElementById('hero');
  if (hero) {
    hero.innerHTML = renderBoardPreview(
      snapshot.board,
      `Daily puzzle board for ${formatDailyDate(snapshot.date)}`
    );
  }
  paintDailyMetadata(snapshot.difficulty, snapshot.date);
};

const applyDailySnapshot = (snapshot: DailySplashSnapshotV2): void => {
  if (!inlinePuzzle && initializeInlinePuzzle({ kind: 'daily', snapshot })) return;
  if (inlinePuzzle) {
    if (!inlinePuzzle.applySnapshot(snapshot)) {
      console.error('Daily preview did not match the active inline puzzle.');
    }
    return;
  }
  renderDailyStatic(snapshot);
};

const applyUgcSnapshot = (
  snapshot: UgcSplashSnapshotV2,
  solved: boolean,
  solves: number
): void => {
  if (!inlinePuzzle && initializeInlinePuzzle({ kind: 'ugc', snapshot })) return;
  if (inlinePuzzle) {
    if (!inlinePuzzle.applySnapshot(snapshot)) {
      console.error('Community preview did not match the active inline puzzle.');
    }
    return;
  }
  renderUgcStatic(snapshot.board, snapshot.difficulty, snapshot.creator);
  applyUgcStatus(solved, solves);
};

// Reconcile current postData with live status, and automatically upgrade old
// metadata/count-only Daily posts to their exact immutable playable snapshot.
// This route is read-only and never issues a Daily `playId`.
const loadPostPreview = async (): Promise<void> => {
  try {
    const response = await fetch('/api/post-preview', { cache: 'no-store' });
    if (!response.ok) return;
    const raw: unknown = await response.json();
    const data = parsePostPreviewResponse(raw);
    if (!data) return;
    if (data.kind === 'ugc') {
      applyUgcSnapshot(data, data.solved, data.solves);
      return;
    }

    applyDailySnapshot(data);
  } catch (error) {
    console.error(error);
  }
};

// Exact V2 postData starts the real inline board synchronously. Historical
// metadata/unversioned posts stay recognizable and upgrade through the
// read-only `/api/post-preview` route without constructing a fake identity.
type InlineBootstrap =
  | { readonly kind: 'daily'; readonly snapshot: DailySplashSnapshotV2 | null }
  | { readonly kind: 'ugc'; readonly snapshot: UgcSplashSnapshotV2 | null };

const renderFromPostData = (): InlineBootstrap | null => {
  try {
    const raw = context.postData?.[POST_DATA_SPLASH_KEY];
    if (typeof raw !== 'string') return null;
    const value: unknown = JSON.parse(raw);
    const data = parseSplashPostData(value);
    if (!data) return null;
    if (data.kind === 'ugc') {
      renderedKind = 'ugc';
      if ('version' in data) return { kind: 'ugc', snapshot: data };
      renderUgcStatic(data.board, data.difficulty, data.creator);
      return { kind: 'ugc', snapshot: null };
    }
    renderedKind = 'daily';
    if ('version' in data) return { kind: 'daily', snapshot: data };
    paintDailyMetadata(data.difficulty, data.date);
    return { kind: 'daily', snapshot: null };
  } catch (error) {
    console.error(error);
    return null;
  }
};

const initialPuzzle = renderFromPostData();
const inlineRootElement = document.getElementById('inline-daily');
const postId = typeof context.postId === 'string' ? context.postId : '';

const initializeInlinePuzzle = (puzzle: InlineBootstrap): boolean => {
  if (inlinePuzzle) return inlinePuzzleKind === puzzle.kind;
  if (!(inlineRootElement instanceof HTMLElement)) return false;
  renderedKind = puzzle.kind;
  try {
    const common = {
      root: inlineRootElement,
      postId,
      renderBoard: (board: Board, pieces: readonly Piece[], label: string) =>
        renderBoardPreview(board, label, pieces),
      openExpanded: (
        event: MouseEvent,
        intent: LaunchIntent,
        beforeRequest?: () => boolean
      ) => openExpanded(event, intent, beforeRequest),
      onLegacyHydrationError: showLegacyHydrationError,
      onHydrated: () => {
        legacyKeyboardStartPending = false;
      },
    };
    inlinePuzzle =
      puzzle.kind === 'daily'
        ? createInlineDaily({
            ...common,
            ...(puzzle.snapshot ? { snapshot: puzzle.snapshot } : {}),
          })
        : createInlineCommunity({
            ...common,
            ...(puzzle.snapshot ? { snapshot: puzzle.snapshot } : {}),
          });
    inlinePuzzleKind = puzzle.kind;
    inlinePuzzle.setExpansionPending(launchPending);
    if (puzzle.snapshot) inlinePuzzle.start();
    return true;
  } catch (error) {
    console.error(error);
    inlinePuzzle = null;
    inlinePuzzleKind = null;
    return false;
  }
};

try {
  if (initialPuzzle && !initializeInlinePuzzle(initialPuzzle)) {
    if (initialPuzzle.snapshot?.kind === 'daily') {
      renderDailyStatic(initialPuzzle.snapshot);
    } else if (initialPuzzle.snapshot?.kind === 'ugc') {
      renderUgcStatic(
        initialPuzzle.snapshot.board,
        initialPuzzle.snapshot.difficulty,
        initialPuzzle.snapshot.creator
      );
    }
  }
} finally {
  document.body.classList.remove('splash-booting');
}

void loadPostPreview();
