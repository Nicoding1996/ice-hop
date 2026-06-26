# Ice Hop — Devpost submission kit

Everything here is copy-paste ready for the Devpost form. Fill in the four links
in the checklist at the bottom before you hit submit.

---

## Tagline (one line)

A daily logic puzzle that lives inside a Reddit post and turns the comment
section into the scoreboard.

---

## What it does

Ice Hop is a daily puzzle you play without leaving the feed. A small grid of ice
holds a few penguins, a seal or two, and some open water. Tap a penguin and it
hops over whatever's next to it; drag a seal and it slides. Get every penguin
into the water in as few moves as you can. That's the whole game, and you can
read it in about three seconds without an instructions screen.

Under the hood there's a solver that knows the optimal solution to every board.
That one fact is what makes the rest work:

- **Par scoring.** You're graded golf-style against the fewest possible moves, so
  "I did it in 7" actually means something and the comments fill up with people
  comparing lines.
- **A real community, not a leaderboard with extra steps.** You can build your
  own puzzle in an in-app editor. The solver checks it's actually solvable (you
  can play-test it first), then it drops into a community stream other people
  play, upvote, and credit you for. Endless free content, and a reason for makers
  to come back and see how their puzzle did.
- **The comment section is part of the game.** Every daily auto-posts a pinned
  comment with the rules and a "drop your score" prompt, your result copies out
  as a spoiler-free emoji grid, and a streak flair gives regulars a public badge.

You come back because there's a fresh puzzle every morning, a streak you don't
want to break, a leaderboard to climb, an Endless mode to dip into any time, and a
bottomless pile of player-made puzzles waiting when you finish the daily.

---

## Why it fits "Games with a Hook"

- **Delightful UX.** One screen, no tutorial, fits the viewport, plays with a tap
  or a drag. Penguins breathe, hops squash-and-stretch, and a solved penguin
  dives into the water and bobs there.
- **Polish.** Hand-built vector art with a single cohesive "arctic at dawn" look,
  smooth scene transitions, a loading state, sound, and a win screen that counts
  your score up and pops the stars in. No dead ends in the flow.
- **Reddity.** It's community-first, not Reddit-themed. The hook is people
  comparing scores and playing each other's puzzles in the thread, not karma or
  Snoo gimmicks.
- **The hook.** Daily ritual + streak + leaderboard + an Endless mode
  (Easy/Medium/Hard) and a player-fed community stream. Something to come back to
  tomorrow, and plenty to do right now.

---

## Inspiration

I love the little daily puzzles that have taken over group chats, the ones you
can finish in a minute and then argue about. I wanted that feeling, but living
where the argument already happens: a Reddit thread. Hopping-and-sliding logic
puzzles are perfect for it because they're deterministic, which meant I could
write a solver, and a solver quietly unlocks par scoring, an endless supply of
fair puzzles, and the ability to let players build their own without ever
shipping a broken one.

The penguins came from the simplest honest mapping of the mechanic: something
that hops, something that slides, something that doesn't move, and a goal worth
diving into. Cold water, penguins, seals. It wrote itself.

---

## How I built it

Built on Devvit Web so it runs natively inside a Reddit post.

- **Engine + solver (pure TypeScript).** The rules, a BFS solver that computes
  par and proves solvability, and a generator that makes graded puzzles. It's
  framework-free and unit-tested, with abstract pieces (hopper/slider/blocker)
  so the penguin theme is just a skin on top.
- **Generation that feels designed.** The generator doesn't just check
  "solvable." It rejects boards with more than one optimal solution, throws out
  any piece that nothing ever touches, and only allows decoys on harder days, so
  the daily feels hand-made instead of random.
