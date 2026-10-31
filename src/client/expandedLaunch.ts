import { context } from '@devvit/web/client';
import { POST_DATA_SPLASH_KEY } from '../shared/api';
import { hasSignedDailyHandoff } from './dailyHandoff';

// Expanded-view work that must not wait for Phaser. game.ts imports this module
// before anything else, so its top-level code runs as soon as the bundle is
// parsed. Evaluating, constructing, and booting the engine takes seconds on a
// phone, and these requests now overlap that time instead of following it:
//
// - consume the one-shot route the feed card stored before expanding;
// - start loading the web fonts the first frame waits for;
// - for the host-post route, request `GET /api/init` when doing so cannot move
//   a ranked Daily clock (see `prefetchKeepsClocks`).

export type LaunchRoute = 'play' | 'build' | 'home' | 'leaderboard' | 'endless';

const postId = typeof context.postId === 'string' ? context.postId : '';

// Splash actions stash this before expanding. It is scoped to this Reddit tab
// and host post, so another card or tab cannot reroute the expanded view.
const LAUNCH_STORAGE_KEY = postId ? `icehop.launch:${postId}` : 'icehop.launch:no-post';

const readLaunchRoute = (): LaunchRoute => {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(LAUNCH_STORAGE_KEY);
    if (stored) sessionStorage.removeItem(LAUNCH_STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable - just play the post */
  }
  return stored === 'build' || stored === 'home' || stored === 'leaderboard' || stored === 'endless'
    ? stored
    : 'play';
};

let pendingRoute: LaunchRoute | null = readLaunchRoute();
const initialRoute: LaunchRoute = pendingRoute ?? 'play';

/** The route the feed card asked for, once. Later calls play the host post. */
export const takeLaunchRoute = (): LaunchRoute => {
  const route = pendingRoute ?? 'play';
  pendingRoute = null;
  return route;
};

// Every face the scenes render. Phaser does not reflow Text when a font
// arrives later, so game.ts waits (briefly) for these before booting.
const FONT_FACES = [
  '500 1em Fredoka',
  '600 1em Fredoka',
  '700 1em Fredoka',
  '400 1em Nunito',
  '600 1em Nunito',
  '700 1em Nunito',
  '800 1em Nunito',
] as const;

/** Settles once every web face has loaded or failed. Never rejects. */
export const webFontsLoaded: Promise<void> = (() => {
  try {
    if (typeof document.fonts?.load !== 'function') return Promise.resolve();
    return Promise.all(FONT_FACES.map((face) => document.fonts.load(face))).then(
      () => undefined,
      () => undefined
    );
  } catch {
    // Fall back to the system stacks declared in theme.ts FONT.
    return Promise.resolve();
  }
})();

const property = (value: object, key: string): unknown => Reflect.get(value, key);

/** This post's puzzle kind and Daily id from its feed snapshot, when present. */
const readHostPuzzle = (): { readonly kind: unknown; readonly puzzleId: unknown } => {
  try {
    const raw: unknown = context.postData?.[POST_DATA_SPLASH_KEY];
    if (typeof raw !== 'string') return { kind: null, puzzleId: null };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return { kind: null, puzzleId: null };
    return { kind: property(value, 'kind'), puzzleId: property(value, 'puzzleId') };
  } catch {
    return { kind: null, puzzleId: null };
  }
};

/**
 * `/api/init` binds a signed player's non-resettable Daily clock, so asking for
 * it before the board can render would add engine boot time to their recorded
 * time. Prefetch only when no ranked clock can move: Community posts have no
 * clock, guest Daily solves are never ranked, and a signed Daily continuation
 * saved by this tab's inline board means that clock is already running.
 */
const prefetchKeepsClocks = (): boolean => {
  const host = readHostPuzzle();
  if (host.kind === 'ugc') return true;
  const signedIn = typeof context.username === 'string' && context.username.length > 0;
  if (!signedIn) return true;
  return (
    postId.length > 0 &&
    typeof host.puzzleId === 'string' &&
    host.puzzleId.length > 0 &&
    hasSignedDailyHandoff(postId, host.puzzleId)
  );
};

/** Same budget as GameScene's own init request, so a stalled prefetch fails
 *  into the same Try again recovery. */
const INIT_TIMEOUT_MS = 12_000;

const requestHostInit = (): Promise<Response> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), INIT_TIMEOUT_MS);
  const request = fetch('/api/init', { signal: controller.signal });
  // Handling both outcomes here also keeps an unconsumed failure from being
  // reported as an unhandled rejection; GameScene still sees the original.
  void request.then(
    () => window.clearTimeout(timer),
    () => window.clearTimeout(timer)
  );
  return request;
};

let hostInit: Promise<Response> | null = null;
try {
  if (initialRoute === 'play' && prefetchKeepsClocks()) hostInit = requestHostInit();
} catch {
  // GameScene requests the puzzle itself when no prefetch exists.
  hostInit = null;
}

/** The host post's prefetched `/api/init` response, once. Retries, forced
 *  Dailies, and every later load request their own. */
export const takeHostInit = (): Promise<Response> | null => {
  const request = hostInit;
  hostInit = null;
  return request;
};
