# Product

## What we are building

**Ice Hop** - a daily logic-puzzle game that runs natively inside a Reddit post
via Devvit Web, built for Reddit's "Games with a Hook" hackathon (June 17 - July
15, 2026). Display name "Ice Hop"; app slug `ice-hop`.

Core mechanic (genre, not a clone): a small grid where "hopper" pieces must jump
over occupied cells to land in empty target holes, while "slider" pieces move
along an axis and "blocker" pieces stay fixed. A puzzle is solved when every
hopper occupies a hole. This is a peg-solitaire / sliding-logic hybrid. Every
puzzle is deterministic with a known optimal solution computed by our solver.

Theme (the art skin over the abstract engine): penguins (hoppers) hop over ice
rocks (blockers) and seals (sliders) to dive into water holes (goals). The number
of penguins always equals the number of water holes, so "get every penguin into
the water" reads at a glance.

## Why it can win

The whole strategy hinges on one fact: the puzzle is deterministic, so we can
write a solver. The solver unlocks three things that turn a solo puzzle into a
retentive, community-run game:

1. Par scoring (golf): score players against the known optimal move count.
2. Procedural generation: an endless supply of graded puzzles.
3. UGC validation: verify that any user-built puzzle is solvable before publish.

## The player loop (the "hook")

- Daily puzzle: one shared, freshly generated puzzle per day, auto-posted to the
  feed (the ritual). Difficulty ramps across the week (Mon/Tue easy -> weekend
  hard). The daily is always solver-generated; it is NOT sourced from user
  submissions.
- Streak: consecutive days solved; loss aversion brings people back. The first
  solve each day sets a streak-based subreddit flair (e.g. "🔥 7-day streak").
- Score: moves vs par -> star rating; time is only a tiebreaker.
- Share: a spoiler-free emoji-grid of your solution path, pasted into comments.
- Comment hub: each daily post auto-seeds a pinned how-to-play comment that
  invites players to drop their scores, so the comment section is part of play.
- Leaderboard: daily + all-time, sorted by fewest moves then fastest time.
- Build + Community stream (the differentiator): players build their own puzzles
  in the editor and can play-test them before submitting; the solver validates
  each one is solvable before it is accepted; accepted puzzles enter a community
  stream that anyone can play (solve -> next, or skip), upvoting the ones they
  like and seeing the creator credited. Each
  player's stream excludes puzzles they have already solved and interleaves the
  top-voted with the newest, so popular puzzles stay visible while fresh ones
  still get exposure. Submissions are de-duplicated and rate-limited (a few per
  day) to keep the stream spam-free. This fuses Hook + User Contributions +
  Reddity. (A future step could promote a top-voted community puzzle into a
  curated daily, but today the daily and the community stream are independent.)

## Success criteria (hackathon)

Primary target: Best Use of Retention ($3k) and Best Use of User Contributions
($3k), plus Honorable Mention, with an outside shot at Best App with a Hook
($15k) and Best Use of Phaser ($5k). Judged on Delightful UX, Polish, Reddity,
Hook (all equally weighted). Must be launch-ready and great on mobile.
