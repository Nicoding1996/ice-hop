# Product

## What we are building

**Ice Hop** is a live daily logic-puzzle game that runs inside Reddit posts via
Devvit Web. New Daily and creator Community posts are directly playable in the
feed through one lightweight DOM/SVG surface; opening the full Phaser app is
optional. Display name: "Ice Hop". App slug and package name: `ice-hop`.

The board combines peg-solitaire and sliding-block ideas: `HOPPER` pieces jump
over contiguous occupied cells, `SLIDER` pieces move along one axis, and fixed
`BLOCKER` pieces shape the route. A puzzle is solved when every hopper reaches a
hole. The engine remains theme-agnostic; the product skin maps those pieces to
penguins, seals, ice rocks, and water.

Every shipped puzzle is deterministic and has a solver-computed optimal solution.
The number of penguins always equals the number of water holes, so the player goal
reads immediately: get every penguin into the water.

## Why the solver matters

One pure TypeScript solver supports the product's core systems:

1. **Fair scoring:** par is the known optimal move count.
2. **Reliable supply:** daily and Endless boards are generated and graded before
   players receive them.
3. **Safe creation:** a community board must be structurally valid, solver-valid,
   and personally solved by its creator in the exact submitted form.
4. **Progressive help:** Endless hints recompute a valid next move from the current
   position without weakening daily competition.

Server completion is authoritative. Daily, Endless, and Community completions are
accepted only after legal transcript replay against the exact board, and retries
cannot increment persistent progress more than once. Guest Daily and Community
solves can therefore be explicitly server-verified, but guests never share a
Redis identity or receive durable progression: no Daily rank/streak, and
Community returns `saved:false` without ledger or creator-total writes. Signing
in later does not migrate a guest solve.

## Player loops

- **Inline posts:** each new Daily or Community post embeds an exact immutable V2
  snapshot and paints the board immediately. The first deliberate interaction
  reconciles it with the authoritative host puzzle; Daily obtains a play capability
  then. Snapshot/preview/init disagreement freezes the visible board and offers
  Retry/Open-full-game recovery instead of silently switching puzzles.
- **Daily:** one shared solver-generated puzzle is posted each day. Difficulty
  ramps from par 4 on Monday/Tuesday to Medium on Wednesday-Friday and Hard on
  weekends. Community submissions never silently become the daily.
- **Endless:** Easy, Medium, and Hard provide an always-full path after the daily.
  A no-hint solve adds one to the lifetime total and one to that tier; every solve
  has equal progression value. Hinted solves remain playable but do not count.
- **Awards:** quantity milestones reward 10, 25, 50, 100, and 250 Endless solves.
  Tier awards recognize Easy, Medium, first/ten Hard solves, a Hard solve at par,
  and ten solves in every tier.
- **Daily return:** consecutive Daily solves build a streak and update subreddit
  flair. In expanded `GameScene` only, a solved-Daily recap routes returning
  players toward Endless or Community. The inline post remains a playable board.
- **Competition:** each immutable daily puzzle has its own leaderboard, ranked by
  fewest moves with server-derived elapsed time only as a tiebreaker. The
  Leaderboards screen adds this week's stars (Monday-Sunday), current streaks,
  and all-time days solved, so a returning player always has a race to watch.
- **Discussion:** each puzzle post's pinned comment is a live leaderboard (top
  10, par rate, move chart) that freezes into Final results when a Daily closes.
  Sharing and the user-authorized "Comment my score" action put spoiler-free,
  dated results with streaks into the post thread under the player's account.
  Comment names are plain text (no pings), and any player can hide theirs.
- **Creation:** the editor provides live solver feedback, Undo, Random, and Test.
  Submit stays locked until the creator legally solves that exact board. Accepted
  puzzles use the same playable inline-post surface and enter the Community stream.
- **Community discovery:** authenticated solved puzzles are filtered through the
  durable played ledger; skips may resurface. Guest verification is non-durable.
  Top-voted, recent, and discovery candidates are interleaved so both established
  and new creators receive exposure.
- **Creator payoff:** My Puzzles reports per-board and aggregate solve/upvote
  counts, giving makers a concrete reason to return.
- **Low-friction conversion:** guests can play and receive an authoritative solve
  result before signing in. Win screens naturally offer sign-in and an optional
  community subscription without implying that guest progression was saved.

## Product health

Use bounded, allowlisted counters rather than free-form analytics. Signed unique
and next-day-return measurements temporarily store username-keyed membership in
Redis hashes with a 32-day TTL; longer-lived telemetry contains only daily totals.
The public fixed-event endpoint is capped per signed user or host post with a
short-lived request counter. Monitor the events currently emitted:

- daily, Endless, and Community starts versus verified completions;
- daily-to-Endless and daily-to-Community continuation;
- signed daily actives and next-day returners;
- Endless issue/completion rates by tier and at-par frequency;
- creator test starts/solves and accepted submissions;
- daily generation tier, quality pass (`prepared` by the week-ahead job, or the
  on-demand pass that made it), and resulting par.

The product is healthy when puzzles load reliably, daily completion and next-day
return remain strong, players continue into Endless/Community, and creators see
real plays on valid submissions. Mobile fit, clear recovery states, and truthful
progress take priority over adding more systems.

## Originality and identity guardrail

Ice Hop uses familiar public-domain puzzle genres, but its name, artwork, code,
scoring, generated boards, and community boards are its own. Never copy another
product's name, artwork, or puzzle set. Keep engine concepts abstract
(`HOPPER`/`SLIDER`/`BLOCKER`) and the Arctic theme as a replaceable skin. Daily
and Endless content must remain generated; Community content must come from
players and pass the product's validation and proof rules.
