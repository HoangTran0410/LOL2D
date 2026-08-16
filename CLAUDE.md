# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LOL2D is a fan-made, browser-based 2D game inspired by League of Legends. It runs entirely in the browser: p5.js draws the canvas, Vue 3 drives the HUD, all TypeScript, bundled with Vite. Tests run under Vitest, plus Playwright scripts that drive the real game in Chrome.

p5 itself is the one exception to the bundle: `index.html` loads it from a CDN `<script>` tag because the game uses p5's **global mode**, so `createVector`, `push`, `fill` and the rest are globals with no import. See the comment at the top of `src/main.ts` — all code touching a p5 global must run inside `setup()`, never at module eval time.

## Running the Project

```bash
npm install
npm run dev      # Vite dev server, http://localhost:5173
npm run verify   # everything CI runs — do this before declaring work done
```

`npm run verify` = `assets:check` + `ability:check` + `typecheck` + `typecheck:core` + full Vitest suite + `build`.

- **Menu** → Click "Chơi" to start the game
- **In-game controls**: Right-click to move, `A` `Q` `W` `E` `R` for abilities and `D` `F` for summoner spells (see `SpellHotKeys` in `src/game/constants.ts`), `Space` to toggle camera follow, `N` for the nav debug overlay, mouse wheel to zoom, `Esc` to open the practice panel. **`Esc` no longer leaves the match** — one mis-hit used to end it outright; the way out is the exit button at the bottom of the panel's Trận đấu tab, behind a two-step confirm.

## Code Style

