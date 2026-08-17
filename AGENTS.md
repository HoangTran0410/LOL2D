# AGENTS.md

Guidance for Codex (Codex.ai/code) when working in this repository.

## Project

LOL2D — a fan-made browser 2D game inspired by League of Legends. TypeScript + Vite; p5.js draws the canvas, Vue 3 drives the HUD. Vitest for tests, Playwright scripts (`tests/e2e/`) drive the real game in Chrome.

p5 runs in **global mode** — `createVector`, `push`, `fill` and the rest are globals from a CDN `<script>` in `index.html`, not bundled. All code touching a p5 global must run inside `setup()`, never at module eval time. See the header of `src/main.ts`, the only entry point; in dev it also exposes `window.__lol2d`, which is how the e2e scripts reach the running game.

## Running

```bash
npm run dev      # http://localhost:5173
npm run verify   # everything CI runs — do this before declaring work done
```

`verify` = `assets:check` + `ability:check` + `typecheck` + `typecheck:core` + Vitest + `build`.

**The app is an installable PWA**, so two build-time facts are load-bearing. `predev`/`prebuild` copy p5 and stats.js out of `node_modules` into `public/vendor/` (gitignored, `scripts/copy-vendor.mjs`) and `index.html` loads them from there rather than a CDN: p5 is a global the game cannot boot without, in dev or production, and a service worker can only cache a cross-origin script it has already seen fetched, so the first offline launch would otherwise be a white screen. Stats.js is the same story only in dev — `GameScene.setup()` gates `new Stats()` behind `import.meta.env.DEV` (three always-redrawing debug canvases cost real frame budget on a phone for a HUD nobody but a developer reads), so it stays vendored and precached for dev builds but is dead weight, not a boot dependency, in production. And `public/` is the only directory Vite copies verbatim, which is why `favicon/` lives there: the generated manifest points at those icons by path. `npm run e2e:pwa` builds and checks the whole thing in a real browser with the network cut — including clearing Chromium's own HTTP cache first, without which a missing precache entry still appears to work.

In-game: right-click moves, `A Q W E R` abilities, `D F` summoners (`SpellHotKeys` in `src/game/constants.ts`), `Space` toggles camera follow, `N` the nav debug overlay, wheel zooms, `Esc` opens the practice panel. **`Esc` does not leave the match** — one mis-hit used to end it outright; the way out is the exit button in the panel's Trận đấu tab, behind a two-step confirm.

## Code style

- **Prettier** (`.prettierrc`, 2 spaces, single quotes, 100 columns). Several files predate it and fail `--check` on `main`; never run `--write` across them as a side effect of an unrelated change.
- **Tuning values** are exported constants in the spell file so tests import them. Retuning damage must not mean editing a test.
- **Array prototypes are polyfilled** in `src/main.ts` from `src/utils/optimized.utils.ts`, before p5 loads. Consequence: **`Array.prototype.filter` cannot narrow types.** `src/types/global.d.ts` re-declares it and the merged interface puts the non-predicate overload first, so `objects.filter((o): o is Foo => …)` still comes back wide. Write a plain loop (see `MatchDirector.bots()`), not a cast.
- **`<script setup>` *is* the setup function.** A `const x = ref(…)` at its top level looks like module scope and is not — it is rebuilt on every mount. State that must outlive an unmount belongs in a plain `.ts` module (`src/game/hud/practice/panelTab.ts`).
- **Spell design and VFX**: `docs/VFX_STANDARD.md` is the whole bar, distilled so an agent can be briefed with a link instead of a 400-line spell. In short: every champion's VFX is its own artwork with a real windup, damage scales to a ~100 health pool (spells 15-35, ultimates 40-60) and ranges to this canvas rather than raw wiki numbers, and a dash or sweep hits each unit at most once via a `hitTargets` set. **Legibility outranks looking good** — the animation has to state the ability's reach and area, give each differently-behaving zone a visibly different region, land an impact *on the victim*, move the way the buff moves (an inward pull draws the weapon coming inward), and stop at the fewest layers that say it. Pretty effects stacked on each other hide each other.

