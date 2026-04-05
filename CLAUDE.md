# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LOL2D is a fan-made, browser-based 2D game inspired by League of Legends. It runs entirely in the browser using p5.js for rendering. There is no build system or test framework — the project loads dependencies from CDNs and serves static files directly.

## Running the Project

Serve the project with any static file server, then open `index.html` in a browser:

```bash
npx serve .
# or
python3 -m http.server 8080
```

- **Menu** → Click "Chơi" to start the game
- **In-game controls**: Right-click to move, number keys `1-6` for spells, `Space` to toggle camera follow, `Esc` to return to menu

## Code Style

- **Formatting**: Prettier (config in `.prettierrc` — 2 spaces, single quotes, trailing commas)
- **No build tools**: All JS is ES module, loaded via `<script type="module">` from CDN
- **Polyfills**: Array prototype methods (`map`, `filter`, `forEach`, etc.) are overridden in `src/app.js` with optimized versions from `src/utils/optimized.utils.js`

## Architecture

### Scene Flow
`LoadingScene` → `MenuScene` → `GameScene`

`src/sketch.js` initializes the p5 sketch and `SceneManager`. `src/app.js` overrides global Array methods before p5 globals are imported.

### Core Classes (`src/game/`)

| Class | File | Role |
|---|---|---|
| `Game` | `Game.js` | Main game loop, owns camera/objectManager/terrainMap/fogOfWar |
| `ObjectManager` | `managers/ObjectManager.js` | Updates and draws all game objects; uses quadtree for spatial queries |
| `SceneManager` | `managers/SceneManager.js` | Custom scene manager (not p5's), routes p5 events to active scene |

### Game Object Hierarchy

```
GameObject
├── AttackableUnit (has stats, buffs, health, movement)
│   ├── Champion (player-controlled)
│   ├── AIChampion (AI-controlled)
│   └── Monster
├── SpellObject (projectile/effect created by spells)
└── Helpers (ParticleSystem, CombatText, TrailSystem)
```

### Spells (`src/game/gameObject/spells/`)

Each spell is a separate file exporting a class extending `Spell`. `Spell` manages cooldown state machine (READY → COOLDOWN → READY). Spell files reference their champion prefix (e.g., `Ahri_Q.js`, `Yasuo_R.js`). Summoner spells (`Flash`, `Ghost`, `Heal`, `StealthWard`) are at the root of the spells folder.

**Adding a new spell**: Create a new file in the spells folder, extend `Spell`, implement `onSpellCast()`, then export it from `spells/index.js` and add it to `SpellGroups` in `src/game/preset.js`.

### Buffs (`src/game/gameObject/buffs/`)

Each buff extends the base `Buff` class and controls `statusFlagsToEnable`/`statusFlagsToDisable` to apply crowd control effects via `StatusFlags` and `ActionState`.

### Stats System (`Stats.js`, `Stat.js`)

Stats use a base + bonus modifier pattern. `ActionState` flags are updated by both status effects and buff system.

### Enums (`src/game/enums/`)

Key enums: `ActionState` (movement/combat flags), `StatusFlags` (crowd control), `SpellState` (cooldown states), `EventType` (game events via EventManager).

### Map & Collision

- `TerrainMap.js` stores map polygon data and handles terrain collision
- `FogOfWar.js` renders fog of war overlay
- `Camera.js` handles world-to-screen coordinate transformation
- QuadTree-based collision in `libs/quadtree.js`; collision algorithms in `libs/detect-collisions.js`

## Tools

- **`tools/shape-maker/`** — Standalone p5 app for creating polygon point arrays (drag to move points, `a` add, `d` delete, `e` export, `i` import). Output is pasted into `TerrainMap.js`
- **`tools/map-editor/`** — External map editor (linked in its README)

## Asset Organization

- `assets/images/champions/` — Champion avatar sprites and backgrounds
- `assets/images/monsters/` — Monster sprites
- `assets/json/summoner_map.json` — Summoner spell data
- All assets loaded by `AssetManager` in `src/managers/AssetManager.js`
