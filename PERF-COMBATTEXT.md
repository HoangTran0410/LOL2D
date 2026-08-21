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