## Testing

`verify` is the gate. Beyond it, pick the cheapest tool that can see the bug:

1. **Vitest by default** — 2500 tests in about ten seconds, most of that the nav sweeps.
2. **A source-scan test** for any "nobody may do X" rule: milliseconds, and it closes a whole class permanently. Models: `tests/game/spells/mana-spend-seam.test.ts`, `dash-onupdate-seam.test.ts`. Strip comments before matching, or the scan flags its own documentation.
3. **Playwright only for what Vitest structurally cannot see** — a real finger, a real renderer, the paused/unpaused frame boundary. Minutes per run; do not re-run neighbouring scripts for a change that does not touch their area.

**Every test must be shown to fail.** Write it first, run it, and *read* the message. Two failure shapes have shipped repeatedly here: asserting on state the code under test has already produced (checking `game.monsters` is empty when the setter emptied it synchronously), and a check that computes its own expected value by calling the thing it checks — a transform asked to verify itself agrees with itself however wrong it is; one inverted axis was off by 3468 against arithmetic written out by hand. Prove an e2e script falsifiable **once, when it is new**; repeating that on every later change is the single most expensive habit available.

Known flakes, not worth chasing: `drive-new-spells.mjs` (~1 in 4, `oScene` undefined during scene boot) and `drive-touch-controls.mjs` (rare freeze). A stray dev server holding port 5173 makes both far likelier.

### Keeping a pass cheap

`verify` is not the expensive part. What actually burns a context window, measured on the Camille/Ekko/Jarvan pass:

- **Fanning out agents that share a briefing.** Seven agents each told to "read `Fizz_E.ts` first" read the same 400-line file seven times before writing a line. Fan out when the work is independent *and* the shared context is small; when N files need one standard, one agent reads it once. An audit agent should report `file:line` plus a sentence and **never quote code back** — that part scaled fine across 150 files.
- **Reading screenshots.** A 1280x900 PNG costs about what 600 lines of source costs. Make the e2e script end in a numeric summary and trust it. Open one or two to judge a *look*, never a whole run's worth.
- **Piping whole command output.** `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"` is the entire signal, and `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "\.vue'"` drops the pre-existing SFC-resolution errors that are not yours.

## Architecture

