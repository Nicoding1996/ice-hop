# Art Direction: "Arctic at Dawn"

Ice Hop's look is **code-drawn vector art** (no raster sprites). Cohesion is the
whole game: one palette, one shape language, consistent spacing. A deliberate,
internally consistent flat/vector style is what makes it read as "designed"
rather than AI-generated. Source of truth for values: `src/client/art/theme.ts`.

## Mood

A calm polar dawn. The colony wakes on the ice and wants to slip into the water.
Cool blues dominate; a single warm sunrise accent draws the eye to what matters
(the primary action, success, stars). Restraint over decoration: never noisy.

## Palette

Cool base (the world):
- Sky gradient: night indigo `#0b1f3a` (top) -> dawn blue `#1c4a6e` (bottom)
- Ice tile: base `#bfe3f2`, highlight `#e8f7ff`, shadow/edge `#7fb4d4`
- Water hole: deep `#0e3a55`, ring `#1d6f9c`, shimmer `#7fe0ff`

Characters:
- Penguin: body `#2b3440` (soft slate, not pure black), belly `#f4f9fc`,
  beak/feet `#f6a623`
- Seal: body `#6b7b8c`, belly `#aebecb`, nose `#33404d`
- Ice rock: base `#9fb6c6`, facet `#c8dbe8`, snow cap `#eef7fc`
- Eyes: pupil `#15202b`, white `#ffffff`

Warm accent (use sparingly, for focus only):
- Sunrise coral `#ff8a5b` — primary actions (Play, Submit-when-valid), success
- Gold `#ffd166` — stars, streak flame, selection ring, hint dots

Text: `#eaf6fb` on dark; `#062033` on light/accent buttons.

Rule: at most one warm accent element competing for attention per screen.

## Shape language

- Everything rounded. Tiles are rounded squares (corner radius ~18% of cell).
- Characters are built from circles/ellipses (neoteny). Consistent stroke weight
  if strokes are used; prefer soft fills + a single subtle shadow for depth.
- No textures, no gradients on small elements. Gradient only on the backdrop.

## Characters (neoteny = "save the animals")

Large eyes, round bodies, soft contours trigger a protective, nurturing response.
- Penguin (HOPPER): round body, big head, oversized eyes with a white highlight,
  small orange beak + feet, tiny wing nubs. Reads happy and a little helpless.
- Seal (SLIDER): pudgy, big dark eyes, whiskers, lying on its belly. Friendly,
  not threatening. Refuses water (a flipper bump) — characterful + teaches the rule.
- Ice rock (BLOCKER): faceted block with a snow cap. Clearly scenery so players
  do not expect it to move.
- Water hole (GOAL): a glowing pool with a gentle shimmer; reads as inviting.

## Motion / juice (feel)

Layer feedback; keep it synced and tasteful (not constant motion).
- Idle: penguins do a slow breathing bob; water holes shimmer. Bob the inner art
  node, never the outer container (which owns position/hit-area/drag).
- Select: the chosen piece lifts/scales slightly; a gold ring appears.
- Hop: squash on takeoff, stretch through an arc, squash on landing; a small
  splash burst (a few tweened circles, no texture needed) when landing in water.
- Slide: smooth ease with a brief snow-spray at the trailing edge.
- Win: all penguins cheer, snow-sparkle burst, stars/score count up, warm copy;
  aurora flourish on a 3-star solve. (Win-screen polish is its own phase.)

Respect calm: no screen shake except meaningful moments; prefer ease-out curves.

## Layout / UI

- Mobile-first, fit the viewport (Devvit rule). Touch targets ~44-48px.
- Layered info: show only Moves/Par during play; push Build/Community to a clean
  home, not the play HUD. Icons paired with short labels (never icon-only).
- Backdrop is calm: dawn gradient + a couple of soft snow drifts, optional faint
  stars/aurora near the top. Never busy.

## Anti-"AI slop" checklist

- One palette, one shape language; every element looks related.
- Consistent corner radius, spacing, and alignment.
- One warm accent per screen; everything else cool and quiet.
- Intentional empty states with personality (community "be the first", editor hints).
- Crisp at the size it renders; fits the viewport on mobile.
