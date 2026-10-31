# Tech Stack

Devvit Web app (runs on Reddit.com). Verified against reddit/devvit-template-phaser.

## Versions / runtime

- Node >= 22.12.0, ES modules (`"type": "module"`).
- `devvit`, `@devvit/web`, `@devvit/start`: 0.15.1 (keep all three on the same
  version)
- `hono` 4.x + `@hono/node-server`; `phaser` 4.1.0
- Build: Vite 7.3.7 with the `@devvit/start/vite` plugin (`@devvit/start` 0.15.1
  needs `vite >= 7.3.5`). TypeScript project references.

## Two execution contexts

- Client (`src/client`): runs in an iframe on reddit.com. Import from
  `@devvit/web/client` (e.g. `navigateTo`, `showToast`, `showForm`,
  `showLoginPrompt`, `showShareSheet`, `requestExpandedMode`).
- Server (`src/server`): secure serverless Node 22. A Hono app. Import from
  `@devvit/web/server`: `context` (postId, subredditName, userId...), `redis`,
  `reddit`, `createServer`, `getServerPort`.
- Shared (`src/shared`): pure TS shared by both. Trigger/request types come from
  `@devvit/web/shared`.

## Client architecture

- Phaser 4 is confined to the `game.html` expanded view, with scenes: `Boot`
  (loads the sound pref, launches `GameScene`), `HomeScene` (the hub), `GameScene`
  (daily / endless / community / test play), `EditorScene` (build),
  `CommunityScene` (the paginated Community browse list; a tapped row starts
  `GameScene` with the list as its Next queue), `EndlessScene`
  (Easy/Medium/Hard tier select), and `MyPuzzlesScene` (creator dashboard). The
  shared "How to play" overlay (`src/client/howToPlay.ts`) opens from the hub and
  expanded play screen. The shared Leaderboards overlay
  (`src/client/leaderboard.ts`: Daily today/yesterday, Week, Streaks, All-time)
  opens from the hub, the Daily win screen (inside its fitted win layer), and the
  feed win card's status line via the `leaderboard` launch intent, which Boot
  routes to `HomeScene` with the host post's board open.
- `game.ts` imports `src/client/expandedLaunch.ts` before Phaser (keep that
  import first), so its top-level code runs while the engine still has to
  evaluate and boot. It consumes the one-shot launch intent (Boot reads it with
  `takeLaunchRoute`), starts the web-font loads, and for the default play route
  requests the host post's `GET /api/init`, which `GameScene` adopts once
  (`takeHostInit`; retries fetch fresh). That early request must never move a
  ranked clock: it runs for Community posts, guests, and a signed Daily only
  when this tab's inline board already saved a signed handoff. Otherwise
  `GameScene` requests init itself once it is built.
- The default `splash.html` entrypoint is a real Phaser-free DOM/SVG game shared
  by Daily and Community. `splash.ts` paints exact V2 boards immediately, while
  `inlineDaily.ts` owns interaction, lazy authority hydration, verification, and
  recovery. `dailyHandoff.ts` can carry a bounded Daily attempt into expanded
  play; Community has no transcript handoff after a move.
- All art is drawn in code as vector graphics - no image/sprite assets. One
  palette + helper module, `src/client/art/theme.ts`, holds the penguin / seal /
  rock / water, the connected ice sheet, board thumbnails (`drawBoardThumb`),
  the backdrop, win FX, and the scene fades (`fadeToScene` / `fadeInScene`).
- The expanded game renders at device resolution: `game.ts` runs Phaser with
  `Scale.NONE` at the container's CSS size times `RENDER_SCALE`
  (`devicePixelRatio`, capped at 3) and a `1/RENDER_SCALE` canvas zoom, and
  resizes the canvas itself when the container changes. Every scene calls
  `useCrispRendering(this)` (camera zoom + DPR text: its `add.text` passes the
  resolution at creation, so each Text draws and uploads once) and lays out in
  CSS pixels with `viewWidth(this)` / `viewHeight(this)`, never
  `scale.width/height`. Do not return to Phaser's `RESIZE` mode: it sizes the
  backing store in CSS pixels, so high-DPI phones show a stretched 1x canvas.
  Distances Phaser measures itself (for example `input.dragDistanceThreshold`)
  are in canvas pixels.
- Play-screen geometry (HUD rows, board, action bar, tip) is the pure
  `src/shared/playLayout.ts`, shared with the UI smoke test so its taps land on
  the cells and buttons `GameScene` draws. Change layout there, not inline.
- Audio lives in `src/client/audio.ts`. Hop, slide, splash, and verified-win
  cues are synthesized at runtime with Web Audio; the ambient soundtrack is one
  checked-in composition encoded as `ice-hop-music.ogg` and
  `ice-hop-music.mp3` under `src/client/public/` for Chromium/Android and
  Safari/iOS decode fallback. Phaser's own sound manager is off
  (`audio: { noAudio: true }` in `game.ts`), so no scene may use `this.sound`.
