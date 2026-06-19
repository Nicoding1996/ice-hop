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
├── .kiro/steering/          # these docs
└── src/
    ├── shared/              # PURE TS, unit-testable, no platform imports
    │   ├── game/
    │   │   ├── types.ts     # Board, Piece, Move, PieceKind, etc.
    │   │   ├── board.ts     # board encode/decode, helpers
    │   │   ├── moves.ts     # legal-move generation (hop + slide)
    │   │   └── rules.ts     # apply move, win detection
    │   ├── solver/
    │   │   ├── solver.ts    # BFS optimal solution + solvability/uniqueness
    │   │   ├── generator.ts # procedural puzzle generation
    │   │   └── difficulty.ts# grade a puzzle (par length, branching)
    │   └── api.ts           # client<->server DTOs
    ├── server/
    │   ├── index.ts         # Hono entry (mounts /api and /internal)
    │   ├── routes/
    │   │   ├── api.ts        # /api/* client-facing endpoints
    │   │   ├── menu.ts       # /internal/menu/*
    │   │   ├── triggers.ts   # /internal/triggers/* (onAppInstall)
    │   │   └── scheduler.ts  # /internal/scheduler/* (daily puzzle cron)
    │   └── core/
    │       ├── post.ts       # submitCustomPost helpers
    │       ├── daily.ts      # daily puzzle storage/selection (Redis)
    │       ├── scoring.ts    # moves-vs-par -> stars
    │       ├── leaderboard.ts# Redis sorted sets
    │       └── ugc.ts        # user puzzle submit + solver validation
    └── client/
        ├── splash.html/.css/.ts   # inline feed view (fast, light)
        ├── game.html/.css/.ts     # expanded Phaser view
        └── scenes/                # Phaser scenes (Boot, Preloader, Game, ...)
```

## Conventions

- Engine pieces are theme-agnostic: `HOPPER` (jumps), `SLIDER` (moves along an
  axis), `BLOCKER` (fixed), and `HOLE`/`GOAL` targets. Theme/art is a skin on top
  so we can repaint without touching logic (and to keep our own identity).
- Redis key naming: `daily:{date}` (puzzle), `solve:{date}:{userId}`,
  `lb:{date}` and `lb:all` (sorted sets), `streak:{userId}`,
  `ugc:queue` / `ugc:{id}` (submissions). Keep a single source of truth for keys.
