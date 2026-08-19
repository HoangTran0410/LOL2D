# Render interpolation — design

**Status:** implemented. Groundwork and wiring both landed; `renderInterpolation.wiring.test.ts` covers the seams and `measure-frame-pacing.mjs` is the passing gate (see §4 for the one deviation the measurement environment forced).

**Problem in one line:** the game _simulates_ on a fixed 60Hz clock and _draws_
on an unrelated one, so a rendered frame catches the simulation at an arbitrary
phase and every moving body visibly jiggles.

---

## 1. The measurement

`tests/e2e/measure-frame-pacing.mjs` (already in the repo) drives the real game
in Chrome, walks the player in a straight line, and records the player's world
position on every rendered frame together with the number of simulation ticks
that happened since the previous frame.

On the shipped build, over 120 rendered frames:

| Simulation ticks in a rendered frame | Frames |
| ------------------------------------ | ------ |
| 0                                    | 24     |
| 1                                    | 48     |
| 2                                    | 48     |

Per-frame displacement: **min 0px, max 6px, mean 3.6px, coefficient of
variation 0.62** — for a body the simulation is stepping an even 3px per tick.

That is the bug. It is a **phase** problem, not a frame-rate problem. The frame
rate can be a perfectly steady 60 and the jiggle is still there.

### Why the two clocks exist

- `src/scenes/GameScene.ts` — `updateLoop()` runs the simulation on its own
  `setTimeout` loop, gated to `Game.fps`.
- `src/game/Game.ts:107` — `readonly fps = 60`. The simulation rate is a
  constant and is **not** the render preference.
- `src/scenes/GameScene.ts:126` — `frameRate(renderFpsPreference())` throttles
  p5's `draw()` only. The render preference is 30 or 60
  (`Game.setRenderFps`).

Nothing synchronises them, and **nothing should**. This is the decision the
user made explicitly:

> "t muốn giữ sim, nhưng vẽ phải mượt, thường sim sẽ cố định 60hz, còn render
> sẽ bị lag nên giảm fps, nên 1 render thường = 1-2 sim; có cách nào cho 2
> thằng này tách biệt được không, không dẫm lên nhau, nhưng vẫn giữ vòng draw
> mượt"

A fixed timestep is what keeps movement, collision and cooldowns identical on
every machine. The draw rate has to stay free to drop on a slow phone. Both
properties are worth keeping; the phase error is the price, and interpolation
is how it is paid.

---

## 2. What this is NOT — two wrong roads, both already walked

**Both of these were tried in this session, shipped, and reverted. Do not
repeat either.**

### 2.1 Do not scale movement by `deltaTime`

Commit `c260fe2`, reverted by `67171c5`. The reasoning was "`Stats.speed` is
per frame, so scale it by elapsed time". It is wrong here because **the
simulation is already a fixed timestep** — `Game.fps` is a constant 60 and
`updateLoop` gates on it, so a per-tick step is already a per-unit-time step.

Worse, `deltaTime` is p5's global and measures the **render** loop. Scaling
simulation motion by it multiplies a fixed-rate simulation by a variable render
delta. At the 30 FPS setting that made the game run at **double speed** — which
is exactly how it was caught.

### 2.2 Do not make the camera smooth over time either

Commit `1894798`, reverted by `9ef1351`. `Camera.update()` runs inside the
simulation tick, so its fixed per-tick lerp factor is already correct. Feeding
it p5's render `deltaTime` had the same defect as 2.1 and, at 30 FPS, made the
camera converge twice as fast.

### 2.3 Do not merge the two loops

Tempting, and it does remove the phase error, but it throws away the fixed
timestep the user explicitly asked to keep, and it makes gameplay depend on
render rate. Rejected.

---

## 3. The design

Draw the world **between** the two ticks it currently sits between, at the
fraction of a step that has actually elapsed. The simulation is untouched and
remains authoritative; only the picture is blended.

