// Local preview server for the UI smoke test (never deployed). Serves the
// built client from dist/client, injects a Devvit context stub before the app
// modules, and answers /api/* with fixtures. Completion routes replay the
// posted transcript with the real shared engine, so a client that sends an
// illegal or unsolved move history fails the test.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Board } from '../../src/shared/game/types';
import { verifySolvedTranscript } from '../../src/shared/game/replay';
import { competitionRanks } from '../../src/shared/leaderboard';
import { difficultyFromPar } from '../../src/shared/solver/difficulty';
import { solve } from '../../src/shared/solver/solver';
import { property } from './cdp';

const CLIENT_ROOT = resolve('dist/client');

export type Fixture = { readonly board: Board; readonly par: number };

const withPar = (board: Board): Fixture => {
  const result = solve(board, { maxStates: 400_000 });
  if (!result.solvable) throw new Error('UI smoke fixture is not solvable.');
  return { board, par: result.par };
};

/** Fixed boards (generated once from the shared generator) keep runs deterministic. */
export const FIXTURES = {
  daily: withPar({
    width: 5,
    height: 5,
    holes: [12, 19, 21],
    pieces: [
      { kind: 'SLIDER', cells: [23, 24], orient: 'H' },
      { kind: 'BLOCKER', cells: [13] },
      { kind: 'HOPPER', cells: [9] },
      { kind: 'HOPPER', cells: [11] },
      { kind: 'HOPPER', cells: [10] },
    ],
  }),
  community: withPar({
    width: 5,
    height: 5,
    holes: [6, 14],
    pieces: [
      { kind: 'SLIDER', cells: [7, 8], orient: 'H' },
      { kind: 'SLIDER', cells: [18, 23], orient: 'V' },
      { kind: 'BLOCKER', cells: [1] },
      { kind: 'HOPPER', cells: [12] },
      { kind: 'HOPPER', cells: [0] },
    ],
  }),
};

export const DAILY_DATE = '2026-10-30';
const PUZZLE_ID = `v6:${DAILY_DATE}`;
const COMMUNITY_ID = 'ugc_smoke1';
const CREATOR = 'frosty_builder';

const dailySnapshot = {
  version: 2,
  kind: 'daily',
  puzzleId: PUZZLE_ID,
  date: DAILY_DATE,
  board: FIXTURES.daily.board,
  par: FIXTURES.daily.par,
  difficulty: difficultyFromPar(FIXTURES.daily.par),
};
const communitySnapshot = {
  version: 2,
  kind: 'ugc',
  id: COMMUNITY_ID,
  board: FIXTURES.community.board,
  par: FIXTURES.community.par,
  difficulty: difficultyFromPar(FIXTURES.community.par),
  creator: CREATOR,
};

// The stub picks a scenario from the page URL: ?post=daily|ugc&user=name|guest
const stub = `(() => {
  const q = new URLSearchParams(location.search);
  const post = q.get('post') === 'ugc' ? 'ugc' : 'daily';
  const user = q.get('user') || 'guest';
  const snapshots = ${JSON.stringify({ daily: dailySnapshot, ugc: communitySnapshot })};
  window.devvit = {
    context: {
      postId: 't3_smoke_' + post,
      subredditName: 'IceHop',
      username: user === 'guest' ? undefined : user,
      postData: { splash: JSON.stringify(snapshots[post]) },
    },
  };
  document.cookie = 'smoke_post=' + post + '; path=/';
  document.cookie = 'smoke_user=' + user + '; path=/';
})();`;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.map': 'application/json',
};

export type VerifiedCompletion = {
  readonly route: string;
  readonly ok: boolean;
  readonly moves: number;
  readonly reason?: string;
};

export type SmokeServer = {
  readonly origin: string;
  readonly completions: VerifiedCompletion[];
  /** Every /api/* path requested, in order. */
  readonly requests: string[];
  /** Every /api/* path with its query string, in order. */
  readonly urls: string[];
  close(): Promise<void>;
};

const BOARD_NAMES = [
  'aurora_fan',
  'icebreaker',
  'puffin_pal',
  'floe_rider',
  'snowcap',
  'krill_king',
  'glacier_gus',
  'tux_tamer',
  'berg_buddy',
  'slushy',
];

/** A consistent 42-player Daily board; a signed viewer sits at #7. */
const dailyLeaderboard = (date: string, viewer: string | null) => {
  const par = FIXTURES.daily.par;
  const viewerRank = viewer ? 7 : 0;
  const entries = BOARD_NAMES.map((name, index) => ({
    rank: index + 1,
    username: viewer && index + 1 === viewerRank ? viewer : name,
    moves: par,
    timeMs: 18_000 + index * 4_100,
    streak: [12, 0, 5, 2, 0, 9, 3, 0, 1, 4][index] ?? 0,
  }));
  return {
    puzzleId: `v6:${date}`,
    date,
    par,
    totalPlayers: 42,
    viewerRank,
    entries,
    nearbyEntries: viewer ? entries.slice(4, 9) : [],
    distribution: [18, 11, 7, 4, 2].map((players, index) => ({
      moves: par + index,
      orMore: index === 4,
      players,
    })),
    viewerHidden: false,
  };
};

