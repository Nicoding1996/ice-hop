import { context, requestExpandedMode } from '@devvit/web/client';
import type {
  DailyBoardTeaser,
  PostPreviewResponse,
  SplashPostData,
} from '../shared/api';
import { POST_DATA_SPLASH_KEY } from '../shared/api';
import { todayUtc } from '../shared/date';
import { isDailyDate } from '../shared/daily';
import type { Board, Piece } from '../shared/game/types';
import { validateBoardStructure } from '../shared/game/validation';
import type { Difficulty } from '../shared/solver/difficulty';

// --- Launch actions ----------------------------------------------------------

const startElement = document.getElementById('start-button');
const startButton = startElement instanceof HTMLButtonElement ? startElement : null;
const exploreElement = document.getElementById('explore-button');
const exploreButton = exploreElement instanceof HTMLButtonElement ? exploreElement : null;
type ExpandedModeEvent = Parameters<typeof requestExpandedMode>[0];
type LaunchIntent = 'play' | 'home';

let launchPending = false;
let launchResetTimer: number | undefined;
let idleStartLabel = startButton?.textContent ?? "Play today's puzzle";

const clearLaunchIntent = (): void => {
  try {
    localStorage.removeItem('icehop.launch');
  } catch {
    /* localStorage is an optimization; default launch still opens the post */
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
  document.body.classList.remove('opening');
  startButton?.removeAttribute('aria-busy');
  exploreButton?.removeAttribute('aria-busy');
  if (startButton) {
    startButton.disabled = false;
    startButton.textContent = idleStartLabel;
  }
  if (exploreButton) exploreButton.disabled = false;
};

const openExpanded = (event: ExpandedModeEvent, intent: LaunchIntent): void => {
  if (launchPending) return;
  launchPending = true;
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
      localStorage.setItem('icehop.launch', 'home');
    } catch {
      /* localStorage unavailable - Boot will play the host post */
    }
  }

  try {
    // Keep this synchronous inside the click handler so Reddit retains the user gesture.
    requestExpandedMode(event, 'game');
    // If expansion fails silently, clear any one-shot route and restore the card.
    launchResetTimer = window.setTimeout(() => resetLaunchState(true), 4000);
  } catch (error) {
    console.error(error);
    resetLaunchState(true);
  }
};

startButton?.addEventListener('click', (event) => openExpanded(event, 'play'));
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

// --- Community-puzzle preview ------------------------------------------------
// Daily posts use a spoiler-safe synthetic board. Community-puzzle posts
// swap in the exact validated board because they are not timed. Both previews
// mirror the in-game Phaser draw helpers (art/theme.ts): same proportions and
// palette, emitted as static SVG so the splash stays Phaser-free and fast.

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

const parseDailyBoardTeaser = (value: unknown): DailyBoardTeaser | null => {
  if (!isObject(value)) return null;
  const width = property(value, 'width');
  const height = property(value, 'height');
  const hoppers = property(value, 'hoppers');
  const sliders = property(value, 'sliders');
  const blockers = property(value, 'blockers');
  const holes = property(value, 'holes');
  const values = [width, height, hoppers, sliders, blockers, holes];
  if (
    values.some(
      (entry) =>
        typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0
    ) ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    typeof hoppers !== 'number' ||
    typeof sliders !== 'number' ||
    typeof blockers !== 'number' ||
    typeof holes !== 'number' ||
    width < 1 ||
    height < 1 ||
    width > 20 ||
    height > 20
  ) {
    return null;
  }
  const cells = width * height;
  if (
    holes > cells ||
    hoppers !== holes ||
    hoppers + blockers + sliders * 2 > cells
  ) {
    return null;
  }
  return { width, height, hoppers, sliders, blockers, holes };
};

