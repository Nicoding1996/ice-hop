# Ice Hop 🐧

A daily logic-puzzle game that runs natively inside a Reddit post, built on
[Devvit Web](https://developers.reddit.com/docs) for Reddit's "Games with a Hook"
hackathon.

Guide every penguin into the water. Every penguin hops, every seal slides, and
the ice never moves. Solve the daily in as few moves as possible, keep your
streak alive, climb the leaderboard, race through Endless mode, and build puzzles
for everyone else to play.

---

## How to play

The board is a small grid of ice. On it you'll find penguins, seals, ice rocks,
and open water holes.

- **Penguins (you move these).** Tap a penguin to hop. A penguin only moves by
  **jumping in a straight line** over one or more pieces sitting next to it,
  landing on the first empty square beyond them. It can't shuffle into an empty
  square next door; it has to jump something.
- **Seals.** Drag a seal along its lane to slide it any distance. Seals can't jump
  and **won't slide into the water** (they'd fall in), so you'll often slide a
  seal out of the way to open a path, or use it as a stepping stone to hop over.
- **Ice rocks.** They never move. Pure obstacles to hop over and slide around.
- **Water holes.** The goal. **The puzzle is solved when every penguin is sitting
  in a hole.** There are always exactly as many holes as penguins, so "everyone
  in the water" is the finish line.

That's the whole game. No instructions screen needed: tap a penguin, watch it
hop, and figure out the order that gets everyone into the water.

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

- **Restart** the board any time from the bottom bar to take a fresh run at par —
  a wrong move is never a dead end.
- **Endless mode** has an optional **Hint** that glows the next good move when
  you're stuck, so you keep learning. A hinted solve doesn't count toward your
  Endless total, so the number stays honest.
- No sign-in wall: play as a guest, and sign in from the win screen when you want
  to save your streak and progress.

---

## The hook (why you come back)

- **A fresh puzzle every day.** One shared daily puzzle, auto-posted to the feed.
  Difficulty ramps across the week: easy on Monday and Tuesday, medium midweek,
  hardest on the weekend.
- **Endless mode.** Finished the daily and still want more? Pick Easy, Medium, or
  Hard and play a never-ending shuffle of fresh, solver-made puzzles, with a
  running "Solved" count to grow. It's the always-full path when you want one more.
- **Streaks.** Solve day after day to build a streak. Miss a day and it resets.
  Your first solve each day sets a streak flair on the subreddit ("🔥 7-day
  streak"), a public nudge to keep coming back.
- **Leaderboards.** Daily and all-time, so there's always a race.
- **A built-in comment hub.** Every daily post auto-seeds a pinned how-to-play
  comment that invites players to drop their scores, so the comment section
  becomes part of the game instead of an afterthought.
- **Shareable result.** Copy a spoiler-free emoji summary of your solve (par,
  moves, streak) straight into the comments to compare without spoiling the board.
- **Build your own + a community stream.** Make your own puzzle in the editor;
  the solver checks it's actually solvable (and you can play-test it) before it's
  accepted. Accepted puzzles go into a community stream anyone can play through
  (solve one, jump to the next, or skip), upvoting the ones they like with the
  creator credited. That's an endless supply of "one more" puzzles and a reason
  for creators to come back and see how their puzzle is doing.

---

## Building a puzzle (the editor)

Open the **Build** screen from the game to design a board:

- Place **Penguin**, **Seal**, **Rock**, or **Hole**, or use **Erase**.
- Tap the **Seal** tool again to rotate the seal between horizontal and vertical.
- **Random** drops a solver-generated starter board you can riff on.
- **Undo** steps back your last placement.
- **Test** drops you into your own board to play it before you commit.
- The editor runs the solver live and tells you whether the board is **solvable**
  and its **par** before you submit, so you never publish a dead end.

A valid submission is a 4-6 wide/tall board with 1-4 penguins, an equal number of
water holes, a real solution, and a par of at least 2. You can submit up to 5
puzzles a day and exact duplicates are rejected. When you play the community
stream it skips puzzles you've already solved and mixes popular picks with fresh
new ones, so there's always something new and every creator gets a fair shot.

---

## Tech stack

- **[Devvit Web](https://developers.reddit.com/docs)** (`devvit` / `@devvit/web`
  `0.12.24`) - runs the app inside a Reddit post.
- **[Phaser](https://phaser.io) 4** - the interactive board (expanded view).
- **[Hono](https://hono.dev) 4** - the serverless API on Devvit's Node runtime.
- **TypeScript** + **Vite** (via `@devvit/start/vite`), with a pure, framework-free
  game engine and solver shared between client and server.
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
    game/     # board, legal moves, apply-move + win detection, types
    solver/   # BFS solver (par), puzzle generator, difficulty, UGC validation
    scoring.ts share.ts date.ts api.ts
  server/   # Hono app on Devvit (Node 22)
    routes/   # /api (init, solve, leaderboard, endless), /api/ugc, /internal (menu, cron, triggers)
    core/     # daily puzzle, endless pool, leaderboard + streaks, UGC, post creation, Redis keys
  client/   # runs in the post iframe
    splash.*  # fast inline feed view
    game.*    # expanded Phaser view
    scenes/   # Boot, HomeScene, GameScene, EditorScene, CommunityScene, EndlessScene, MyPuzzlesScene
```

See `.kiro/steering/` for the full design, tech, and structure notes.

---

## Local development

Requires **Node >= 22.2.0** (Devvit's runtime) and a Reddit account with the
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
npm run build        # vite build
npm run deploy       # type-check + devvit upload
npm run launch       # deploy + devvit publish
```

### How the daily post is created

- **Automatically:** a Devvit scheduler task (`scheduler.tasks.daily-puzzle` in
  `devvit.json`, cron `0 12 * * *`) posts a fresh puzzle to the feed every day at
  12:00 UTC.
- **Manually:** moderators can use the subreddit menu action **"Post today's
  puzzle"** any time.

---

## Hackathon notes

- **What to play:** the daily puzzle post in the test subreddit, then tap
  **‹ Menu** for the hub — **Endless** mode (Easy / Medium / Hard), the **Build**
  screen, **My puzzles** (your builds with their solve/upvote counts), and the
  **Community** puzzle stream. On a win you can **Share** or **Comment my score**
  straight into the thread, and signed-in players can one-tap **Join** the
  subreddit.
- **Retention:** daily puzzle + streaks + daily/all-time leaderboards + a weekly
  difficulty ramp + an always-on Endless mode, plus a win-screen sign-in prompt
  that turns guests into returning players who can subscribe.
- **User contributions:** a solver-validated puzzle editor feeding a playable,
  upvotable community stream with creator credit.
- **Reddity:** every daily auto-seeds a pinned how-to/score-sharing comment,
  spoiler-free shareable results are built to be pasted into the thread, and a
  streak flair gives regulars a public badge, turning the comment section into
  the scoreboard and the bragging.
- The puzzle mechanic is an original take on the classic peg-solitaire / sliding
  logic genre. The name, art, generated puzzles, and all user puzzles are our own.
