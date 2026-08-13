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
- **In-game controls**: Right-click to move, `A` `Q` `W` `E` `R` for abilities and `D` `F` for summoner spells (see `SpellHotKeys` in `src/game/constants.ts`), `Space` to toggle camera follow, `Esc` to return to menu

## Code Style

- **Formatting**: Prettier (config in `.prettierrc` — 2 spaces, single quotes, trailing commas, 100 columns). Several files predate it and fail `prettier --check` on `main`; do not run `--write` across them as a side effect of an unrelated change.
- **Polyfills**: Array prototype methods (`map`, `filter`, `forEach`, etc.) are overridden in `src/main.ts` with optimized versions from `src/utils/optimized.utils.ts`, before p5 globals are imported.
- **Tuning values**: exported as constants from the spell file so tests import them instead of copying numbers. Retuning damage must not mean editing a test.

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
