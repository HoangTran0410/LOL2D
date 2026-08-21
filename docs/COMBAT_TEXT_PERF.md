# Combat text performance — investigation and fix

Branch `perf-combat-text`, worktree `LOL2D-perf-combattext`.

## The report

> khi có nhiều lính, hoặc nhiều event sát thương/hồi máu xảy ra liên tục (khi
> combat) thì combat text xuất hiện và remove liên tục, t cần làm sao cho
> performance tý, ví dụ gộp damage/heal, hoặc dùng pool để limit số combat
> text cùng xuất hiện trên màn hình

With many minions, or many damage/heal events in quick succession during a
fight, combat text is created and destroyed continuously and the frame rate
suffers.

## Method

Built `tests/e2e/measure-combattext-perf.mjs`, a Playwright script (model:
`tests/e2e/drive-bot-discipline.mjs`, boot: `tests/e2e/harness.mjs`). It:

1. Boots a real match, lets the first wave leave both fountains, then spawns
   more minions directly through `MinionSpawner.spawn` up to a configurable
   target (env-overridable: `LOL2D_TARGET_MINIONS`, `LOL2D_HITS_PER_TICK`,
   `LOL2D_TICK_MS`, `LOL2D_BURST_MS`).
2. Pins a pool of 40 "dummy" minions' health to 1e9 so a burst of real
   `takeDamage`/`takeHeal` calls (some routed through `takeHeal`'s omnivamp
   path, some plain) can't kill them and shrink the population mid-run — that
   would make before/after numbers incomparable for reasons unrelated to
   combat text.
