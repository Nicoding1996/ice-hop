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
  giving each puzzle thread a natural conversation prompt.

## Retention and progression loops

1. Daily ritual: one shared puzzle/day via cron-posted feed item + streak. Each
   daily post auto-seeds a pinned how-to-play comment inviting score-sharing, so
   the comment section is a built-in discussion home.
2. Competition: each immutable daily puzzle has its own leaderboard; reset gives
   a fresh daily race.
   The first solve each day also sets a streak-based subreddit flair (e.g.
   "🔥 7-day streak"), a public, recurring status that nudges return visits.
3. Completion: hit par, get clean closure, anticipate tomorrow (healthier than
   time-grinding the same board).
4. Difficulty ladder: daily bands are non-overlapping and never below par 4:
   Monday/Tuesday par 4, Wednesday-Friday par 5-7, weekend par 8-11. Each
   generation pass and fallback remains inside that day's band.
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
   count is derived from a migration baseline plus permanent per-tier completion
   ledgers, and the same tier totals label the Easy/Medium/Hard buttons. Quantity
   milestones and tier awards use those verified no-hint counts; each tier solve
   adds exactly one, and Hard-at-par is tracked separately. Endless is the cold-start answer: it is always full even
   when a subreddit has zero community puzzles, so it - not the (possibly empty)
   community stream - is the CTA after a daily solve. Tiers use non-overlapping
   par bands plus piece-count levers: Easy is trap-free
   (`requireAllPiecesUsed`, par 2-4), Medium allows decoys (par 5-7), and Hard
   uses heavier boards (par 8-11), while every served board remains solvable. Endless drops the daily's
   uniqueness gate (it's solo, so a single optimal line doesn't matter) and bounds
   the solver budget, so generation stays cheap. Puzzles are served from a small
   per-tier Redis pool (`endless:pool:1:{tier}`, quality generation) refilled off
   the request path by an every-5-minute scheduler cron (budget spread across the
   tiers) plus a warm-up on install. When a pool is momentarily empty the request
   uses a FAST, bounded fallback generator (low attempts, tight solver cap, gates
   off) so it can never hang - the pool supplies the nicer puzzles. The
   client also prefetches the next puzzle (stashed in the Phaser registry) while
   you solve the current one, so tapping "Next" is instant; the lifetime count is
   kept in the registry so a prefetched board still shows the right banner. A
   progressive **Hint** (Endless only) reveals the solver's best next move - first
   tap glows the piece, second shows a translucent ghost of where it goes,
   recomputed from the current board so it is always valid. For signed-in play,
   the server atomically marks the issued puzzle ineligible before returning the
   hint, so a modified client cannot claim it afterward; only a newly issued
   puzzle clears that eligibility state. The daily has no hint, to protect its leaderboard
   and the "how'd you do it in N" comment culture; there, stuck players use
   Restart and the community shares approaches in the comments.

## Solver is the linchpin

BFS over board states (state = positions of all pieces), in `src/shared/solver`
as pure TS. Used to: compute par (`solver.ts`), count optimal solutions for
uniqueness (`countShortestSolutions`), generate graded puzzles (`generator.ts` +
`difficulty.ts`), classify each piece's role (`quality.ts`), validate that
user submissions are solvable before they are accepted (`validate.ts`), and power
the Endless hint (the best next move recomputed from the current board state).

## Generated puzzle quality (not just "solvable")

Daily boards are random placements filtered by the solver, but "solvable + par
in range" alone does not feel designed. The preferred daily pass applies the
quality gates below. If its request-safe deadline expires, relaxed and fast
passes progressively drop expensive gates while preserving the exact weekday par
band; the final fallback is also solver-verified and in-band. Endless pool
refills use similar quality gates off the player request path.

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
decoys. UGC puzzles are deliberately NOT held to these generation-quality gates
so player creativity is not over-constrained; they still require sane structure,
solvability/par policy, and a legal creator solve of the exact board.

## Community stream: fairness & anti-spam

The community stream is built per player (`listStreamForUser` + the pure
`orderCommunityStream` in `community.ts`):

