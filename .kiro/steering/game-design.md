# Game Design Spec

## The board

- Grid (start with 5x5; configurable). Cells are empty, a hole, or hold a piece.
- A `HOLE` is a target slot. A puzzle is SOLVED when every `HOPPER` sits in a hole.

## Pieces

- HOPPER (penguin): moves only by jumping in a straight line (up/down/left/right)
  over a contiguous run of one or more occupied cells, landing on the first empty
  cell beyond them. Cannot step into an adjacent empty cell without jumping. A
  hole is a valid landing cell (the goal). Occupies 1 cell.
- SLIDER (seal): occupies a 1x2 footprint and slides along its axis (horizontal
  or vertical) any number of free cells. Cannot jump, cannot pass through another
  piece, and cannot slide onto or across a HOLE (a seal won't slide into open
  water). The movable obstacle.
- BLOCKER (ice rock): never moves. Pure obstacle that hoppers jump over and
  sliders cannot pass through.

Define "a move" precisely: one piece relocation (`applyMove` in `rules.ts`). One
hop is a single straight-line jump over one contiguous run; hops do NOT auto-chain
into a multi-direction combo, so each landing is its own move. One slide is a
single relocation of a slider. This keeps move counts directly comparable across
players, and the solver counts moves the same way.

## Scoring (moves, not time)

- The solver computes `par` = optimal move count for the puzzle.
- Player score is relative to par (golf), tuned to stay encouraging: moves <=
  par+1 -> 3 stars, moves <= 2*par -> 2 stars, any other solve -> 1 star. Logic
  lives in `src/shared/scoring.ts` (shared by client + server so they agree).
- Leaderboard sort: primary = fewest moves, tiebreak = fastest time. This avoids
  a giant tie at optimal and rewards insight first, speed second.
- Moves-based scoring also drives comment discussion ("how did you do it in 8?"),
  which is our Reddity lever.

## Retention loops (the hook)

1. Daily ritual: one shared puzzle/day via cron-posted feed item + streak. Each
   daily post auto-seeds a pinned how-to-play comment inviting score-sharing, so
   the comment section is a built-in discussion home (Reddity lever).
2. Competition: daily + all-time leaderboards; reset gives a fresh daily race.
   The first solve each day also sets a streak-based subreddit flair (e.g.
   "🔥 7-day streak"), a public, recurring status that nudges return visits.
3. Completion: hit par, get clean closure, anticipate tomorrow (healthier than
   time-grinding the same board).
4. Difficulty ladder: the daily ramps across the week (Mon/Tue easy -> Wed-Fri
   medium -> weekend hard) so regulars get a build-up, not a flat experience.
5. Build + community stream (the differentiator): users build puzzles in the
   in-app editor; the solver validates each is solvable (and computes its par)
   before it is accepted; accepted puzzles join a community stream others can
   play (solve -> next, or skip) and upvote, with creator credit. Infinite free
   content + creators return to see plays and votes. (Future option: promote a
   top-voted community puzzle into a curated daily. Today the daily and the
   community stream are independent: the daily is always freshly generated.)
6. Endless mode (the "play more" loop): a tier picker (Easy / Medium / Hard)
   backed by the same solver-graded generator as the daily, serving an unlimited
   random shuffle of fresh puzzles from the chosen bucket. A lifetime "Solved: N"
   count (Redis `endless:{user}`) is the progression payoff and ticks up on the
   win screen. Endless is the cold-start answer: it is always full even when a
   subreddit has zero community puzzles, so it - not the (possibly empty)
   community stream - is the CTA after a daily solve. Tiers are defined purely by
   the generator levers (par range + piece counts): Easy is trap-free
   (`requireAllPiecesUsed`, par ~2-4), Medium allows decoys (par ~5-8), Hard is
   brutal-but-fair (more pieces, par ~7-12) but never literally unsolvable.

## Solver is the linchpin

BFS over board states (state = positions of all pieces), in `src/shared/solver`
as pure TS. Used to: compute par (`solver.ts`), count optimal solutions for
uniqueness (`countShortestSolutions`), generate graded puzzles (`generator.ts` +
`difficulty.ts`), classify each piece's role (`quality.ts`), and validate that
user submissions are solvable before they are accepted (`validate.ts`).

## Generated puzzle quality (not just "solvable")

Daily boards are random placements filtered by the solver, but "solvable + par
in range" alone does not feel designed. The generator applies extra gates (the
`generate` options in `generator.ts`):

- `requireUnique`: exactly one optimal solution (no mushy many-solution boards).
- `rejectInert`: drop boards with an inert piece, one the player can never even
  touch along the solution path (the "why is this rock here" clutter that reads
  as randomly assembled).
- `requireAllPiecesUsed`: every piece sits on the optimal path (no decoys).

