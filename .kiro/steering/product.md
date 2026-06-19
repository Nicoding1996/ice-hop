# Product

## What we are building

A daily logic-puzzle game that runs natively inside a Reddit post via Devvit Web,
built for Reddit's "Games with a Hook" hackathon (June 17 - July 15, 2026).

Core mechanic (genre, not a clone): a small grid where "hopper" pieces must jump
over adjacent pieces to land in empty target holes, while "slider" pieces move
along an axis and "blocker" pieces stay fixed. A puzzle is solved when every
hopper occupies a hole. This is a peg-solitaire / sliding-logic hybrid. Every
puzzle is deterministic with a known optimal solution computed by our solver.

## Why it can win

The whole strategy hinges on one fact: the puzzle is deterministic, so we can
write a solver. The solver unlocks three things that turn a solo puzzle into a
retentive, community-run game:

1. Par scoring (golf): score players against the known optimal move count.
2. Procedural generation: an endless supply of graded puzzles.
3. UGC validation: verify that any user-built puzzle is solvable before publish.

## The player loop (the "hook")

- Daily puzzle: one shared puzzle per day, auto-posted to the feed (the ritual).
- Streak: consecutive days solved; loss aversion brings people back.
- Score: moves vs par -> star rating; time is only a tiebreaker.
- Share: a spoiler-free emoji-grid of your solution path, pasted into comments.
- Leaderboard: daily + all-time.
- Endless mode: solver-generated puzzles for "one more" after the daily.
- Community-curated daily: players build puzzles; the community upvotes them;
  the top pick becomes tomorrow's official daily, credited to its creator.
  This single feature fuses Hook + User Contributions + Reddity.

## Success criteria (hackathon)

Primary target: Best Use of Retention ($3k) and Best Use of User Contributions
($3k), plus Honorable Mention, with an outside shot at Best App with a Hook
($15k) and Best Use of Phaser ($5k). Judged on Delightful UX, Polish, Reddity,
Hook (all equally weighted). Must be launch-ready and great on mobile.