- SFX and music have independent `localStorage` preferences and independent
  controls in the inline post and expanded hub. The expanded play HUD exposes a
  combined mute that restores the player's previous channel mix when re-enabled.
  Inline music is authorized only by the first legal move; expanded music is
  authorized by its first local pointer or keyboard gesture, never by feed scroll.
- Hidden/offscreen documents suspend their shared `AudioContext`. A decoded music
  cache is invalidated immediately on page hide, mute, or entrypoint transition;
  mute may retain the active source for its bounded 700ms fade. An offscreen card
  releases its source and cache after five seconds. A still-enabled, previously
  authorized view may reload and resume when visible. Audio failures are
  enhancement-only and must never interrupt gameplay.
- Audio asset replacements require a documented creator/source, redistribution
  rights, and matching OGG/MP3 encodes. Repository history alone is not evidence
  of those rights; keep an explicit provenance record with any replacement.

## Unified custom-post contract

- New Daily and Community custom posts JSON-encode exact immutable version-2
  snapshots under `postData.splash`. Daily includes `puzzleId`, `date`, ordered
  `board`, `par`, and `difficulty`; Community includes `id`, ordered `board`,
  `par`, `difficulty`, and `creator`. `board.pieces` order is identity-bearing
  because move transcripts use piece indexes; validation must not reorder it.
- Exact V2 boards paint before a server round trip. On the first deliberate board
  interaction, inline play calls `GET /api/init` to reconcile the snapshot with
  the authoritative host puzzle; Daily receives its `playId` then.
- Current-bundle historical posts with valid host mappings automatically upgrade
  to exact snapshots through read-only `GET /api/post-preview`. It never issues a
  Daily `playId` or any other play capability, and Daily preview never returns
  personalized solved state.
- Daily submits `{puzzleId,playId,moves}` to `POST /api/solve`. Community submits
  one frozen canonical `{id,moves}` transcript to `POST /api/ugc/played`; retries
  reuse it. Both are server-replayed. Signed success persists; guest Daily is
  verified without rank/streak persistence, and guest Community returns
  `saved:false` without durable played-ledger or creator-total writes.
- Snapshot/preview/init disagreement aborts stale work, freezes the visible board,
  removes move controls, and exposes Retry/Open-full-game recovery. Expansion
  pending state also locks controllers created or upgraded after the request.
  A prior Daily solve does not replace the inline board; the expanded-view
  "Getting the penguins ready..." loader and solved-Daily recap are `GameScene`
  behavior only.
- Compact feed sizing preserves board aspect ratio and constrains it by both card
  width and available height while keeping HUD, footer, and touch targets. Do not
  restore short-height `height: auto` or unconstrained grid-row overrides that
  collapse size-container rows.

## Server routing

- One Hono app. Mount public routes at `/api` (called by the client) and
  internal routes at `/internal` (menu, form, triggers, scheduler).
- Post creation uses `reddit.submitCustomPost({ title, ... })`; Daily and
  Community publication both write V2 splash snapshots plus authoritative host
  mappings.
- `GET /api/post-preview` is read-only host reconciliation/legacy upgrade.
  `GET /api/init` returns the authoritative host puzzle and lazily issues the
  Daily play capability. `POST /api/solve` verifies Daily transcripts;
  `POST /api/ugc/played` verifies Community transcripts.
- `GET /api/hub` is the hub's read-only summary (today's date and par, the
  viewer's verified result, rank, streak, and Endless total; parsed by
  `parseHubResponse`). It uses read-only lookups, so unlike `/api/init` it never
  issues a `playId`, starts the Daily clock, or generates a puzzle.
- User-attributed Reddit actions run server-side via `reddit`, using the `asUser`
  scopes declared in devvit.json: `reddit.subscribeToCurrentSubreddit()` (the
  win-screen "Join" -> `/api/subscribe`) and `reddit.submitComment({ ..., runAs:
  'USER' })` (the win-screen "Comment my score" -> `/api/comment-score`). The
  pinned daily/community comments are seeded as the app and distinguished, and
  double as live leaderboards: the app edits them with
  `reddit.getCommentById(id)` then `comment.edit({ text })`, only when the
  rendered text changed (`src/server/core/commentBoard.ts`). Comment and score
  names are plain text, never `u/` mentions.
- Leaderboard routes: `GET /api/leaderboard` (`puzzleId`, `day=yesterday`, or
  `post=1`; adds par, the move distribution, per-row streaks, and the viewer's
  name opt-out), `GET /api/leaderboard/board?kind=week|streak|alltime`, and
  `POST /api/leaderboard/visibility {hidden}`. Leaderboard reads use the
  read-only `findCanonicalDailyRef` / `findDailyPuzzle`, so a request-supplied
  id can never claim or generate a Daily.