- For authenticated players, excludes puzzles in the durable
  `ugc:played:{user}` ledger. Skips do NOT mark a puzzle played, so they can
  resurface. Guest solves are server-replayed but return `saved:false`; they do
  not enter this ledger or persistently filter the stream.
- Includes the player's own puzzles, so a creator (including one in a small or
  newly launched community) can see their submission go live instead of an empty
  stream; signed solved ones still drop out via the played set.
- Interleaves the top-voted pool with the newest pool, so favourites stay visible
  and new submissions still get seen (no pure vote-ranking that buries new work).

Anti-spam / integrity on submit + vote:

- Rate limit: at most 5 accepted submissions per user per UTC day.
- De-duplication: identical boards are rejected via a canonical `boardSignature`
  (a player cannot flood the queue with the same puzzle).
- Must be signed in, pass structural/solver validation, and include a legal
  creator transcript that solves the exact canonical board. Any editor mutation
  invalidates the previous proof.
- No self-upvotes: `votePuzzle` rejects a vote when the voter is the creator, and
  enforces one vote per user per puzzle via a voters hash.

## Sharing format

Spoiler-free emoji grid summarizing the solution path / score (Wordle-style),
shared via the native share sheet (`showShareSheet`, which also links back to the
post) with a clipboard fallback so the paste-into-comments flow works everywhere.
No board spoilers before a user solves. A separate "Comment my score" win-screen
action posts the same spoiler-free score line straight into the post's thread on
the player's behalf (`buildScoreComment` in `share.ts` -> `/api/comment-score`,
`runAs: 'USER'`, gated by the `SUBMIT_COMMENT` asUser scope), so the comment
section fills with scores without anyone leaving the game.


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
  Counts ramp with the weekly difficulty tier while preserving mobile readability.
  #penguins always == #water holes.

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
- Submit turns active (coral) only after the board validates and the creator has
  solved that exact board in Test mode. Placement, erase, undo, random, and clear
  all invalidate the proof.
- Play controls are identical in the feed post and the full game: tap a penguin,
  then tap its destination (the whole destination cell is the target, the gold
  dot is only the cue). Slide a seal by dragging it along its lane, or tap it and
  tap one of its one-cell lane stops (shared `slideStop` in
  `src/shared/game/slide.ts`). Taps act on release, like native buttons. The
  one feed exception is Reddit's scroll rule: a vertical seal's drag axis is the
  feed's scroll axis, so in the feed it drags only after a tap selects it.

## Inline Daily and Community posts

- New custom posts share one lightweight Phaser-free DOM/SVG board. Their exact
  immutable V2 `postData.splash` snapshots paint immediately; Daily carries its
  puzzle/date and Community its puzzle/creator. Ordered piece arrays are part of
  identity because legal transcripts address pieces by index.
- The first deliberate board interaction lazily calls `GET /api/init` to reconcile
  the snapshot with the authoritative host puzzle and, for Daily, obtain a
  `playId`. A prior Daily solve never replaces this feed board with a recap.
- Daily solves use `/api/solve`. Community signed and guest solves send one frozen
  canonical `{id,moves}` transcript to `/api/ugc/played`. Both are server-replayed;
  signed success persists, while guest Daily has no durable rank/streak and guest
  Community returns `saved:false` without a played-ledger or creator-total write.
- Snapshot, preview, or init disagreement fails closed: abort stale work, freeze
  the visible board, remove move controls, and show Retry/Open-full-game recovery.
  Pending expansion locks even a controller created or upgraded after it began.
- After a Community move, expansion stays locked because no transcript handoff
  exists. A hydrated Daily attempt can use the bounded Daily handoff instead.
- Compact feed sizing preserves board aspect ratio and constrains it by both card
  width and available height, retaining HUD/footer/touch targets. Never restore
  short-height `height: auto` or unconstrained grid-row overrides that collapse
  size-container rows.
- No feed state may need inner scrolling: `.inline-stage` is `overflow: hidden`
  with no overscroll containment (Reddit rejects scroll traps), so every card is
  laid out to fit. Win cards use one primary action and secondary actions two per
  row; short cards drop decoration (eyebrow, small stars, the Join extra) first.
  `npm run test:ui` asserts the fit at 320-700px wide and 320/512px tall.
- The feed header leads with difficulty (then date or creator) and uses icon
  SFX/Music toggles, so truncation never hides the difficulty or credit.

