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
- **`Array.prototype.filter` cannot narrow types here.** `src/types/global.d.ts` re-declares it with the optimized `(value, index) => boolean` signature, and the merged interface puts that overload first, so the type-predicate overload never applies — `objects.filter((o): o is Foo => …)` still comes back as the wide type. Write a plain loop (see `MatchDirector.bots()`), not a cast.
- **`<script setup>` *is* the setup function.** A `const x = ref(…)` at its top level looks like module scope and is not — it is rebuilt on every mount. State that must outlive an unmount belongs in a plain `.ts` module (see `src/game/hud/practice/panelTab.ts`).

## Testing

`npm run verify` is the gate. Beyond it, pick the cheapest tool that can see the bug:

1. **Vitest by default.** 1500 tests run in about a second.
2. **A source-scan test** for any "nobody may do X" rule — it runs in milliseconds and closes a whole class permanently. `tests/game/spells/mana-spend-seam.test.ts` (no file may write `stats.mana` directly) and `tests/game/spells/cc-buff-icons.test.ts` are the models. Strip comments before matching, or the scan flags its own documentation.
3. **Playwright (`tests/e2e/drive-*.mjs`) only for what Vitest structurally cannot see**, which is three things: a real finger, a real renderer, and the paused/unpaused frame boundary. Each run costs minutes. Do not re-run neighbouring scripts for a change that does not touch their area.

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

**A direction must never be `(0,0)`.** `Game.facing()` is the convention: fall back to the body's heading, then a fixed vector. `context.direction` is itself `(0,0)` when the cursor sits on the origin, so falling back to *it* is the bug rather than a guard against it.

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
