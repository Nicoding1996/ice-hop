# Ice Hop: Devpost submission kit

Copy-paste ready for the Devpost form. The tabs, in order, are **General info,
Project details (story, Built with, links, media), Additional info, Submit**.
Work top to bottom, and fill in the four links in the checklist at the end before
you hit submit.

---

## 1. General info

**Project name** (max 60 characters)

```
Ice Hop
```

**Elevator pitch** (max 200 characters). The version you're submitting:

```
Every penguin wants in the water. Help them all dive in! Ice Hop is a daily logic puzzle inside a Reddit post, with streaks, leaderboards, and community-made puzzles.
```

*(166 characters. It opens with a bit of heart, then names the game and the two
things we most want judges to notice: the return hooks and the player-made
puzzles.)*

Alternates if you want a different angle:

- **Compact** (142): `A daily penguin logic puzzle inside a Reddit post: hop them all into the water, keep your streak, and build boards for the community to solve.`
- **Reddity-forward** (103): `A daily logic puzzle that lives inside a Reddit post and turns the comment section into the scoreboard.`

**Thumbnail** (the tile next to the name; JPG/PNG/GIF, 3:2, 5 MB max). Replace the
default "Untitled" placeholder. A purpose-built 3:2 key-art tile is ready: open
**`brand/thumbnail.html`** in your browser and click **Download PNG** (no install,
no upload; it renders `brand/thumbnail.svg` with your browser's fonts). The
1200×800 export is plenty, and the 2400×1600 one is crisper and still under 5 MB.
A clean gameplay screenshot cropped to 3:2 also works if you'd rather show the
live board.

---

## 2. Project story: the "About the project" box

Paste the whole block below (from **What it does** through **How to test it in
~60 seconds**) into the "About the project" field. It's Markdown, so Devpost
renders the headings and bold. The order follows Devpost's own prompt: what it is,
what inspired it, how it's built, what was hard, and what I learned.

---

### What it does

Ice Hop is a daily puzzle you play without leaving the feed. A small grid of ice
holds a few penguins, a seal or two, and some open water. Tap a penguin and it
hops over whatever's beside it. Drag a seal and it slides. Get every penguin into
the water in as few moves as you can. That's the whole game, and you can read it
in about three seconds. A quick how-to greets first-timers, then gets out of the
way.

Under the hood there's a solver that knows the optimal solution to every board.
That one fact is what makes the rest work:

- **Par scoring, if you want it.** Just getting every penguin into the water is a
  win, so anyone can finish and feel good. For players who want a challenge,
  you're also scored golf-style against the fewest possible moves, so "I did it in
  7" actually means something and the comments fill up with people comparing lines.
- **A real community, not a leaderboard with extra steps.** You build your own
  puzzle in an in-app editor. The solver checks it's actually solvable (you can
  play-test it first), then it drops into a community stream and becomes its own
  Reddit post that other people play, upvote, and credit you for. There's endless
  free content, plus a reason for makers to come back: a My Puzzles dashboard shows
  each of your boards with its live solve and upvote counts.
- **The comment section is part of the game.** Every daily auto-seeds a pinned
  comment with the rules and a "drop your score" prompt, your result copies out as
  a spoiler-free emoji grid, and a streak flair gives regulars a public badge.

You come back because a fresh puzzle drops every morning, and the week builds:
easy on Monday, hardest by the weekend. Then there's the streak you don't want to
break, a leaderboard to climb, Endless mode any time you want more, and a growing
stack of player-made puzzles once you've finished the daily.

### Why it fits "Games with a Hook"

- **Delightful UX.** One screen, reads at a glance, fits the viewport, plays with a
  tap or a drag. Penguins bob gently, hops squash and stretch, and a solved penguin
  dives into the water and floats there.
- **Polish.** Hand-built vector art in a single "arctic at dawn" palette, smooth
  scene transitions, a calm loading state, synthesized sound, and a win screen
  that counts your score up and pops the stars in. No dead ends in the flow: every
  board has Restart, and every failure state has a way out.
- **Reddity.** Community-first, not Reddit-themed. The hook is people comparing
  scores and playing each other's puzzles in the thread, not karma or Snoo
  gimmicks. Puzzles become posts, and scores become comments.