## Expanded navigation & flow

- Home hub (`HomeScene`): the menu screen with Play today's puzzle / Endless
  puzzles / Build a puzzle / My puzzles / Community puzzles, plus a persistent
  sound on/off toggle and a "?" chip that opens the shared "How to play" overlay
  (`showHowToPlay` in `howToPlay.ts`). The game is built to read without
  instructions, so "?" is a discoverable safety net, not a wall; the same overlay
  is reachable from the expanded play screen for a first-timer who opens the full
  Daily.
- My puzzles (`MyPuzzlesScene`): a creator dashboard listing the puzzles you've
  built with their solve and upvote counts plus headline totals - the reason a
  builder comes back. Paginated (Prev / Next) rather than scrolled so rows never
  overlap the header/footer; data from GET `/api/ugc/mine`. Empty and error
  states route to Build or a retry.
- Endless tier select (`EndlessScene`): pick Easy / Medium / Hard; shows the
  lifetime "Solved so far" banner, per-tier counts, and a paginated Awards panel
  (from GET `/api/endless/stats`: total, `byTier`, and the achievement snapshot),
  then routes into `GameScene` in Endless mode.
- In expanded play, the HUD nav is a single "‹ Menu" button (top-left) back to the
  hub plus a "↺ Restart" button (bottom strip) that restores the current board to
  its start; Restart only appears once a move has been made (it swaps in for the
  first-move hint), so a stranded/unsolvable board is never a dead end. In Endless
  a "Hint" button sits beside Restart (best next move; the solve then won't
  count). Endless play also shows a top-right "Solved: N" progression banner.
- No dead ends in expanded `GameScene`: the Daily win screen offers Share result
  (native share sheet, clipboard fallback), Comment my score (posts a spoiler-free
  score line straight into the current post's thread, authored by the player via
  `/api/comment-score`; gated by a `scorePosted` flag and a "this puzzle came from
  the host post" check so it can never double-post or comment a mismatched puzzle),
  More puzzles (-> Endless tier select), and Menu; Endless wins offer Next puzzle
  (same tier) / Change level / Menu; Community wins offer Upvote / Next / Back to
  daily; Test wins offer Back to editing. Signed-in players who haven't joined
  also get a "Join r/{subreddit}" CTA (`/api/subscribe` - a one-tap opt-in that
  never gates play; an app-side `subscribed:{user}` flag stops re-prompting), and
  logged-out players get a "Sign in to save your streak / progress" CTA via
  `showLoginPrompt`. A failed puzzle load shows Try again + Menu recovery instead
  of hanging on the loader.
- **Expanded `GameScene` only:** returning to a solved Daily shows a recap (moves,
  stars, and "a fresh puzzle drops tomorrow") that funnels toward Endless /
  Community, with a quiet "Play today's again" replay. The inline feed post always
  remains a playable board, even after a prior solve.
- **Expanded `GameScene` only:** the board hides behind "Getting the penguins
  ready..." until the puzzle is fetched and rendered, so no half-built frame
  flashes. Exact V2 inline boards paint immediately; inline loading/recovery is
  reserved for legacy hydration or verification.
- Scene transitions: a shared camera fade (`fadeToScene` / `fadeInScene` in
  `theme.ts`) between every scene. Always pass a fresh data object to
  `scene.start` - Phaser keeps the previous scene data when started with
  `undefined`, which once reloaded a stale community puzzle.
- Audio: hop, slide, splash, and the verified-win arpeggio are synthesized in
  `src/client/audio.ts`; the ambient loop is a checked-in composition with OGG
  first on Chromium/Android and MP3 fallback for Safari/iOS. Inline and hub SFX /
  Music controls persist independently. The compact expanded-play speaker is a
  combined mute that restores the previous channel mix rather than overwriting it.
  Music never starts from feed scrolling: inline play authorizes it on the first
  legal move, while expanded play authorizes it on the first local pointer or
  keyboard gesture. Hidden/offscreen views suspend immediately and release their
  decoded track after a bounded grace period; entrypoint transitions stop the old
  document before the new one can begin. The inline win cue plays only after the
  server has replayed and accepted the exact transcript.
