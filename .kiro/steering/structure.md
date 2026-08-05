# Project Structure

The project follows the Devvit Web `src/{client,server,shared}` layout. Keep
`src/shared` pure: no Devvit or Phaser imports.

```
.
├── devvit.json              # entrypoints, server, permissions, menu, triggers, scheduler
├── package.json
├── vite.config.ts
├── tsconfig.json            # project references -> tools/*
├── tools/                   # tsconfig.{base,client,server,shared,vite}.json
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
    │   │   └── proof.ts      # exact-board creator solve proof
    │   ├── solver/
    │   │   ├── solver.ts     # BFS optimal solution/par and solution count
    │   │   ├── generator.ts  # procedural generation and quality gates
    │   │   ├── difficulty.ts # par-to-difficulty grading
    │   │   ├── quality.ts    # used/decoy/inert classification
    │   │   └── validate.ts   # user-board policy and solvability
    │   ├── __tests__/        # pure engine, policy, scoring, sharing, proof tests
    │   ├── achievements.ts   # pure quantity/tier award evaluation
    │   ├── telemetry.ts      # bounded client telemetry event allowlist
    │   ├── api.ts            # client/server DTOs
    │   ├── daily.ts          # immutable Daily puzzle identities/migration parser
    │   ├── community.ts      # stream ordering and creator totals
    │   ├── scoring.ts        # stars and leaderboard score encoding
    │   ├── share.ts          # spoiler-free share/comment copy
    │   └── date.ts           # UTC date and deterministic seed helpers
    ├── server/
    │   ├── index.ts          # Hono entry; mounts /api and /internal
    │   ├── routes/
    │   │   ├── api.ts        # init, verified solves, social actions, telemetry
    │   │   ├── ugc.ts        # submit/list/mine/vote/verified played routes
    │   │   ├── menu.ts       # moderator menu endpoints
    │   │   ├── triggers.ts   # install warm-up/first post
    │   │   └── scheduler.ts  # daily post and Endless refill jobs
    │   └── core/
    │       ├── completion.ts  # issue records and authoritative transcript verification
    │       ├── achievements.ts# Redis first-unlock persistence
    │       ├── telemetry.ts   # bounded aggregate daily counters
    │       ├── post.ts        # daily/community posts and pinned comments
    │       ├── daily.ts       # bounded daily generation and storage
    │       ├── dailyPolicy.ts # pure weekday bands and verified fallbacks
    │       ├── endless.ts     # tiered pool, fallback generation, stats
    │       ├── leaderboard.ts # sorted sets, streaks, flair
    │       ├── ugc.ts         # validation, storage, voting, stream queries
    │       ├── keys.ts        # single source of truth for Redis keys
    │       └── __tests__/     # pure server policy tests
    └── client/
        ├── splash.html/.css/.ts   # lightweight inline feed view
        ├── game.html/.css/.ts     # expanded Phaser bootstrap
        ├── audio.ts               # sound/music state and playback
        ├── telemetry.ts           # best-effort fixed-event client reporting
        ├── howToPlay.ts           # shared instructions overlay
        ├── art/theme.ts           # palette, vector art, transitions, win FX
        └── scenes/
            ├── Boot.ts
            ├── HomeScene.ts
            ├── GameScene.ts       # daily, Endless, Community, and Test play
            ├── EditorScene.ts
            ├── CommunityScene.ts
            ├── EndlessScene.ts    # tiers, counts, Awards overlay
            └── MyPuzzlesScene.ts
```

## Conventions

- Engine pieces stay theme-agnostic: `HOPPER`, `SLIDER`, `BLOCKER`, and `HOLE`.
- Parse untrusted boards and move histories with shared runtime validators. Never
  trust client move counts, par, tier, IDs, timing, or creator proof claims.
- Guests never share a Redis identity. Guest progression is Phaser-session state;
  persistent progression requires an authenticated Reddit username.
- Redis keys live only in `src/server/core/keys.ts`. Current families include:
  - daily: immutable `daily:{schema}:{date}` boards, versioned post mappings,
    user-bound play issues, a migration baseline plus permanent per-user date
    ledger, bounded per-puzzle score candidates/materialized bests, leaderboards,
    streaks, and score-comment claims;
  - UGC: submissions, vote/recent/creator indexes, board deduplication, voters,
    a verified played ledger, bounded completion candidates/materialized bests,
    solve totals, and daily submit limits;
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