`LoadingScene` → `MenuScene` → `GameScene`, routed by a custom `managers/SceneManager.ts` (not p5's).

| File | Role |
|---|---|
| `Game.ts` | game loop; owns camera / objectManager / terrainMap / fogOfWar |
| `managers/ObjectManager.ts` | updates and draws every object; **two** quadtrees — `_objectsTree` for anything gameplay can ask about, `_decorTree` for particles and trails, which no query should ever page in. `draw` reads both, `queryObjects` only the first; `isDecoration()` is the closed list, and a `SpellObject` never belongs on it |
| `MatchDirector.ts` | every mutation of a *running* match, and the only thing that persists them |
| `managers/MinionSpawner.ts` | wave clock for both bases; owns the live minion cap |
| `gameObject/map/Minimap.ts` | screen-space map; tap expands it, tapping the expanded map teleports |

Objects: `GameObject` → `AttackableUnit` (`Champion`, `AIChampion`, `Minion`, `Monster`, `Turret`), plus `Fountain`, `SpellObject` and helpers (`ParticleSystem`, `CombatText`, `TrailSystem`). Key enums in `game/enums/`: `ActionState` (movement/combat flags), `StatusFlags` (crowd control), `SpellState`, `EventType`.

**Adding a spell**: read `docs/ADDING_SPELLS.md` first — the three registration points, the `MissileSpellObject` base every skillshot should extend, the buff catalogue's mandatory `stackId`, the engine traps `tsc` cannot catch, and how to verify against the real game.

### Teams, lanes and minions

`GameObject.teamId` defaults to a fresh uuid per unit, so **every unit is its own faction, and champions keep that** — player and bots are free-for-all, hostile to everyone including both minion teams. `enums/TeamId.ts` adds the two shared ids that a base's fountain, its turret row (`turret1` blue, `turret2` red in `summoner_map.json`) and its minions share. `lanes.ts` holds three waypoint paths ordered blue → red; red minions walk them backwards, and `tests/game/minions/Lanes.test.ts` checks the coordinates against the wall polygons — edit them and re-run it.

### The practice panel

`hud/PracticePanel.vue` — three tabs over a paused match, opened by `Esc`. A **superset of the pregame setup screen**: setup sets AI behaviour globally, the panel sets it per bot. Tabs never touch `localStorage`; they call `MatchDirector`, which mutates the live match and then writes `lol2d:pregameConfig:v1`, so the match you shaped is the one you get back. **Cheats, debug layers and stack counts are session state and deliberately never stored** — a test asserts the blob is byte-identical after every cheat is switched on. `config/savedKits.ts` is the one thing a tab stores on its own. A fourth tab will not fit: `.pregame-tab` is `flex: 1` and 390px holds three plus the close button.

## Traps that have cost real time

Each was found by measurement, more than once, and none is visible from the file you are editing. The seams named here carry the long version in their own doc comments.

**The practice panel holds the match paused.** `Game.update()`/`draw()` return early while `paused`, and every `MatchDirector` method runs in exactly that window — so nothing has settled. Four bugs so far. **Read both `objects` and `_objectToBeAdd`, skip `toRemove` and deactivated entries, and clamp derived stats at the point of change rather than trusting `update()`.**

**`GameScene` calls `preventDefault()` on every touch on the page**, so the browser synthesises neither the trailing `click` nor its own scrolling — anywhere, not just over the canvas. A checkbox, a range drag and a plain `@click` were each dead under a thumb and perfect under a mouse. **Every HUD control needs a touch handler beside its click handler**, and a scrollable panel body needs hand-rolled scroll. `RulesTab.vue` and `RosterTab.vue` carry the shapes.

**An effect that reaches beyond its caster's body must be a `SpellObject`, not `castSpec.vfx`.** VFX drawn from `Champion.draw()` disappears whenever `ObjectManager.draw` skips the caster, while the damage — with bounds of its own — lands normally. Lux R's beam crossed the screen invisibly. Aim telegraphs (Pantheon Q, Varus Q) are the deliberate exception.

**p5 global mode means ordinary English words are functions.** `pop`, `text`, `fill`, `line`, `point`, `random`, `map`, `scale`, `rotate`, `image`, `color` are all globals, and a local of the same name silently shadows one — `const pop = …` inside a `draw()` turns the `pop()` that closes the block into a call on a number. `tsc` cannot see it: p5's globals are ambient declarations, and shadowing an ambient is legal. It fails only at runtime, in the browser, on a frame that may not be the one you are looking at. Name locals for what they mean in the effect (`opened`, `caption`, `swept`), never for the quantity's generic word.

**A `SpellObject` that paints past its own centre needs `getDisplayBoundingBox()`.** The default derives it from `visionRadius`, which is 0 for a plain `SpellObject` — a zero-area box — so a 400px cone vanishes when its *centre* leaves the camera. Six of twelve new effects had it. `aoe-display-bounds.test.ts`.

**Ground art must set `zIndex = 2`.** `Z_INDEX_MAP` is keyed by *exact constructor*, so a `SpellObject` subclass does not inherit its slot of 2 and falls through to 99 — above `Champion`'s 4, covering the feet of everyone standing on it. `ground-decal-zindex.test.ts`.

**Match rules are read live, and only through their seam.** `Spell.effectiveMana()` is the single expression of URF's `manaFree`, `spendMana()` the only way to charge a caster, `cooldownMultiplier` the same for CDR. Touching `stats.mana` directly silently opts out; `mana-spend-seam.test.ts` bans the name from `spells/`, `spellObjects/` and `buffs/`. **Granting is not billing** — a refill must not be zeroed by URF, so it lives on the unit as `AttackableUnit.restoreMana()`, beside `takeHeal()`.

**Use `Dash.onDashUpdate`, never `dashBuff.onUpdate = …`.** `Dash` puts the movement itself in `Dash.prototype.onUpdate`, so an instance assignment replaces the frame instead of hooking it and the champion plays the spell's logic standing still. It reads exactly like a callback — Camille E, Ekko E and Jarvan Q all shipped with it unnoticed, because each still dealt its damage to whatever was next to the caster. `dash-onupdate-seam.test.ts`.

**A query that picks a unit must ask whether the caster can see it.** `queryObjects` knows teams, death and targetability, not the fog — Warwick R found the blue camp through a jungle wall and leaped through it. The seam is `PredefinedFilters.visibleTo(observer)` over `combat/Vision.ts`, which answers the same rule `FogOfWar` paints. **The fog's own flag is not that seam**: `AttackableUnit.visibleToPlayerTeam` (once called `willDraw`, which is what made it look usable) is written by `FogOfWar.calculateSight` from *the player's* eyes and read only by the draw cull, the minimap and the debug overlay. Thirteen abilities had gated targeting on it, so every bot's spell was silently limited to what the human could see — it could not target an enemy beside it in an unlit bush, and could target one across the map the player had lit. The same source scan bans the name from `spells/`. `TargetResolver` and `pickExecuteTarget`/`lethalTargets` apply it centrally; a `SELF` spell doing its own lookup must add it, and `target-vision-seam.test.ts` scans for the omission. Two boundaries: **vision gates acquisition, never damage** (an area effect must still hit the champion in the bush, so only a query narrowing to a *chosen* unit gets the filter), and **distance is not vision's business** — `Reach.ts` owns range, and a sight-radius cap on top would have trimmed Warwick R from 550 to the camera's 500. `Minion`/`Monster`/`Turret` zero `visionRadius` on purpose, so granting vision and being able to see are separate questions there.

**Ask `wallOutlinesInArea(game, area)`, not `terrainMap`.** Anivia W and Jarvan R are genuinely impassable but are `SpellObject`s, so `terrainMap` shows holes exactly where a player just built something — Camille's grapple flew through an ice wall, Janna R blew people through Cataclysm. A new slab implements `DynamicWall` and is picked up free. Deliberately not folded into `getObstaclesInArea`: `FogOfWar` must keep not seeing them and `NavigationSystem` rasterizes once at match start. `DynamicTerrain.test.ts`.

**`CollideUtils.lineRect` misses a segment lying wholly inside the rectangle** — four edge crossings and nothing else. `Rectangle.intersect(Line)` is that function, so a `Line` is a lossy quadtree query area: anything whose bounding box swallows the segment is dropped. `Vision.hasLineOfSight` uses a bounding box instead, because `collide.utils.ts` is shared with the spell hitboxes and says not to change its semantics. Still there for the next caller.

**A conservative approximation whose error matches the feature size is not conservative, it is wrong.** `NavGrid` measured clearance to the nearest blocked cell *centre*, up to a half-diagonal off, so cells were refused with 19px to spare — ~93px of corridor demanded for a 55px body, on a map whose jungle is 60-90px gaps, and a stacked champion's walkable map broke into five pieces. `refineNearWalls` measures the real distance where it decides anything; `NavGrid.test.ts` now bounds the error in both directions.

**A direction must never be `(0,0)`.** `Game.facing()` is the convention: body heading, then a fixed vector. `context.direction` is itself `(0,0)` when the cursor sits on the origin, so falling back to *it* is the bug rather than a guard.

**A permanent stack is paid for by the corpse, not the hit.** Nasus Q, Cho'Gath R and Veigar Q banked one per *landed* cast, farming uncapped stats off targets that never died. The kill test is `takeDamage` being synchronous: latch `wasAlive` before, read `isDead` after. Implement `executeCandidates()` / `executeDamageAgainst()` / `executeFallback` and `combat/ExecuteTargeting.ts` gives lethal-first targeting plus the "this one dies" ring (`ExecuteMarks.ts`, drawn from `Game.draw`, never as caster VFX). Lethality counts shields. Skillshots stay out: the mark promises a kill an aimed spell cannot keep.

**`Champion.score` is a getter** over `combat/MatchTally.ts`, so `score++` no longer compiles; the ledger is written in `AttackableUnit.die` and `takeDamage`. What a kill is worth is `killCredit` on the victim, not an `instanceof` at the crediting site: `'champion'`, `'minion'` (default, so camps are CS) or `'none'`. **`Pet` needs `'none'` explicitly because `Pet extends Champion`** — otherwise every Shaco clone killed lands on someone's KDA.

**A taunt must leave `CAN_ATTACK` and `CAN_MOVE` alone** — the one control effect that does. `BasicAttackController.update` drops its standing order the moment `canAttack` goes false, so clearing it orders a swing and cancels it on the same frame; clearing `CAN_MOVE` roots the victim out of reach. `StatusFlags.Taunted` is in exactly one of the three lists in `Stats.updateActionState` (CAN_CAST). The buff writes through `AttackableUnit.forceAttackTarget` and re-issues every frame, because the AI re-scans and the player can press keys.

**Reacting to a hit is not modifying it.** `Buff.modifyIncomingDamage` runs in insertion order, each buff handing the next what is left, so a reflect written as a modifier only sees what reaches it — behind a shield, the overflow — and ordering it first fixes one cast and not the next. `Buff.onDamageTaken(swung, landed, attacker)` runs after the whole chain and cannot change either number; `DamageReflect` lives there with a re-entrancy latch, because the payout re-enters `takeDamage` on the attacker and two curled Rammuses would ping-pong one hit.

**`ON_ATTACK_HIT` is basic attacks only** — `combat/BasicAttack.ts` is the sole emitter, so an effect hung there is invisible to every spell. Annie E's shield burn shipped that way and punished nobody. For "someone damaged me", use `Buff.onDamageTaken`.

**Concurrent agents share one working tree.** `git stash` takes another agent's uncommitted work with it. Use `git worktree`, and commit with explicit paths — never `git add -A`, never `.`, never a bare `git commit`.

## Assets and data

`assets/json/summoner_map.json` is the **map** — `wall`, `bush` and `water` polygons plus the two turret rows. Not summoner spell data. Everything else loads through `AssetManager` (`src/managers/AssetManager.ts`).

`npm run assets:generate` walks `assets/` and regenerates `src/generated/assetManifest.ts` with a typed `AssetKey` union, so a mistyped asset name is a compile error rather than a broken image at runtime. Never hand-edit the generated file; add the image and re-run. `assets:check` fails the build when the two drift.

Ability data (damage, cooldowns, ranges, icons) is imported from the LoL Wiki by `scripts/wiki/import-abilities.mjs` into `docs/abilities/<champion>/<slot>.json`, with provenance in `assets/source-manifest.json`.

**Spell names are Riot's, not ours.** `Spell.name` is `'<tên tiếng Việt> (Champion_Slot)'`, and the Vietnamese half must be the string the Vietnamese client ships — 97 had drifted into hand-written approximations. `npm run names:sync` reads Data Dragon's `vi_VN` locale into `docs/spell-names-vi.json` and reports the drift; `npm run names:apply` rewrites the name line in place. **Descriptions stay hand-written** — the official ones carry no numbers and ours are scaled to a ~100 health pool. The cache lives outside `docs/abilities/` because `ability:check` validates that tree against a different schema, and only the sync script touches the network; `vi-spell-names.test.ts` checks the code against the cache offline.

`tools/shape-maker/` is a standalone p5 app for drawing polygon point arrays (`a` add, `d` delete, `e` export, `i` import); `tools/map-editor/` is linked from its own README.
