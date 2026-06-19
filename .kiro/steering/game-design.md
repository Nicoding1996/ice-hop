# Game Design Spec

## The board

- Grid (start with 5x5; configurable). Cells are empty, a hole, or hold a piece.
- A `HOLE` is a target slot. A puzzle is SOLVED when every `HOPPER` sits in a hole.

## Pieces

- HOPPER: moves only by jumping in a straight line (up/down/left/right) over
  exactly one or more contiguous occupied cells, landing on the first empty cell
  beyond them. Cannot move into an adjacent empty cell without jumping.
- SLIDER: occupies a 1xN footprint and slides along its axis any number of free
  cells. Cannot jump. (The movable obstacle, like a fox/car.)
- BLOCKER: never moves (like a mushroom/wall). Pure obstacle.

Define "a move" precisely: one piece relocation. A multi-jump chain by a single
hopper in one turn counts as ONE move (the solver enforces this consistently so
move counts are comparable across players). Decide and lock this in `rules.ts`.

## Scoring (moves, not time)

- The solver computes `par` = optimal move count for the puzzle.
- Player score is relative to par (golf): par -> 3 stars, par+1..+2 -> 2 stars,
  solved over that -> 1 star.
- Leaderboard sort: primary = fewest moves, tiebreak = fastest time. This avoids
  a giant tie at optimal and rewards insight first, speed second.
- Moves-based scoring also drives comment discussion ("how did you do it in 8?"),
  which is our Reddity lever.

## Retention loops (the hook)

1. Daily ritual: one shared puzzle/day via cron-posted feed item + streak.
2. Competition: daily + all-time leaderboards; reset gives a fresh daily race.
3. Completion: hit par, get clean closure, anticipate tomorrow (healthier than
   time-grinding the same board).
4. Endless mode: solver-generated puzzles for "one more".
5. Community-curated daily (the differentiator): users submit puzzles (validated
   by the solver), community upvotes, top pick becomes tomorrow's official daily
   with creator credit. Infinite free content + creators return to see results.

## Solver is the linchpin

BFS over board states (state = positions of all pieces). Used to: compute par,
prove solvability + (optionally) uniqueness for UGC, and grade difficulty
(solution length + branching factor). Keep it in `src/shared/solver` as pure TS.

## Sharing format

Spoiler-free emoji grid summarizing the solution path / score (Wordle-style) for
pasting into the post's comments. No board spoilers before a user solves.


## Theme (LOCKED): "Floe" - penguins on the ice

Two animals + one inanimate obstacle (three animals tested as too confusing).
The engine stays theme-agnostic; this is purely the art skin.

- HOPPER  = penguin (1 cell). Hops over obstacles/animals; goal is to dive into a water hole.
- SLIDER  = seal (1x2). Slides along its axis on the ice (the most natural slider mapping).
- BLOCKER = ice rock (fixed). The thing penguins hop over; seals cannot slide through it.
- GOAL    = water hole. Land every penguin in a hole = solved (the colony dives in).

Daily framing / stakes: "Get the whole colony into the water." Number of penguins
always equals the number of water holes so "everyone in" reads instantly.
Working title "Floe" (package/app still named rabbits-n-foxes until rename is confirmed).