The price is up to one tick (16.7ms) of display latency. That is the standard
trade and is below what anyone can perceive.

### 3.1 What already exists

`src/game/render/Interpolation.ts` and `tests/game/render/Interpolation.test.ts`
are **written, tested and committed** — 9 passing tests. Nothing imports the
module yet. It exports:

- `RENDER_SNAP_PX = 150` — the longest step that may be blended.
- `isContinuousStep(prevX, prevY, curX, curY): boolean` — a squared-distance
  test against that limit.
- `blend(from, to, alpha): number` — one axis, pure.
- `renderAlpha(elapsedMs, stepMs): number` — clamped to `[0, 1]`.

Read that file's header comment before starting; it carries the rationale in
full.

### 3.2 Each object remembers where it started the tick

Every `GameObject` needs the position it held at the **start** of the current
simulation tick. Two plain numbers, not a vector: every object carries a pair
and the draw pass reads them every frame, so a `createVector` each would be an
allocation per object per tick for a value nothing outside rendering ever sees.

**Name them `renderOriginX` / `renderOriginY`, not `previousX` / `previousY`.**
`Camille_E_GrappleObject` and `Nautilus_Q_Object` already declare
`private previousX` / `previousY` for their own purposes, and reusing the name
makes both classes fail to extend their base — `TS2415`, caught by
`npm run typecheck:core` and by nothing else.

Also add `snapRenderOrigin()`, which collapses the origin onto the current
position (§3.5).

### 3.3 The snapshot rides the existing update walk

`ObjectManager.update()` already opens with a `for (const o of this.objects)`
loop that calls `o.update?.()`. Write the origin at the top of that loop body —
no second pass over the object list.

Objects created during a tick land in `_objectToBeAdd` and are appended after
it; their origin is set by the `GameObject` constructor, so their first drawn
frame does not slide in from wherever the field was initialised.

### 3.4 The draw pass substitutes and restores

`ObjectManager.draw()` takes an `alpha` parameter defaulting to `1` (which must
be a no-op, so every existing caller and test keeps working untouched).

In the final `for (const { o } of drawables)` loop, when `alpha < 1` and the
step is continuous: stash the true `x`/`y` in locals, write the blended values
onto `o.position`, draw, then write the true values back.

**This is the whole reason the change is small.** None of the hundreds of
`draw()` bodies in this codebase needs to know it is happening, and no draw
site has to be edited.

Three things to be careful of:

- **`position` is reassignable, not just mutable.** Several spell objects do
  `this.position = something.copy()`. Stash the numbers, not the vector, and
  write them back onto whatever `o.position` is at the end.
- **No `try`/`finally` per object.** A throw inside a `draw()` already breaks
  the frame; paying for a guard on every object at 60fps to tidy up a state
  that is about to be discarded is not worth it.
- **Culling stays on the true position.** The quadtree retrieval and the
  `visualBound` test run before substitution and should keep running there. The
  difference is sub-pixel and the alternative is rebuilding the hit-list.

### 3.5 A jump is not a journey

Blending across a blink draws the champion sliding the whole way, which is
worse than the jump it replaces. Two defences, both wanted:

1. **By construction:** `GameObject.teleportTo` and the
   `AttackableUnit.teleportTo` override call `snapRenderOrigin()`. Check
   `respawn()` and the minimap teleport path too.
2. **As a net:** `isContinuousStep` refuses anything past `RENDER_SNAP_PX`
   (150). That covers the call sites nobody remembered. 150 is comfortably
   above the longest legitimate tick — the fastest dash on the roster is well
   under half of it — and far below Flash's 400.

### 3.6 The camera has to move with the world

`Camera.update()` runs inside the simulation tick and lerps both
`position` and `currentScale`. If objects are interpolated and the camera is
not, the camera jumps once per tick and the whole world jitters against the
screen — the same bug, relocated.

Give `Camera` its own render origin (position **and** `currentScale`), snapshot
it at the top of `update()`, and apply the same substitute/restore around the
body of `Game.draw()`.

