// Phone-sized UI smoke test: `npm run test:ui` (builds first).
//
// Drives the built feed post (splash.html) and the full game (game.html) in a
// headless Chrome/Edge with touch emulation against a local mock API, then:
// - plays the Daily and Community fixtures to a server-replayed win by tapping
//   the same controls a player would (penguin -> destination, seal -> stop);
// - drags seals by touch where the feed allows it;
// - asserts every feed state fits its card without inner scrolling (Reddit
//   rejects inline posts that need it) and the header text is not truncated;
// - fails on any page exception.
// Screenshots land in .ui-smoke/ for a quick visual review.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Board, Piece } from '../../src/shared/game/types';
import { applyMove } from '../../src/shared/game/rules';
import { slideStop } from '../../src/shared/game/slide';
import { solve } from '../../src/shared/solver/solver';
import { findBrowser, launchBrowser, sleep, type Page } from './cdp';
import { FIXTURES, startServer, type SmokeServer } from './server';

const OUT_DIR = resolve('.ui-smoke');
const failures: string[] = [];
let checks = 0;

const check = (name: string, ok: boolean, detail = ''): void => {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` (${detail})` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
};

const STAGE_FIT = `(() => {
  const stage = document.querySelector('.inline-stage');
  if (!stage) return 'no stage';
  const bounds = stage.getBoundingClientRect();
  const overflowing = Array.from(stage.querySelectorAll('*')).some((el) => {
    const box = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' && box.height > 0 && box.bottom > bounds.bottom + 1;
  });
  return stage.scrollHeight <= stage.clientHeight + 1 && !overflowing ? 'fits' : 'overflow ' + stage.scrollHeight + '/' + stage.clientHeight;
})()`;

const CONTEXT_FIT = `(() => {
  const line = document.getElementById('inline-context');
  return line ? (line.scrollWidth <= line.clientWidth + 1 ? 'fits' : 'truncated: ' + line.textContent) : 'missing';
})()`;

const hudLabel = (page: Page): Promise<unknown> =>
  page.evaluate(`document.querySelector('.inline-hud')?.getAttribute('aria-label') ?? ''`);

/** The labelled feed control a player taps to make `move`. */
const feedMoveLabel = (board: Board, pieces: readonly Piece[], pieceIndex: number, to: readonly number[]): string => {
  const piece = pieces[pieceIndex];
  if (piece.kind === 'HOPPER') {
    const cell = to[0];
    const row = Math.floor(cell / board.width) + 1;
    const column = (cell % board.width) + 1;
    return board.holes.includes(cell)
      ? `Hop penguin into water at row ${row}, column ${column}`
      : `Hop penguin to row ${row}, column ${column}`;
  }
  const stop = slideStop(piece, { pieceIndex, kind: 'SLIDER', to }, board.width);
  if (!stop) throw new Error('fixture slide has no stop');
  return `Slide seal ${stop.direction} ${stop.distance} ${stop.distance === 1 ? 'cell' : 'cells'}`;
};

const tapSelector = async (page: Page, selector: string, settleMs = 500): Promise<boolean> => {
  const point = await page.centerOf(selector);
  if (!point) return false;
  await page.tap(point.x, point.y);
  await sleep(settleMs);
  return true;
};

const solveInFeed = async (page: Page, board: Board): Promise<boolean> => {
  let pieces: Piece[] = board.pieces.map((piece) => ({ ...piece, cells: [...piece.cells] }));
  for (const move of solve(board).solution) {
    if (!(await tapSelector(page, `[data-piece-control='${move.pieceIndex}']`, 450))) return false;
    const label = feedMoveLabel(board, pieces, move.pieceIndex, move.to);
    if (!(await tapSelector(page, `[aria-label='${label}']`, 650))) return false;
    pieces = applyMove(pieces, move);
  }
  await sleep(1400);
  return true;
};