const rankedBoard = (kind: string, viewer: string | null) => {
  const values =
    kind === 'week'
      ? [21, 18, 18, 15, 12, 12, 9, 7, 6, 3]
      : kind === 'streak'
        ? [41, 30, 22, 14, 9, 7, 5, 4, 3, 2]
        : [120, 96, 80, 64, 50, 41, 33, 20, 12, 8];
  const ranks = competitionRanks(values);
  return {
    kind,
    ...(kind === 'week' ? { periodStart: '2026-10-26', periodEnd: '2026-11-01' } : {}),
    ...(kind === 'streak' ? {} : { totalPlayers: 57 }),
    entries: values.map((value, index) => ({
      rank: ranks[index] ?? index + 1,
      username: BOARD_NAMES[index] ?? `player${index}`,
      value,
    })),
    viewer: viewer ? { rank: kind === 'streak' ? 0 : 14, value: kind === 'week' ? 5 : 3 } : null,
    viewerHidden: false,
  };
};

const readCookies = (header: string | undefined): Map<string, string> => {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name && value !== undefined) cookies.set(name, value);
  }
  return cookies;
};

export const startServer = async (): Promise<SmokeServer> => {
  if (!existsSync(join(CLIENT_ROOT, 'splash.html'))) {
    throw new Error('dist/client is missing. Run `npm run build` first.');
  }
  const completions: VerifiedCompletion[] = [];
  const requests: string[] = [];
  const urls: string[] = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      urls.push(`${url.pathname}${url.search}`);
    }
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const json = (value: unknown, status = 200): void => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      const cookies = readCookies(request.headers.cookie);
      const post = cookies.get('smoke_post') === 'ugc' ? 'ugc' : 'daily';
      const user = cookies.get('smoke_user') ?? 'guest';
      const username = user === 'guest' ? 'anon' : user;
      const guest = username === 'anon';

      if (url.pathname === '/__stub.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(stub);
        return;
      }
      if (url.pathname === '/api/post-preview') {
        json(
          post === 'ugc'
            ? { type: 'post-preview', ...communitySnapshot, solves: 12, solved: false }
            : { type: 'post-preview', ...dailySnapshot }
        );
        return;
      }
      if (url.pathname === '/api/init') {
        if (post === 'ugc' && url.searchParams.get('daily') !== '1') {
          json({
            type: 'init',
            kind: 'ugc',
            puzzle: {
              id: COMMUNITY_ID,
              board: FIXTURES.community.board,
              par: FIXTURES.community.par,
              difficulty: communitySnapshot.difficulty,
              creator: CREATOR,
              votes: 4,
              solves: 12,
            },
            username,
            solved: false,
            subredditName: 'IceHop',
          });
          return;
        }
        json({
          type: 'init',
          kind: 'daily',
          puzzleId: PUZZLE_ID,
          date: DAILY_DATE,
          playId: `play_${Date.now()}`,
          board: FIXTURES.daily.board,
          par: FIXTURES.daily.par,
          difficulty: dailySnapshot.difficulty,
          username,
          solved: false,
          subscribed: false,
          subredditName: 'IceHop',
        });
        return;
      }
      if (url.pathname === '/api/solve' || url.pathname === '/api/ugc/played') {
        const daily = url.pathname === '/api/solve';
        const parsed: unknown = body ? JSON.parse(body) : null;
        const fixture = daily ? FIXTURES.daily : FIXTURES.community;
        const replay = verifySolvedTranscript(fixture.board, property(parsed, 'moves'));
        completions.push({
          route: url.pathname,
          ok: replay.ok,
          moves: replay.ok ? replay.moveCount : 0,
          ...(replay.ok ? {} : { reason: replay.reason }),
        });
        if (!replay.ok) {
          json({ status: 'error', message: replay.reason }, 400);
          return;
        }
        if (!daily) {
          json({ ok: true, saved: !guest, firstSolve: true });
          return;
        }
        const moves = replay.moveCount;
        const par = fixture.par;
        const stars = moves <= par + 1 ? 3 : moves <= par * 2 ? 2 : 1;
        json({
          accepted: true,
          stars,
          par,
          moves,
          bestMoves: moves,
          rank: guest ? 0 : 7,
          totalPlayers: guest ? 0 : 42,
          streak: guest ? 0 : 3,
        });
        return;
      }
      if (url.pathname === '/api/leaderboard') {
        const requested = url.searchParams.get('puzzleId');
        if (requested !== null && requested !== PUZZLE_ID) {
          json({ status: 'error', message: 'no daily puzzle' }, 404);
          return;
        }
        const date = url.searchParams.get('day') === 'yesterday' ? '2026-10-29' : DAILY_DATE;
        json(dailyLeaderboard(date, guest ? null : username));
        return;
      }
      if (url.pathname === '/api/leaderboard/board') {
        json(rankedBoard(url.searchParams.get('kind') ?? '', guest ? null : username));
        return;
      }
      if (url.pathname === '/api/leaderboard/visibility') {
        const parsed: unknown = body ? JSON.parse(body) : null;
        json({ ok: true, hidden: property(parsed, 'hidden') === true });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        json({ ok: true });
        return;
      }

      const relative = url.pathname === '/' ? '/splash.html' : url.pathname;
      const file = normalize(join(CLIENT_ROOT, relative));
      if (!file.startsWith(CLIENT_ROOT) || !existsSync(file)) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      let data = readFileSync(file);
      if (extname(file) === '.html') {
        data = Buffer.from(
          data.toString('utf8').replace('<head>', '<head><script src="/__stub.js"></script>')
        );
      }
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      });
      response.end(data);
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? portOf(address) : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    completions,
    requests,
    urls,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
};

const portOf = (address: AddressInfo): number => address.port;