- **Server (Hono on Devvit's Node runtime).** Daily puzzle, solves, streaks,
  leaderboards, and all the community puzzle logic, with Redis for state and a
  cron job that posts a fresh puzzle every day.
- **Client (Phaser 4).** The whole board and every character are drawn in code as
  vector art, with the animation, particles, and juice on top. No sprite sheets.
- **Sound** is synthesized live with the Web Audio API (a hop, a slide, a splash,
  a little win chime), so there are no audio files to ship.

---

## Challenges I ran into

- **Making generated puzzles fun, not just solvable.** The first version spat out
  technically-valid boards that felt arbitrary. Adding the uniqueness and
  "every piece matters" gates was the difference between a tech demo and a game.
- **Community puzzles that don't turn into spam or a ghost town.** I added a daily
  submission cap, duplicate rejection, a per-player "already solved" filter, and a
  stream that interleaves popular and brand-new puzzles so new makers actually get
  seen.
- **Feel.** Getting the art to read as intentional vector art instead of
  programmer shapes took real iteration: outlines, neoteny, a connected ice
  sheet, and a penguin that dives into the hole instead of standing on it.

---

## What's next

- Promote a top-voted community puzzle into a curated "puzzle of the week."
- Themed weekend boards and seasonal palettes.
- Per-subreddit puzzles so any community can host its own daily.

---

## Built with

`devvit`, `devvit-web`, `phaser`, `hono`, `typescript`, `vite`, `redis`,
`web-audio-api`, `reddit`

---

## New project note (for the submission form)

Ice Hop was built from scratch during the submission window, specifically for
this hackathon. Everything in it, the engine, solver, generator, server,
art, and UI, is original work created during the event. The name, the artwork
(all drawn in code), and every puzzle (generated or player-made) are our own; the
mechanic is an original take on the public peg-solitaire / sliding-logic genre.

---

## For the judges (how to test in ~60 seconds)

1. Open the demo post (link below) on mobile or desktop.
2. Tap **Play today's puzzle**. Tap a penguin to hop it, drag a seal to slide it.
   Get all the penguins into the water. You'll get stars vs par. Stuck? Every
   board has **Restart**, and Endless puzzles add a **Hint**.
3. From the win screen, **Share your result** (a spoiler-free emoji grid), then
   hit **More puzzles ▶** to jump into **Endless** mode and pick a difficulty.
   Tap **‹ Menu** for the hub: **Community** puzzles (player-made boards) and
   **Build a puzzle** — the Build screen has a **Test** button so you can play
   your board before **Submit** sends it to the stream.
4. Check the post's pinned comment, that's auto-seeded on every daily.

No sign-in wall: play as a guest, and sign in from the win screen to save your
streak. Works in the feed.

---

## Demo video script (no voiceover, ~58s — captions + the game's own SFX)

No narration. Let the gameplay, the synthesized SFX (hop / slide / splash / win),
and big on-screen captions carry it — captions matter because most people watch
sound-off. Hook in the first five seconds, use tight cuts, skip mundane flows (no
sign-in on camera), and keep it under 60s (judges may stop at a minute). Record
mobile/portrait — it's judged on the device it's built for — and pre-stage a
puzzle so nothing fumbles.

| Time | On screen | Caption (text overlay) |
| --- | --- | --- |
| 0:00–0:05 | The daily post in the Reddit feed → tap **Play today's puzzle** → a penguin hops and splashes into the water. | "A daily puzzle, right inside a Reddit post." |
| 0:05–0:14 | Solve the daily: tap penguins to hop, drag a seal to slide, the last one dives in → win screen, stars pop, score counts up vs par. | "Tap to hop, drag to slide. Get every penguin in the water." |
| 0:14–0:20 | On the win screen tap **Comment my score** → the score line lands in the post's thread. | "The comment section is the scoreboard." |
| 0:20–0:38 | **‹ Menu → Build a puzzle**: drop pieces, the editor reads **Solvable · par 5**, tap **Test** then **Submit** → cut to the new puzzle as a feed post ("by u/you") → another player solves it and taps **Upvote**. | "Build your own." → "The solver guarantees it's fair." → "It becomes a post everyone can play." |
| 0:38–0:48 | Montage: **Endless** tier select (Easy / Medium / Hard) → a quick solve, **Solved: N** ticks up → the streak flair → the leaderboard. | "Endless puzzles. Streaks. Leaderboards." |
| 0:48–0:54 | A clean 3-star win: aurora flourish + sparkle, a penguin bobbing in the hole. | "All hand-drawn, all in code." |
| 0:54–0:58 | End card: the **ICE HOP** wordmark + tagline + r/IceHop. | "Ice Hop — get every penguin into the water!" |

Each beat hits a judging criterion: Delightful UX (0:05), Reddity (0:14, 0:20),
User Contributions (0:20–0:38, the longest beat on purpose), Hook/retention
(0:38), Polish/Phaser (0:48). The title card goes at the END, never the start.

Capture tips: big high-contrast captions in the top/bottom safe zones; keep the
game SFX on (optionally a low royalty-free music bed under it); pre-build a puzzle
ready to **Submit** and a community puzzle ready to play so every clip is snappy;
trim hard to stay under 60s; upload unlisted/public on YouTube.

---

## Submission checklist (fill these in)

- [ ] **App listing:** https://developers.reddit.com/apps/ice-hop
- [ ] **Demo post:** link to a public post running the game in your test
      subreddit (keep the subreddit under 200 members, or install dr-admin-approve
      so admins can join).
- [ ] **Demo video:** unlisted/public YouTube link, under one minute.
- [ ] **Repo (optional):** public code repository URL.
- [ ] **Developer feedback survey (optional, its own prize):** complete it with
      specific, actionable notes from building this.
- [ ] README.md is in the repo root (it is).
