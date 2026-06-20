# Tech Stack

Devvit Web app (runs on Reddit.com). Verified against reddit/devvit-template-phaser.

## Versions / runtime

- Node >= 22.2.0, ES modules (`"type": "module"`).
- `devvit`, `@devvit/web`, `@devvit/start`: 0.12.24
- `hono` 4.x + `@hono/node-server`; `phaser` 4.1.0
- Build: Vite with the `@devvit/start/vite` plugin. TypeScript project references.

## Two execution contexts

- Client (`src/client`): runs in an iframe on reddit.com. Import from
  `@devvit/web/client` (e.g. `navigateTo`, `showToast`, `showForm`).
- Server (`src/server`): secure serverless Node 22. A Hono app. Import from
  `@devvit/web/server`: `context` (postId, subredditName, userId...), `redis`,
  `reddit`, `createServer`, `getServerPort`.
- Shared (`src/shared`): pure TS shared by both. Trigger/request types come from
  `@devvit/web/shared`.

## Server routing

- One Hono app. Mount public routes at `/api` (called by the client) and
  internal routes at `/internal` (menu, form, triggers, scheduler).
- Post creation: `reddit.submitCustomPost({ title, ... })`.
- Persistence: `redis` (get/set/incrBy; sorted sets for leaderboards via the
  zAdd/zRange family - verify exact signatures in docs at implementation time).
- Daily content: `scheduler.tasks` in devvit.json with a `cron` expression
  pointing at an `/internal/scheduler/...` endpoint.

## devvit.json (config, schema v1)

Key sections: `post.entrypoints` (default = `splash.html` inline feed view,
`game` = `game.html` expanded view), `server` (dir/entry), `menu.items`,
`forms`, `triggers` (e.g. `onAppInstall`), `scheduler.tasks` (cron), `scripts`
(`dev`: `vite build --watch`, `build`: `vite build`).

## Commands

- `npm run login`      -> `devvit login`
- `npm run dev`        -> `devvit playtest` (live test in a subreddit)
- `npm run build`      -> `vite build`
- `npm run type-check` -> `tsc --build`
- `npm run test`       -> `vitest run` (all tests); `npm run test -- <file>` for one
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
