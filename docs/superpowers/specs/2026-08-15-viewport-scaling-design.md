# Viewport scaling — design

Date: 2026-08-15
Status: approved, ready for an implementation plan

## The problem

`Camera.currentScale` is effectively pinned at `1`, so one world unit is one
screen pixel and **the visible world is exactly the size of the window**. A
match played on a phone and the same match played on a desktop are not the same
game:

| | Viewport, world units | Area |
|---|---|---|
| Phone, landscape | 844 × 390 | 329k |
| Desktop | 2560 × 1440 | 3.69M |

Eleven times the area. `zoomBy` and `zoomTo` exist on `Camera` and **nothing
calls them** — not even `mouseWheel`, which `SceneManager` routes but
`GameScene` never overrides. The machinery is there; no policy was ever put on
top of it.

## The anchor: the vision circle

The imbalance is smaller than 11× in useful terms, and the reason gives us a
principled anchor rather than an invented number. A champion's
`visionRadius` is **500** (`Stats.ts:190`), so what a player is permitted to
know is a circle **1000 world units across**. Everything beyond it is fog.

- On desktop that circle fits with room to spare — you see all of your own
  vision, plus allied and turret vision elsewhere.
- On a landscape phone the circle is **larger than the viewport in both
  dimensions** — you never see the whole of your own vision. The screen, not
  the fog, is what limits you.

So the rule is: **every screen shows at least the player's full vision circle.**

```
baseScale = min(viewportWidth, viewportHeight) / VISION_SPAN     // VISION_SPAN = 1000
```

| Screen | baseScale | Champion (55u) on screen |
|---|---|---|
| Phone landscape 844×390 | 0.39 | 21px |
| Tablet 1180×820 | 0.82 | 45px |
| Laptop 1440×900 | 0.90 | 50px |
| Desktop 2560×1440 | 1.44 | 79px |

Keying off the **shorter** side is deliberate: an ultrawide is not punished for
its width, it simply gets more horizontal world, which costs nothing because
fog limits what is there to see anyway. Note the consequence, which is correct
rather than a bug: the 2.16-aspect phone ends up seeing *more* horizontal world
(2164 units) than the 1.78-aspect desktop (1778). Aspect ratio decides
horizontal extent; that is inherent and not something to normalise away.

`VISION_SPAN` is a constant derived from the *default* vision radius, not a
live read of `player.stats.visionRadius.value`. A buff that grants vision must
not make the camera lurch.

## Manual zoom, on top of the anchor

The balanced value is the **default**, not a cage. The player adjusts, and the
adjustment is a **factor on the base**, never an absolute scale:

```
scale = clamp(baseScale * zoomFactor, SCALE_MIN, SCALE_MAX)
```

Storing a factor rather than a scale is what makes the two inputs compose. With
an absolute scale, resizing the window would silently discard the player's
choice, and choosing a zoom would discard the balance. With a factor, a player
who prefers "a bit closer than standard" keeps exactly that across a resize, an
orientation change, and a different device.

`zoomFactor` ranges **[0.6, 1.6]** and persists, following the shape
`touchControlsPreference()` already establishes in `TouchControls.ts:220-232`: a
URL query override first (`?zoom=`), then the stored value, then the default.
The query override is what makes the e2e scripts able to pin a zoom.

`SCALE_MIN` / `SCALE_MAX`: **`Camera.zoomBy`/`zoomTo` currently
`constrain(this.scale, 0.5, 2)`, and 0.39 is below that floor.** The clamp has
to widen to `[0.3, 2.5]` or the phone default is silently clipped to 0.5 — which
would leave the exact bug this spec exists to fix, in a form much harder to
spot. This is the single most likely way to implement the whole feature and
have nothing change on a phone.

**Two ways in.** Mouse wheel on desktop (`GameScene.mouseWheel`, which
`SceneManager` already routes to the active scene). A slider on touch — added
to the practice panel's Trận đấu tab, because a phone has no wheel and phones
are who this feature is for. Pinch-to-zoom is deliberately **not** in scope:
`GameScene`'s touch handlers already `preventDefault()` two-finger gestures so
that a two-thumb aim does not pinch-zoom the page, and a pinch recogniser would
be competing with the aiming gestures for the same fingers.

## What breaks when scale stops being 1

Everything below is invisible today *because* nothing ever changed the scale.
Each is a real defect that ships the moment this feature does.

### World-space text becomes unreadable

There are 15 `textSize()` calls in `src/game/`. `TouchControls.ts` draws after
`camera.makeDraw` returns, so it is unaffected. The rest are inside the camera
transform, and at the phone's 0.39 a `textSize(12)` health-bar number renders at
**4.7 real pixels**.