- **The hook.** A daily ritual with a streak and a leaderboard, an Endless mode
  (Easy/Medium/Hard) for right now, and a player-fed community stream that grows on
  its own. Something to come back to tomorrow, and plenty to do today.

### Inspiration

I love a puzzle that makes you work. The good ones stop you cold at first: you
stare at the board certain there's no way it's possible, then something clicks,
you see the line, and that little "ohhh" is one of the best feelings there is.
It's even better with other people: getting stuck on the same board, working out
the trick together, sometimes racing to a cleaner line, and arguing about it after
("wait, you did it in seven?"). That's what the daily puzzles taking over group
chats get right.

I wanted that feeling, but living where the argument already happens: a Reddit
thread. Hopping-and-sliding logic puzzles fit because they're deterministic, which
meant I could write a solver. And a solver quietly unlocks par scoring, an endless
supply of fair puzzles, and the ability to let players build their own without
ever shipping a broken one.

The penguins came from the simplest honest mapping of the mechanic: something
that hops, something that slides, something that doesn't move, and a goal worth
diving into. Cold water, penguins, seals. It wrote itself.

### How I built it

Built on Devvit Web so it runs natively inside a Reddit post.

- **Engine and solver (pure TypeScript).** The rules, a breadth-first solver that
  computes par and proves solvability, and a generator that makes graded puzzles.
  It's framework-free and unit-tested, with abstract pieces (hopper, slider,
  blocker) so the penguin theme is just a skin on top.
- **Generation that feels designed.** The generator doesn't just check "solvable."
  It rejects boards with more than one optimal solution, throws out any piece that
  nothing ever touches, and only allows decoys on harder days, so the daily reads
  as hand-made instead of randomly assembled.
- **Server (Hono on Devvit's Node runtime).** Daily puzzle, solves, streaks,
  leaderboards, and all the community-puzzle logic, with Redis for state. One cron
  posts a fresh puzzle every day (its difficulty set by the day of the week), and
  another keeps the Endless pool topped up.
- **Client (Phaser 4).** The whole board and every character are drawn in code as
  vector art, with the animation, particles, and juice layered on top. No sprite
  sheets.
- **Sound** is synthesized live with the Web Audio API (a hop, a slide, a splash,
  a little win chime), so there are no audio files to ship.

### Challenges I ran into

- **Making generated puzzles fun, not just solvable.** The first version spat out
  technically valid boards that felt arbitrary. The uniqueness gate and the
  "every piece matters" gate were the difference between a tech demo and a game.
- **A community stream that doesn't become spam or a ghost town.** I added a daily
  submission cap, duplicate rejection, and a per-player "already solved" filter.
  Then I made the stream round-robin three lanes: top-voted, brand-new, and
  resurfaced older puzzles. That keeps favorites visible, gives new makers a look,
  and stops anything from getting buried once the catalog grows.
- **Feel.** Getting the art to read as intentional vector work instead of
  programmer shapes took real iteration: outlines, neoteny, a connected ice sheet,
  and a penguin that dives into the hole instead of standing on it.

### Accomplishments I'm proud of

- **One solver runs the whole game.** Par scoring, the graded daily generator,
  safe user-built puzzles, and the Endless hint all come off a single
  breadth-first search. It's the piece I'm proudest of, because everything else
  leans on it.
- **It reads in three seconds, on a phone.** Tap to hop, drag to slide, get every
  penguin in the water. It fits the viewport and plays with one thumb, and a quick
  how-to is one tap away if you want it.
- **Every pixel is hand-drawn in code.** Penguins, seals, rocks, water, and the
  win effects are vector art in one "arctic at dawn" palette. No sprite sheets, no
  stock assets, so the game has its own identity instead of a generic look.
- **No dead ends.** Every board has Restart, failed loads recover instead of
  hanging, guests can play without signing in, and the win screen always routes you
  onward. It's built to feel launch-ready, not like a demo.

### What I learned

- **Pick a mechanic you can solve.** Once the puzzle is deterministic and the
  optimal line is computable, par scoring, graded generation, safe user-built
  puzzles, and the Endless hint all fall out of the same breadth-first search. That
  single choice carried the whole design.
- **"Solvable" and "fun" are different problems.** Proving a board can be finished
  says nothing about whether it feels authored. The quality gates (one optimal
  solution, no dead-weight pieces) are what made the generator's output worth
  shipping as a daily.
- **Designing around Devvit's split runtime.** The client (an iframe on
  reddit.com) and the serverless server share one pure-TypeScript engine, so the
  same rules score a solve on both sides. Redis has no list operations, so the
  leaderboard packs "fewest moves, then fastest time" into a single sorted-set
  score, and the Endless pool is a hash refilled by a cron off the request path.
