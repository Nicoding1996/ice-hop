# Project Structure

Mirrors the official Devvit Web layout (`src/{client,server,shared}`), extended
for this game. Keep `src/shared` pure (no Devvit/Phaser imports).

```
.
├── devvit.json              # Devvit app config (entrypoints, server, scheduler, menu, triggers)
├── package.json
├── vite.config.ts
├── tsconfig.json            # project references -> tools/*
├── tools/                   # tsconfig.{base,client,server,shared,vite}.json
├── public/                  # static assets served to the client
├── README.md                # game overview + how to play (hackathon requirement)
├── SUBMISSION.md            # Devpost submission kit (description + demo video script)
├── .kiro/steering/          # these docs
└── src/
    ├── shared/              # PURE TS, unit-testable, no platform imports
    │   ├── game/
    │   │   ├── types.ts      # Board, Piece, Move, PieceKind, etc.
    │   │   ├── board.ts      # encode/decode, occupancy, isSolved (win detection)
    │   │   ├── moves.ts      # legal-move generation (hop + slide)
    │   │   └── rules.ts      # applyMove; re-exports isSolved
    │   ├── solver/
    │   │   ├── solver.ts     # BFS optimal solution + par; optimal-solution count
    │   │   ├── generator.ts  # procedural generation (solver-filtered + quality gates)
    │   │   ├── difficulty.ts # grade a puzzle (par length, branching)
    │   │   ├── quality.ts    # classify pieces: used / decoy / inert (no-clutter gate)
    │   │   └── validate.ts   # validate a user-built board (size/counts/solvable/par)
    │   ├── __tests__/        # vitest: engine, scoring, share, validate, quality, community
    │   ├── api.ts            # client<->server DTOs
    │   ├── community.ts      # pure community-stream ordering (interleave + filter)
    │   ├── scoring.ts        # moves-vs-par -> stars; leaderboard score encode/decode
    │   ├── share.ts          # spoiler-free emoji share text
    │   └── date.ts           # daily date key + deterministic seed helpers
    ├── server/
    │   ├── index.ts         # Hono entry (mounts /api and /internal)
    │   ├── routes/
    │   │   ├── api.ts        # /api/* (init, solve, leaderboard)
    │   │   ├── ugc.ts        # /api/ugc/* (submit, list, vote)
    │   │   ├── menu.ts       # /internal/menu/*
    │   │   ├── triggers.ts   # /internal/triggers/* (onAppInstall)
    │   │   └── scheduler.ts  # /internal/scheduler/* (daily puzzle cron)
    │   └── core/
    │       ├── post.ts       # create daily post + seed the pinned how-to comment
    │       ├── daily.ts      # daily puzzle generation/storage (Redis)
    │       ├── leaderboard.ts# Redis sorted sets + streaks
    │       ├── ugc.ts        # user puzzle submit/list/vote + solver validation
    │       └── keys.ts       # single source of truth for Redis keys
    └── client/
        ├── splash.html/.css/.ts   # inline feed view (fast, light)
        ├── game.html/.css/.ts     # expanded Phaser view (game.ts bootstraps Phaser)
        ├── audio.ts               # tiny Web Audio synth SFX (tap/slide/splash/win) + mute pref
        ├── art/theme.ts           # palette, vector draw helpers, transitions, win FX
        └── scenes/                # Phaser scenes
            ├── Boot.ts            # boot, load audio pref, launch GameScene
            ├── HomeScene.ts       # hub: Play / Build / Community + sound toggle
            ├── GameScene.ts       # play the daily or a community puzzle
            ├── EditorScene.ts     # build + live-validate a puzzle
            └── CommunityScene.ts  # load the community stream, hand off to GameScene
```

## Conventions

- Engine pieces are theme-agnostic: `HOPPER` (jumps), `SLIDER` (moves along an
  axis), `BLOCKER` (fixed), and `HOLE`/`GOAL` targets. Theme/art is a skin on top
  (penguin / seal / ice rock / water) so we can repaint without touching logic.
- Redis keys live in one place (`src/server/core/keys.ts`). Current keys:
  `daily:5:{date}` (puzzle; the `5` is a schema version bumped to force regen),
  `post:{postId}` (post -> date), `solve:{date}:{user}`, `lb:{date}` and `lb:all`
  (leaderboard sorted sets), `streak:{user}`, and for UGC: `ugc:counter`,
  `ugc:sub:{id}`, `ugc:index` (sorted set by votes), `ugc:recent` (sorted set by
  createdAt), `ugc:voters:{id}` (hash, one-vote-per-user), `ugc:boards` (hash of
  board signatures for dedup), `ugc:played:{user}` (sorted set of solved puzzles),
  and `ugc:subs:{user}:{date}` (per-day submission counter for the rate limit).
