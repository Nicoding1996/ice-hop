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
├── brand/                   # app-listing art (icon.svg, banner.svg)
├── README.md                # game overview + how to play (hackathon requirement)
├── SUBMISSION.md            # Devpost submission kit (description + demo video script)
├── semantic-review/         # saved semantic-review reports (dev artifact, not shipped)
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
    │   ├── community.ts      # pure community-stream ordering (interleave + filter) + creator totals
    │   ├── scoring.ts        # moves-vs-par -> stars; leaderboard score encode/decode
    │   ├── share.ts          # spoiler-free emoji share text + score-comment text
    │   └── date.ts           # daily date key + deterministic seed helpers
    ├── server/
    │   ├── index.ts         # Hono entry (mounts /api and /internal)
    │   ├── routes/
    │   │   ├── api.ts        # /api/* (init, solve, subscribe, comment-score, leaderboard, endless[/stats,/solved])
    │   │   ├── ugc.ts        # /api/ugc/* (submit, list, mine, vote, played)
    │   │   ├── menu.ts       # /internal/menu/*
    │   │   ├── triggers.ts   # /internal/triggers/* (onAppInstall: first post + endless warm-up)
    │   │   └── scheduler.ts  # /internal/scheduler/* (daily puzzle + endless pool refill crons)
    │   └── core/
    │       ├── post.ts       # create daily + community posts + seed the pinned how-to comment
    │       ├── daily.ts      # daily puzzle generation/storage (Redis)
    │       ├── endless.ts    # endless tiered generation + pre-generated pool + fast fallback + solve stats
    │       ├── leaderboard.ts# Redis sorted sets + streaks
    │       ├── ugc.ts        # user puzzle submit/list/mine/vote/played + solver validation
    │       └── keys.ts       # single source of truth for Redis keys
    └── client/
        ├── splash.html/.css/.ts   # inline feed view (fast, light)
        ├── game.html/.css/.ts     # expanded Phaser view (game.ts bootstraps Phaser)
        ├── audio.ts               # tiny Web Audio synth SFX (tap/slide/splash/win) + mute pref
        ├── howToPlay.ts           # shared "How to play" overlay (hub + play screen)
        ├── art/theme.ts           # palette, vector draw helpers, transitions, win FX
        └── scenes/                # Phaser scenes
            ├── Boot.ts            # boot, load audio pref, launch GameScene
            ├── HomeScene.ts       # hub: Play / Endless / Build / My puzzles / Community + sound + how-to
            ├── GameScene.ts       # play the daily, an endless, a community, or a test puzzle
            ├── EditorScene.ts     # build + live-validate a puzzle
            ├── CommunityScene.ts  # load the community stream, hand off to GameScene
            ├── EndlessScene.ts    # endless tier select (Easy/Medium/Hard) + solved banner
            └── MyPuzzlesScene.ts  # creator dashboard: your puzzles + solves/votes (GET /api/ugc/mine)
```

## Conventions

- Engine pieces are theme-agnostic: `HOPPER` (jumps), `SLIDER` (moves along an
  axis), `BLOCKER` (fixed), and `HOLE`/`GOAL` targets. Theme/art is a skin on top
  (penguin / seal / ice rock / water) so we can repaint without touching logic.
- Redis keys live in one place (`src/server/core/keys.ts`). Current keys:
  `daily:5:{date}` (puzzle; the `5` is a schema version bumped to force regen),
  `post:{postId}` (daily post -> date), `post:ugc:{postId}` (community post -> UGC
  submission id; a distinct prefix so daily and community posts never collide),
  `solve:{date}:{user}`, `lb:{date}` and `lb:all` (leaderboard sorted sets),
  `streak:{user}`, `subscribed:{user}` (app-side flag set by the in-app Join
  button, since Reddit exposes no live-subscription read - used only to stop
  re-prompting), and for UGC: `ugc:counter`, `ugc:sub:{id}`, `ugc:index` (sorted
  set by votes), `ugc:recent` (sorted set by createdAt), `ugc:voters:{id}` (hash,
  one-vote-per-user), `ugc:boards` (hash of board signatures for dedup),
  `ugc:solves` (hash id -> solve count, the creator-feedback signal),
  `ugc:bycreator:{user}` (sorted set of a user's own submissions, for "My
  puzzles"), `ugc:played:{user}` (sorted set of solved puzzles),
  `ugc:subs:{user}:{date}` (per-day submission counter for the rate limit),
  `endless:{user}` (lifetime count of endless puzzles solved - the progression
  banner), `endless:{user}:{tier}` (the per-tier split shown on the tier-select
  buttons), and `endless:pool:1:{tier}` + `endless:poolseq:1:{tier}` (the
  pre-generated endless puzzle pool per tier - a hash of id -> JSON {board,par} -
  and its id sequence; the `1` is a pool schema version).
