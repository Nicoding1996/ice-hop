# Ice Hop: Devpost submission kit

**Status: SHIPPED.** App approved and live (v0.0.16, unlisted) on r/IceHop, and the
Devpost entry is submitted (editable until the July 15 deadline). The live links
and the full launch record are in section 10.

Copy-paste ready for the Devpost form. The tabs, in order, are **General info,
Project details (story, Built with, links, media), Additional info, Submit**.
Work top to bottom, and fill in the links in the checklist at the end before you
hit submit.

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
about 60 seconds**) into the "About the project" field. It's Markdown, so Devpost
renders the headings and bold. The order follows Devpost's own prompt: what it is,
what inspired it, how it's built, what was hard, and what I learned.

---

### What it does

**Ice Hop is a daily logic puzzle that turns a Reddit post into a tiny frozen playground.**

A few penguins are stranded on the ice with seals, rocks, and open water. Tap a penguin to hop over occupied spaces. Drag a seal to slide it out of the way, or into exactly the wrong place. Get every penguin into the water in as few moves as you can.

That's the whole game. It fits in one viewport, plays with a tap or a drag, and has a one-tap how-to if you need it.

Behind every board is a solver that knows the shortest possible solution. That gives each puzzle a real par, so finishing always feels good while finding the cleanest line gives experienced players something to chase. The daily leaderboard ranks by fewest moves, with time only breaking ties.

A new daily puzzle arrives each day, with the week building from easier Mondays toward harder weekends. After the daily, Endless mode offers Easy, Medium, and Hard puzzles whenever you want another. Endless also has a progressive hint: the first tap highlights the piece, and the second shows where it should go. Using it helps you move on, but that solve does not count toward your Endless total.

Players can also build their own puzzles. The editor gives live solver feedback, lets you play-test the board, and refuses submissions that cannot be solved. Accepted puzzles enter a Community stream where other people can play them, upvote them, and see who made them. The **My Puzzles** screen gives creators a reason to return by showing the live solve and upvote counts for every board they published.

The Reddit thread is part of the game too. Each puzzle post seeds a pinned prompt inviting players to share their score. After solving, a signed-in player can tap **Comment my score** to post their moves, par, and stars beneath it. Reddit shows each player's username above their result, turning the replies into a real scoreboard without spoiling the puzzle.

**Puzzles become posts, and scores become comments.**

### Why it fits "Games with a Hook"

- **Delightful UX:** The goal reads at a glance. Penguins bob while they wait, squash and stretch through a hop, then dive into the water and float there when they reach safety.

- **Polish:** The game uses one hand-built "arctic at dawn" palette, smooth scene transitions, responsive controls, synthesized effects, ambient music, clear loading states, and recovery buttons when something fails.

- **Reddity:** This is community-first. Players compare scores in the thread, solve each other's boards, and return to see how their own creations performed.

- **The hook:** The daily puzzle, streak, flair, and leaderboard bring players back tomorrow. Endless and Community make sure there is always more to play today.

- **Phaser:** Phaser powers the responsive board, touch and drag input, code-drawn characters, persistent idle animation, hop arcs, particles, splashes, and win effects, not just a static puzzle inside a game wrapper.

### Inspiration

I love puzzles that look impossible for the first few minutes.

You stare at the board, try a few ideas, and then one relationship finally clicks. That little *"ohhh, that's the line"* feeling is one of my favorite things in games.

It gets even better when other people are solving the same puzzle. Someone posts a score, somebody else finds a cleaner route, and suddenly the conversation becomes:

> "Wait, you did it in six moves?"

I wanted that feeling to live where the conversation already happens: inside a Reddit thread.

A hopping-and-sliding puzzle worked because it is deterministic. I could write a solver that knows whether a board is possible and what the best solution looks like. That one decision opened the door to fair scoring, procedural puzzles, hints, and player-made boards that can never be published broken.

The theme came from the rules: something that hops, something that slides, something that stays still, and somewhere worth jumping into.

Cold water, penguins, seals. It wrote itself.

### How I built it

Ice Hop is built with **Devvit Web**, **Phaser 4**, **TypeScript**, **Hono**, and **Redis**.

The game rules and solver live in pure TypeScript, separate from both Phaser and Devvit. A breadth-first search finds the shortest solution, which becomes the board's par. The same solver validates community submissions, grades generated puzzles, and recomputes Endless hints from the player's current position.

