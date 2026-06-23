import { context, requestExpandedMode } from '@devvit/web/client';
import type { InitResponse } from '../shared/api';
import type { Board } from '../shared/game/types';

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
// small, light SVG preview of that exact board (no Phaser here - the splash must
// stay fast) plus a "Puzzle by u/creator" credit, so the feed post shows the
// actual puzzle.

const PREVIEW = {
  sheet: '#bfe3f2',
  sheetEdge: '#7fb4d4',
  tile: '#d7eef8',
  waterFill: '#0e3a55',
  waterRim: '#1d6f9c',
  waterShimmer: '#7fe0ff',
  penguin: '#2b3440',
  penguinEdge: '#141a22',
  belly: '#f4f9fc',
  beak: '#f6a623',
  eye: '#15202b',
  seal: '#6b7b8c',
  sealBelly: '#aebecb',
  sealEdge: '#54616e',
  rock: '#9fb6c6',
  rockEdge: '#7c95a8',
  rockCap: '#eef7fc',
} as const;

const CELL = 40;
const PAD = 8;

const renderBoardPreview = (board: Board): string => {
  const colOf = (i: number): number => i % board.width;
  const rowOf = (i: number): number => Math.floor(i / board.width);
  const cx = (i: number): number => PAD + colOf(i) * CELL + CELL / 2;
  const cy = (i: number): number => PAD + rowOf(i) * CELL + CELL / 2;
  const w = board.width * CELL + PAD * 2;
  const h = board.height * CELL + PAD * 2;
  const parts: string[] = [];

  // One connected ice sheet under the grid.
  parts.push(
    `<rect x="${PAD - 4}" y="${PAD - 4}" width="${board.width * CELL + 8}" height="${
      board.height * CELL + 8
    }" rx="14" fill="${PREVIEW.sheet}" stroke="${PREVIEW.sheetEdge}" stroke-width="3" />`
  );
  // Subtle per-cell tiles.
  for (let i = 0; i < board.width * board.height; i++) {
    const x = PAD + colOf(i) * CELL;
    const y = PAD + rowOf(i) * CELL;
    parts.push(
      `<rect x="${x + 3}" y="${y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="7" fill="${PREVIEW.tile}" opacity="0.6" />`
    );
  }
  // Water holes carved into the sheet.
  for (const hole of board.holes) {
    parts.push(`<circle cx="${cx(hole)}" cy="${cy(hole)}" r="${CELL * 0.34}" fill="${PREVIEW.waterRim}" />`);
    parts.push(`<circle cx="${cx(hole)}" cy="${cy(hole)}" r="${CELL * 0.27}" fill="${PREVIEW.waterFill}" />`);
    parts.push(
      `<ellipse cx="${cx(hole) - CELL * 0.07}" cy="${cy(hole) - CELL * 0.08}" rx="${CELL * 0.12}" ry="${
        CELL * 0.06
      }" fill="${PREVIEW.waterShimmer}" opacity="0.7" />`
    );
  }
  // Pieces.
  for (const piece of board.pieces) {
    if (piece.kind === 'BLOCKER') {
      const x = cx(piece.cells[0]);
      const y = cy(piece.cells[0]);
      const s = CELL * 0.64;
      parts.push(
        `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="8" fill="${PREVIEW.rock}" stroke="${PREVIEW.rockEdge}" stroke-width="2" />`
      );
      parts.push(
        `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s * 0.32}" rx="6" fill="${PREVIEW.rockCap}" opacity="0.9" />`
      );
    } else if (piece.kind === 'SLIDER') {
      const xs = piece.cells.map(cx);
      const ys = piece.cells.map(cy);
      const m = CELL * 0.34;
      const x = Math.min(...xs) - m;
      const y = Math.min(...ys) - m;
      const bw = Math.max(...xs) - Math.min(...xs) + m * 2;
      const bh = Math.max(...ys) - Math.min(...ys) + m * 2;
      parts.push(
        `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${CELL * 0.3}" fill="${PREVIEW.seal}" stroke="${PREVIEW.sealEdge}" stroke-width="2" />`
      );
      parts.push(
        `<rect x="${x + bw * 0.18}" y="${y + bh * 0.34}" width="${bw * 0.64}" height="${bh * 0.4}" rx="${
          Math.min(bw, bh) * 0.22
        }" fill="${PREVIEW.sealBelly}" opacity="0.85" />`
      );
    } else {
      // HOPPER penguin.
      const x = cx(piece.cells[0]);
      const y = cy(piece.cells[0]);
      parts.push(
        `<ellipse cx="${x}" cy="${y}" rx="${CELL * 0.3}" ry="${CELL * 0.34}" fill="${PREVIEW.penguin}" stroke="${PREVIEW.penguinEdge}" stroke-width="2" />`
      );
      parts.push(`<ellipse cx="${x}" cy="${y + CELL * 0.05}" rx="${CELL * 0.17}" ry="${CELL * 0.22}" fill="${PREVIEW.belly}" />`);
      parts.push(
        `<circle cx="${x - CELL * 0.1}" cy="${y - CELL * 0.12}" r="${CELL * 0.055}" fill="#ffffff" />` +
          `<circle cx="${x + CELL * 0.1}" cy="${y - CELL * 0.12}" r="${CELL * 0.055}" fill="#ffffff" />`
      );
      parts.push(
        `<circle cx="${x - CELL * 0.09}" cy="${y - CELL * 0.11}" r="${CELL * 0.028}" fill="${PREVIEW.eye}" />` +
          `<circle cx="${x + CELL * 0.11}" cy="${y - CELL * 0.11}" r="${CELL * 0.028}" fill="${PREVIEW.eye}" />`
      );
      parts.push(
        `<polygon points="${x - CELL * 0.05},${y - CELL * 0.01} ${x + CELL * 0.05},${y - CELL * 0.01} ${x},${
          y + CELL * 0.07
        }" fill="${PREVIEW.beak}" />`
      );
    }
  }

  return `<svg class="preview-art" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Community puzzle board preview">${parts.join('')}</svg>`;
};

const showUgcPost = (
  puzzle: { readonly board: Board; readonly creator: string; readonly solves: number },
  solved: boolean
): void => {
  const hero = document.getElementById('hero');
  if (hero) hero.innerHTML = renderBoardPreview(puzzle.board);

  const byline = document.getElementById('byline');
  if (byline) {
    byline.textContent = `Puzzle by u/${puzzle.creator}`;
    byline.removeAttribute('hidden');
  }

  if (startButton) startButton.textContent = solved ? 'Play again' : 'Play this puzzle';

  const how = document.getElementById('how');
  if (how) how.textContent = 'A community puzzle. Tap a penguin to hop, drag a seal to slide.';

  if (meta) {
    const plays = puzzle.solves > 0 ? ` \u00B7 ${puzzle.solves} ${puzzle.solves === 1 ? 'solve' : 'solves'}` : '';
    meta.textContent = `Community puzzle${plays}`;
  }
};

// Ask the server what this post is. A community-puzzle post swaps the hero for a
// preview of its board; a daily post is left as-is.
const loadPostContext = async (): Promise<void> => {
  try {
    const response = await fetch('/api/init');
    if (!response.ok) return;
    const data: InitResponse = await response.json();
    if (data.kind === 'ugc') showUgcPost(data.puzzle, data.solved);
  } catch (error) {
    console.error(error);
  }
};

void loadPostContext();