- Persistence: `redis` (get/set/incrBy; hashes via hSet/hGet/hKeys/hDel/hLen for
  the endless pool; sorted sets for leaderboards via the zAdd/zRange family -
  verify exact signatures in docs at implementation time). No list ops
  (lPush/rPop) are available in the Devvit redis client, and no ZCOUNT or
  ZREVRANK: count members below a score with `countScoresBelow` (first member at
  or above the boundary via `zRange(..., { by: 'score', limit })`, then `zRank`).
- Scheduled jobs: `scheduler.tasks` in devvit.json, each a `cron` expression
  pointing at an `/internal/scheduler/...` endpoint - the daily puzzle post, an
  every-5-minutes endless pool refill, the comment-leaderboard refresh every
  5 minutes offset by two (`2,7,...,57 * * * *`) so it never shares a minute with
  the refill, and the week-ahead Daily preparation every 10 minutes at minute 4
  (`4,14,...,54 * * * *`, `prepareUpcomingDailies`) so it never shares a minute
  with the other jobs (the scheduler resolves ~once a minute; up to 10 recurring
  tasks per install). The Daily puzzle date rolls over at
  12:00 UTC (`dailyPuzzleDate` / `DAILY_ROLLOVER_UTC_HOUR` in `src/shared/date.ts`),
  matching the `0 12 * * *` post cron, so the hub's "today" is always the newest
  Daily post. Change both together. Telemetry and rate limits keep UTC days.
- Devvit Web allows 30 seconds per request, scheduled jobs included. Generation
  jobs have wall-clock budgets well under that (Daily preparation 15s, Endless
  refill 20s), save each puzzle as soon as it is made, and let the next run
  continue. Request-path generation stays bounded by the clients' 12-second
  timeouts (Daily on demand about 5.5s at worst, Endless about 1.2s).

## devvit.json (config, schema v1)

Key sections: `post.entrypoints` (default = `splash.html` tall inline playable
view, `game` = `game.html` expanded Phaser view), `server` (dir/entry),
`permissions` (`redis: true`, plus `reddit.enable` with `asUser` scopes
`SUBSCRIBE_TO_SUBREDDIT` + `SUBMIT_COMMENT` that back the win-screen Join and
Comment-my-score actions), `menu.items`, `triggers` (e.g. `onAppInstall`),
`scheduler.tasks` (cron - the `daily-puzzle`, `endless-refill`,
`comment-leaderboards`, and `daily-prepare` jobs), `scripts`
(`dev`: `vite build --watch`, `build`: `vite build`), and `dev.subreddit` (the
playtest subreddit, currently `ice_hop_dev`). (No `forms` are declared today.)

Local source/build changes do not alter already-live Reddit clients. Historical
upgrade works only when the post runs the current bundle and still has a valid
host mapping. Devvit asset-retrofit/version-pinning behavior is unconfirmed; an
old post pinned to an older uploaded bundle may need recreation after a confirmed
upload.

## Commands

- `npm run login`      -> `devvit login`
- `npm run dev`        -> `devvit playtest` (live test in a subreddit)
- `npm run build`      -> `vite build`
- `npm run type-check` -> `tsc --build`
- `npm run test`       -> `vitest run` (all tests); `npm run test -- <file>` for one
- `npm run bench:gen`  -> puzzle-generation benchmark (`tools/bench/`): Daily on
  demand and prepared, and the Endless pool, with time, par, best solutions,
  3-star luck, and repeats. Run it before and after any generation change.
  PowerShell drops options passed through `npm run ... --`; use
  `npx tsx tools/bench/generation.ts --days 56` there.
- `npm run test:ui`    -> build + phone-sized UI smoke test (`tools/ui-smoke/`):
  headless Chrome/Edge with touch emulation against a mock API; plays Daily and
  Community to a replay-verified win, checks feed cards never need inner
  scrolling, and fails on page exceptions. Needs Chrome/Edge (`CHROME_PATH`).
- `npm run deploy`     -> type-check + `devvit upload`
- `npm run launch`     -> deploy + `devvit publish`

(No `lint` script is configured; type-check is the gate before upload.)

## Hard rules (from official AGENTS.md)

- Devvit Web ONLY. Do NOT use `@devvit/public-api` or Devvit "blocks".
- No `window.alert` / `window.location` / `window.assign`; use client effects
  (`showToast`, `showForm`, `navigateTo`).
- Keep `splash.html` fast; put heavy deps (Phaser) in `game.html`.
- No inline `<script>` in HTML; use a separate ts/js file.
- Every new menu item / trigger / scheduler endpoint must also be registered in
  `devvit.json`.

## Code style

- Prefer `type` aliases over `interface`. Named exports over default exports.
- Never cast types. Keep `src/shared` free of Devvit/Phaser imports (pure TS) so
  the engine and solver stay unit-testable in isolation.

Docs index: https://developers.reddit.com/docs/llms.txt