- **Feel lives in the small stuff.** Prefetching the next Endless board makes
  "Next" feel instant, and rebuilding only the piece that moved (never the whole
  board) keeps the idle bobs and water shimmer running through a move. Tiny
  details, but they're most of the difference between rough and finished.

### What's next

- Promote a top-voted community puzzle into a curated "puzzle of the week."
- Themed weekend boards and seasonal palettes.
- Per-subreddit puzzles so any community can host its own daily.

### A note on originality

Ice Hop was built from scratch during the submission window, specifically for this
hackathon. The engine, solver, generator, server, art, and UI are all original
work created during the event. The name, the artwork (all drawn in code), and
every puzzle (generated or player-made) are our own. The mechanic is an original
take on the public peg-solitaire / sliding-logic genre, not a clone of any one
product.

### How to test it in ~60 seconds

1. Open the demo post on mobile or desktop.
2. Tap **Play today's puzzle**. Tap a penguin to hop it, drag a seal to slide it,
   and get all the penguins into the water. You'll earn stars vs par. Stuck? Every
   board has **Restart**, and Endless puzzles add a **Hint**.
3. From the win screen, **Comment my score** drops a spoiler-free line into the
   thread, and **Share your result** copies the emoji grid. Then hit **More
   puzzles ▶** for **Endless** (pick a difficulty), or tap **‹ Menu** for the hub:
   **Community** puzzles (player-made boards) and **Build a puzzle**. The Build
   screen has a **Test** button so you can play your board before **Submit** sends
   it to the stream.
4. Check the post's pinned comment, which is auto-seeded on every daily.

No sign-in wall: play as a guest, and sign in from the win screen to save your
streak. It all runs inside the feed.

---

*(End of the "About the project" paste.)*

---

## 3. Built with

Type each tag into the "Built with" field and press Enter:

```
devvit, devvit-web, phaser, hono, typescript, vite, redis, node.js, web-audio-api, reddit
```

---

## 4. "Try it out" links

Add these under "Try it out links":

- **App listing:** https://developers.reddit.com/apps/ice-hop
- **Demo post:** _(public post running the game in your test subreddit)_
- **Repo (optional but recommended):** _(public code repository URL)_

*(The demo video goes under Project media below. You can also add the YouTube link
here as an extra "Try it out" link.)*

---

## 5. Project media

**Video.** Upload the ~58s demo (script and shot list are further down). A YouTube
link or a direct upload both work. Judges may stop at a minute, so lead with
gameplay.

**Image gallery** (JPG/PNG/GIF, 3:2, 5 MB each, up to 15). Shoot these in portrait
gameplay then crop to 3:2, or capture at 3:2 directly. Suggested set, strongest
first:

1. The daily board mid-solve: a penguin caught hopping, splash starting. The core
   read.
2. The win screen: stars popped, moves vs par, streak and rank block.
3. The editor in its valid state: the green **Solvable in N moves, tap Submit!**
   message.