`quality.ts` classifies each piece as **used** (on the optimal path), a **decoy**
(touchable along the path but not used - fair misdirection), or **inert** (never
touchable - clutter). Difficulty then has three independent levers: par length,
solution uniqueness, and decoys. Easy tiers use `requireAllPiecesUsed` for clean,
trap-free teaching boards; harder tiers keep uniqueness + no-clutter but allow
decoys. UGC puzzles are deliberately NOT held to these gates (only solvable +
sane size/par) so player creativity is not over-constrained.

## Community stream: fairness & anti-spam

The community stream is built per player (`listStreamForUser` + the pure
`orderCommunityStream` in `community.ts`):

- Excludes puzzles the player has already solved (tracked in `ugc:played:{user}`,
  recorded when a community puzzle is solved). Skips do NOT mark a puzzle played,
  so a skipped puzzle can resurface later.
- Includes the player's own puzzles, so a creator (or a solo tester/judge) can
  see their submission go live instead of an empty stream; solved ones still drop
  out via the played set.
- Interleaves the top-voted pool with the newest pool, so favourites stay visible
  and new submissions still get seen (no pure vote-ranking that buries new work).

Anti-spam / integrity on submit + vote:

- Rate limit: at most 5 accepted submissions per user per UTC day.
- De-duplication: identical boards are rejected via a canonical `boardSignature`
  (a player cannot flood the queue with the same puzzle).
- Must be signed in and pass solver validation to submit.
- No self-upvotes: `votePuzzle` rejects a vote when the voter is the creator, and
  enforces one vote per user per puzzle via a voters hash.

## Sharing format

Spoiler-free emoji grid summarizing the solution path / score (Wordle-style) for
pasting into the post's comments. No board spoilers before a user solves.


## Theme (LOCKED): "Ice Hop" - penguins on the ice

Two animals + one inanimate obstacle (three animals tested as too confusing).
The engine stays theme-agnostic; this is purely the art skin.

- HOPPER  = penguin (1 cell). Hops over rocks/seals; goal is to dive into a water hole.
- SLIDER  = seal (1x2). Slides along its axis on the ice; cannot enter the water.
- BLOCKER = ice rock (fixed). The thing penguins hop over; seals cannot slide through it.
- GOAL    = water hole. Land every penguin in a hole = solved (they all dive in).

Daily framing / stakes: "Get every penguin into the water." Number of penguins
always equals the number of water holes so "everyone in" reads instantly.
(Player-facing copy avoids "colony" - it read ant-ish in testing.)

Display name "Ice Hop"; app slug and package name `ice-hop`.

## Board size & piece counts

- Grid is 5x5 for the daily. Boards stay small so they read on mobile.
- Penguins (hoppers): 1-3. Seals (sliders): 0-2. Ice rocks (blockers): 1-2.
  Counts ramp with the weekly difficulty tier (see `daily.ts`), echoing the
  variety of Jump In'-style boards. #penguins always == #water holes.

## Editor & controls

- Build screen (`EditorScene`): place Penguin / Seal / Rock / Water, or Erase via
  icon tool-chips (the active tool highlights gold). "Random" drops a solver-made
  starter to riff on. Live solver feedback reports whether the board is solvable
  and its par before the player submits.
- Seal orientation: tap the Seal tool again to rotate it between horizontal
  (<->) and vertical; a status hint spells this out so it stays discoverable.
  Generated dailies can use either orientation too.
- Undo: an in-editor history stack reverts the last placement.
- Test: play your own board before submitting. It saves a draft, jumps into a
  GameScene "test" mode, and returns you to the editor with the board intact.
- Submit turns active (coral) only once the board passes validation.
- Play controls: tap a penguin to hop it; drag a seal along its axis to slide it.

## Navigation & flow

- Home hub (`HomeScene`): the menu screen with Play today's puzzle / Endless
  puzzles / Build a puzzle / Community puzzles, plus a persistent sound on/off
  toggle.
- Endless tier select (`EndlessScene`): pick Easy / Medium / Hard; shows the
  lifetime "Solved so far" banner and routes into `GameScene` in endless mode.
- In play, the only HUD nav is a single "‹ Menu" button (top-left) back to the
  hub; Build/Community live on the hub, not crowding the board. Endless play also
  shows a top-right "Solved: N" progression banner.
- No dead ends: the daily win screen offers Copy result, More puzzles (-> Endless
  tier select), and Menu; endless wins offer Next puzzle (same tier) / Change
  level / Menu; community wins offer Upvote / Next / Back to daily; test wins
  offer Back to editing.
- Loading state: the board hides behind a calm "Getting the penguins ready..."
  message until the puzzle is fetched and rendered, so no half-built frame flashes.
- Scene transitions: a shared camera fade (`fadeToScene` / `fadeInScene` in
  `theme.ts`) between every scene. Always pass a fresh data object to
  `scene.start` - Phaser keeps the previous scene data when started with
  `undefined`, which once reloaded a stale community puzzle.
- Sound: synthesized via the Web Audio API (`src/client/audio.ts`), no audio
  files - a hop, a slide, a splash, and a win arpeggio, with a persisted mute
  toggle on the hub.
