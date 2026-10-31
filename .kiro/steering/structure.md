# Project Structure

The project follows the Devvit Web `src/{client,server,shared}` layout. Keep
`src/shared` pure: no Devvit or Phaser imports.

```
.
├── devvit.json              # entrypoints, server, permissions, menu, triggers, scheduler
├── package.json
├── vite.config.ts
├── tsconfig.json            # project references -> tools/*
├── tools/                   # tsconfig.{base,client,server,shared,vite,ui-smoke}.json
│   └── ui-smoke/            # npm run test:ui: CDP driver, mock API server, scenarios
├── brand/                   # active app art: icon.png, icon.svg, banner.svg
├── docs/archive/            # dated historical material; not active product guidance
├── README.md                # player overview, development guide, release history
├── .kiro/steering/          # active engineering/product guidance
└── src/
    ├── shared/              # PURE TS, unit-testable, no platform imports
    │   ├── game/
    │   │   ├── types.ts      # Board, Piece, Move, PieceKind
    │   │   ├── board.ts      # signatures, occupancy, solved-state helpers
    │   │   ├── moves.ts      # legal hop and slide generation
    │   │   ├── rules.ts      # applyMove and isSolved
    │   │   ├── validation.ts # strict runtime board parser/normalizer
    │   │   ├── replay.ts     # canonical legal transcript replay
    │   │   ├── slide.ts      # seal lane stops shared by feed post and full game
    │   │   ├── motion.ts     # shared move timing, win beat, seal water check
    │   │   └── proof.ts      # exact-board creator solve proof
    │   ├── solver/
    │   │   ├── solver.ts     # BFS optimal solution/par and solution count
    │   │   ├── generator.ts  # procedural generation and quality gates
    │   │   ├── difficulty.ts # par-to-difficulty grading
    │   │   ├── quality.ts    # used/decoy/inert classification
    │   │   └── validate.ts   # user-board policy and solvability
    │   ├── __tests__/        # pure engine, policy, scoring, sharing, proof tests
    │   ├── achievements.ts   # pure quantity/tier award evaluation
    │   ├── tutorial.ts       # three Practice lessons (boards + captions)
    │   ├── telemetry.ts      # bounded client telemetry event allowlist
    │   ├── api.ts            # V2 splash/preview/init/solve DTOs
    │   ├── daily.ts          # immutable Daily puzzle identities/migration parser
    │   ├── community.ts      # stream ordering and creator totals
    │   ├── scoring.ts        # stars and leaderboard score encoding
    │   ├── leaderboard.ts    # distributions, ranks, durations, response parsers
    │   ├── commentBoard.ts   # live pinned-comment leaderboard Markdown
    │   ├── share.ts          # spoiler-free share/comment copy
    │   └── date.ts           # UTC/puzzle dates, weeks, labels, seed helpers
    ├── server/
    │   ├── index.ts          # Hono entry; mounts /api and /internal
    │   ├── routes/
    │   │   ├── api.ts        # post preview/init, Daily replay, leaderboards, social actions, telemetry
    │   │   ├── ugc.ts        # submit/list/mine/vote/Community replay routes
    │   │   ├── menu.ts       # moderator menu endpoints
    │   │   ├── triggers.ts   # install warm-up/first post
    │   │   └── scheduler.ts  # daily post, Endless refill, comment-leaderboard jobs
    │   └── core/
    │       ├── completion.ts  # issue records and authoritative transcript verification
    │       ├── achievements.ts# Redis first-unlock persistence
    │       ├── telemetry.ts   # bounded aggregate daily counters
    │       ├── post.ts        # V2 Daily/Community posts, mappings, pinned comments
    │       ├── daily.ts       # bounded daily generation and storage
    │       ├── dailyPolicy.ts # pure weekday bands and verified fallbacks
    │       ├── endless.ts     # tiered pool, refill budget, stats
    │       ├── endlessPolicy.ts # pure tier shapes, bands, fallbacks, generators
    │       ├── leaderboard.ts # sorted sets, streaks, weekly/streak/all-time boards, flair
    │       ├── commentBoard.ts# live pinned-comment boards: queue, render, edit
    │       ├── ugc.ts         # validation, storage, voting, stream queries
    │       ├── keys.ts        # single source of truth for Redis keys
    │       └── __tests__/     # pure server policy tests
    └── client/
        ├── splash.html/.css/.ts   # Phaser-free playable Daily/Community feed surface
        ├── inlineDaily.ts         # shared inline controller, replay, recovery
        ├── dailyHandoff.ts        # bounded Daily attempt continuation to GameScene
        ├── game.html/.css/.ts     # expanded Phaser bootstrap
        ├── audio.ts               # sound/music state and playback
        ├── telemetry.ts           # best-effort fixed-event client reporting
        ├── howToPlay.ts           # shared instructions overlay
        ├── leaderboard.ts         # shared Leaderboards overlay (hub, win, feed link)
        ├── art/theme.ts           # palette, vector art, transitions, win FX
        └── scenes/
            ├── Boot.ts
            ├── HomeScene.ts
            ├── GameScene.ts       # daily, Endless, Community, Test, recap/loading
            ├── EditorScene.ts
            ├── CommunityScene.ts
            ├── EndlessScene.ts    # tiers, counts, Awards overlay
            └── MyPuzzlesScene.ts
```

## Conventions

- Engine pieces stay theme-agnostic: `HOPPER`, `SLIDER`, `BLOCKER`, and `HOLE`.
- Parse untrusted boards and move histories with shared runtime validators. Never
  trust client move counts, par, tier, IDs, timing, or creator proof claims.
- Preserve `board.pieces` order: transcripts use piece indexes, so the ordered
  array is part of immutable puzzle identity even when geometry appears equal.
- New custom posts carry exact V2 `postData.splash` snapshots. Reconcile preview
  and lazy init data with the authoritative host puzzle; disagreement fails closed
  with a frozen board and recovery actions rather than swapping identities.
- Guests never share a Redis identity or receive durable progression. Daily and
  Community guest transcripts may still be server-verified; Community returns
  `saved:false` and writes neither the played ledger nor creator solve totals.
  Persistent progression requires an authenticated Reddit username.
- Redis keys live only in `src/server/core/keys.ts`. Current families include:
  - daily: immutable `daily:{schema}:{date}` boards, versioned post mappings,
    user-bound play issues, a migration baseline plus permanent per-user date
    ledger, bounded per-puzzle score candidates/materialized bests, leaderboards,
    streaks, and score-comment claims;
  - cross-puzzle boards: expiring weekly star totals keyed by the Monday puzzle
    date, a streak board whose rows mirror each streak record (lapsed rows are
    filtered and removed on read), the all-time `lb:all`, and the comment-board
    name opt-out hash;
  - comment boards: one queue of boards to render, per-board pinned-comment
    targets and change counters, and the last text written to each comment;
  - UGC: submissions, vote/recent/creator indexes, board deduplication, voters,
    a verified played ledger, bounded completion candidates/materialized bests,
    a per-puzzle best-solve board, solve totals, and daily submit limits;
  - Endless: migration baselines, permanent per-tier completion ledgers, atomic
    hint/completion resolution claims, Hard-at-par, awards, user-bound issues,
    and versioned per-tier pools/sequences;
  - telemetry: versioned aggregate day counters, short-lived per-actor request
    limits, and 32-day username-keyed daily-active membership hashes used to
    derive unique/return totals.
- A Redis schema version changes only when stale data must be ignored or
  regenerated; document the reason in the corresponding key comment.
- Historical event/submission material belongs under `docs/archive/`, never in
  active steering or runtime structure.