4. A community puzzle as a feed post: the "Ice Hop … puzzle by u/…" title.
5. Endless tier select: Easy / Medium / Hard with the **Solved: N** banner.
6. The pinned how-to / score comment in the thread (the "comment section is the
   scoreboard" beat).
7. The **My puzzles** dashboard: your builds with their solve and upvote counts.
8. The inline splash view as it appears in the feed.

---

## 6. Demo video script (no voiceover, ~58s; captions and the game's own SFX)

No narration. Let the gameplay, the synthesized SFX (hop, slide, splash, win), and
big on-screen captions carry it. Captions matter because most people watch
sound-off. Hook in the first five seconds, use tight cuts, skip mundane flows (no
sign-in on camera), and keep it under 60s (judges may stop at a minute). Record
mobile/portrait (it's judged on the device it's built for) and pre-stage a puzzle
so nothing fumbles.

| Time | On screen | Caption (text overlay) |
| --- | --- | --- |
| 0:00–0:05 | The daily post in the Reddit feed → tap **Play today's puzzle** → a penguin hops and splashes into the water. | "A daily puzzle, right inside a Reddit post." |
| 0:05–0:14 | Solve the daily: tap penguins to hop, drag a seal to slide, the last one dives in → win screen, stars pop, score counts up vs par. | "Tap to hop, drag to slide. Get every penguin in the water." |
| 0:14–0:20 | On the win screen tap **Comment my score** → the score line lands in the post's thread. | "The comment section is the scoreboard." |
| 0:20–0:38 | **‹ Menu → Build a puzzle**: drop pieces, the editor turns green (**Solvable in 5 moves, tap Submit!**), tap **Test** then **Submit** (**Submitted! Par 5. The community can play it now.**) → cut to the new puzzle as a feed post (titled "…puzzle by u/you") → a second account solves it and taps **Upvote this puzzle**. | "Build your own." → "The solver guarantees it's fair." → "It becomes a post everyone can play." |
| 0:38–0:48 | Montage: **Endless** tier select (Easy / Medium / Hard) → a quick **no-hint** solve, **Solved: N** ticks up → cut to the daily win screen's rank and **streak** block (that's the leaderboard). Optional: a beat on the pinned thread showing your 🔥 streak flair. | "Endless puzzles. Streaks. Leaderboards." |
| 0:48–0:54 | A clean 3-star win: aurora flourish and sparkle, a penguin bobbing in the hole. | "All hand-drawn, all in code." |
| 0:54–0:58 | End card: the **ICE HOP** wordmark, tagline, and r/IceHop. | "Ice Hop: get every penguin into the water!" |

Each beat hits a judging criterion: Delightful UX (0:05), Reddity (0:14, 0:20),
User Contributions (0:20–0:38, the longest beat on purpose), Hook and retention
(0:38), Polish and Phaser (0:48). The title card goes at the END, never the start.

Capture tips: big high-contrast captions in the top/bottom safe zones; keep the
game SFX on (optionally a low royalty-free music bed under it); pre-build a puzzle
ready to **Submit** and a community puzzle ready to play so every clip is snappy;
trim hard to stay under 60s; upload unlisted or public on YouTube.

---

## 7. Recording plan (shot list and cut points)

**One take, or segments?** Record six short clips plus a built end card, then edit
them together. A single live take can't cross the surfaces this video needs: the
win screen waits on a server fetch (the "Saving your score…" to leaderboard beat
would be dead air live), "Comment my score" posts to the Reddit thread (a
different surface), and the Build beat ends on someone *else* upvoting your puzzle.
The **Upvote** button is hidden on your own puzzle and self-votes are rejected, so
it needs a second account. The one stretch you *can* shoot continuously is the
daily run (feed → solve → win → comment); record it once and slice it into beats
1–3.

**Pre-stage before recording**

- A daily board you know the **3-star line** for (make this solve 3-star so beats
  2 and 6 can share the same win footage). Stage the opening so a penguin dives
  into water on the first tap or two, for the splash payoff.
- A board one tap away from valid in the editor, so **Solvable in 5 moves, tap
  Submit!** lights up fast.
