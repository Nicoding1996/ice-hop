# Ice Hop 🐧

A daily logic-puzzle game that runs natively inside a Reddit post, powered by
[Devvit Web](https://developers.reddit.com/docs).

Guide every penguin into the water. Every penguin hops, every seal slides, and
the ice never moves. Solve the daily in as few moves as possible, keep your
streak alive, climb the leaderboard, race through Endless mode, and build puzzles
for everyone else to play.

**Play it live on Reddit: [r/IceHop](https://www.reddit.com/r/IceHop/)**

---

## How to play

The board is a small grid of ice. On it you'll find penguins, seals, ice rocks,
and open water holes.

- **Penguins (you move these).** Tap a penguin to hop. A penguin only moves by
  **jumping in a straight line** over one or more pieces sitting next to it,
  landing on the first empty square beyond them. It can't shuffle into an empty
  square next door; it has to jump something.
- **Seals.** Drag a seal along its lane to slide it any distance, or tap it and
  then tap where it should stop. Seals can't jump
  and **won't slide into the water** (they'd fall in), so you'll often slide a
  seal out of the way to open a path, or use it as a stepping stone to hop over.

The controls are the same in the feed post and the full game. Tap a penguin,
then tap its destination square (marked with a gold dot). Every tap acts when
you lift your finger, so sliding off a button cancels a mis-tap.
- **Ice rocks.** They never move. Pure obstacles to hop over and slide around.
- **Water holes.** The goal. **The puzzle is solved when every penguin is sitting
  in a hole.** There are always exactly as many holes as penguins, so "everyone
  in the water" is the finish line.

That's the whole game: tap a penguin, watch it hop, and figure out the order that
gets everyone into the water. A quick how-to greets first-timers, then gets out of
the way.

### Scoring

Every puzzle has a **par**: the fewest moves possible, computed by the game's
solver. One hop or one slide counts as one move. You're scored golf-style against
par:

- **3 stars** - solved in par or par + 1 (a clean line)
- **2 stars** - solved in up to double par
- **1 star** - solved at all (you still got them home)

The leaderboard ranks by **fewest moves first, fastest time as the tiebreak**, so
insight matters more than speed.

### While you play

- **Undo** steps back one move and **Restart** returns to the start, both from
  the bar under the board. Every move can be reversed, so a wrong move is never
  a dead end, and only your final move list is scored.
- A gold **star goal** beside Moves/Par shows the best stars you can still get,
  for example "★★★ up to 7".
- A penguin that can hop again stays selected after its hop, so chains of hops
  take one tap each.
- When the last penguin dives in, everyone cheers for a moment before the result
  card. **Try for ★★★** on the win screen replays the same puzzle; your best
  verified score is the one that counts.
- New players can open **Practice** from the How-to card: three tiny lessons for
  hopping, sliding a seal, and hopping back out of the water.
- **Endless mode** has an optional **Hint** that glows the next good move when
  you're stuck, so you keep learning. A hinted solve doesn't count toward your
  Endless total, so the number stays honest.
- No sign-in wall: play as a guest, and sign in from the win screen when you want
  to save your streak and progress.

### Sound and music

Ice Hop has synthesized hop, slide, splash, and win effects plus a calm ambient
soundtrack. **SFX** and **Music** can be changed independently from the playable
feed post and the expanded hub; the speaker in expanded play is a temporary
combined mute that restores the channel mix you had before muting.

Music never starts because a card merely scrolled into view. In the feed it
starts only after your first legal move; in the expanded game it starts after
your first pointer or keyboard gesture. Hidden or offscreen views suspend audio,
and the inline win arpeggio waits until the server has verified the completed
move history.

---

## Ways to keep playing

- **A fresh puzzle every day.** One shared daily puzzle, auto-posted to the feed.
  Difficulty ramps across the week: easy on Monday and Tuesday, medium midweek,
  hardest on the weekend.
- **Endless mode.** Finished the daily and still want more? Pick Easy, Medium, or
  Hard and play a never-ending shuffle of fresh, solver-made puzzles. Every
  no-hint solve adds one to your lifetime and tier totals; awards mark overall
  milestones, tier mastery, and a Hard solve exactly at par. Hinted solves stay
  available for learning but do not advance progress.
- **Streaks.** Solve day after day to build a streak. Miss a day and it resets.
  Your subreddit flair shows the streak ("🔥 7-day streak"), a public nudge to
  keep coming back. Without one it shows the Dailies you've solved ("🐧 45
  Dailies solved"), and creators also get their puzzle count.
- **Leaderboards.** Each daily puzzle is its own race, ranked by fewest moves
  with verified time as the tiebreak. The **Leaderboards** screen (from the
  menu, the Daily win screen, or the feed result's "Leaderboard ›" link) shows
  today's or yesterday's board with a move-count chart and streak flames, plus
  this week's stars (Monday to Sunday, reset at Monday's 12:00 UTC rollover),
  current streaks, and all-time days solved.
- **A live comment leaderboard.** Every puzzle post's pinned comment shows a live
  top 10 that updates every few minutes: moves, times, how many players hit par,
  and a move-count chart. When the day's puzzle closes it freezes into
  **Final results**, and the next day's board names yesterday's winner. Names
  are plain text (no "u/" pings), and any player can hide their name on comment
  boards from the Leaderboards screen.
- **Shareable result.** Copy a spoiler-free emoji summary of your solve (par,
  moves, streak) straight into the comments to compare without spoiling the board,
  or tap **Comment my score** to post a line like
  "🐧 Daily Oct 30 · ⭐⭐⭐ 6 moves (par 6) 🎯 · 🔥 3-day streak" under the
  pinned leaderboard.
- **Build your own + a community stream.** Make your own puzzle in the editor;
  the solver checks that it is structurally valid and solvable, and Submit stays
  locked until you personally solve that exact board in Test mode. Accepted
  puzzles go into a community list anyone can browse or play straight through
  (solve one, jump to the next, or skip), upvoting the ones they like with the
  creator credited. That's an endless supply of "one more" puzzles and a reason
  for creators to come back and see how their puzzle is doing.

---

## Building a puzzle (the editor)

Open the **Build** screen from the game to design a board:

- Place **Penguin**, **Seal**, **Rock**, or **Water**, or use **Erase**.
- Tap the **Seal** tool again to rotate the seal between horizontal and vertical.
- **Random** drops a solver-generated starter board you can riff on.
- **Undo** steps back your last placement.
- **Test** drops you into your own board. You must solve the exact current board
  before **Submit** unlocks; changing anything invalidates that proof and asks you
  to test again. A **Build → Test → Submit** stepper at the top shows where you
  are.
- The editor runs the solver live. The line under the board says what is missing
  (with penguin and water-hole counts) or that the board is **solvable**, with its
  **par** and difficulty. The server independently replays the creator proof
  before publication.

A valid submission is a 4-6 wide/tall board with 1-4 penguins, an equal number of
water holes, a real solution, and a par of at least 2. You can submit up to 5
puzzles a day and exact duplicates are rejected. For signed-in players, the
community stream skips puzzles in the durable solved ledger and mixes popular
picks with fresh new ones; verified guest solves remain unsaved. That keeps the
stream varied and gives every creator a fair shot.

---

## Tech stack

- **[Devvit Web](https://developers.reddit.com/docs)** (`devvit` / `@devvit/web`
  `0.15.1`) - runs the app inside a Reddit post.
- **[Phaser](https://phaser.io) 4** - powers the expanded `game.html` app; the
  playable feed board is a separate Phaser-free DOM/SVG surface.
- **[Hono](https://hono.dev) 4** - the serverless API on Devvit's Node runtime.
- **TypeScript** + **Vite** (via `@devvit/start/vite`), with a pure, framework-free
  game engine and solver shared between both clients and the server.
- **Web Audio API** for synthesized game cues and a lazily decoded ambient loop,
  shipped as OGG plus MP3 fallback with independent persisted SFX/music controls.
- **Redis** (Devvit's managed store) for the daily puzzle, solves, streaks,
  leaderboards, and community submissions.

The game logic is deliberately split from the theme. The engine speaks in
abstract pieces - `HOPPER`, `SLIDER`, `BLOCKER`, and `HOLE` goals - and the
penguins-on-ice look is just a skin on top. That keeps the solver and rules
unit-testable in isolation and lets the art change without touching gameplay.

## Project structure

```
src/
  shared/   # pure TS, no platform imports (engine, solver, scoring, DTOs)
    game/     # board, legal moves, apply-move + win detection, symmetry fingerprints, types
    solver/   # BFS solver (par), position-graph analysis, reverse + random generators, difficulty, UGC validation
    scoring.ts share.ts date.ts api.ts
    playLayout.ts    # play-screen geometry shared by GameScene and the UI smoke test
    leaderboard.ts   # distributions, ranks, durations, leaderboard and hub response parsers
    commentBoard.ts  # Markdown for the live pinned-comment leaderboards
  server/   # Hono app on Devvit (Node 22)
    routes/   # /api (preview, init, hub, solve, leaderboard, endless), /api/ugc, /internal (menu, cron, triggers)
    core/     # daily puzzle, endless pool, leaderboards + streaks, player flair, comment boards, UGC, posts, Redis keys
  client/   # runs in the post iframe
    audio.ts         # synthesized SFX, dual-format ambient loop, prefs + lifecycle
    leaderboard.ts   # shared Leaderboards overlay (Daily, Week, Streaks, All-time)
    public/          # checked-in OGG/MP3 soundtrack encodes copied into the build
    splash.*         # lightweight Phaser-free playable Daily/Community feed surface
    inlineDaily.ts   # shared inline board controller and verification/recovery UX
    dailyHandoff.ts  # bounded Daily attempt continuation into expanded play
    game.*           # expanded Phaser view
    expandedLaunch.ts # work started before Phaser loads: launch route, fonts, host puzzle request
    scenes/          # Boot, HomeScene, GameScene, EditorScene, CommunityScene, EndlessScene, MyPuzzlesScene
```

See `.kiro/steering/` for the full design, tech, and structure notes.

---

## Local development

Requires **Node >= 22.12.0** (matching the pinned Vite toolchain) and a Reddit account with the
[Devvit CLI](https://developers.reddit.com/docs/quickstart) set up.

```sh
npm install
npm run login        # devvit login (one time)
npm run dev          # devvit playtest - live-reloads into your test subreddit
```

`npm run dev` runs the app in a real subreddit (configured under `dev.subreddit`
in `devvit.json`, currently `ice_hop_dev`). Open the subreddit, use the
moderator menu action **"Post today's puzzle"** to create a post, and play.

Other scripts:

```sh
npm run type-check   # tsc --build
npm run test         # vitest run (engine, scoring, share, validation)
npm run test:ui      # build + phone-sized UI smoke test (needs Chrome or Edge)
npm run bench:gen    # puzzle-generation benchmark (time, par, best solutions, luck, repeats)
npm run build        # vite build
npm run deploy       # type-check + devvit upload
npm run launch       # deploy + devvit publish
```

### Audio release assets

The ambient soundtrack is one approximately 127.78-second stereo, 44.1 kHz loop
checked in as two browser-compatible encodes. Vite copies both files from
`src/client/public/` to the client artifact root:

- `ice-hop-music.ogg` — Vorbis, 1,833,149 bytes, SHA-256
  `25884E9026C587904B0D015E1678E9B58B6A1886447F4AA3358708D80F0AD026`
- `ice-hop-music.mp3` — MP3, 2,045,535 bytes, SHA-256
  `64F92B0C603BD91DA84621A885D21AB3A740D50508131901EA9536FF9F754BA4`

Chromium/Android prefers OGG; Safari/iOS goes directly to MP3, and a failed first
choice falls back to the other encode. The selected file is fetched only after a
local playback gesture and decoded for gapless Web Audio looping. Hidden and
offscreen documents suspend immediately. Page hide and entrypoint transition
release the source and decoded cache immediately; normal mute invalidates the
cache but lets the active source retain it for no more than a 700ms fade. An
offscreen feed card releases its source and cache after five seconds, so inactive
cards do not retain roughly 45 MB each. Returning views may reload only when music
is still enabled and that document was previously gesture-authorized.

The files entered this repository through project-author commits `0319f20` and
`42754f3`. **Release-owner rights attestation (2026-08-16):** the soundtrack was
created by the release owner or is covered by permission/license to redistribute
it in Ice Hop on Reddit, including both the OGG and MP3 encodes. Any future
replacement must carry an equivalent creator/source and redistribution-rights
record; commit history alone is not sufficient.

### How puzzle posts are created

- **Daily, automatically:** `scheduler.tasks.daily-puzzle` in `devvit.json` posts
  a fresh puzzle every day at 12:00 UTC (`0 12 * * *`). The Daily puzzle date
  rolls over at the same moment (`dailyPuzzleDate` in `src/shared/date.ts`), so
  "Play today's puzzle" in the menu is always the newest post and its thread.
  Change the cron and `DAILY_ROLLOVER_UTC_HOUR` together.
- **Daily puzzles are made a week ahead:** `scheduler.tasks.daily-prepare` runs
  every 10 minutes and keeps the next seven dates ready under the strict rules
  (one best solution, no clutter, low 3-star luck, no repeat of the last 60
  days). The 12:00 post uses the prepared puzzle; a date is never created
  before its day, so nobody can see it early. If none is ready, the post makes
  one on the spot within a few seconds, as before.
- **Daily, manually:** moderators can use **"Post today's puzzle"** at any time.
- **Community:** each accepted creator submission is published as its own custom
  post after structural, solver, duplicate, rate-limit, and creator-proof checks.

### How the pinned comment leaderboards update

Every new post seeds its distinguished, app-authored comment with the board
already rendered. `scheduler.tasks.comment-leaderboards` runs every five minutes
(offset two minutes from the Endless refill) and edits a pinned comment only when
its rendered text changed:

- Today's Daily board re-renders every run. The first run after the 12:00 UTC
  rollover renders the previous Daily once more as frozen **Final results** and
  stops updating it; later solves of that puzzle still count in the app.
- A Community board re-renders after a signed, non-creator solve improves it.
- Posts published before live boards attach on their first verified solve
  (Daily, current puzzle date only) or through the submission's post (Community).
- Hiding your name applies to live boards: today's Daily and the Community
  puzzles you appear on. Closed Daily results keep the names they closed with.

### How player flair updates

A signed player's subreddit flair shows one headline plus puzzles built: a
Daily streak of two or more days, otherwise Dailies solved, otherwise
"🐧 Ice Hopper" (`src/server/core/flair.ts`).

- A Daily solve or a published puzzle refreshes it. The text written last is
  stored, so a solve that changes nothing, such as a replay, makes no Reddit call.
- `scheduler.tasks.player-flair` runs every 10 minutes and rewrites the flair of
  players whose streak lapsed at the 12:00 UTC rollover, at most 30 per run. Its
  first runs also index streak flair written before the job existed.
- Ice Hop writes only over an empty flair it never set, or over flair that still
  shows Ice Hop text. If a player or moderator changes or removes it, Ice Hop
  leaves it alone. Setting it back to any Ice Hop text, such as "🐧 Ice Hopper",
  hands it back.
- Moderators can switch it off with the **Player flair** app setting. Off stops
  every update and leaves existing flair as it is.

### Playable feed-post contract

Daily and Community custom posts share the lightweight default entrypoint: a real
DOM/SVG board using the pure game engine, not a static launcher or reveal teaser.
It stays Phaser-free; Phaser remains in expanded `game.html` only.

- New posts JSON-encode an exact immutable version-2 snapshot under
  `postData.splash`. Daily stores `puzzleId`, `date`, the ordered `board`, `par`,
  and `difficulty`; Community stores `id`, the ordered `board`, `par`,
  `difficulty`, and `creator`. The order of `board.pieces` is identity-bearing
  because move transcripts address pieces by index; it must never be reordered.
- An exact V2 board paints immediately. On the first deliberate board interaction,
  `GET /api/init` reconciles it with the authoritative host puzzle; Daily receives
  its `playId` only then. Current-bundle historical posts with a valid host mapping
  automatically upgrade through read-only `GET /api/post-preview`, which issues no
  play capability and never returns personalized Daily solved state.
- Daily completion posts to `/api/solve`. Community completion posts one frozen
  canonical `{id,moves}` transcript to `/api/ugc/played`; retries resend those
  exact moves. Both paths replay the transcript against the server-known board.
  Signed success persists. Guest success is still verified, but guests never share
  a Redis identity or receive durable progression: Daily gets no rank or streak,
  and Community returns `saved:false` without entering the played ledger or
  increasing persistent creator solve totals.
- Snapshot, preview, or init disagreement fails closed: stale work is aborted, the
  visible board freezes, move controls disappear, and Retry/Open-full-game recovery
  remains. A pending expansion also locks controllers created or upgraded late.
- A prior Daily solve never replaces the inline board with a recap. The exact
  expanded-view "Getting the penguins ready..." loader and solved-Daily recap
  belong only to `GameScene`.
- Compact feed layout preserves board aspect ratio and limits it by both card width
  and available height while retaining the HUD, footer, and touch targets. Do not
  restore short-height `height: auto` or unconstrained grid-row overrides that
  collapse size-container rows.
- Inline seals work like the full game on both Daily and Community: drag a seal
  along its lane, or tap it to show its one-cell lane stops (pressing or focusing
  a stop previews the exact 1x2 landing footprint) and tap a stop. Keyboard uses
  the same labelled buttons. Touch drags stay feed-safe: a horizontal seal uses
  `touch-action: pan-y`, so up/down swipes still scroll Reddit, and a vertical
  seal, whose drag axis is the scroll axis, captures touch only after a tap
  selects it. Cancellation, lost capture, or leaving the iframe returns the seal
  to its origin without recording a move.
- No feed state scrolls inside the post (`.inline-stage` is `overflow: hidden`).
  Result cards fit by design, and `npm run test:ui` checks that at several card
  sizes. The header leads with difficulty and uses icon SFX/Music toggles so the
  difficulty and creator credit stay visible.
- Inline SFX and Music controls are independent, persisted, grouped for assistive
  technology, and remain at least 44px tall. A legal move—not a feed tap—starts
  enabled music and its move cue; water landings add a splash, and the win cue is
  delayed until authoritative Daily or Community verification succeeds.

Local source or build changes do not alter clients already live on Reddit.
Historical upgrade requires both the current bundle and a valid host mapping.
Devvit asset-retrofit/version-pinning behavior is not confirmed; if an old post
remains pinned to an older uploaded bundle, it may need recreation after a
confirmed upload.

---

## Community and progression

- **Start anywhere:** Daily and Community posts are directly playable in the feed.
  Use **Full game** for the expanded hub, Endless, Build, My Puzzles, and the
  Community stream. Wins always route to a useful next action.
- **Return tomorrow:** the daily, streak, daily leaderboard, weekly difficulty
  ramp, and subreddit flair provide a shared recurring challenge.
- **Keep playing today:** Endless is always available, even before a community has
  player-made boards. Counts and awards are quantity-based, so Easy, Medium, and
  Hard each add one honest solve when completed without a hint.
- **Create for other players:** Community submissions are solver-validated,
  de-duplicated, rate-limited, and require a legal creator solve of the exact
  submitted board. My Puzzles reports live solves and votes afterward.
- **Use the thread:** every puzzle post pins a live leaderboard comment,
  spoiler-free results are shareable, and signed-in players can post a verified
  score beneath it.
- **Protect progress:** server-side transcript replay verifies Daily, Endless, and
  Community completions. Daily and Community guest solves may still be verified,
  but guest progression is never durable or migrated after sign-in.
- **Keep the identity original:** the mechanic draws from classic peg-solitaire
  and sliding-logic genres; Ice Hop's name, art, generated boards, and community
  boards are its own.

---

## Changelog

The `0.0.x` entries identify explicit Devvit app uploads. `0.1.0` records the
source/package hardening milestone that preceded those later platform builds.

### 0.0.28 - 2026-10-31

Faster **Full game**. Timings below are the median of 9 runs in desktop Chrome
throttled to 4x CPU and 4G, from opening the expanded view to the first frame
with the board, for a returning player.

- The expanded view now asks for its puzzle while Phaser is still loading and
  starting, instead of after the play screen is built. This applies to
  Community posts, guests, and signed-in players continuing a Daily they
  started in the feed. A signed-in player who opens a Daily they haven't
  started still asks once the screen is ready: that request starts their Daily
  clock, and their time should not include engine start-up. A guest Daily went
  from 2.27s to 1.96s with a 300 ms server, and a Community puzzle from 3.07s
  to 2.23s with a 1 s server.
- Text is drawn once at full resolution instead of once at 1x and again at full
  size, and buttons no longer redraw an unchanged label. The first play screen
  uploads 30 text images to the GPU instead of 52, and fewer after each move.
- Phaser no longer builds its own unused audio system at startup, and the web
  fonts start loading before Phaser does. A signed-in Daily, which gets only
  these changes, went from 2.45s to 2.30s.

Player flair:

- A streak flair no longer outlives the streak. A new `player-flair` job
  rewrites it after the rollover where the streak ends, including flair set
  before this change.
- Without a streak, flair shows Dailies solved ("🐧 45 Dailies solved") instead
  of "🐧 Ice Hopper", which now marks new players.
- Ice Hop no longer replaces flair a player or moderator chose or removed.
- Moderators can turn player flair off with the new **Player flair** setting.
- A solve that would write the same text no longer rewrites the flair.

### 0.0.27 - 2026-10-31

Puzzle generation. Numbers below are from `npm run bench:gen` on one PC, before
and after: 28 Daily dates, and 300 Easy, 150 Medium and 60 Hard Endless boards.

- Puzzles are built in reverse: start from a finished board, map every position
  that can reach it, and pick starting boards with a known par and a known
  number of best solutions. The shared solver still checks every puzzle's par.
  Hard boards with one best solution come out in about half a second; random
  placement found none for a weekend Daily within its 2.5-second budget.
- Every Daily in the test now has exactly one best solution, so "how did you do
  it in 9?" has one answer. Before, no weekend Daily passed that check (one had
  106 equally short solutions), and 4 of 12 midweek Dailies skipped the quality
  checks entirely.
- Daily boards also limit "3-star luck", the chance that random moves earn 3
  stars (finish within par + 1 moves): at most 5% on Easy days and 1% on Medium
  and Hard days.
- Dailies are made a week ahead by a new `daily-prepare` job, so the 12:00 post
  never rushes one, and a prepared Daily never repeats one from the last 60
  days, counting mirrored and rotated copies. A date's puzzle can't be created
  before its day, and Daily boards no longer come from a seed derived from the
  date, which the public code would have let anyone compute.
- Endless no longer repeats for signed-in players: each player's last 500
  puzzles per level are skipped, counting mirrored and rotated copies, and the
  pool no longer holds the same puzzle twice. Easy also has four more piece
  mixes. Before, 72 of 300 Easy boards were repeats or mirrored copies of
  earlier ones; now the generator makes 20 in 300, and the seen list keeps those
  from reaching the same signed-in player twice.
- A pooled Endless puzzle now goes to exactly one player; two players asking at
  the same moment could both get it before.
- Endless boards are made much faster: Hard took about 7.8 seconds each (up to
  20) and now takes about 0.14 seconds, so pools refill sooner and an empty pool
  still serves a quality board within about a second.
- `npm run bench:gen` reports time, par, best solutions, 3-star luck and repeats
  for the Daily (on demand and prepared) and Endless generators.

### 0.0.26 - 2026-10-31

Phone-first release: touch and fit fixes, game feel, live leaderboards, and
redesigned full-game screens.

Touch, fit, and generation fixes from a phone-sized audit:

- One set of controls on both surfaces. Seals slide by drag or by tap-then-stop
  in the feed post and the full game. The full game's seal tap used to do
  nothing. The feed now also supports touch dragging within Reddit's
  scroll rules. A hop accepts a tap anywhere in its destination cell instead of
  only on a 26px dot, and every button acts on release.
- Feed result cards fit a tall post without inner scrolling: the old card cut off
  "Play again" and relied on an inner scroller that Reddit's scroll-trap rules
  reject. The header now leads with difficulty and creator credit and uses icon
  audio toggles.
- Sharper full-game text on high-DPI phones, and seal art that stays inside its
  1x2 footprint.
- The Daily puzzle date rolls over at 12:00 UTC to match the post, so the menu's
  "today" is always the newest post instead of an unposted puzzle for 12 hours.
- Endless Easy no longer falls back to one fixed board for roughly 1 in 7
  pool-empty requests, static fallbacks are varied and never pooled, pooled
  entries are validated, and refill runs have a time budget.
- Copy fixes (Endless banner, Test win, feed instructions), a Retry on Community
  load errors, and a new `npm run test:ui` phone smoke test.

Game feel and play, on both the feed post and the full game:

- The win moment plays out: the last penguin's splash and dive stay on screen,
  every penguin cheers with sparkles, and then the result card fades in. In the
  full game the splash never showed at all, because highlight redraws deleted it
  in the same frame. Completion requests now start at the moment of the win.
- Smoother movement: feed penguins hop in an arc with a landing squash instead
  of gliding, water landings ripple, sliding seals kick up snow, a seal pushed
  toward water shies back, longer hops take a little longer (shared timing in
  `src/shared/game/motion.ts`), and the feed board breathes and shimmers without
  restarting its animations on every tap. Reduced-motion settings are respected.
- Undo, a live "★★★ up to N" goal, "Try for ★★★" replays, a penguin that stays
  selected while it can keep hopping, and a three-lesson Practice tutorial.
- Fixed the full game's Moves/Par readout staying hidden after "Play today's
  again" on the solved-Daily recap.

Leaderboards and the comment leaderboard:

- The pinned comment on every Daily and Community post is now a live leaderboard
  (top 10, par rate, move-count chart, yesterday's winner) that a new
  every-5-minutes scheduler job edits only when it changes. A closed Daily
  freezes into Final results. Before this, the pinned comment was never updated.
- A new Leaderboards screen replaces the win screen's Compare list: Daily (today
  or yesterday, with times, streak flames, and the move chart), this week's stars,
  current streaks, and all-time days solved. It opens from the menu, the Daily
  win screen, and the feed result's status line. The all-time count (`lb:all`)
  was stored before but never shown.
- Players can hide their name on comment boards. Names in comments are plain
  text, so updates never ping anyone.
- "Comment my score" posts the puzzle date and streak:
  "🐧 Daily Oct 30 · ⭐⭐⭐ 6 moves (par 6) 🎯 · 🔥 3-day streak". Community
  score comments no longer mention the creator.
- Leaderboard reads never claim or generate a Daily for a request-supplied id.

Screens in the full game:

- The canvas now renders at the phone's pixel ratio (up to 3x). Phaser's resize
  mode had drawn a 1x canvas that the browser stretched, so penguins and text
  looked soft on high-DPI phones.
- The play screen names what you are playing ("Daily · Fri, Oct 30 · Medium",
  "Community · by frosty_builder · Medium") and keeps Undo, Restart, and the
  Endless Hint in one bar under the board for the whole puzzle. Undo and Restart
  wait, disabled, for your first move, and Hint is available from the start.
- Every result screen uses one card: title, stars, "6 moves · par 6", then the
  actions, with Menu in the corner. The Daily card shows your rank, streak, and
  how many players hit par; Community wins now show stars and the score too.
- The menu leads with today's puzzle and your status under it (your verified
  result or the date and difficulty, plus your streak) from a new read-only
  `GET /api/hub` that never starts the Daily clock. Endless, Community, Build,
  and Leaderboards are icon tiles with your Endless total and today's rank.
- The Endless picker shows each level's par range and your solves per level,
  plus a bar toward your next award. Guests were stuck on "Solved so far: …"
  because the count arrived before the screen was ready.
- Community opens a list instead of dropping you into the first puzzle: board
  thumbnails, creator ("by you" for yours), difficulty, par, upvotes, and
  solves, a page at a time. Tap a puzzle to play it, Next continues down the
  list, and "‹ Community" goes back to the same page. The "all caught up" card
  no longer has the play controls drawn over it when you reach it with Skip.
- The editor shows a Build → Test → Submit stepper and a status line under the
  board that says what is missing (with penguin and water-hole counts) or the
  board's par and difficulty. Undo, Random, and Clear became quieter chips, and
  after a successful submit the Submit button becomes "My puzzles ›". The tool
  buttons' tap areas now follow screen resizes; they kept their first size.
- UI smoke test: 64 checks, now including hub → Community list → puzzle → back.

### 0.0.25 - 2026-08-16

Audio and feed-control release built from the exact post-`0.0.24` candidate.

- Added the dual-format ambient soundtrack to inline and expanded play, preferring
  OGG on Chromium/Android and MP3 on Safari/iOS with decode fallback.
- Added independent, persisted SFX and Music controls to playable feed posts;
  inline playback starts only with the first legal move, never from feed scroll.
- Connected synthesized hop/slide cues to legal moves, splash to water landings,
  and the win arpeggio only to server-verified Daily or Community completion.
- Suspended hidden/offscreen audio, stopped the old document during expanded-mode
  handoff, and bounded decoded-buffer retention by releasing inactive caches.
- Preserved independent channel choices through the expanded play-screen master
  mute and added grouped semantics, clear disabled styling, responsive 44px touch
  targets, keyboard focus treatment, and reduced-motion behavior to feed controls.
- Locked and validated both soundtrack encodes in the production client artifact.

### 0.0.24 - 2026-08-16

Playable-feed release.

- Unified new Daily and Community posts on a directly playable, Phaser-free
  DOM/SVG feed board backed by exact immutable V2 snapshots.
- Added lazy authority reconciliation, read-only historical post preview upgrade,
  frozen server-replayed solve transcripts, and fail-closed mismatch recovery.
- Preserved expanded Daily recap/loading behavior while making verified guest
  completion explicitly non-durable.
- Redesigned inline seal movement for mobile feed play with tap-to-select lane
  stops, exact 1x2 landing previews, labelled keyboard controls, feed-safe touch
  panning, and robust mouse/pen drag commit/cancel behavior shared by Daily and
  Community posts.
- Validated horizontal and vertical lanes at near, middle, and far stops; held
  touch and keyboard previews; one-activation commits; cancellation and feed-pan
  behavior; mouse/pen dragging; responsive card sizes; and both Daily and
  Community continuation contracts.

### 0.1.0 - 2026-08-05

First live-product hardening release.

- Daily, Endless, and Community progress now requires legal move-by-move replay
  against the exact server-known board; retries are idempotent and guest progress
  never shares a Redis identity.
- Community publication now requires the creator to solve the exact submitted
  board, with the server independently validating the proof.
- Added bounded product telemetry and quantity-plus-tier Endless awards; hinted
  solves remain playable but do not advance counts or awards. Signed unique and
  next-day-return metrics use short-lived Redis membership hashes.
- Daily difficulty now stays in non-overlapping weekday bands with minimum par 4
  and an in-band solver-verified fallback for every tier.
- Pinned Vite 7.3.2 for the Devvit 0.12.24 toolchain and expanded focused policy,
  replay, validation, and achievement coverage.
- Archived event-era submission material and made active documentation evergreen.

### 0.0.16

Approved launch build installed on r/IceHop, including user-attributed score
comments beneath each puzzle's pinned discussion prompt.

### 0.0.12

Initial Reddit review build.

- Daily solver-generated puzzle with a weekly difficulty ramp (easy early week,
  hardest on weekends), par-based star scoring, and a daily leaderboard.
- Streaks, with a first-solve-of-day subreddit streak flair.
- Endless mode (Easy / Medium / Hard) with a lifetime solved count and an
  optional next-move Hint.
- Build-a-puzzle editor with live solver validation and play-testing, feeding a
  community puzzle stream (play, skip, upvote, with creator credit), plus per-day
  submission limits and duplicate rejection.
- Spoiler-free shareable result and one-tap "Comment my score"; guest play with a
  win-screen sign-in / Join prompt.
- Every daily post auto-seeds a pinned how-to-play / score-sharing comment.