const parseSplashPostData = (value: unknown): SplashPostData | null => {
  if (!isObject(value)) return null;
  const kind = property(value, 'kind');
  const difficulty = readDifficulty(property(value, 'difficulty'));
  if (!difficulty) return null;

  if (kind === 'daily') {
    const dateValue = property(value, 'date');
    if (dateValue !== undefined && !isDailyDate(dateValue)) return null;
    const teaserValue = property(value, 'teaser');
    if (teaserValue === undefined) {
      return dateValue === undefined
        ? { kind, difficulty }
        : { kind, date: dateValue, difficulty };
    }
    const teaser = parseDailyBoardTeaser(teaserValue);
    if (!teaser) return null;
    return dateValue === undefined
      ? { kind, difficulty, teaser }
      : { kind, date: dateValue, difficulty, teaser };
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
    const date = property(value, 'date');
    const teaser = parseDailyBoardTeaser(property(value, 'teaser'));
    return isDailyDate(date) && teaser
      ? { type: 'post-preview', kind, date, difficulty, teaser }
      : null;
  }
  if (kind !== 'ugc') return null;

  const creator = property(value, 'creator');
  const solves = property(value, 'solves');
  const solved = property(value, 'solved');
  const structure = validateBoardStructure(property(value, 'board'));
  if (
    typeof creator !== 'string' ||
    creator.length < 1 ||
    creator.length > 100 ||
    typeof solves !== 'number' ||
    !Number.isSafeInteger(solves) ||
    solves < 0 ||
    typeof solved !== 'boolean' ||
    !structure.ok
  ) {
    return null;
  }
  return {
    type: 'post-preview',
    kind,
    board: structure.board,
    difficulty,
    creator,
    solves,
    solved,
  };
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

const renderBoardPreview = (board: Board, label: string): string => {
  const colOf = (i: number): number => i % board.width;
  const rowOf = (i: number): number => Math.floor(i / board.width);
  const cx = (i: number): number => PAD + colOf(i) * CELL + CELL / 2;
  const cy = (i: number): number => PAD + rowOf(i) * CELL + CELL / 2;
  const boardW = board.width * CELL;
  const boardH = board.height * CELL;
  const w = boardW + PAD * 2;
  const h = boardH + PAD * 2;
  const S = CELL * 0.9; // piece size, a hair under the cell like the real board
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
  parts.push(box(sx + 2, sy + 4, sW, sH, sr, '#06121f', { opacity: 0.45 }));
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

  // Pieces (penguins, seals, rocks).
  for (const piece of board.pieces) {
    if (piece.kind === 'BLOCKER') {
      parts.push(rockArt(cx(piece.cells[0]), cy(piece.cells[0]), S));
    } else if (piece.kind === 'SLIDER') {
      const last = piece.cells[piece.cells.length - 1];
      const ax = (cx(piece.cells[0]) + cx(last)) / 2;
      const ay = (cy(piece.cells[0]) + cy(last)) / 2;
      const vertical = rowOf(piece.cells[0]) !== rowOf(last);
      parts.push(sealArt(ax, ay, S, vertical));
    } else {
      parts.push(penguinArt(cx(piece.cells[0]), cy(piece.cells[0]), S));
    }
  }

  return `<svg class="preview-art" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${parts.join('')}</svg>`;
};

// The Daily teaser mirrors the real board's dimensions and piece counts, but
// places everything at synthetic anchors. It feels like the game while keeping
// the actual layout unavailable until /api/init starts the play clock.
type Anchor = readonly [number, number];
type SliderCandidate = {
  readonly cells: readonly [number, number];
  readonly orient: 'H' | 'V';
  readonly distance: number;
};

const HOLE_ANCHORS: readonly Anchor[] = [
  [0.86, 0.14],
  [0.14, 0.84],
  [0.86, 0.84],
];
const SLIDER_ANCHORS: readonly Anchor[] = [
  [0.42, 0.24],
  [0.72, 0.54],
];
const BLOCKER_ANCHORS: readonly Anchor[] = [
  [0.5, 0.52],
  [0.22, 0.42],
];
const HOPPER_ANCHORS: readonly Anchor[] = [
  [0.14, 0.14],
  [0.5, 0.84],
  [0.82, 0.66],
];

const buildDailyTeaserBoard = (teaser: DailyBoardTeaser): Board => {
  const { width, height } = teaser;
  const cellCount = width * height;
  const occupied = new Set<number>();
  const holes: number[] = [];
  const pieces: Piece[] = [];
  const allCells = Array.from({ length: cellCount }, (_, index) => index);
  const distanceTo = (cell: number, anchor: Anchor): number => {
    const col = cell % width;
    const row = Math.floor(cell / width);
    const targetCol = anchor[0] * Math.max(0, width - 1);
    const targetRow = anchor[1] * Math.max(0, height - 1);
    return (col - targetCol) ** 2 + (row - targetRow) ** 2;
  };
  const takeCell = (anchor: Anchor): number | null => {
    const candidates = allCells
      .filter((cell) => !occupied.has(cell))
      .sort((a, b) => distanceTo(a, anchor) - distanceTo(b, anchor) || a - b);
    const cell = candidates[0];
    if (cell === undefined) return null;
    occupied.add(cell);
    return cell;
  };

  for (let index = 0; index < teaser.holes; index++) {
    const anchor = HOLE_ANCHORS[index % HOLE_ANCHORS.length] ?? [0.5, 0.5];
    const cell = takeCell(anchor);
    if (cell !== null) holes.push(cell);
  }

  const placeSlider = (orient: 'H' | 'V', anchor: Anchor): boolean => {
    const candidates: SliderCandidate[] = [];
    for (let cell = 0; cell < cellCount; cell++) {
      const col = cell % width;
      const row = Math.floor(cell / width);
      const second = orient === 'H' ? cell + 1 : cell + width;
      if ((orient === 'H' && col + 1 >= width) || (orient === 'V' && row + 1 >= height)) {
        continue;
      }
      const midCol = orient === 'H' ? col + 0.5 : col;
      const midRow = orient === 'V' ? row + 0.5 : row;
      const targetCol = anchor[0] * Math.max(0, width - 1);
      const targetRow = anchor[1] * Math.max(0, height - 1);
      candidates.push({
        cells: [cell, second],
        orient,
        distance: (midCol - targetCol) ** 2 + (midRow - targetRow) ** 2,
      });
    }
    const winner = candidates
      .sort((a, b) => a.distance - b.distance || a.cells[0] - b.cells[0])
      .find(({ cells }) => !occupied.has(cells[0]) && !occupied.has(cells[1]));
    if (!winner) return false;
    occupied.add(winner.cells[0]);
    occupied.add(winner.cells[1]);
    pieces.push({ kind: 'SLIDER', cells: winner.cells, orient: winner.orient });
    return true;
  };

  for (let index = 0; index < teaser.sliders; index++) {
    const anchor = SLIDER_ANCHORS[index % SLIDER_ANCHORS.length] ?? [0.5, 0.5];
    const preferred: 'H' | 'V' = index % 2 === 0 ? 'H' : 'V';
    if (!placeSlider(preferred, anchor)) {
      void placeSlider(preferred === 'H' ? 'V' : 'H', anchor);
    }
  }

  for (let index = 0; index < teaser.blockers; index++) {
    const anchor = BLOCKER_ANCHORS[index % BLOCKER_ANCHORS.length] ?? [0.5, 0.5];
    const cell = takeCell(anchor);
    if (cell !== null) pieces.push({ kind: 'BLOCKER', cells: [cell] });
  }
  for (let index = 0; index < teaser.hoppers; index++) {
    const anchor = HOPPER_ANCHORS[index % HOPPER_ANCHORS.length] ?? [0.5, 0.5];
    const cell = takeCell(anchor);
    if (cell !== null) pieces.push({ kind: 'HOPPER', cells: [cell] });
  }

  return { width, height, holes: holes.sort((a, b) => a - b), pieces };
};

const FALLBACK_DAILY_TEASER: Record<Difficulty, DailyBoardTeaser> = {
  EASY: { width: 5, height: 5, hoppers: 1, sliders: 0, blockers: 1, holes: 1 },
  MEDIUM: { width: 5, height: 5, hoppers: 2, sliders: 1, blockers: 1, holes: 2 },
  HARD: { width: 5, height: 5, hoppers: 2, sliders: 2, blockers: 2, holes: 2 },
  EXPERT: { width: 5, height: 5, hoppers: 3, sliders: 2, blockers: 2, holes: 3 },
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
let renderedDailyKey = '';
let ugcBoardRendered = false;

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
    document.body.classList.remove('daily-preview');
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

const renderDailyStatic = (
  difficulty: Difficulty,
  teaser = FALLBACK_DAILY_TEASER[difficulty],
  date?: string
): void => {
  if (renderedKind === 'ugc') return;
  const key = `${date ?? 'legacy'}:${difficulty}:${teaser.width}:${teaser.height}:${teaser.hoppers}:${teaser.sliders}:${teaser.blockers}:${teaser.holes}`;
  const isToday = date === todayUtc();
  if (key !== renderedDailyKey) {
    document.body.classList.add('puzzle-preview', 'daily-preview');
    document.body.classList.remove('ugc');
    const board = buildDailyTeaserBoard(teaser);
    const hero = document.getElementById('hero');
    if (hero) {
      const boardLabel = isToday ? "today's puzzle" : 'this Daily puzzle';
      hero.innerHTML = `<div class="daily-teaser"><div class="daily-preview-shell">${renderBoardPreview(
        board,
        `Frosted illustration of ${boardLabel}`
      )}<div class="daily-frost" aria-hidden="true"></div></div><span class="daily-reveal"><span class="daily-reveal-icon" aria-hidden="true">&#10052;</span>Board hidden until Play</span></div>`;
    }
    renderedDailyKey = key;
  }

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

// Refine static postData with live Community status or a legacy Daily's actual
// counts. This endpoint is read-only: it never issues a Daily play.
const loadPostPreview = async (): Promise<void> => {
  try {
    const response = await fetch('/api/post-preview', { cache: 'no-store' });
    if (!response.ok) return;
    const raw: unknown = await response.json();
    const data = parsePostPreviewResponse(raw);
    if (!data) return;
    if (data.kind === 'ugc') {
      renderUgcStatic(data.board, data.difficulty, data.creator);
      applyUgcStatus(data.solved, data.solves);
    } else {
      renderDailyStatic(data.difficulty, data.teaser, data.date);
    }
  } catch (error) {
    console.error(error);
  }
};

// Paint from postData first for an instant feed card. Runtime parsing keeps a
// malformed post payload from reaching the SVG renderer. A complete Daily
// teaser needs no follow-up request; Community still refreshes live solve state.
const renderFromPostData = (): boolean => {
  try {
    const raw = context.postData?.[POST_DATA_SPLASH_KEY];
    if (typeof raw !== 'string') return false;
    const value: unknown = JSON.parse(raw);
    const data = parseSplashPostData(value);
    if (!data) return false;
    if (data.kind === 'ugc') {
      renderUgcStatic(data.board, data.difficulty, data.creator);
      return false;
    }
    renderDailyStatic(data.difficulty, data.teaser, data.date);
    return data.teaser !== undefined && data.date !== undefined;
  } catch (error) {
    console.error(error);
    return false;
  }
};

const hasCompleteDailyPostData = renderFromPostData();
if (!hasCompleteDailyPostData) void loadPostPreview();