- A **second account** for the "someone else solves and upvotes your puzzle" shot,
  and a community puzzle you did **not** create queued up (the Upvote button only
  shows on other people's puzzles).
- An Endless board ready, and solve it **without the Hint**. A hinted solve won't
  add to your total, so the counter won't tick.
- Portrait capture, notifications off, captions added in your editor (not in-app).

**Clips (where you start/stop recording = your cut points)**

| Clip | Record from → to | Taps / on screen (exact labels) | Raw |
| --- | --- | --- | --- |
| A. Daily run (beats 1–3) | Feed post → comment lands in the thread | **Play today's puzzle** (trim the "Getting the penguins ready…" loader) → hop a penguin (splash) → finish the solve → stars pop and moves count up vs par → **Comment my score** → cut to the thread | ~30s → trim to ~20s |
| B. Build (beat 4a) | Editor open → "Submitted!" | **‹ Menu → Build a puzzle** → place pieces → green **Solvable in 5 moves, tap Submit!** → **Test** (one hop) → back → **Submit** → **Submitted! Par 5. The community can play it now.** | ~18s → ~10s |
| C. As a post (beat 4b) | Feed/post → after the upvote | The new post titled **"…puzzle by u/you"** → (second account) one solve → **Upvote this puzzle** | ~10s → ~7s |
| D. Endless (beat 5a) | Tier select → counter ticks | **More puzzles ▶** → **Easy / Medium / Hard** → a no-hint solve → **Solved: N** ticks up | ~10s → ~6s |
| E. Leaderboard/streak (beat 5b) | Reuse Clip A's tail | Hold on the daily win screen after the score saves: the rank and **streak** block. Optional: cut to the thread showing your 🔥 streak flair | from A |
| F. 3-star win (beat 6) | Reuse Clip A's win | Aurora and sparkle, a penguin bobbing in the hole | from A |
| End card (beat 7) | Built in your editor | ICE HOP wordmark, tagline, and subreddit | 4s still |

**Caption timing (text in → out).** Bring each caption in ~0.5s after the cut so
the action reads first, and hold it long enough to read with sound off.

| Caption | In → Out | Position |
| --- | --- | --- |
| A daily puzzle, right inside a Reddit post. | 0:00.5 → 0:04.5 | top |
| Tap to hop, drag to slide. Get every penguin in the water. | 0:05.5 → 0:11 | bottom |
| The comment section is the scoreboard. | 0:14.5 → 0:19 | top |
| Build your own. | 0:20.5 → 0:24 | bottom |
| The solver guarantees it's fair. | 0:27 → 0:31 | bottom |
| It becomes a post everyone can play. | 0:33 → 0:37.5 | bottom |
| Endless puzzles. Streaks. Leaderboards. | 0:38.5 → 0:43 | top |
| All hand-drawn, all in code. | 0:48.5 → 0:53 | bottom |

**Assembly.** Hard cuts on every beat; the only fade is into the end card. Two
cuts to land cleanly: win → editor at 0:20, and a match-cut from the board in the
editor to the *same* board as a feed post at ~0:32 (frame both at the same board
scale so it snaps).

**Keep it honest (show, don't tell).** Don't add a big "N puzzles" number; it reads
as hype to a jury that's explicitly screening out AI-slop polish. Endless already
sells itself on screen: the **Solved: N** counter climbing, and the tier screen's
own line, "The puzzles never run out." Let the *solver* be the flex ("The solver
guarantees it's fair"), not the volume.

**End-card subreddit.** The configured playtest sub is **r/ice_hop_dev**
(`dev.subreddit` in devvit.json). If you brand the card **r/IceHop**, create that
subreddit and post the public demo there so the end card and the Devpost
demo-post link match.

---

## 8. Additional info and the Submit tab (don't skip these)

The form has steps beyond the story (the tabs read Manage team, Project overview,
Project details, Additional info, Submit). A few things that are easy to miss:

- **Prize categories.** If the form lets you opt into specific prizes, choose the
  ones this app is built for: **Best Use of Retention Mechanics** and **Best Use
  of User Contributions** (our primary targets), plus **Best App with a Hook** and
  **Best Use of Phaser**. Don't leave these blank; it's how the right judges find
  you.
- **New vs. existing project.** This was built during the submission window, so
  answer "new" if asked. The "A note on originality" paragraph in the story backs
  that up.
- **Eligibility questions.** Expect age/region confirmation and agreement to the
  official rules. Answer honestly. A missed eligibility checkbox can sink an
  otherwise-strong entry, so it's worth reading the rules page once.
- **Contact / who you are.** Devpost has no separate "contact" field in the story;
  your **Devpost profile and team list are the contact**. Make sure your profile
  shows your name and Reddit username, add any teammates on the **Manage team** tab
  *before* submitting, and confirm the app listing points back to you.
- **Repo (optional, but worth it).** A public repository is the cleanest proof the
  work is real and hand-built, a strong counter to any "AI slop" doubt. Link it
  under "Try it out."

Two Devpost-workflow habits that help:

- **Submit a draft early.** If you submit at least a week before the deadline,
  Devpost's reviewers pre-check eligibility and message you if anything needs
  fixing. The deadline is **July 15, 6pm PT**, so get a placeholder draft in, then
  keep editing (you can edit right up to the deadline). *(Content rephrased from
  Devpost organizer guidance.)*
- **The page is permanent.** A Devpost project page stays public after the event,
  so finish it properly: story, screenshots, video, and links all filled in.

---

## 9. Submission checklist (fill these in)

- [ ] **App listing:** https://developers.reddit.com/apps/ice-hop
- [ ] **Demo post:** link to a public post running the game in your test
      subreddit (keep the subreddit under 200 members, or install dr-admin-approve
      so admins can join).
- [ ] **Demo video:** unlisted or public YouTube link, under one minute.
- [ ] **Image gallery:** 3 to 8 screenshots at 3:2 (see the shot list in section 5).
- [ ] **Thumbnail:** replace the default "Untitled" tile (section 1).
- [ ] **Prize categories selected** on the Additional info tab (section 8).
- [ ] **Team + profile:** teammates added, profile shows your name and Reddit handle.
- [ ] **Repo (optional):** public code repository URL.
- [ ] **Developer feedback survey (optional, its own prize):** complete it with
      specific, actionable notes from building this.
- [ ] **Draft submitted early** so reviewers can flag any eligibility issue.
- [ ] README.md is in the repo root (it is).

---

## 10. Launch / deployment record

A running record of what was actually shipped, so the app version, settings, and
review status stay documented (and any significant post-submission updates are
traceable, per the hackathon's "document significant updates" note).

**Status:** Submitted for review (pending Reddit approval). Not yet public or
installed on a live community.

| Field | Value |
| --- | --- |
| App slug / listing | `ice-hop` — https://developers.reddit.com/apps/ice-hop |
| Version submitted | 0.0.12 |
| Submitted for review | 2026-07-03 |
| Review reason (per CLI) | App creates custom posts |
| Playtest subreddit | r/ice_hop_dev (`dev.subreddit` in devvit.json) |
| Intended launch subreddit | r/IceHop (create, then `devvit install` after approval) |
| Devvit CLI | 0.12.24 (update to 0.13.4 available; not yet applied) |

**Commands used to launch**

- `npm run launch` = `npm run deploy && devvit publish`
- `npm run deploy` = `npm run type-check && devvit upload`
- The first `devvit publish` failed once with a transient `TypeError: fetch
  failed` (network); re-running `npx devvit publish` succeeded and chose
  "Continue with the source code upload" when prompted for the review source zip.

**What happens on approval**

- Email confirmation from Reddit (typically 1-2 business days).
- Then installable on any subreddit you moderate: `npx devvit install r/IceHop`.
- Published apps are **unlisted by default** (other communities can't install
  them) - the intended setting for this game.

**Behavior tied to approval (don't mistake for a bug)**

- The win-screen "Comment my score" posts via `runAs: 'USER'`. Before approval it
  shows the app account (`u/ice-hop`) on those comments; after approval it posts
  under each real player's username.

**Updating after launch**

- Change code, then `npm run launch` (or `npx devvit publish`) to submit a new
  version for review; re-run `npx devvit install r/IceHop` to move the live
  community to the approved version. Use `npm run dev` (playtest) for instant,
  review-free iteration. Batch changes into fewer releases.

**Significant update in this cycle**

- Score comments now post as a **reply under the post's pinned comment** (Reddit's
  required pattern for score-only user comments) instead of as top-level comments.
  Implemented in `post.ts` (store the pinned comment id at post creation), `keys.ts`
  (new `pinnedComment` key), and `api.ts` (`/api/comment-score` replies to it, with
  a top-level fallback for posts created before this change). Type-check clean,
  31/31 tests pass.
