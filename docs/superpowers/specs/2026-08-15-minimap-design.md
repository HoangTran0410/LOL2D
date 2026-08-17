# Minimap — design

Date: 2026-08-15
Status: approved, ready for an implementation plan

## The problem

There is no minimap. The camera shows a slice of a 6400×6400 map — after the
viewport-scaling work, a 1000-unit-tall window — and nothing tells you where
that slice is. Teleport was deferred out of the cheat tab for exactly this
reason: picking a destination on the visible map can only move you as far as
you could already see, which is not a teleport.

## What it is

A small map in the **top-left**, always visible, drawn on the canvas. Tapping it
**expands** it; tapping the expanded map **teleports the player there** and
collapses it.

Two steps rather than one because a 150px minimap of a 6400-unit world is
~43 world units per pixel: a thumb covering 40px is covering 1700 world units.
Precise enough to glance at, nowhere near precise enough to pick a destination
with. Expanding is what makes the second tap mean something.

Top-left rather than the conventional bottom-right: both bottom corners are
where two thumbs sit for the whole match, and avoiding them costs nothing.

## Fog

The minimap shows only what the player can see — units whose
`visibleToPlayerTeam` is true. `FogOfWar.calculateSight()` already computes that
flag every frame and `ObjectManager.draw` already consumes it, so there is **no
new visibility maths**; the minimap is a second consumer of an existing answer.

> Renamed since this spec was written: the flag was `willDraw`, and it lived on
> `GameObject`. It is also *only* a rendering answer — `AttackTargeting` used to
> read it and was moved onto `combat/Vision.ts`, which asks per observer rather
> than through the player's eyes. The minimap may read it because the minimap is
> the player's point of view; anything deciding what a unit may *do* may not.

Seeing the whole map is a **toggle in the Gian lận tab**, where it belongs:
that is a cheat, and putting it there means the minimap itself never has to
reason about balance.

## Teleport

The expanded map's tap teleports. `GameObject.teleportTo(x, y)` already exists
and does the whole job — `markDisplaced()`, `pathAgent.clear()`, sets both
`position` and `destination`. It does not check terrain, and does not need to:
`TerrainMap.update()` pushes a body out of a wall on the next tick.

This makes the minimap a practice tool rather than a neutral HUD element, which
is the intent — but state it plainly in the code, because a reader who assumes
"minimap" means "the LoL minimap" will expect a move order.

**Expanding does not pause.** `Game.draw()` returns early while `paused`, so a
canvas-drawn expanded map would not render at all under a pause. Not pausing is
also simpler: no pause/unpause bookkeeping, and the expand is a momentary
action, not a modal.

## Where the code goes

`src/game/gameObject/map/Minimap.ts`, beside `Camera`, `FogOfWar` and
`TerrainMap`. Drawn from `Game.draw()` **after** `fogOfWar.draw()` and beside
`touchControls.draw()` — an overlay you cannot see is not an overlay — and
**outside** `camera.makeDraw`, because it is screen space, not world space.

`TouchControls` is the model for the whole shape: a canvas-drawn, screen-space
control that owns its own hit-testing and is driven in a plain node test with
no canvas. Follow it, including keeping every method except `draw()` free of p5
globals so the geometry is testable headlessly.

### The terrain is drawn once, not every frame

The wall layer is static. Re-tracing every polygon at minimap scale each frame
is waste; render it once into a `p5.Graphics` buffer and blit that. `FogOfWar`
already keeps an overlay buffer, so the pattern and its `resize` handling have
precedent in this codebase.

Two buffers are needed, not one — the small map and the expanded map are
different pixel sizes, and scaling one to the other is what makes a minimap look
muddy. Rebuild both on `resize`.

### The transform

One pair of functions, `worldToMinimap` / `minimapToWorld`, parameterised by the
current rect. The expanded and collapsed states differ only in that rect, so
there is one transform, not two, and the teleport tap and the dot placement use
the same one. Getting this wrong in one direction only is the likeliest bug here
and is exactly what a headless test catches.

## What is drawn

- Terrain: wall polygons from `TerrainMap.wallPolygons()`, pre-rendered.
- The player, in a distinct colour, always (you can always see yourself).
- Every other unit with `visibleToPlayerTeam`, coloured by team using the same
  `TEAM_COLORS` / `NEUTRAL_COLORS` the minions already use, so a colour means
  the same thing in both places.
- Turrets and fountains, which are static and always known.
- The camera's current view, as a rectangle outline — this is the one thing that
  answers "where am I looking", and `Camera.getBoundingBox()` already returns
  it.

Dots are a fixed pixel size, not scaled from `stats.size`: a minimap dot is an
icon, not a scale model, and a 165-unit Cho'Gath must not become a blob that
hides four other units.

## Known risks

**Touch routing.** `GameScene` hands every touch to `Game.syncTouches`, which
hands it to `TouchControls`. The minimap needs first refusal on touches inside
its rect, before the aiming controls see them — otherwise a tap on the minimap
also aims a spell. `TouchControls` already has hit-testing to model this on, but
the ordering is new and is the most likely source of a "the minimap works but
now I cannot aim" regression.

**The expanded map covers the aiming controls.** It does not pause, so the match
runs underneath it. Decide deliberately whether touches outside the expanded map
still reach the controls (they should) and whether the expanded state has an
explicit dismiss that is not a teleport (it must — otherwise opening it by
accident forces you to teleport somewhere).

**Perf.** `measure-fog.mjs` reports fog draw at 0.34ms average. The minimap must
not cost more than the thing it sits next to; the pre-rendered terrain buffer is
what keeps it to a blit plus a few dozen circles.

## Testing

Vitest, headless, no canvas — the point of keeping geometry out of `draw()`:

- `worldToMinimap` and `minimapToWorld` round-trip, at both rects, at the four
  corners and the centre. **Assert the round trip, not one direction** — a
  transform wrong by the same factor in both directions round-trips correctly,
  so also assert one known absolute: world `(0,0)` maps to the rect's top-left.
- Hit-testing: a point inside the collapsed rect hits, a point one pixel outside
  does not, and the same for expanded.
- The tap on an expanded map produces the world coordinate the transform
  predicts — the teleport destination, before any teleport happens.

e2e: tap the minimap, assert it expanded; tap a known point, assert
`player.position` moved to within a few units of the predicted world coordinate
**and** that the collapsed state returned. Prove it can fail by inverting one
axis of `minimapToWorld` — a bug a round-trip test alone would not catch.

## Out of scope

- Move orders from the minimap. The user asked for teleport; a move order is a
  different gesture on the same surface and can be added later without
  redesigning anything here.
- Pings, ward icons, champion portraits on the map, a rotating minimap.
- Drag-scrubbing the expanded map.

## Files

- Create: `src/game/gameObject/map/Minimap.ts`, `tests/game/map/Minimap.test.ts`,
  `tests/e2e/drive-minimap.mjs`
- Modify: `src/game/Game.ts` (construct, draw, resize, route touches),
  `src/scenes/GameScene.ts` (mouse clicks on the minimap),
  `src/game/hud/practice/CheatTab.vue` (reveal-whole-map toggle),
  `src/game/MatchDirector.ts` (that toggle's state)