const lastCompletion = (server: SmokeServer, route: string) =>
  [...server.completions].reverse().find((completion) => completion.route === route);

const feedScenarios = async (page: Page, server: SmokeServer): Promise<void> => {
  const dailySizes: ReadonlyArray<readonly [number, number, string]> = [
    [390, 512, 'snowfan'],
    [360, 512, 'guest'],
    [320, 512, 'snowfan'],
    [700, 512, 'snowfan'],
    [360, 320, 'snowfan'],
  ];
  for (const [width, height, user] of dailySizes) {
    const name = `feed daily ${width}x${height} ${user}`;
    console.log(name);
    await page.setViewport(width, height, 2);
    await page.navigate(`${server.origin}/splash.html?post=daily&user=${user}`, 2000);
    check(`${name}: board fits`, (await page.evaluate(STAGE_FIT)) === 'fits');
    if (width >= 360) {
      const context = await page.evaluate(CONTEXT_FIT);
      check(`${name}: difficulty/date line not truncated`, context === 'fits', String(context));
    }
    await tapSelector(page, "[data-piece-control='0']");
    const stops = await page.evaluate(`document.querySelectorAll('.inline-target--slide').length`);
    check(`${name}: tapping a seal shows its lane stops`, typeof stops === 'number' && stops > 0);
    check(`${name}: selected seal fits`, (await page.evaluate(STAGE_FIT)) === 'fits');
    await tapSelector(page, "[data-piece-control='0']");
    const solved = await solveInFeed(page, FIXTURES.daily.board);
    const completion = lastCompletion(server, '/api/solve');
    check(
      `${name}: solved by taps and replay-verified at par`,
      solved && completion?.ok === true && completion.moves === FIXTURES.daily.par,
      completion?.reason ?? ''
    );
    const fit = await page.evaluate(STAGE_FIT);
    check(`${name}: win card fits without inner scrolling`, fit === 'fits', String(fit));
    await page.screenshot(join(OUT_DIR, `feed-daily-win-${width}x${height}-${user}.png`));
  }

  const communitySizes: ReadonlyArray<readonly [number, number, string]> = [
    [390, 512, 'snowfan'],
    [360, 320, 'guest'],
  ];
  for (const [width, height, user] of communitySizes) {
    const name = `feed community ${width}x${height} ${user}`;
    console.log(name);
    await page.setViewport(width, height, 2);
    await page.navigate(`${server.origin}/splash.html?post=ugc&user=${user}`, 2000);
    if (width >= 360) {
      const context = await page.evaluate(CONTEXT_FIT);
      check(`${name}: difficulty/creator line not truncated`, context === 'fits', String(context));
    }
    const solved = await solveInFeed(page, FIXTURES.community.board);
    const completion = lastCompletion(server, '/api/ugc/played');
    check(
      `${name}: solved by taps and replay-verified at par`,
      solved && completion?.ok === true && completion.moves === FIXTURES.community.par,
      completion?.reason ?? ''
    );
    const fit = await page.evaluate(STAGE_FIT);
    check(`${name}: win card fits without inner scrolling`, fit === 'fits', String(fit));
    await page.screenshot(join(OUT_DIR, `feed-community-win-${width}x${height}-${user}.png`));
  }

  console.log('feed seal touch drag');
  await page.setViewport(390, 512, 2);
  await page.navigate(`${server.origin}/splash.html?post=daily&user=snowfan`, 2000);
  const horizontal = await page.centerOf("[data-piece-control='0']");
  const cellWidth = await page.evaluate(
    `document.querySelector('.inline-board').getBoundingClientRect().width / (5 + 24 / 44)`
  );
  if (horizontal && typeof cellWidth === 'number') {
    await page.swipe(horizontal.x, horizontal.y, horizontal.x - cellWidth, horizontal.y);
    await sleep(800);
  }
  check('feed: dragging a horizontal seal by touch slides it', (await hudLabel(page)) === 'Moves 1, par 6');

  await page.navigate(`${server.origin}/splash.html?post=ugc&user=snowfan`, 2000);
  const vertical = await page.centerOf("[data-piece-control='1']");
  if (vertical) {
    await page.swipe(vertical.x, vertical.y, vertical.x, vertical.y - 60);
    await sleep(800);
  }
  check(
    'feed: an up/down swipe on an unselected vertical seal is left to the feed',
    (await hudLabel(page)) === 'Moves 0, par 7'
  );
  await tapSelector(page, "[data-piece-control='1']");
  const touchAction = await page.evaluate(
    `getComputedStyle(document.querySelector("[data-piece-control='1']")).touchAction`
  );
  check('feed: a selected vertical seal captures its own drag', touchAction === 'none', String(touchAction));
};