The rule to apply: **information overlays are drawn at constant screen size;
world objects scale with the world.** A champion sprite is the world. A health
bar, a damage number and a stack tally are a heads-up display that happens to be
positioned in world coordinates.

This matters as a *pair*, not two independent fixes. `drawHealthBar` is 100
world units wide with `textSize(12)` over it. Compensating only the text gives
12px digits over a 39px bar — worse than either extreme. The bar and its text
compensate together, or neither does.

Affected: `AttackableUnit.drawHealthBar`, `CombatText`, `Champion`, `Turret`,
`Nasus_Q`, `Veigar_Q`, `ChoGath_R` (the last three draw stack tallies), and
`NavDebugOverlay` for consistency.

Proposed seam: a method on `Camera` — `constantSize(px)` returning
`px / this.currentScale` — so call sites read
`textSize(this.game.camera.constantSize(12))` and are greppable as a group.

### FogOfWar reads the wrong scale

`FogOfWar.ts:304-305` uses `this.game.camera.scale`; everything else in the
codebase uses `currentScale`. `scale` is the target and `currentScale` is the
lerped value chasing it (`Camera.update`, 0.07/frame). The two are identical
today only because nothing moves the target. The moment a wheel notch or a
resize does, the fog snaps to the final zoom while the world slides toward it.

### The opening zoom animation

`currentScale` is constructed at `0.5` and lerps to `scale`. With `scale` no
longer 1, a phone at 0.39 now *zooms out* on entry rather than in. Either seed
`currentScale = scale` at construction for a static open, or keep a deliberate
animation — but it must be a decision, not the residue of a hardcoded 0.5.

## Where the code goes

`Game.resize(w, h)` already exists and already fans out to `fogOfWar.resize`
and `touchControls.resize` (`Game.ts:344-347`), reached from
`GameScene.windowResized`. The camera's recompute belongs there, plus once at
construction — a match that boots and is never resized must not be left at a
default scale.

`Camera` owns the policy: it is the only thing that knows what `currentScale`
means, and `Game` should not grow viewport arithmetic.

## Testing

Vitest:

- `baseScale` for each row of the table above, asserted as numbers.
- The clamp actually admits 0.39 — i.e. a test that **fails against the current
  `constrain(0.5, 2)`**. This is the one test that must be written first and
  watched to go red, because passing it is the whole point of touching the
  clamp.
- `zoomFactor` survives a resize: set a factor, resize, assert the factor is
  unchanged and the scale moved.
- `constantSize(px)` returns a value that, multiplied by `currentScale`, is
  `px` — at three different scales.

The practice-panel plan shipped six tests that could never fail, all the same
shape: asserting on state after the code under test had already produced it.
Every test here is to be run red first and the failure message read.

e2e: a run at two viewport sizes asserting the visible world span is within a
few percent of each other, which is the user-visible claim this whole spec
makes. `bench-mobile.mjs` and `drive-mobile-hud.mjs` already drive a landscape
phone and are the place to add it.

## Out of scope

- **Pinch-to-zoom** — conflicts with the two-thumb aiming gestures.
- **Zoom following the action** (auto zoom-out in fights). A different feature
  with a different failure mode.
- **The minimap**, which answers the same question — "how much of the world can
  I see" — at a different altitude, and has its own spec waiting. Teleport is
  blocked behind that one.

## Files

- Modify: `src/game/gameObject/map/Camera.ts` (base scale, zoom factor, widened
  clamp, `constantSize`), `src/game/Game.ts` (recompute in `resize` and at
  construction), `src/scenes/GameScene.ts` (`mouseWheel`),
  `src/game/gameObject/map/FogOfWar.ts` (`scale` → `currentScale`),
  `src/game/gameObject/attackableUnits/AttackableUnit.ts`,
  `src/game/gameObject/attackableUnits/Champion.ts`,
  `src/game/gameObject/structures/Turret.ts`,
  `src/game/gameObject/helpers/CombatText.ts`,
  `src/game/gameObject/spells/Nasus_Q.ts`,
  `src/game/gameObject/spells/Veigar_Q.ts`,
  `src/game/gameObject/spells/ChoGath_R.ts`,
  `src/game/nav/NavDebugOverlay.ts`,
  `src/game/hud/practice/RulesTab.vue` (the zoom slider)
- Note on ordering: the practice-panel spec merges `WorldTab` into
  `RulesTab.vue`. This work lands first, so the slider goes into `RulesTab.vue`
  as it exists today and that merge happens around it.