3. Runs a fixed-rate damage/heal burst against random dummies for several
   seconds and counts, by wrapping real methods from the page context (no
   screenshots):
   - rendered frames (`Game.draw` invocations) → fps
   - live `CombatText` instances, sampled at 60Hz, filtered by
     `constructor.name`
   - `CombatText` constructions during the window (`ObjectManager.addObject`)
   - `_objectsTree` / `_decorTree` populations at the end of the burst (walked
     directly off the quadtree node structure, not through `retrieve`, so the
     count isn't itself paying the cost being measured)
   - cumulative time inside `Quadtree.prototype.retrieve`, split by which tree
     instance it ran on (`_objectsTree` vs `_decorTree` vs "other", the last
     bucket catching `TerrainMap`'s own quadtree so it can't contaminate the
     numbers)
   - cumulative time inside `ObjectManager.update` / `.draw`

Every instrument is restored to the real method before the script reads its
result, so the measured numbers are never inflated by the instrumentation
itself lingering.

Two scenarios were run, each with a stashed "before" (original `src/`) and
the fixed `src/` on the same machine, same warm dev server:

- **moderate**: 130 minions on the board, 200 damage/heal events/sec, 5s
  window (`node tests/e2e/measure-combattext-perf.mjs`, defaults)
- **heavy**: 160 minions (the live cap), 1000 events/sec, 6s window
  (`LOL2D_TARGET_MINIONS=150 LOL2D_HITS_PER_TICK=10 LOL2D_TICK_MS=10
LOL2D_BURST_MS=6000 node tests/e2e/measure-combattext-perf.mjs`)

Every one of the 10 new Vitest cases and the e2e script's own checks were
run against the original code (via `git stash` on just the six touched
`src/` files) before the fix and confirmed to fail with a real, legible
message — not vacuously — then the stash was restored. See "Falsifiability"
below for the exact failures.

## What was actually true

Two things, both real, of very different size.

### 1. `CombatText` was never decoration — confirmed, then fixed

`ObjectManager.isDecoration()` returned true for `ParticleSystem` and
`TrailSystem` only, so every `CombatText` (it extends `SpellObject`) went
into `_objectsTree` — the quadtree every one of the ~150 `queryObjects` call
sites, plus every AOE/vision/target query, walks every tick.

The existing doc comment on `isDecoration` said this was deliberate:
"`CombatText` is not here on purpose — it extends `SpellObject`, so a query
narrowing by that type would quietly stop seeing it." That claim didn't
survive an audit. Every filter that narrows by type in the codebase narrows
to `AttackableUnit`, `Champion`, or (once) `Pet` — never bare `SpellObject`.
The one filter that comes close, `PredefinedFilters.missileSpellObject`,
also requires `object.isMissile`, which `CombatText` never sets (it isn't in
any of the four call sites, and `SpellObject.isMissile` defaults to
`false`). Nothing in the codebase could have been relying on finding a
`CombatText` through a `SpellObject`-typed query.

`CombatText` fits `isDecoration`'s own stated criterion exactly: "deals no
damage, holds no target, blocks nothing." So it's added to the list, with
the doc comment corrected to record the audit rather than the old
(incorrect) worry.

**Measured cost of the misclassification** (heavy scenario, live
`CombatText` count settling around 960-1030 during a fight because nothing
was capping it — see cause #2):

| | before | after |
|---|---:|---:|
| `_objectsTree` population (end of burst) | 1295-1310 | 274-284 |
| of which was `CombatText` | ~79% | 0% (all in `_decorTree`) |
| `Quadtree.retrieve` time on `_objectsTree` | 109.7-119.1ms / 6s window | 34.3-34.8ms / 6s window |

Real, but this number alone is the smaller of the two causes here — the
tree got 3-4x smaller and query time on it dropped ~68-71%, but the query
time itself was a modest fraction (~2%) of the frame budget even before the
fix. It's a real, free-to-take fix with no observed downside, not the
headline number.

### 2. Uncapped, unmerged `CombatText` — the real cost

Every `takeDamage`, `takeHeal`, shield absorption and reflect payout spawned
one new `CombatText` object, unconditionally. In the heavy scenario (1000
damage/heal events/sec against 40 units, well within what a real 5-unit
teamfight with autoattacks and a couple of AOE spells can produce), live
count settled at **~965-1030 simultaneous floating numbers** — every one of
them animating (`update()`), drawing (`push`/`stroke`/`fill`/`textStyle`/
`text`/`pop`), and eventually being GC'd. Nobody reads 1000 overlapping
numbers; the player wants "how much am I taking right now."

## The fix

### Merge rule (`src/game/gameObject/helpers/CombatText.ts`)

One door in: `CombatText.show(owner, kind, amount, textColor)`, where
`kind` is `'damage' | 'heal' | 'shield' | 'reflect'`. It merges **per
(victim, kind, color)**:

- Two different units each taking 15 are two numbers over two heads, never
  one 30 — the merge key is the victim (`owner`), not just the kind.
- Color is part of the key too, because `Shield` and `DamageReflect` carry a
  caster-chosen color (Malphite W's shield is a different color from Lux
  W's). Two different shields landing on the same ally must not blend into
  one number that hides which spell ate what — they key apart, and only a
  repeated hit against the *same* shield instance merges.
- The **first hit in a burst shows immediately** — no scheduler, no added
  latency on the number a player is most likely watching (their own). Every
  hit that lands **while that text is still alive** adds to its running
  total, reformats it (`-25`, `+18`, `14`, `⟲40`, …) and resets its age to a
  fresh `COMBAT_TEXT_LIFETIME_MS` (1000ms, promoted from the old hardcoded
  `1000` to an exported constant). Position and drift (`movedVector`,
  `velocity`) are left untouched on a merge, so the number keeps floating
  smoothly rather than popping back to the unit's feet on every hit.
- Sustained fire keeps one number alive and climbing for as long as the fire
  continues; it only starts to fade once a full lifetime passes with
  nothing new to add.

### Why not a fixed flush tick

The coordinator's mid-task steer suggested the alternative directly: batch
for ~200-250ms (matching `TeamBlackboard`'s own cadence) and flush once. It
was considered and not built, for a reason stateable without building it:
the steady-state live count is the same either way — one text per (victim,
kind) currently in combat — so a fixed tick buys the same object-count
reduction this fix already gets, at the cost of up to one tick of latency
on an isolated hit. That latency lands squarely on the number a player is
most likely to be staring at: their own health bar's damage number. The
alive-merge approach gets the identical steady-state count with zero added
latency and no scheduler; its effective window is `COMBAT_TEXT_LIFETIME_MS`
itself, which is one constant instead of two that would need to be kept in
sync. Building the fixed-tick version to also measure it wasn't judged
cheap enough to be worth it once the object-count math came out equal — the
two approaches don't differ on the axis the numbers below measure, only on
latency, which the reasoning above already settles. Flagging this so it can
be revisited if the reasoning turns out wrong in play-testing.

### No separate cap

Merging already bounds live count to one text per unit currently taking a
given kind of event — bounded by how many units exist (`MinionSpawner`'s
160-live-minion cap plus the roster), not by event rate. An AOE hitting
forty units should show forty numbers, one each; a cap would be trimming
the correct answer, not noise. If a future report shows even that bound is
too many on a crowded phone screen, `COMBAT_TEXT_LIFETIME_MS` and the merge
key are the two knobs to retune from — no new mechanism needed.

### Call sites

All four construction sites (`AttackableUnit.takeDamage`,
`AttackableUnit.takeHeal`, `DamageReflect.onDamageTaken`,
`Shield.modifyIncomingDamage`, `Heal.onSpellCast` — five call sites, four
files) now call `CombatText.show(...)` instead of hand-building and adding
an instance. No damage/heal numbers changed — this is display and
bookkeeping only, per the design constraint. One inconsequential formatting
unification: `Heal.ts` used to show `+ 18` (space after the sign) while
`AttackableUnit.takeHeal` showed `+18`; both now go through the same
`'heal'` formatter and always show `+18`. Noted here since it's the one
observable text-content change, though it isn't a damage/gameplay change.

## Before / after

**Moderate** (130 minions, 200 events/sec, 5-5.3s window):

| metric | before | after |
|---|---:|---:|
| `CombatText` constructions | 1000 | 97-106 |
| live `CombatText` (mean / max) | 191.6 / 208 | 60.7-63.7 / 69-70 |
| `_objectsTree` size (end of burst) | 452 | 240-258 |
| `_decorTree` size (end of burst) | 0 | 61-67 |
| `_objectsTree` retrieve time | 38.7ms (7.7ms/s) | 25.4-27.5ms (5.1-5.5ms/s) |
| `ObjectManager.update` total | 224.6ms (0.749ms/call) | 218.2-220ms (0.727-0.733ms/call) |
| `ObjectManager.draw` total | 277.9ms (0.926ms/call) | 193.1-197ms (0.644-0.657ms/call) |
| fps | 60 (vsync-capped) | 59.9-60 (vsync-capped) |

**Heavy** (160 minions, 1000 events/sec, 6-6.01s window, 2 runs each side):

| metric | before | after |
|---|---:|---:|
| `CombatText` constructions | 6010 | 13-18 |
| live `CombatText` (mean / max) | 962.9-967.4 / 1030 | 79.4 / 80 |
| `_objectsTree` size (end of burst) | 1295-1310 | 274-284 |
| `_decorTree` size (end of burst) | 0 | 80 |
| `_objectsTree` retrieve time | 109.7-119.1ms (18.3-19.8ms/s) | 34.3-34.8ms (5.7-5.8ms/s) |
| `ObjectManager.update` total | 508.8-542.6ms (1.413-1.507ms/call) | 275.1-283.6ms (0.764-0.788ms/call) |
| `ObjectManager.draw` total | 133.2-213.5ms (0.37-0.593ms/call) | 246.1-313.5ms (0.684-0.871ms/call) |
| fps | 59.9-60 (vsync-capped) | 59.9 (vsync-capped) |

The construction count, live count, tree population and `_objectsTree`
retrieve time all move dramatically and consistently in the same direction
across repeats, in both scenarios — a 99%+ cut in constructions and an
~92% cut in peak live count in the heavy scenario, `_objectsTree` cut to
roughly a fifth. `ObjectManager.update` drops 44-48% in the heavy scenario
(it iterates every live object once a tick regardless of which tree it
indexes into, so this reflects fewer live objects overall, not the tree
split).

**`draw` did not move in a consistent direction** and I'm reporting that
rather than hiding it: it fell in the moderate scenario (277.9→~195ms) but
rose in the heavy one (133-213ms → 246-313ms), and varied 60% run-to-run on
the *same* code (133.2ms vs 213.5ms, before-heavy, two back-to-back runs).
The likely explanation: `ObjectManager.draw` only visits what
`tree.retrieve(camBound)` returns for the *current camera viewport* — with
40 dummy targets scattered across a 6400x6400 map (some near the player's
own fountain, some at the far red fountain), how many of their floating
numbers are on-screen at any instant depends on exactly where the camera
sits, which isn't controlled by this script and isn't the thing the fix
changes. I did not chase this further — the four metrics above are
unambiguous and directly test the two stated causes; `draw` time is noisy
for a reason unrelated to the fix and calling it either way would be
overstating the evidence.

## Falsifiability

All 10 new tests were run against the original `src/` (via `git stash` on
just the six touched files, then `git stash pop` to restore) before being
declared passing:

- `tests/game/helpers/CombatText.test.ts` (9 cases): all 9 failed with
  `TypeError: default.show is not a function` — `CombatText.show` didn't
  exist yet.
- `tests/game/managers/ObjectManager.render.test.ts` › "routes CombatText
  into the decoration tree, not the gameplay one": failed with
  `expected +0 to be 1` — `_decorTree` was empty and `_objectsTree` held
  the `CombatText` instead, exactly the pre-fix routing.

The e2e script (`tests/e2e/measure-combattext-perf.mjs`) was run against
the original code too (the "before" rows above) and its own checks passed
in both states — it's a measurement script, not a pass/fail gate, and its
numbers are the falsification: the "before" run's `combatTextLiveMean` of
~192-967 versus "after"'s ~61-79 is not something the original code could
have produced by accident.

## Tests added

- `tests/game/helpers/CombatText.test.ts` (9 cases): merges same
  victim+kind+color; keeps different victims apart; keeps different kinds
  apart; keeps differently-colored shields apart; merges repeated hits on
  the same shield instance; updates the same instance in place (identity
  check, not just value); refreshes the lifetime on merge; starts a fresh
  text once the old one has fully faded rather than reviving it; drops a
  zero-amount event.
- `tests/game/managers/ObjectManager.render.test.ts`: one case added to the
  existing "the decoration index" describe block, proving `CombatText`
  lands in `_decorTree` and is invisible to a type-filtered gameplay query.
- `tests/e2e/measure-combattext-perf.mjs`: the measurement script itself,
  kept as a regression instrument (env-overridable burst intensity via
  `LOL2D_TARGET_MINIONS` / `LOL2D_HITS_PER_TICK` / `LOL2D_TICK_MS` /
  `LOL2D_BURST_MS`).

`npm run verify` is green: 244 test files, 3949 tests, both `tsc` passes,
and the build. `npx prettier --check` passes on every file touched.

## Found but not fixed

- **`draw`'s noise** (above) suggests `ObjectManager.draw`'s camera-viewport
  cull is doing real, load-bearing work — worth knowing if a future
  perf pass targets `draw` specifically, since a synthetic burst needs to
  control camera position to measure it cleanly. Not a bug, just a gap in
  what this script's camera setup can see.
- **`Heal.ts`'s combat text used `+ 18` (with a space); everywhere else used
  `+18`.** Unified to `+18` as a side effect of routing both through the same
  formatter (see "Call sites" above). Purely cosmetic, flagging per the
  "report gameplay bugs found on the way, don't fix them" instruction even
  though this one is display-only and I did fold it in as part of the
  refactor rather than leave two formatters alive for one inconsistent
  space.

## Addendum: the arc under sustained merges was unbounded (fixed)

Reported from a phone after the fix above shipped: the number's animation is
normally "arcs up then falls while fading," but under sustained fire on the
same (victim, kind) it "keeps falling forever and leaves the viewport."

### Root cause

`update()` integrated `movedVector += velocity; velocity += gravity` every
tick with no ceiling. A single, un-merged hit is only ever alive for one
`lifeTime` (~1000ms, ~60 ticks), so the integration was accidentally bounded
by how long the object existed. `CombatText.show`'s merge branch resets
`age` (fade/removal) on every merge but deliberately left `velocity`/
`movedVector` alone — the old class doc comment said this was so the number
"keeps floating smoothly instead of popping back to the unit's feet," which
is correct about *why* it must not reset, but the comment stopped there and
never noticed the other half: under sustained fire `age` never crosses
`lifeTime`, so the text never dies, while `velocity` accumulates `gravity`
forever. A few seconds of continuous hits put it in unbounded free fall.

### Falsifying test, run before the fix

`tests/game/helpers/CombatText.test.ts` › "does not run away when the same
(victim, kind) merges every tick for 5s" — merges into the same text every
16ms for 5 seconds (5x `COMBAT_TEXT_LIFETIME_MS`) and asserts the offset
from the owner stays under 100px. Run against the pre-fix code:

```
AssertionError: expected 2113.8000000000025 to be less than 100
```

**2113.8px** — the number the bug produced, confirming it grows without
bound rather than settling. Then the fix was applied and the same test
(unmodified assertion, only the field name it reads) passes.

### The fix

Two clocks instead of one, in `src/game/gameObject/helpers/CombatText.ts`:

- `age` — unchanged. Drives fade alpha and removal, resets to 0 on every
  merge.
- `elapsedMs` — new. Time since the instance was *created*. **Never reset by
  a merge.** Drives the arc.

The arc itself is no longer an integrated velocity; it's a closed form of
`p = min(elapsedMs, COMBAT_TEXT_ARC_MS) / COMBAT_TEXT_ARC_MS` (a new
exported constant, set equal to `COMBAT_TEXT_LIFETIME_MS` so a single hit's
motion is pixel-identical to before): `offsetY = ARC_LINEAR_PX * p +
ARC_QUADRATIC_PX * p*p`, reproducing the old integration's shape (peaks
~10px up around a third of the way through, settles ~30px down by the time
the arc completes) but as a formula that cannot exceed its `p = 1` value by
construction — there is no accumulator left to run away. The small sideways
drift is the same idea: a fixed per-instance `driftTargetX` reached via
`driftTargetX * p*p`, bounded to ±40px, instead of an accumulated
`gravity.x`. `velocity`/`gravity`/`movedVector` are gone; `draw()` reads
`offsetX`/`offsetY`, recomputed once per `update()` tick.

Confirmed by watching the three cases the design called for:

- **Single hit** — `age` and `elapsedMs` advance together and the text dies
  at `age > lifeTime = COMBAT_TEXT_ARC_MS`, i.e. right as `p` would reach 1
  anyway, so the clamp is never actually engaged. Motion unchanged.
- **Sustained fire** — plays the rise-and-fall once, then holds at the
  settled position (`p` pinned at 1) while the running total keeps
  climbing. No bounce, no jitter, no drift.
- **Fire stops** — `age` resumes counting from its last reset; the held
  number fades out from wherever it stopped, in place.

The class doc comment is corrected accordingly (the old "position and drift
are left alone on a merge" paragraph is replaced with a "two clocks, not
one" section stating the actual invariant and the bug that came from not
having it).

### e2e numbers, unchanged

Re-ran `tests/e2e/measure-combattext-perf.mjs` after the arc fix — the merge
rule and tree routing are untouched, so these should (and do) match the
earlier report within the same run-to-run variance already documented there:

| metric | moderate (prior) | moderate (post arc-fix) | heavy (prior) | heavy (post arc-fix) |
|---|---:|---:|---:|---:|
| combat text constructions | 97-106 | 110 | 13-18 | 15 |
| live mean / max | 60.7-63.7 / 69-70 | 62.8 / 72 | 79.4 / 80 | 79.6 / 80 |
| `_objectsTree` size | 240-258 | 242 | 274-285 | 285 |
| `_decorTree` size | 61-67 | 64 | 79-80 | 79 |
| `_objectsTree` retrieve time | 25.4-27.5ms | 27.1ms | 34.3-34.8ms | 34.5ms |

No regression to the object-count or quadtree-routing fix from this change.

### Tests

- `tests/game/helpers/CombatText.test.ts`: new describe block, one case
  (above). All 10 cases in the file pass against the fixed code; `npm run
verify` is green (244 files, 3950 tests, both `tsc` passes, build).

## Addendum 2: z-index — combat text hidden behind the avatar, dead champions on top

Two more phone reports, one root cause per the coordinator's own diagnosis
(confirmed against the code, not re-derived from scratch):

> perf text ko bị rớt nữa, nhưng giờ điểm cuối của animation lại nằm ngay sau
> avatar champ, bị avatar che mất luôn, ko thấy luôn
>
> vs có 1 bug z-index nữa, dead champ lại render trên alive champ, please
> update hệ thống z-index của game, cái gì quan trọng hơn cần đc render sau
> (đè lên thứ ko quan trọng)

The arc no longer runs away, but its resting point sits behind the champion
sprite. Separately, a dead champion draws over a living one.

### Root cause, verified against the code

`ObjectManager.zIndexOf` resolved `Z_INDEX_MAP` by **exact constructor**:
`TrailSystem 0, ParticleSystem 1, SpellObject 2, AttackableUnit 3, CombatText
5`, default `99` for anything not an exact key.

Checking every class in the hierarchy against this (not just trusting the
summary): `Champion` itself was **not** broken — it has its own `static
displayZIndex = 4`, checked via a separate `Object.hasOwn` escape hatch, so
it already resolved correctly before this fix. What actually fell through to
`99` were `Champion`'s own subclasses — `AIChampion`, `Pet`, `DummyChampion`
— because a subclass never *owns* an inherited static field (`Object.hasOwn`
returns `false` on them even though reading `AIChampion.displayZIndex`
directly would find Champion's `4` through the prototype chain), and none of
them are `Z_INDEX_MAP` keys either. In a default match (player + 3 bots) that
is 3 of 4 champions on screen. Combined with `CombatText` sitting at `5` —
below the `99` those subclasses fell through to — a number attached to any
bot or pet painted under that unit's own sprite.

The same walk gap affects a much larger, previously invisible set: **every
concrete spell-effect class** (a missile, a hit-spark, an aura — anything
built on `MissileSpellObject` or `SpellObject` that does not explicitly
override `zIndex`) is a subclass with no map entry either, so essentially
every spell VFX in the game was *also* resolving to `99` by the same
accident. `ground-decal-zindex.test.ts`'s own doc comment even said so out
loud: "That is the right default for a missile or a blast" — a correct
judgement about the accidental value, never actually stated as an
intentional constant.

The dead-over-alive bug is the same root cause from a different angle: two
champions on the same numeric layer (before the fix, two bots both falling
through to `99`; after the class-resolution fix, *any* two champions, now
correctly tied at `4`) have no tiebreak, so paint order is whatever the
quadtree's traversal happened to return — insertion order, in effect —
which is exactly what silently flipped a corpse on top of a survivor.

### The fix

**1. Named layers in `ObjectManager.ts`, one ordered list, doc comment
states the rule.** `FOUNTAIN_Z_INDEX -1, TRAIL_Z_INDEX 0, PARTICLE_Z_INDEX 1,
GROUND_Z_INDEX 2, UNIT_Z_INDEX 3, MINION_Z_INDEX 3.2, OBJECTIVE_Z_INDEX 3.5,
CHAMPION_Z_INDEX 4, SPELL_EFFECT_Z_INDEX 6, COMBAT_TEXT_Z_INDEX 8`. The rule:
**more important paints later.** `Champion.displayZIndex`,
`Minion.displayZIndex`, and the instance `zIndex` on `Monster`, `Turret` and
`Fountain` all now reference these constants instead of a private literal —
verified none of the five files create an import cycle (`ObjectManager.ts`
never imports any of them; `Minion.ts` and the structures already imported
`PredefinedFilters` from it, so the direction was already established). The
dozen-plus ground-art spell files (31 files, `Jhin_E.ts`'s previously-local
`GROUND_Z_INDEX`, and `Syndra_Q.ts`'s `SPHERE_AIR_Z_INDEX`, which turned out
to already independently equal the new `SPELL_EFFECT_Z_INDEX` by
coincidence) now import the one shared constant instead of each hardcoding
`zIndex = 2`.

**2. `classLayerOf` resolves up the prototype (`extends`) chain.** Walks from
the object's own constructor toward `Object.prototype`, checking at *every*
step for either an own `displayZIndex` static or a `Z_INDEX_MAP` entry — the
same two escape hatches as before, just no longer requiring an *exact* match.
`AIChampion`/`Pet`/`DummyChampion` climb to `Champion.displayZIndex`; a
`MissileSpellObject` subclass with nothing of its own climbs to
`SpellObject`'s `SPELL_EFFECT_Z_INDEX`. `DEFAULT_Z_INDEX` (the true fallback,
now `UNIT_Z_INDEX` instead of `99`) should be unreachable for anything real:
`AttackableUnit`, `SpellObject`, `TrailSystem`, `ParticleSystem` and
`Fountain` are the only direct `GameObject` subclasses in the game, and the
walk finds one of the first four for every concrete class; `Fountain` always
sets its own instance `zIndex` and never reaches class resolution.

**3. Dead-below-alive is a per-object tiebreak beside the sort, not a
layer.** `ObjectManager.draw()` now records `dead: o instanceof AttackableUnit
&& o.isDead` alongside each drawable's `z` in the same pass that already
computes it, then sorts `z` first and `dead` (alive-after-dead) second. Per
the coordinator's explicit ask, this is deliberately **not** folded into
`zIndexOf`'s number — "is this particular instance dead right now" is not a
property of the class.

**4. `CombatText` moved from `5` to `COMBAT_TEXT_Z_INDEX = 8`** — above
`CHAMPION_Z_INDEX` (4) *and* `SPELL_EFFECT_Z_INDEX` (6), i.e. above every
unit and every ordinary spell effect, not just above the old `AttackableUnit`
slot of 3. It is an overlay, not a thing in the scene (it already draws at
constant screen size regardless of zoom), so it now sits above everything
else world-related.

### A bug in my own first draft, caught by the test rather than shipped

The first version of the dead/alive comparator was `Number(a.dead) -
Number(b.dead)` — backwards. Running the new tests immediately surfaced it:
the "insert dead first" case passed by insertion-order coincidence, but
"insert dead last" failed with `['alive', 'dead']` instead of `['dead',
'alive']`, and the representative-set test failed with "expected 7 to be
less than 6" (the dead pet sorting *after* the live champion). Fixed to
`Number(b.dead) - Number(a.dead)` and re-verified both tests pass. Recorded
here because it is exactly the failure mode "build it both ways round" was
asked for to catch — a comparator that is right for one insertion order and
silently wrong for the other is indistinguishable from working, from a
single test run.

### Audit: what moved when the default stopped meaning "on top"

Requested explicitly, enumerated before shipping rather than found from a
screenshot:

| class | before | after | verdict |
|---|---:|---:|---|
| `Champion` | 4 (`displayZIndex`, own field) | 4 (unchanged, now via the shared `CHAMPION_Z_INDEX` constant) | no change |
| `Minion` | 3.2 (`displayZIndex`, own field) | 3.2 (unchanged, now via `MINION_Z_INDEX`) | no change |
| `Monster`, `Turret` | 3.5 (instance `zIndex`) | 3.5 (unchanged, now via `OBJECTIVE_Z_INDEX`) | no change |
| `Fountain` | -1 (instance `zIndex`) | -1 (unchanged, now via `FOUNTAIN_Z_INDEX`) | no change |
| **`AIChampion`, `Pet`, `DummyChampion`** | 99 (fell through) | **4** (climbs to `Champion.displayZIndex`) | **fixes both reports** — a bot or a pet now sits on the same footing as any other champion, dead-vs-alive included |
| **Every un-overridden `SpellObject`/`MissileSpellObject` subclass** (missiles, hit-sparks, auras — hundreds of classes across the roster) | 99 (fell through) | **6** (`SPELL_EFFECT_Z_INDEX`, climbs to `SpellObject`'s map entry) | **correct**: still above every unit, same relative position as before. Verified nothing in the codebase constructs a bare `new SpellObject(...)` for a real effect (grepped — only `CombatText`, which has its own entry), so this is the only population the change touches |
| **`CombatText`** | 5 | **8** (`COMBAT_TEXT_Z_INDEX`) | **intentional, requirement #4** — now above spell effects too, not only above units. The one real behavioural delta: a flashy spell effect can no longer visually cover a damage number. Consistent with this project's own stated VFX principle ("legibility outranks looking good," `CLAUDE.md`) — a number the player needs to read should not lose to an explosion |
| bare `AttackableUnit` (never instantiated directly in real gameplay) | 3 (exact map hit) | 3 (unchanged — first-hop match, no walk needed) | no change |
| anything reaching the true `DEFAULT_Z_INDEX` fallback | 99 | 3 (`UNIT_Z_INDEX`) | should be unreachable for any real class — see `classLayerOf`'s doc comment |

One remaining known tie, named rather than silently accepted: two *living*
champions on the same layer (the ordinary case — the player next to a bot,
or two bots) still have no deterministic order between them, only insertion
order. That was true before this fix too and was never the reported bug
(only *dead-vs-alive* was); a living-vs-living tiebreak was not requested
and is not added here.

### Research: how League actually presents floating combat text

Requested explicitly. Riot does not publish the client's rendering internals,
so this is drawn from patch notes, wiki pages and player-facing forum
threads — behaviour and layout conventions only, no asset, font or artwork
referenced or copied (this repo is mid-effort to separate from Riot IP).

- **Color coding by damage type**: physical red, magic purple, true damage
  white, healing green — introduced in the "Hecarim patch" combat-text
  rework, which also fixed a bug where damage text could "linger on the
  screen." ([Hecarim Patch Notes, MobaFire](https://www.mobafire.com/league-of-legends/forum/general/hecarim-patch-notes-formatted-14073))
- **Anchor**: "damage is registered onto an enemy champion and displayed
  above them, over their health bar" — not over the character model itself.
  ([League of Legends Damage System, Explained — forum thread](http://forums.na.leagueoflegends.com/board/showthread.php?t=3284327))
- **A recurring player complaint, independent of this project**: "the
  floating text sometimes pops up and floats behind the health bar or is
  sometimes just so small it's difficult to read." ([Cannot see floating
  text/combat text — LoL forums](http://forums.na.leagueoflegends.com/board/showthread.php?t=2325214))
- **Crit and gold changes** were made "to increase the impact of those
  ceremonies and standardize the presentation across all regions." ([Floating
  Combat Text — Gold and Crit Changes, PBE boards](https://boards.pbe.leagueoflegends.com/en/c/general-pbe-feedback/Li36FbmE-floating-combat-text-gold-and-crit-changes))
- Separately, a WoW addon convention ("group by thousands" — batching many
  small hits into one number above a threshold) turned up while searching
  for "how simultaneous numbers avoid overlapping"; it is a Blizzard/WoW
  addon feature, not something League itself does. ([Floating combat text on
  target, mmo-champion](https://www.mmo-champion.com/threads/1477571-Floating-combat-text-on-target-Group-by-thousands))

**Adopted**: the anchor convention (above the health bar, not over the
character). `CombatText.draw()` now rests `HEALTH_BAR_CLEARANCE_PX` (20px,
scaled like the bar) above where `AttackableUnit.drawHealthBar` puts the bar
itself, clearing both the bar and its "12 / 100" label, with the existing
arc (`offsetX`/`offsetY`) playing out from that higher point exactly as
before. This is squarely a placement fix, in scope per the coordinator's
explicit carve-out, and it is the same *kind* of bug LoL's own players have
reported independently ("floats behind the health bar") — evidence this is a
real failure mode worth guarding, not a speculative addition. Verified
falsifiable: with the clearance term removed, the anchor sits exactly at the
unit's top edge and the new test (`draws above the top of the unit body, not
at its centre or feet`) fails with `expected -27.5 to be less than -27.5`.

**Rejected / not applied**:
- **Color-by-damage-type** (physical/magic/true). LOL2D's `CombatText.show`
  is keyed on `kind` (`damage`/`heal`/`shield`/`reflect`), not on a damage
  *type* the combat system does not currently track at the text layer —
  plumbing physical/magic/true through to `CombatText.show` would touch the
  damage pipeline itself, which is out of scope for a rendering/placement
  fix and is explicitly the "combat feel" the brief says not to redesign.
- **"Group by thousands" batching**. Not League's own behaviour (a WoW
  addon), and this game already has a merge rule scaled to its own ~100
  health pool (`CombatText`'s per-victim, per-kind merge from the first
  addendum) — a second, differently-shaped batching rule on top would be two
  ways of doing the same job.
- **A deterministic per-kind horizontal lane** (so a simultaneous shield
  absorb and damage number, or a reflect proc and its underlying damage
  number, never share the same x by chance) was considered — the existing
  bounded random `driftTargetX` per instance already gives *some* separation,
  and no report named overlapping-but-different-kind numbers as a problem.
  Left alone rather than added speculatively; flagging it here as the next
  thing to reach for if that specific complaint shows up.

### Tests

- `tests/game/managers/drawOrder.test.ts` (new): the full representative set
  — dead champion (`Pet`, standing in for the broken class), live champion,
  monster, turret, fountain, ground decal, particle, trail, an unlabeled
  `SpellObject` subclass, and combat text — asserted as one connected chain
  of relations (not one pair), with `monster`/`turret`'s intentional tie
  named rather than forced into a fake order. A second describe block builds
  the dead-vs-alive case both insertion orders round. Run against the
  pre-fix code (`git stash` on the touched `src/` files, temporarily
  inlining `GROUND_Z_INDEX = 2` in the test since the old `ObjectManager.ts`
  did not export it): the representative-set test failed with `expected 8 to
  be less than 6` (the dead `Pet` sorting after the live champion — the
  `AIChampion`/`Pet` bug), and the dead-vs-alive test failed on exactly one
  of its two orderings (`insert dead first` passed by accident; `insert dead
  last` produced `['alive', 'dead']`) — the insertion-order dependence
  itself, caught by testing it both ways round rather than once.
- `tests/game/helpers/CombatText.test.ts`: one case added for the raised
  anchor (above).
- `tests/game/spells/ground-decal-zindex.test.ts`: assertions unchanged
  (still passes — `GROUND_Z_INDEX` kept its value of 2), doc comment updated
  since its shape (the *reason* an override is needed) changed: it used to
  say an un-overridden `SpellObject` falls through to `DEFAULT_Z_INDEX`
  (99); it now resolves to the deliberate `SPELL_EFFECT_Z_INDEX` (6) instead,
  which is *still* the wrong layer for ground art, for the same underlying
  reason (a `SpellObject` subclass does not inherit the *ground* slot,
  because that slot is intentionally a different, lower one).
- Every other stale doc comment across the ~40 ground-art spell files that
  mentioned the literal `zIndex = 2` or the old "falls through to 99" wording
  was corrected in the same pass (`GROUND_Z_INDEX` / `SPELL_EFFECT_Z_INDEX`
  named instead of the numbers), so a future reader is not told the old
  mechanism.

### e2e: object count and quadtree numbers, unchanged

The z-index fix only reorders what `ObjectManager.draw()` paints and in what
sequence — it does not touch `CombatText.show`'s merge logic, object
construction, or which quadtree an object lives in. Re-ran
`tests/e2e/measure-combattext-perf.mjs` to confirm:

| metric | prior (post arc-fix) | post z-index-fix |
|---|---:|---:|
| moderate: live mean / max | 62.8-63.7 / 69-72 | 64.2 / 71 |
| moderate: `_objectsTree` size | 242-258 | 244 |
| moderate: retrieve time | 27.1-27.5ms | 26.7ms |
| heavy: live mean / max | 79.4-79.6 / 80 | 79.6 / 80 |
| heavy: `_objectsTree` size | 274-285 | 282 |
| heavy: retrieve time | 34.3-34.8ms | 37.8ms |

All within the same run-to-run variance already documented in this file —
no regression.

### Verify

`npm run verify` green: 245 test files, 3954 tests, both `tsc` passes, build.
`npx prettier --check` passes on every file this addendum touched, with two
pre-existing exceptions carried forward unchanged: `Minion.ts` and
`Turret.ts` already failed `--check` on `main` before this session (an
unrelated line in each exceeds the column rule) — `prettier --write` was run
across all 45 touched files to catch real formatting issues, and the two
collateral reformats it produced on lines this session did not otherwise
touch were manually reverted, per `CLAUDE.md`'s explicit instruction never to
fix a predates-Prettier file as a side effect of an unrelated change.
