import { context, requestExpandedMode } from '@devvit/web/client';
import type { InitResponse, InitUgcPuzzle, SplashPostData } from '../shared/api';
import { POST_DATA_SPLASH_KEY } from '../shared/api';
import type { Board } from '../shared/game/types';
import type { Difficulty } from '../shared/solver/difficulty';

// --- Buttons -----------------------------------------------------------------

const startButton = document.getElementById('start-button');
startButton?.addEventListener('click', (e) => {
  // Play the current post's puzzle. Clear any stale build intent so the expanded
  // view opens straight onto the board.
  try {
    localStorage.removeItem('icehop.launch');
  } catch {
    /* ignore */
  }
  // Open the expanded Phaser view (the 'game' entrypoint in devvit.json).
  requestExpandedMode(e, 'game');
});

const buildButton = document.getElementById('build-button');
buildButton?.addEventListener('click', (e) => {
  // Stash an intent the expanded view's Boot scene reads to open the editor.
  // (Build is also reachable from the in-game menu, so this is a shortcut.)
  try {
    localStorage.setItem('icehop.launch', 'build');
  } catch {
    /* ignore */
  }
  requestExpandedMode(e, 'game');
});

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
// A daily post keeps the static penguin hero. A community-puzzle post swaps in a
// preview of that exact board. The art below is a faithful, 1:1 port of the
// in-game Phaser draw helpers (art/theme.ts) - same proportions, same palette -
// emitted as static SVG so the splash stays Phaser-free and fast. So the feed
// preview looks like the real puzzle, not a simplified stand-in.

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

const renderBoardPreview = (board: Board): string => {
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

  return `<svg class="preview-art" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Community puzzle board preview">${parts.join('')}</svg>`;
};

// Difficulty-dot colours: a small colour-coded cue inside an otherwise cool
// badge, so the warm Play button stays the single dominant accent per screen.
const DIFFICULTY_DOT: Record<Difficulty, string> = {
  EASY: '#5ef0c0',
  MEDIUM: '#ffd166',
  HARD: '#ff8a5b',
  EXPERT: '#b59bff',
};

// Whether the community board has been painted yet (from postData or /api/init),
// so the two paths never double-render it.
let boardRendered = false;

// The static half of a community card (board + difficulty badge + credit + how).
// Drawn from postData on first paint when available, else from /api/init.
const renderUgcStatic = (board: Board, difficulty: Difficulty, creator: string): void => {
  if (boardRendered) return;
  // Switch the splash into "community puzzle" layout: the board becomes the
  // hero (bigger), the wordmark shrinks, and the tagline gives way to credit.
  document.body.classList.add('ugc');

  const hero = document.getElementById('hero');
  if (hero) hero.innerHTML = renderBoardPreview(board);

  // Difficulty badge + creator credit share one row, with a colour-coded dot.
  const badge = document.getElementById('badge');
  if (badge) {
    badge.innerHTML = `<span class="dot" style="background:${DIFFICULTY_DOT[difficulty]}"></span>${difficulty}`;
  }
  const byline = document.getElementById('byline');
  if (byline) byline.textContent = `by u/${creator}`;
  document.getElementById('credit')?.removeAttribute('hidden');

  const how = document.getElementById('how');
  if (how) how.textContent = 'Tap a penguin to hop, drag a seal to slide.';

  // Neutral meta until /api/init brings the live solve count.
  if (meta) meta.textContent = 'Community puzzle';
  boardRendered = true;
};

// The live half only /api/init knows: the solved-state button label and the
// social-proof solve count (or an inviting empty state).
const applyUgcStatus = (solved: boolean, solves: number): void => {
  if (startButton) startButton.textContent = solved ? 'Play again' : 'Play this puzzle';
  if (meta) {
    meta.textContent =
      solves > 0
        ? `Community puzzle \u00B7 ${solves} ${solves === 1 ? 'solve' : 'solves'}`
        : 'Community puzzle \u00B7 be the first to solve!';
  }
};

const showUgcPost = (puzzle: InitUgcPuzzle, solved: boolean): void => {
  renderUgcStatic(puzzle.board, puzzle.difficulty, puzzle.creator);
  applyUgcStatus(solved, puzzle.solves);
};

// Ask the server what this post is. A community-puzzle post swaps the hero for a
// preview of its board; a daily post is left as-is.
const showDailyBadge = (difficulty: Difficulty): void => {
  // Spoiler-free enticement on the daily card: show only the band (never the
  // board or par), which ties into the weekly difficulty ramp ("today is Hard").
  const badge = document.getElementById('badge');
  if (badge) {
    badge.innerHTML = `<span class="dot" style="background:${DIFFICULTY_DOT[difficulty]}"></span>Today: ${difficulty}`;
  }
  document.getElementById('credit')?.removeAttribute('hidden');
};

const loadPostContext = async (): Promise<void> => {
  try {
    const response = await fetch('/api/init');
    if (!response.ok) return;
    const data: InitResponse = await response.json();
    if (data.kind === 'ugc') showUgcPost(data.puzzle, data.solved);
    else if (data.kind === 'daily') showDailyBadge(data.difficulty);
  } catch (error) {
    console.error(error);
  }
};

// Paint the card from postData first (instant, no network), then refine with
// /api/init for the live bits (solve count + solved state). Posts created before
// postData existed have no payload, so they fall back to the /api/init render.
const renderFromPostData = (): void => {
  try {
    const raw = context.postData?.[POST_DATA_SPLASH_KEY];
    if (typeof raw !== 'string') return;
    const data: SplashPostData = JSON.parse(raw);
    if (data.kind === 'ugc') renderUgcStatic(data.board, data.difficulty, data.creator);
    else if (data.kind === 'daily') showDailyBadge(data.difficulty);
  } catch (error) {
    console.error(error);
  }
};

renderFromPostData();
void loadPostContext();