const expandedScenario = async (page: Page, server: SmokeServer): Promise<void> => {
  const width = 390;
  const height = 844;
  const name = `full game daily ${width}x${height}`;
  console.log(name);
  await page.setViewport(width, height, 3);
  await page.navigate(`${server.origin}/game.html?post=daily&user=snowfan`, 800);
  await page.evaluate(`localStorage.setItem('icehop.howto.seen', '1'); location.reload(); true`);
  await sleep(3500);

  // Mirrors GameScene.layout() so taps land on real cells.
  const board = FIXTURES.daily.board;
  const hudHeight = Math.min(84, Math.max(72, height * 0.14));
  const regionH = height - hudHeight - 50;
  const cell = Math.max(24, Math.floor(Math.min((width - 32) / board.width, (regionH - 32) / board.height)));
  const originX = (width - cell * board.width) / 2;
  const originY = hudHeight + (regionH - cell * board.height) / 2;
  const centre = (cells: readonly number[]): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    for (const c of cells) {
      x += originX + (c % board.width) * cell + cell / 2;
      y += originY + Math.floor(c / board.width) * cell + cell / 2;
    }
    return { x: x / cells.length, y: y / cells.length };
  };

  let pieces: Piece[] = board.pieces.map((piece) => ({ ...piece, cells: [...piece.cells] }));
  for (const move of solve(board).solution) {
    const from = centre(pieces[move.pieceIndex].cells);
    await page.tap(from.x, from.y);
    await sleep(450);
    if (move.kind === 'HOPPER') {
      // Tap off-centre inside the destination cell: the whole cell is the target.
      const to = centre(move.to);
      await page.tap(to.x + cell * 0.3, to.y + cell * 0.3);
    } else {
      // Tap the seal's lane stop (selection shows it), not a drag.
      const stop = slideStop(pieces[move.pieceIndex], move, board.width);
      if (!stop) throw new Error('fixture slide has no stop');
      const at = centre([stop.leadingCell]);
      await page.tap(at.x, at.y);
    }
    await sleep(700);
    pieces = applyMove(pieces, move);
  }
  await sleep(2500);
  const completion = lastCompletion(server, '/api/solve');
  check(
    `${name}: seal stop taps + off-centre hop taps reach a replay-verified win`,
    completion?.ok === true && completion.moves === FIXTURES.daily.par,
    completion?.reason ?? 'no verified completion'
  );
  await page.screenshot(join(OUT_DIR, 'full-game-daily-win.png'));
};

const main = async (): Promise<void> => {
  const executable = findBrowser();
  if (!executable) {
    console.error('UI smoke test needs Chrome or Edge. Set CHROME_PATH to its executable.');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await launchBrowser(executable);
  try {
    await feedScenarios(browser.page, server);
    await expandedScenario(browser.page, server);
    check(
      'no page exceptions or console errors',
      browser.page.problems.length === 0,
      browser.page.problems.slice(0, 3).join(' | ')
    );
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`\n${checks - failures.length}/${checks} checks passed. Screenshots: ${OUT_DIR}`);
  if (failures.length > 0) {
    console.error(`Failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  process.exit(0);
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
