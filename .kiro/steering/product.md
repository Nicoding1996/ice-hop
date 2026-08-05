# Product

## What we are building

**Ice Hop** is a live daily logic-puzzle game that runs inside Reddit posts via
Devvit Web. Display name: "Ice Hop". App slug and package name: `ice-hop`.

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

Server completion is authoritative. Daily, Endless, and Community progress is
recorded only after legal transcript replay against the exact board. Guest
progress remains session-local, and retries cannot increment persistent progress
more than once.

## Player loops

- **Daily:** one shared solver-generated puzzle is posted each day. Difficulty
  ramps from par 4 on Monday/Tuesday to Medium on Wednesday-Friday and Hard on
  weekends. Community submissions never silently become the daily.
- **Endless:** Easy, Medium, and Hard provide an always-full path after the daily.
  A no-hint solve adds one to the lifetime total and one to that tier; every solve
  has equal progression value. Hinted solves remain playable but do not count.
- **Awards:** quantity milestones reward 10, 25, 50, 100, and 250 Endless solves.
  Tier awards recognize Easy, Medium, first/ten Hard solves, a Hard solve at par,
  and ten solves in every tier.
- **Daily return:** consecutive daily solves build a streak and update subreddit
  flair. A solved-daily recap routes returning players toward Endless or
  Community rather than silently replaying completed content.
- **Competition:** each immutable daily puzzle has its own leaderboard, ranked by
  fewest moves with server-derived elapsed time only as a tiebreaker.
- **Discussion:** each puzzle post seeds a pinned prompt. Sharing and the
  user-authorized "Comment my score" action put spoiler-free results into the
  post thread under the player's account.
- **Creation:** the editor provides live solver feedback, Undo, Random, and Test.
  Submit stays locked until the creator legally solves that exact board. Accepted
  puzzles become playable posts and enter the Community stream.
- **Community discovery:** solved puzzles are filtered per player; skips may
  resurface. Top-voted, recent, and discovery candidates are interleaved so both
  established and new creators receive exposure.
- **Creator payoff:** My Puzzles reports per-board and aggregate solve/upvote
  counts, giving makers a concrete reason to return.
- **Low-friction conversion:** guests can play before signing in. Win screens are
  the natural point to offer sign-in and an optional community subscription.

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
- daily generation tier, quality pass, and resulting par.

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