The generator does more than ask whether a board is solvable. Its strict pass looks for a clean optimal solution and rejects pieces the player could never even touch. Easier boards require every piece to matter, while harder boards can include fair decoys: pieces you can reach and be tempted by, even though the best line never needs them. Generation has strict time limits and solver-verified fallbacks so an expensive search can never leave the player stuck on a loading screen.

The server is one Hono app running on Devvit's Node runtime. Redis stores daily boards, solves, streaks, rankings, Community puzzles, votes, creator statistics, and the pre-generated Endless pools. One scheduled task creates the daily post, while another keeps the Endless pools stocked away from the player request path.

Community submissions are rate-limited and de-duplicated. Players cannot upvote their own work or vote twice. Each player's stream removes puzzles they have already solved and mixes top-voted boards, new submissions, and a catalog-wide discovery sample so good older puzzles still have a chance to surface.

On the client, every gameplay character and board element is drawn in code. Penguins, seals, rocks, water, ice, particles, and win effects all share the same rounded shape language and calm polar palette. The lightweight feed card stays separate from Phaser and only opens the full game when the player chooses to play.

The hop, slide, splash, and win sounds are synthesized with the Web Audio API. A quiet ambient track sits underneath them and can be muted along with the effects.

### Challenges I ran into

#### Making generated puzzles fun

The first generator produced boards that were technically valid but sometimes felt random. A piece might just sit there with no way for the player to ever interact with it, or the board might have too many equally good answers.

Counting optimal solutions and checking whether each piece actually matters made the difference between a working generator and puzzles that feel designed.

#### Keeping generation fast

Proving that a board has one clean solution can be much more expensive than finding any solution. Early versions could spend too long searching.

I added hard generation deadlines, graceful fallback passes, scheduled Endless pools, and client-side prefetching. The game still aims for the best board it can find, but it never sacrifices a reliable load for an expensive proof.

#### Making Community fair

Ranking only by votes would let early favorites dominate forever. Ranking only by recency would bury good work immediately.

The final stream rotates between top-voted puzzles, new submissions, and catalog-wide discovery. Rate limits, duplicate rejection, solved filtering, and no self-voting keep it useful without making creation frustrating.

#### Finding the game's look

Drawing shapes was easy. Making them feel like one world took much longer.

The connected ice sheet, rounded silhouettes, large eyes, recessed water, and the penguin actually diving instead of standing on its goal were the details that gave Ice Hop its identity.

### Accomplishments I'm proud of

- **One solver supports almost the whole game:** par scoring, daily generation, submission validation, difficulty grading, and Endless hints.

- **The creator loop is complete:** build, validate, test, publish, then return to see real solve and upvote counts.

- **The game reads on a phone:** tap to hop, drag to slide, get every penguin into the water.

- **The comment section really becomes the scoreboard:** results appear beneath the pinned prompt under each player's Reddit username.

- **It is shipped:** Ice Hop is approved and live on Reddit, not only running as a local prototype.

### What I learned

- **Choose a mechanic that gives you leverage.** Once the optimal solution is computable, scoring, generation, validation, and hints can all share the same foundation.

- **Solvable and fun are different problems.** A solver proves that a board has an answer; quality checks make that answer feel intentional.

- **User contributions need a reason to return.** Publishing is only the first half. Solve and upvote counts make creators care about what happens afterward.

- **Polish lives in small details.** Keeping idle animations alive through a move, prefetching the next puzzle, and always offering a way out matter as much as the larger features.

### What's next

- A curated puzzle of the week chosen from Community creations.

- Seasonal palettes and special weekend boards.

- More creator milestones and longer-term competition.

- Ice Hop dailies hosted by more Reddit communities.

### A note on originality

I built Ice Hop from scratch during the hackathon submission window.

The engine, solver, generator, server systems, interface, and code-drawn visual identity were made for this project. Daily and Endless boards are generated, while Community boards are created by players; no commercial puzzle set is copied.

The rules combine familiar peg-solitaire and sliding-block ideas into a new system with its own name, artwork, scoring, and community features.

### How to test it in about 60 seconds

The submitted demo is a **Community puzzle post**, so every visitor receives a playable board immediately. No sign-in is required to play; an account is only needed for the steps marked *(signed in)* below.