- **Formatting**: Prettier (config in `.prettierrc` — 2 spaces, single quotes, trailing commas, 100 columns). Several files predate it and fail `prettier --check` on `main`; do not run `--write` across them as a side effect of an unrelated change.
- **Polyfills**: Array prototype methods (`map`, `filter`, `forEach`, etc.) are overridden in `src/main.ts` with optimized versions from `src/utils/optimized.utils.ts`, before p5 globals are imported.
- **Tuning values**: exported as constants from the spell file so tests import them instead of copying numbers. Retuning damage must not mean editing a test.
- **Spell Design & Visual Guidelines** (the whole bar, distilled for briefing an agent without making it read a 400-line spell: `docs/VFX_STANDARD.md`):
  1. **Visual Distinction & Animation**: Each champion must have unique, recognizable VFX. Never pop spells in instantly without windups, travel animations, or cast times. Never reuse artwork/geometry across champions (e.g. Jarvan R must use earthen walls/crags, NOT Anivia's ice walls).
  2. **Physics & On-Hit Effects**: Use `ParticleSystem` or `ImpactEffect` on impacts — `ParticleSystem` (`gameObject/helpers/`) for a legacy `onSpellCast` spell, `ImpactEffect` (`game/vfx/`) only from a `castSpec.vfx` factory; they are not interchangeable. Ground shockwaves/beams must trigger ONLY upon landing (e.g. Jarvan E flag landing on ground). Ekko R ghost/afterimage must ONLY render when Ekko R is ready (`state === 'READY'`).
  3. **Damage Scaling**: Scale damage numbers relative to LOL2D base health (~100 health pools; normal spells ~15-35, ultimates ~40-60). Never copy raw League PC wiki numbers directly without scaling.
  4. **Range & Velocity Scaling**: Scale spell ranges and missile speeds to LOL2D canvas dimensions rather than raw PC values.
  5. **Multi-hit Protection**: A dash or continuous spell pass must hit each target unit at most ONCE using a hit tracking set (`hitTargets`).
- **`Array.prototype.filter` cannot narrow types here.** `src/types/global.d.ts` re-declares it with the optimized `(value, index) => boolean` signature, and the merged interface puts that overload first, so the type-predicate overload never applies — `objects.filter((o): o is Foo => …)` still comes back as the wide type. Write a plain loop (see `MatchDirector.bots()`), not a cast.
- **`<script setup>` *is* the setup function.** A `const x = ref(…)` at its top level looks like module scope and is not — it is rebuilt on every mount. State that must outlive an unmount belongs in a plain `.ts` module (see `src/game/hud/practice/panelTab.ts`).

## Testing

`npm run verify` is the gate. Beyond it, pick the cheapest tool that can see the bug:

1. **Vitest by default.** 1500 tests run in about a second.
2. **A source-scan test** for any "nobody may do X" rule — it runs in milliseconds and closes a whole class permanently. `tests/game/spells/mana-spend-seam.test.ts` (no file may write `stats.mana` directly) and `tests/game/spells/cc-buff-icons.test.ts` are the models. Strip comments before matching, or the scan flags its own documentation.
3. **Playwright (`tests/e2e/drive-*.mjs`) only for what Vitest structurally cannot see**, which is three things: a real finger, a real renderer, and the paused/unpaused frame boundary. Each run costs minutes. Do not re-run neighbouring scripts for a change that does not touch their area.

### Keeping a pass cheap

`verify` is not the expensive part — ten seconds, thirty lines of signal. What actually burns a context window here was measured on the Camille/Ekko/Jarvan pass:

- **Fanning out agents that share a briefing.** Seven agents each told to "read `Fizz_E.ts` first" read the same 400-line file seven times before writing a line. `docs/VFX_STANDARD.md` is that briefing distilled, so the instruction is a link. Fan out when the work is independent *and* the shared context is small; when N files all need one standard, one agent doing all N reads it once. An audit agent should report `file:line` plus a sentence and **never quote code back** — that part scaled fine across 150 files.
- **Reading screenshots.** A 1280x900 PNG costs about what 600 lines of source costs. Make the e2e script end in a numeric summary and trust it — `tests/e2e/shoot-new-champion-vfx.mjs` prints `objects=+3 moved=296px` per cast precisely so the run is legible without opening a frame. Open one or two to judge a *look*; never a whole run's worth.
- **Piping whole command output.** `npm run verify` ends with vite's asset table, forty lines of PNG sizes. `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"` is the entire signal, and `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "\.vue'"` drops the four pre-existing SFC-resolution errors that are not yours.

**Every test must be shown to fail.** Write it first, run it, and *read* the message. Two failure shapes have shipped repeatedly here:

- Asserting on state *after* the code under test has already produced it — e.g. checking `game.monsters` is empty when the setter emptied it synchronously.
- A check that computes its own expected value by calling the thing it is checking. A transform asked to verify itself agrees with itself however wrong it is; inverting an axis moved a result by 94 units through the round trip and by 3468 against arithmetic written out by hand.

Prove an e2e script falsifiable **once, when it is new** — break the source, confirm the right check goes red, revert. Do not repeat that on every later change; it is the single most expensive habit available.

Two known flakes, not worth chasing: `drive-new-spells.mjs` (~1 in 4, `oScene` undefined during scene boot) and `drive-touch-controls.mjs` (rare full freeze). A stray `npm run dev` server holding port 5173 makes both far more likely.

## Architecture

### Scene Flow
`LoadingScene` → `MenuScene` → `GameScene`

`src/main.ts` is the only entry point: it installs the Array polyfills, assigns `window.setup`/`window.draw` to boot p5, and creates the `SceneManager`. In dev builds it also exposes the scene manager as `window.__lol2d`, which is how the Playwright scripts in `tests/e2e/` reach the running game.

### Core Classes (`src/game/`)

| Class | File | Role |
|---|---|---|
| `Game` | `Game.ts` | Main game loop, owns camera/objectManager/terrainMap/fogOfWar |
| `ObjectManager` | `managers/ObjectManager.ts` | Updates and draws all game objects; uses quadtree for spatial queries |
| `SceneManager` | `managers/SceneManager.ts` | Custom scene manager (not p5's), routes p5 events to active scene |
| `MinionSpawner` | `managers/MinionSpawner.ts` | Wave clock for both bases; owns the live minion cap |
| `MatchDirector` | `MatchDirector.ts` | Every mutation of a *running* match — roster, loadouts, rules, world, cheats — and the only thing that persists them |
| `Minimap` | `gameObject/map/Minimap.ts` | Screen-space map, top-left; tap expands it, tapping the expanded map teleports |

### The practice panel

`src/game/hud/PracticePanel.vue` — three tabs (Đấu thủ / Trận đấu / Gian lận) over a paused match, opened by `Esc` or the corner button. It is a **superset of the pregame setup screen** for match configuration: the setup screen sets AI behaviour globally, the panel sets it per bot.

Tabs never touch `localStorage` themselves. They call `MatchDirector`, which mutates the live match and then writes `lol2d:pregameConfig:v1`, so the match you shaped is the one you get back on reload. **Cheats, debug layers and stack counts are session state and are deliberately never stored** — there is a test asserting the stored blob is byte-for-byte unchanged after every cheat is switched on. The saved-kit library (`config/savedKits.ts`) is the one thing a tab stores on its own, because the player fills it by name.

Four tabs will not fit: `.pregame-tab` is `flex: 1`, and at 390px three plus the close button is the ceiling.

### Game Object Hierarchy

```
GameObject
├── AttackableUnit (has stats, buffs, health, movement)
│   ├── Champion (player-controlled)
│   ├── AIChampion (AI-controlled)
│   ├── Monster (jungle camp)
│   ├── Minion (lane minion, spawned in waves)
│   └── Turret (team building)
├── Fountain (spawn platform, not attackable)
├── SpellObject (projectile/effect created by spells)
└── Helpers (ParticleSystem, CombatText, TrailSystem)
```

### Teams, lanes and minions

`GameObject.teamId` defaults to a fresh uuid per unit, so by default every unit
is its own faction. **Champions keep that** — the player and the bots are
free-for-all and hostile to everyone, including both minion teams.

`src/game/enums/TeamId.ts` adds the two shared ids that a base's fountain, its
turret row (`turret1` = blue, `turret2` = red in `summoner_map.json`) and the
minions it spawns all share. `src/game/lanes.ts` holds the three lane waypoint
paths, ordered blue base → red base; red minions walk them backwards. Those
coordinates are checked against the map's wall polygons by
`tests/game/minions/Lanes.test.ts` — edit them and re-run it.
`src/game/managers/MinionSpawner.ts` is the wave clock and owns the live cap.

### Spells (`src/game/gameObject/spells/`)

Each spell is a separate file exporting a class extending `Spell`. `Spell` manages cooldown state machine (READY → COOLDOWN → READY). Spell files reference their champion prefix (e.g., `Ahri_Q.ts`, `Yasuo_R.ts`). Summoner spells (`Flash`, `Ghost`, `Heal`, `StealthWard`) are at the root of the spells folder.

**Adding a new spell**: read `docs/ADDING_SPELLS.md` first. It covers the three registration points, the `MissileSpellObject` base every skillshot should extend, the buff catalogue and its mandatory `stackId` rule, the engine traps `tsc` cannot catch (dead status flags, double-updated particle systems, the null-owner HUD path), and how to verify a spell by driving the real game.

### Buffs (`src/game/gameObject/buffs/`)

Each buff extends the base `Buff` class and controls `statusFlagsToEnable`/`statusFlagsToDisable` to apply crowd control effects via `StatusFlags` and `ActionState`.

### Stats System (`Stats.ts`)

Stats use a base + bonus modifier pattern. `ActionState` flags are updated by both status effects and buff system.

### Enums (`src/game/enums/`)

Key enums: `ActionState` (movement/combat flags), `StatusFlags` (crowd control), `SpellState` (cooldown states), `EventType` (game events via EventManager).

### Map & Collision

- `TerrainMap.ts` stores map polygon data and handles terrain collision
- `FogOfWar.ts` renders fog of war overlay
- `Camera.ts` handles world-to-screen coordinate transformation
- QuadTree-based collision in `libs/quadtree.ts`; collision algorithms in `libs/detect-collisions.ts`

## Traps that have cost real time

Each of these was found by measurement, more than once. None is visible from reading the file you are editing.

**The practice panel holds the match paused.** `Game.update()` and `Game.draw()` both return early while `paused`, so `ObjectManager.update()` and `AttackableUnit.update()` do not run while any tab is open — and every `MatchDirector` method runs in exactly that window. Four bugs so far: `bots()` counted only `objectManager.objects` (adds sit in `_objectToBeAdd` until the flush, so the `AI_COUNT_MAX` guard never tripped); `isInvulnerable` trusted `buffs` (`deactivateBuff()` only sets `toRemove`); `Stats.update()`'s health clamp never ran after a max-health drop; and config derivation wrote a just-added bot out as absent. **Rule:** read both `objects` and `_objectToBeAdd`, skip `toRemove` and deactivated entries, and clamp derived stats at the point of change rather than trusting `update()`.

**`GameScene` calls `preventDefault()` on every touch on the page**, so a browser synthesises neither the trailing `click` nor its own scrolling — anywhere, not just over the canvas. A checkbox `change`, a range drag and a plain `@click` were each verifiably dead under a thumb while working perfectly under a mouse. **Every HUD control needs a touch handler beside its click handler**, and a scrollable panel body needs its scroll hand-rolled. `RulesTab.vue` and `RosterTab.vue` carry the working shapes.

**Spell VFX is drawn from `Champion.draw()`**, which `ObjectManager.draw` skips when `willDraw` is false or the champion is outside the camera. So VFX vanishes whenever its caster is unrendered, while damage — a `SpellObject` with its own bounds — lands normally. Lux R's beam crossed the screen and hit the player invisibly for exactly this reason. **An effect that reaches beyond its caster's body must be a `SpellObject`, not `castSpec.vfx`.** Aim telegraphs (Pantheon Q, Varus Q) are the deliberate exception — they *should* disappear with an invisible caster.

**Match rules are read live, and only through their seam.** `Spell.effectiveMana(amount)` is the single expression of URF's `manaFree`, and `spendMana(amount)` is the only sanctioned way to charge a caster; `cooldownMultiplier` is the same idea for CDR. A spell that touches `stats.mana` directly silently opts out of URF — Anivia R's per-tick upkeep did, in both the deduction *and* the affordability check. The source-scan test now forbids it.

**`dashBuff.onUpdate = …` deletes the dash.** `Buff.update()` calls `this.onUpdate()`, and `Dash` puts the movement itself — the step toward `dashDestination`, the arrival check that fires `onReachedDestination`, the interrupt check — in `Dash.prototype.onUpdate`. An instance assignment does not *hook* the frame, it *replaces* it, so the champion plays the spell's own per-frame logic standing perfectly still. It reads exactly like a callback, which is why Camille E, Ekko E and Jarvan Q all shipped with it and none was noticed: each still dealt its damage, to whatever happened to be next to the caster, and still ended on time. **Use `Dash.onDashUpdate`**, which the base calls after the step. `tests/game/spells/dash-onupdate-seam.test.ts` scans for the assignment.

**A `SpellObject` that paints past its own centre needs `getDisplayBoundingBox()`.** `GameObject`'s default derives the box from `visionRadius`, which is **0** for a plain `SpellObject` — a zero-area box on the object's own centre. `ObjectManager.draw` picks what to draw by querying the tree with that box, so a 400px cone or a 220px cage vanishes the moment its *centre* leaves the camera, while its damage lands normally. Same failure as the Lux R beam, one layer down, and it hit six of the twelve effects added with Camille/Ekko/Jarvan. `tests/game/spells/aoe-display-bounds.test.ts` pins it.

**Every `SpellObject` subclass draws at z-index 99 unless it says otherwise.** `ObjectManager`'s `Z_INDEX_MAP` is keyed by *exact constructor*, so a subclass does not inherit `SpellObject`'s slot of 2 — it falls through to `DEFAULT_Z_INDEX`, which is 99, above `Champion.displayZIndex` of 4. Right for a missile or a blast; wrong for anything painted on the floor, which then covers the feet of everyone standing on it. Nocturne's Dusk Trail shipped that way. Ground art sets `zIndex = 2` explicitly — `Singed_W_Object` and `Cassiopeia_W` already do, and `tests/game/spells/ground-decal-zindex.test.ts` pins the rule against the unit z-indices rather than against the number.

**A query that picks a unit must ask whether the caster can see it.** `queryObjects` knows about teams, death and targetability and nothing about the fog, so every auto-locking spell in the game chose its victim out of solid black: Warwick R found the blue camp through a jungle wall and leaped through the wall to bite it, and two dozen others did the same. The seam is `PredefinedFilters.visibleTo(observer)` over `combat/Vision.ts`, and it answers the *same* rule `FogOfWar` paints — walls and bushes block, the bush you stand in does not, a friendly ward is an eye. `TargetResolver` and `pickExecuteTarget`/`lethalTargets` apply it centrally, so `UNIT` spells and the execute marks are covered; a `SELF` spell running its own lookup must add the filter itself, and `tests/game/spells/target-vision-seam.test.ts` scans for the omission. Two boundaries hold the design up. **Vision gates acquisition, never damage** — an area effect must still hit the champion in the bush, so only a query whose result narrows to a *chosen* unit gets the filter. And **distance is not vision's business**: `Reach.ts` owns range, every caller arrives already bounded by its own radius, and a sight-radius cap on top would have quietly trimmed Warwick R from 550 to the 500 the camera happens to use. Sight radius counts in exactly one place, a *borrowed* eye, because a ward sees the circle it lights and no further. Note `Minion`, `Monster` and `Turret` all zero `visionRadius` on purpose — they paint no fog — which is why granted vision and being able to see are two different questions in that module.

**`CollideUtils.lineRect` misses a segment that lies wholly inside the rectangle.** It tests the four edges for crossings and nothing else, so a segment with both endpoints in the box crosses none of them and reads as "no intersection". `Rectangle.intersect(Line)` is that function, which makes a `Line` a lossy quadtree query area: any object whose bounding box swallows the segment is dropped from the retrieve. `Vision.hasLineOfSight` hit it first — every short sightline drawn beside a big wall, which is a jungler's whole world — and works around it with a bounding-box query instead, because `collide.utils.ts` is shared with the spell hitboxes and says at the top not to change its semantics. The gap is still there for the next caller.

**Rasterizing terrain conservatively closes passages, it does not merely narrow them.** `NavGrid` measured clearance to the nearest *blocked cell centre*, and a blocked cell's centre can be a half-diagonal from the wall that blocked it, so cells were refused with up to 19px of room to spare on top of the deliberate margin. Per side that asks ~93px of corridor for a 55px body, and this map's jungle is built out of 60-90px gaps: a fully stacked champion saw the walkable map break into five disconnected pieces. `NavGrid.refineNearWalls` replaces the estimate with the measured distance to the wall for the ~10% of cells near enough to decide anything, which halves the moat, leaves the margin as the only refusal reason, and is strictly *safer* because a measurement cannot overstate the way the transform could. The lesson generalises: a conservative approximation whose error is comparable to the feature size is not conservative, it is wrong. `tests/game/nav/NavGrid.test.ts` now bounds the error in both directions — one sweep for false positives, one for false negatives.

**A direction must never be `(0,0)`.** `Game.facing()` is the convention: fall back to the body's heading, then a fixed vector. `context.direction` is itself `(0,0)` when the cursor sits on the origin, so falling back to *it* is the bug rather than a guard against it.

**`TerrainMap` is only the map file.** Anivia W and Jarvan R put genuinely impassable slabs on the ground — both run the same SAT push-out `TerrainMap.pushOutOfWalls` runs — but they are `SpellObject`s in the object manager, so anything that *asks* `terrainMap` about walls sees a map with holes exactly where a player just built something. Camille's grapple flew through an ice wall; Janna R blew people through Cataclysm. **Ask `wallOutlinesInArea(game, area)`** (`gameObject/map/DynamicTerrain.ts`), which merges both; a new solid slab implements `DynamicWall` (`blocksMovement` + `wallVertices()`) and is picked up for free. Deliberately *not* folded into `getObstaclesInArea`: `FogOfWar` must keep not seeing them (a player wall does not block vision) and `NavigationSystem` rasterizes once at match start. `tests/game/map/DynamicTerrain.test.ts` scans for spells going back to the half-answer.

**A permanent stack is paid for by the corpse, not the hit.** Nasus Q, Cho'Gath R and Veigar Q all banked one per *landed* cast, so the uncapped stats in this game were farmed off targets that never died — worst on Veigar, whose orb pierces, making one cast into a wave five permanent points of max mana. The kill test is `takeDamage` being synchronous: latch `wasAlive` before, read `target.isDead` after. Picking the victim is `pickExecuteTarget(this)` (`combat/ExecuteTargeting.ts`) — a spell implements `executeCandidates()` / `executeDamageAgainst()` / `executeFallback`, and gets lethal-first targeting plus the on-screen "this one dies" ring (`combat/ExecuteMarks.ts`, drawn from `Game.draw`, never as caster VFX) with no code of its own. Lethality counts shields: `health.value + shieldAmount`. Skillshots stay out of it on purpose: the mark promises "this one dies if you press the key", which an aimed spell cannot keep.

**Granting a resource is not billing for one.** `tests/game/spells/mana-spend-seam.test.ts` forbids `spells/`, `spellObjects/` and `buffs/` from naming `stats.mana` at all, because URF's `manaFree` must be one flip. That rule is about charging a caster — a refill must *not* be zeroed by URF — so the giving side lives on the unit as `AttackableUnit.restoreMana()`, next to `takeHeal()`, where `MatchRules` does not apply. Veigar Q's on-kill mana uses it.

**`Champion.score` is a getter now.** It reads `tally.kills - tally.deaths` off `combat/MatchTally.ts`, so `score++` no longer compiles — the ledger is written in `AttackableUnit.die` and `AttackableUnit.takeDamage`, which are the only two funnels every kill and every point of damage already pass through. What a kill is worth is `killCredit` on the victim rather than an `instanceof` at the crediting site: `'champion'`, `'minion'` (the default, so minions and camps are CS) or `'none'`. `Pet` needs `'none'` explicitly **because `Pet extends Champion`** — without it every Shaco clone killed would land on someone's KDA.

**A taunt is the one control effect that must leave `CAN_ATTACK` and `CAN_MOVE` alone.** `BasicAttackController.update` drops its standing order the moment `canAttack` goes false, so a `Taunt` that cleared the bit the way `Stun`/`Charm`/`Fear` do would order a swing and cancel it on the same frame; clearing `CAN_MOVE` would leave the victim rooted out of reach instead of walking in. `StatusFlags.Taunted` therefore appears in exactly one of the three lists in `Stats.updateActionState` (CAN_CAST). Who a unit is fighting lives somewhere different per subclass, so the buff writes through `AttackableUnit.forceAttackTarget` — `Champion` orders its `basicAttack`, `Minion`/`Monster` set `targetLock` + phase — and re-issues it every frame, because the victim's AI re-scans and the player can press keys.

**Reacting to a hit is not modifying it.** `Buff.modifyIncomingDamage` runs in insertion order with each buff handing the next what is left, so a reflect written as a modifier reflects whatever happens to reach it — behind a shield, only the overflow. Adding it first fixes one cast and not the next: recast Annie E while the old shield is up (90% CDR makes that routine) and the *old* shield sits in front of the *new* burn, which then never fires. `Buff.onDamageTaken(swung, landed, attacker)` runs after the whole chain, is handed both numbers, and cannot change either — order stopped being part of the answer. `DamageReflect` (Rammus W's 80%, Annie E's flat burn) lives there. Anything that deals damage from inside it needs the re-entrancy latch that module carries: the payout re-enters `takeDamage` on the attacker, whose own buffs include their reflect, and two curled Rammuses ping-pong one hit until the stack runs out.

**`ON_ATTACK_HIT` is basic attacks only.** `combat/BasicAttack.ts` is the only emitter, so an effect hung there is invisible to every spell in the game. Annie E's shield burn shipped that way and read as broken — it was a "punish whoever damages this" that did nothing to anyone casting anything. Use it for genuine on-hit passives (Teemo E, Twitch R, Varus W); for "someone damaged me", the seam is `Buff.onDamageTaken`.

**Concurrent agents share one working tree.** `git stash` takes another agent's uncommitted work with it. Use `git worktree` instead, and commit with explicit paths — never `git add -A`, never `.`, never a bare `git commit`.

## Tools

- **`tools/shape-maker/`** — Standalone p5 app for creating polygon point arrays (drag to move points, `a` add, `d` delete, `e` export, `i` import). Output is pasted into `TerrainMap.ts`
- **`tools/map-editor/`** — External map editor (linked in its README)

## Asset Organization

- `assets/images/champions/` — Champion avatar sprites and backgrounds
- `assets/images/monsters/` — Monster sprites
- `assets/images/spells/` — Ability icons; `assets/images/buffs/` — crowd-control icons
- `assets/json/summoner_map.json` — the map itself: `wall`, `bush` and `water` polygons plus the two turret rows (`turret1`, `turret2`). Not summoner spell data.
- All assets loaded by `AssetManager` in `src/managers/AssetManager.ts`

`npm run assets:generate` walks `assets/` and regenerates `src/generated/assetManifest.ts` with a typed `AssetKey` union, so a mistyped asset name is a compile error rather than a broken image at runtime. Never hand-edit the generated file; add the image and re-run the script. `assets:check` fails the build when the two are out of sync.

Ability data (damage, cooldowns, ranges, icons) is imported from the LoL Wiki by `scripts/wiki/import-abilities.mjs` into `docs/abilities/<champion>/<slot>.json`, with provenance in `assets/source-manifest.json`.

**Spell names are Riot's, not ours.** `Spell.name` is `'<tên tiếng Việt> (Champion_Slot)'`, and the Vietnamese half must be the string the Vietnamese client ships — 97 of them had drifted into hand-written approximations (Pantheon W read "Khiên Xung Kích" against the official "Khiên Trời Giáng"). `npm run names:sync` reads Data Dragon's `vi_VN` locale into `docs/spell-names-vi.json` and reports the drift; `npm run names:apply` rewrites the name line in place, touching nothing else in the file. **Descriptions stay hand-written** — the official ones carry no numbers and ours are scaled to a ~100 health pool. The cache lives outside `docs/abilities/` because `ability:check` validates every JSON in that tree against a different schema, and `tests/game/spells/vi-spell-names.test.ts` asserts the code against it offline, so only the sync script ever touches the network.
