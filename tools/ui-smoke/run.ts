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
import { actionBarSlots, playLayout } from '../../src/shared/playLayout';
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

const solveInFeed = async (page: Page, board: Board, celebrationShot?: string): Promise<boolean> => {
  let pieces: Piece[] = board.pieces.map((piece) => ({ ...piece, cells: [...piece.cells] }));
  for (const move of solve(board).solution) {
    if (!(await tapSelector(page, `[data-piece-control='${move.pieceIndex}']`, 450))) return false;
    const label = feedMoveLabel(board, pieces, move.pieceIndex, move.to);
    if (!(await tapSelector(page, `[aria-label='${label}']`, 650))) return false;
    pieces = applyMove(pieces, move);
  }
  if (celebrationShot) {
    // The solved board stays up for the win beat before the result card.
    const celebrating = await page.evaluate(`Boolean(document.querySelector('.inline-play--celebrating'))`);
    check('feed: the solved board stays up for the win celebration', celebrating === true);
    await sleep(150);
    await page.screenshot(celebrationShot);
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
    const hudRowFits = await page.evaluate(
      `(() => { const hud = document.querySelector('.inline-hud'); return hud ? hud.scrollWidth <= hud.clientWidth + 1 : false; })()`
    );
    check(`${name}: Moves, Par and the star goal fit on one row`, hudRowFits === true);
    if (width >= 360) {
      const context = await page.evaluate(CONTEXT_FIT);
      check(`${name}: difficulty/date line not truncated`, context === 'fits', String(context));
    }
    await tapSelector(page, "[data-piece-control='0']");
    const stops = await page.evaluate(`document.querySelectorAll('.inline-target--slide').length`);
    check(`${name}: tapping a seal shows its lane stops`, typeof stops === 'number' && stops > 0);
    check(`${name}: selected seal fits`, (await page.evaluate(STAGE_FIT)) === 'fits');
    await tapSelector(page, "[data-piece-control='0']");
    const solved = await solveInFeed(
      page,
      FIXTURES.daily.board,
      width === 390 && height === 512 ? join(OUT_DIR, 'feed-daily-celebration-390x512.png') : undefined
    );
    const completion = lastCompletion(server, '/api/solve');
    check(
      `${name}: solved by taps and replay-verified at par`,
      solved && completion?.ok === true && completion.moves === FIXTURES.daily.par,
      completion?.reason ?? ''
    );
    const fit = await page.evaluate(STAGE_FIT);
    check(`${name}: win card fits without inner scrolling`, fit === 'fits', String(fit));
    if (user !== 'guest') {
      const link = String(
        await page.evaluate(`document.querySelector('.inline-result-link')?.textContent ?? ''`)
      );
      check(
        `${name}: the status line opens the leaderboard`,
        link.startsWith('#7 of 42 today') && link.endsWith('Leaderboard \u203A'),
        link
      );
    }
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
  check('feed: dragging a horizontal seal by touch slides it', String(await hudLabel(page)).startsWith('Moves 1, par 6'));
  const goal = await page.evaluate(`document.querySelector('.inline-stat--goal')?.textContent ?? ''`);
  check('feed: the live star goal shows next to Moves/Par', goal === '\u2605\u2605\u2605 up to 7', String(goal));
  const hudFits = await page.evaluate(
    `(() => { const hud = document.querySelector('.inline-hud'); return hud ? hud.scrollWidth <= hud.clientWidth + 1 : false; })()`
  );
  check('feed: Moves, Par and the star goal fit on one row', hudFits === true);
  await tapSelector(page, '.inline-play-actions button:first-child', 700);
  check('feed: Undo steps back one move', String(await hudLabel(page)).startsWith('Moves 0, par 6'));

  await page.navigate(`${server.origin}/splash.html?post=ugc&user=snowfan`, 2000);
  const vertical = await page.centerOf("[data-piece-control='1']");
  if (vertical) {
    await page.swipe(vertical.x, vertical.y, vertical.x, vertical.y - 60);
    await sleep(800);
  }
  check(
    'feed: an up/down swipe on an unselected vertical seal is left to the feed',
    String(await hudLabel(page)).startsWith('Moves 0, par 7')
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

  // The scene's own layout module, so taps land on real cells and buttons.
  const board = FIXTURES.daily.board;
  const geometry = playLayout({ width, height, cols: board.width, rows: board.height });
  const { cell, originX, originY } = geometry;
  const [undoX = width / 2] = actionBarSlots(width, 2, geometry.maxBarWidth).centers;
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
  const solution = solve(board).solution;

  // Make the first move, then Undo it: the verified transcript below must
  // still be exactly par, proving Undo removed the move.
  const first = solution[0];
  if (first) {
    const firstFrom = centre(pieces[first.pieceIndex].cells);
    await page.tap(firstFrom.x, firstFrom.y);
    await sleep(450);
    const stop = first.kind === 'SLIDER' ? slideStop(pieces[first.pieceIndex], first, board.width) : null;
    const firstTo = centre(stop ? [stop.leadingCell] : first.to);
    await page.tap(firstTo.x, firstTo.y);
    await sleep(700);
    // Undo is the left button of the action bar under the board.
    await page.tap(undoX, geometry.actionsY);
    await sleep(700);
  }

  for (const move of solution) {
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
  // Mid-celebration: the board is still up (the card comes after ~1.1s).
  await sleep(150);
  await page.screenshot(join(OUT_DIR, 'full-game-daily-celebration.png'));
  await sleep(2350);
  const completion = lastCompletion(server, '/api/solve');
  check(
    `${name}: Undo, seal stop taps and off-centre hop taps reach a replay-verified win at par`,
    completion?.ok === true && completion.moves === FIXTURES.daily.par,
    completion?.reason ?? 'no verified completion'
  );
  await page.screenshot(join(OUT_DIR, 'full-game-daily-win.png'));
};

/**
 * Full-game Community post on a smaller phone: penguins by taps, seals by
 * touch drags on the device-resolution canvas, then the result card.
 */
const communityGameScenario = async (page: Page, server: SmokeServer): Promise<void> => {
  const width = 360;
  const height = 640;
  const name = `full game community ${width}x${height}`;
  console.log(name);
  await page.setViewport(width, height, 2);
  await page.navigate(`${server.origin}/game.html?post=ugc&user=snowfan`, 3500);

  const board = FIXTURES.community.board;
  const { cell, originX, originY } = playLayout({
    width,
    height,
    cols: board.width,
    rows: board.height,
  });
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
    if (move.kind === 'SLIDER') {
      const to = centre(move.to);
      await page.swipe(from.x, from.y, to.x, to.y);
    } else {
      await page.tap(from.x, from.y);
      await sleep(450);
      const to = centre(move.to);
      await page.tap(to.x, to.y);
    }
    await sleep(800);
    pieces = applyMove(pieces, move);
  }
  await sleep(3200);
  const completion = lastCompletion(server, '/api/ugc/played');
  check(
    `${name}: hop taps and seal drags reach a replay-verified win at par`,
    completion?.ok === true && completion.moves === FIXTURES.community.par,
    completion?.reason ?? 'no verified completion'
  );
  await page.screenshot(join(OUT_DIR, 'full-game-community-win.png'));
};

/**
 * Tab centres in the leaderboard overlay at 390x844 (mirrors showLeaderboard:
 * a 366x680 card at top 82, title, then a centred row of four "sm" chips).
 */
const OVERLAY_TAB_Y = 157;
const OVERLAY_TABS = { daily: 75, week: 144, streak: 221, alltime: 306 } as const;
const OVERLAY_NAME_TOGGLE = { x: 195, y: 687 } as const;

/** From the verified Daily win: Leaderboard chip -> overlay -> tabs -> name setting. */
const winLeaderboardScenario = async (page: Page, server: SmokeServer): Promise<void> => {
  console.log('full game daily leaderboard');
  check(
    'win: the leaderboard loads after a verified solve',
    server.urls.some((url) => url.startsWith('/api/leaderboard?puzzleId='))
  );
  // composeResultCard() at 390x844: Leaderboard is the right-hand button of
  // the second grid row (Share | Comment, Play again | Leaderboard).
  await page.tap(275, 561);
  await sleep(700);
  await page.screenshot(join(OUT_DIR, 'full-game-leaderboard.png'));
  await page.tap(OVERLAY_TABS.week, OVERLAY_TAB_Y);
  await sleep(900);
  check(
    'win: the Week tab loads this week\u2019s board',
    server.urls.includes('/api/leaderboard/board?kind=week')
  );
  await page.screenshot(join(OUT_DIR, 'full-game-leaderboard-week.png'));
  await page.tap(OVERLAY_NAME_TOGGLE.x, OVERLAY_NAME_TOGGLE.y);
  await sleep(700);
  check(
    'win: the name setting saves through the visibility route',
    server.requests.includes('/api/leaderboard/visibility')
  );
};

/** A feed win's "Leaderboard ›" link launches the hub with the board open. */
const hubLeaderboardScenario = async (page: Page, server: SmokeServer): Promise<void> => {
  console.log('hub leaderboard from the feed link');
  await page.setViewport(390, 844, 2);
  await page.navigate(`${server.origin}/game.html?post=daily&user=snowfan`, 800);
  await page.evaluate(
    `sessionStorage.setItem('icehop.launch:t3_smoke_daily', 'leaderboard'); location.reload(); true`
  );
  await sleep(2800);
  check(
    'hub: the feed link opens the host post\u2019s Daily board',
    server.urls.includes('/api/leaderboard?post=1')
  );
  await page.screenshot(join(OUT_DIR, 'hub-leaderboard.png'));
  await page.tap(OVERLAY_TABS.streak, OVERLAY_TAB_Y);
  await sleep(900);
  check(
    'hub: the Streaks tab loads current streaks',
    server.urls.includes('/api/leaderboard/board?kind=streak')
  );
  await page.screenshot(join(OUT_DIR, 'hub-leaderboard-streaks.png'));
  // Tapping the dimmed backdrop above the card closes it, leaving the hub.
  await page.tap(195, 40);
  await sleep(600);
  await page.screenshot(join(OUT_DIR, 'hub.png'));

  // A short expanded view (e.g. a desktop modal) uses the compact layout.
  await page.setViewport(360, 580, 2);
  await page.evaluate(
    `sessionStorage.setItem('icehop.launch:t3_smoke_daily', 'leaderboard'); location.reload(); true`
  );
  await sleep(2800);
  await page.screenshot(join(OUT_DIR, 'hub-leaderboard-360x580.png'));
};

/**
 * Hub -> Community list -> a puzzle -> back to the list, on a 360x640 phone.
 * Taps are fixed points of that layout: the hub's Community tile (top-right of
 * the 2x2 grid), the first list row, and the play screen's top-left chip.
 */
const communityListScenario = async (page: Page, server: SmokeServer): Promise<void> => {
  console.log('community list 360x640');
  await page.setViewport(360, 640, 2);
  await page.navigate(`${server.origin}/game.html?post=daily&user=snowfan`, 800);
  await page.evaluate(`sessionStorage.setItem('icehop.launch:t3_smoke_daily', 'home'); location.reload(); true`);
  await sleep(3000);
  check('hub: loads its read-only summary', server.requests.includes('/api/hub'));
  await page.screenshot(join(OUT_DIR, 'hub-360x640.png'));

  const listsBefore = server.requests.filter((path) => path === '/api/ugc/list').length;
  await page.tap(262, 396);
  await sleep(1800);
  const listsOpened = server.requests.filter((path) => path === '/api/ugc/list').length;
  check('community: the hub tile opens the browse list', listsOpened === listsBefore + 1);
  await page.screenshot(join(OUT_DIR, 'community-list.png'));

  const startsBefore = server.events.filter((event) => event === 'community_started').length;
  await page.tap(180, 159);
  await sleep(1800);
  const starts = server.events.filter((event) => event === 'community_started').length;
  check('community: tapping a row starts that puzzle', starts === startsBefore + 1);
  await page.screenshot(join(OUT_DIR, 'community-list-puzzle.png'));

  await page.tap(65, 22);
  await sleep(1800);
  const listsAfter = server.requests.filter((path) => path === '/api/ugc/list').length;
  check('community: "\u2039 Community" returns to the list', listsAfter === listsOpened + 1);
};

/** Practice: "?" -> Practice, then solve the three lessons by taps. */
const tutorialScenario = async (page: Page, server: SmokeServer): Promise<void> => {
  const width = 390;
  const height = 844;
  console.log('full game practice tutorial');
  await page.setViewport(width, height, 2);
  await page.navigate(`${server.origin}/game.html?post=daily&user=snowfan`, 3500);
  await page.tap(width - 32, 22); // "?" help chip
  await sleep(700);
  await page.tap(140, 614); // "Practice" beside "Got it"
  await sleep(1300);

  // Lessons are 5x3 boards laid out by the scene's own layout module.
  const lesson = playLayout({ width, height, cols: 5, rows: 3 });
  const col = (c: number): number => lesson.originX + c * lesson.cell + lesson.cell / 2;
  const row = (r: number): number => lesson.originY + r * lesson.cell + lesson.cell / 2;
  const taps: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[col(0), row(1)], [col(2), row(1)]],
    [[col(3.5), row(1)], [col(2), row(1)], [col(2), row(0)], [col(2), row(2)]],
    [[col(1), row(1)], [col(3), row(1)], [col(4), row(1)], [col(1), row(1)]],
  ];
  for (let lesson = 0; lesson < taps.length; lesson++) {
    for (const [x, y] of taps[lesson]) {
      await page.tap(x, y);
      await sleep(550);
    }
    // The win beat plus the card fade-in; generous because headless Chrome
    // renders the device-resolution canvas in software.
    await sleep(2600);
    if (lesson === taps.length - 1) await page.screenshot(join(OUT_DIR, 'full-game-practice-done.png'));
    const initsBefore = server.requests.filter((path) => path === '/api/init').length;
    // "Next" / "Play today's puzzle": composeResultCard centres mascot, title,
    // blurb and actions as one block, putting the primary at y=507 here.
    await page.tap(width / 2, 507);
    await sleep(1400);
    if (lesson === taps.length - 1) {
      const initsAfter = server.requests.filter((path) => path === '/api/init').length;
      check('practice: three lessons solved by taps lead into the Daily', initsAfter > initsBefore);
    }
  }
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
    await winLeaderboardScenario(browser.page, server);
    await communityGameScenario(browser.page, server);
    await hubLeaderboardScenario(browser.page, server);
    await communityListScenario(browser.page, server);
    await tutorialScenario(browser.page, server);
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