Substitute for the **whole** of `Game.draw()`, not just `camera.makeDraw(...)`:
the minimap draws the camera box and would otherwise stutter against a smooth
world. Restore before returning, because `Game.fixedUpdate()` reads
`camera.screenToWorld(mouseX, mouseY)` and must see the true camera.

### 3.7 Where alpha comes from

`GameScene` owns the simulation clock. Its module-level `previousTime` already
marks the notional time of the last tick, and `interval = 1000 / game.fps` is
the step. So:

```
alpha = renderAlpha(performance.now() - previousTime, interval)
```

computed in `GameScene.draw()` and passed down through `game.draw(alpha)` to
`objectManager.draw(alpha)`.

`renderAlpha` clamps deliberately. An alpha above 1 would **extrapolate** —
drawing a body somewhere the simulation never put it — which reads as overshoot
and rubber-banding on exactly the slow devices this feature exists for.

### 3.8 Lifecycle is already safe

No new suspend/resume handling is needed. `GameScene.suspendRuntime()` already
calls `noLoop()` **and** clears the simulation timeout together, and
`resumeRuntime()` restarts both. The two loops are already coupled at the
lifecycle level even though they are independent at the tick level.

---

## 4. Acceptance

**The gate is the measurement, not an opinion about smoothness.**

`tests/e2e/measure-frame-pacing.mjs` must be **updated first**: it currently
wraps `game.draw` and samples `player.position`, which runs _before_
`ObjectManager.draw` substitutes, so it would report the un-interpolated value
and show no improvement however well the feature works. Sample the position the
renderer actually used — wrap `player.draw` and record `player.position` from
inside it.

Then:

- Coefficient of variation of per-frame displacement **below 0.15** (it is 0.62
  today). Prove the updated probe still reports the jiggle with interpolation
  off, or the number means nothing.

  **Deviation forced by the environment (implemented):** headless Chrome drives
  rAF and the sim `setTimeout` off software clocks that lock into perfect 1:1
  lockstep — every rendered frame catches exactly one tick — so the natural
  0.62 does not occur there and cannot be the control. The measurement instead
  *induces* the drift the way a real slow phone does: `frameRate(40)` against the
  60Hz sim, so frames catch one tick or two in a steady 2:3 beat at a constant
  sim speed. It then samples **one walk in two passes** — a forced-`alpha=1`
  baseline (the control, ~0.33 here) and the real interpolated path (~0.12) —
  so the falsifiability proof is built into every run rather than a manual
  side-check. Throttling *below* the sim was load-bearing: pinning to a clean
  multiple (30/60) re-locks the two into a jiggle-free 2:1, and blocking the loop
  to force drift slows the simulation itself, which interpolation correctly
  refuses to hide.
- The 0-tick and 2-tick frames may remain — they are the simulation's business
  and are expected. What must become even is the **drawn** step.
- `npm run verify` stays green, including `typecheck:core` (§3.2).
- Vitest coverage for: alpha 1 is a byte-for-byte no-op; alpha 0.5 draws an
  object at the midpoint of its step; the true position is restored after the
  draw pass; a step longer than `RENDER_SNAP_PX` is drawn at the current
  position, not blended.

---

## 5. Out of scope, but real — record it, do not silently fix it

**At the 30 FPS setting, game time runs at roughly double speed.**

Every duration in the simulation — cooldowns, buff timers, cast times,
`Game.matchTimeMs` — advances by p5's `deltaTime`, which measures the **render**
loop. The simulation ticks 60 times a second regardless. So at
`renderFps = 30`, each of 60 ticks per second adds ~33ms: about 2000ms of game
time per real second.

This is derived from reading the code, **not measured** — verify it before
acting on it. It is a separate defect from the phase problem this spec solves,
it predates all of this session's work, and fixing it means giving the
simulation its own step constant instead of reading `deltaTime` — a mechanical
change across a lot of call sites. Do not fold it into this work.