1. [Open the live demo post](https://www.reddit.com/r/IceHop/comments/1uv7pwz/ice_hop_a_medium_puzzle_by_uhappy_egg1435/).

2. Tap **Play this puzzle**.

3. Tap penguins to hop and drag seals to slide. Get every penguin into the water.

4. *(signed in)* After solving, tap **Comment my score** to add your result beneath the pinned comment.

5. *(signed in)* If you are not the creator, upvote the puzzle, or choose **Next puzzle** to continue through the Community stream.

6. Open **Menu** to try Endless, build a puzzle, or view the creator dashboard.

Daily posts add the full retention loop: stars versus par, daily rank, streak progression, spoiler-free sharing, and tomorrow's fresh board.

Everything plays inside Reddit's post experience.

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

The actual links submitted, ordered most important first:

- **Demo post (play it):** https://www.reddit.com/r/IceHop/comments/1uv7pwz/ice_hop_a_medium_puzzle_by_uhappy_egg1435/
  Deliberately a **community puzzle post**, not a daily. A community post drops any
  visitor (logged in or out) straight into a playable board; a daily shows a
  logged-out visitor an "already solved" recap because all guests share one solve
  record (`solve:{date}:anon`). Full rationale in section 10.
- **Repo:** https://github.com/Nicoding1996/ice-hop
- **App listing:** https://developers.reddit.com/apps/ice-hop  (the developer page;
  it 403s for anyone who isn't the owner, which is expected. The hackathon asked
  for this URL and admins/judges can view it.)

*(The demo video is under Project media; its YouTube link can also go here.)*

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

## 9. Submission checklist (final state)

Submitted. Status of each item:

- [x] **App listing:** https://developers.reddit.com/apps/ice-hop (approved, v0.0.16, unlisted)
- [x] **Demo post:** a community puzzle post (section 4), verified playable in a
      logged-out incognito window.
- [x] **Demo video:** uploaded to YouTube, under one minute.
- [x] **Image gallery:** 3:2 shots including the "comment section is the scoreboard"
      image, framed via `brand/screenshot-framer.html`.
- [x] **Thumbnail:** the 3:2 key-art tile from `brand/thumbnail.html`.
- [x] **Additional info tab:** "Did you use Phaser?" = Yes; Reddit username, app
      page, and test-post link filled.
- [x] **Profile:** shows the Reddit handle (u/Happy_Egg1435).
- [x] **Repo:** https://github.com/Nicoding1996/ice-hop
- [x] **Developer feedback survey** submitted.
- [x] **Entry submitted** on Devpost (editable until the July 15 deadline).
- [x] README.md is in the repo root.

---

## 10. Launch / deployment record

A running record of what was actually shipped, so the app version, settings, and
review status stay documented (and any significant post-submission updates are
traceable, per the hackathon's "document significant updates" note).

**Status: APPROVED and LIVE.** The app is approved (unlisted) and installed on the
public r/IceHop; the Devpost entry is submitted (editable until the deadline).

| Field | Value |
| --- | --- |
| App slug / listing | `ice-hop`, at https://developers.reddit.com/apps/ice-hop |
| Approved version | 0.0.16 (visibility: Unlisted) |
| Rejected version | 0.0.12 ("Not Ready For Review; puzzle would not load") |
| Devvit CLI / API | 0.12.24 (do NOT update mid-hackathon; see below) |
| Launch subreddit | r/IceHop (public; app installed) |
| Demo post (submitted) | a community puzzle post (see section 4) |
| Repo | https://github.com/Nicoding1996/ice-hop |

**Commands used to launch**

- `npm run launch` = `npm run deploy && devvit publish`
- `npm run deploy` = `npm run type-check && devvit upload`
- The first `devvit publish` failed once with a transient `TypeError: fetch
  failed` (network); re-running `npx devvit publish` succeeded and chose
  "Continue with the source code upload" when prompted for the review source zip.

**Now approved (post-approval facts)**

- Installed on r/IceHop via `npx devvit install r/IceHop`. Unlisted, so other
  communities can't install it, which is the intended setting for this game.
- Approval unlocked the user-authored comment features (the `SUBMIT_COMMENT` asUser
  scope). "Comment my score" now posts under each real player's username; before
  approval it posted as the app account (`u/ice-hop`).

**Why the demo link is a community post, not a daily**

- On a daily post a **logged-out** visitor is treated as user `anon`, and all
  guests share one solve record (`solve:{date}:anon`). Once any guest solves that
  day's puzzle, every later logged-out visitor sees the "You've solved it" recap
  instead of a playable board.
- Logged-in visitors are unaffected (keyed by their real username), but judging
  can't assume login, so the demo link points at a **community puzzle post**, which
  has no solved-recap gating and always drops any visitor into a playable board.

**Do NOT update Devvit near the deadline**

- The portal nudges a newer Devvit (0.13.x). The app is approved and working on
  0.12.24; a major-version bump this close risks breaking the live, approved demo.
  Leave it, and update only after the event if development continues.

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
