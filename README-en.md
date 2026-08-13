# League of Legends - 2D (Fan-made)

[![Build](https://github.com/HoangTran0410/LOL2D/actions/workflows/build.yml/badge.svg)](https://github.com/HoangTran0410/LOL2D/actions/workflows/build.yml)
[![Hits](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2FHoangTran0410%2FLOL2D&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=views&edge_flat=true)](https://hits.seeyoufarm.com)

Play your favourite League of Legends champions right in the browser — a 2D Summoner's Rift, 30+ champions, bot fights, and spells you can swap mid-match.

**[▶ Play Now](https://hoangtran0410.github.io/LOL2D)**

![Screenshot](/assets/images/screenshots/Screenshot_1.jpg)

![Screenshot](/assets/images/screenshots/Screenshot_4.jpg)

![Screenshot](/assets/images/screenshots/Screenshot_3.jpg)

## Contents

- [Introduction](#introduction)
- [Controls](#controls)
- [Getting started](#getting-started)
- [npm scripts](#npm-scripts)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [Assets and ability data](#assets-and-ability-data)
- [Testing](#testing)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)

## Introduction

A fan-made, indie game based on [League of Legends](https://www.leagueoflegends.com/) by [Riot Games](https://www.riotgames.com/en). It runs entirely in the browser: [p5.js](https://p5js.org/) draws the canvas, [Vue 3](https://vuejs.org/) drives the HUD, all in TypeScript and bundled with [Vite](https://vitejs.dev/).

What is in it:

- **30+ champion kits** rebuilt from the real game — skillshots, charged casts, channels, recasts, shields, heals, and a full spread of crowd control.
- **Swap spells mid-match**, including a *One For All* mode that puts the whole board on a single ability.
- **Fighting bots**, jungle camps, healing fountains, and turrets.
- **Fog of war** built from a visibility-polygon sweep, with bushes and walls that really do block line of sight.

## Controls

| Action | Key |
| --- | --- |
| Move | Right click |
| Abilities | `A` `Q` `W` `E` `R` |
| Summoner spells | `D` `F` |
| Toggle camera follow | `Space` |
| Back to menu | `Esc` |

Charged abilities (Varus Q, Pantheon Q) are held down and fire on release.

## Getting started

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/HoangTran0410/LOL2D.git
cd LOL2D
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173 by default).

> `npm run dev` runs `assets:generate` first, so the asset manifest always matches what is on disk in `assets/` without you having to think about it.

Production build:

```bash
npm run build     # emits dist/
npm run preview   # serve the built output
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm test` | Run the unit suite once |
| `npm run test:watch` | Run the unit suite in watch mode |
| `npm run typecheck` | Type-check the whole project |
| `npm run typecheck:core` | Strict type-check of the core modules |
| `npm run verify` | **All of the above** — run this before opening a PR |
| `npm run assets:generate` | Regenerate the asset manifest from `assets/` |
| `npm run assets:check` | Fail if the asset manifest is out of date |
| `npm run ability:import` | Pull fresh ability data from the LoL Wiki |
| `npm run ability:check` | Validate the imported ability records |
| `npm run e2e` | Drive the real game in Chrome via Playwright and screenshot it |

## Project layout

```
src/
├── main.ts               # entry point: boots p5 and the SceneManager
├── scenes/               # LoadingScene → MenuScene → GameScene
├── game/
│   ├── Game.ts           # main loop, owns camera/objectManager/map
│   ├── preset.ts         # champion kits, jungle camps, turret and fountain spots
│   ├── gameObject/
│   │   ├── attackableUnits/  # Champion, AIChampion, Monster
│   │   ├── spells/           # one file per ability: Ahri_Q.ts, Yasuo_R.ts, ...
│   │   ├── spellObjects/     # base classes: Missile, Area, Beam, HomingMissile
│   │   ├── buffs/            # Stun, Slow, Shield, Invisible, ...
│   │   ├── structures/       # Turret, Fountain
│   │   └── map/              # TerrainMap, FogOfWar, Camera, Obstacle
│   ├── spell/runtime/    # the spell lifecycle state machine
│   ├── hud/              # Vue-based HUD
│   └── managers/         # ObjectManager (quadtree), EventManager
├── managers/             # AssetManager, SceneManager
└── generated/            # script-generated asset manifest — do not hand-edit
```

## Architecture

**Spell lifecycle.** Every spell declares a `castSpec` describing how it is cast — press, hold-and-release, channel, or recast — and `SpellRuntime` runs the `READY → CASTING/CHARGING → ACTIVE → COOLDOWN` state machine, including resource commit, refund on interrupt, and interrupt sources (death, stun, silence, displacement). Spells only implement the `onCastStart` / `onRelease` / `onSpellCast` hooks.

**Spell objects.** Projectiles extend `MissileSpellObject`, area effects extend `AreaSpellObject`, lines use `BeamSpellObject` — note that the beam is hit detection only and **does not draw itself**, so subclass it and write a `draw()`.

**Collision and queries.** `ObjectManager` maintains a quadtree rebuilt each frame; all target selection goes through `queryObjects({ area, filters })` with the ready-made predicates in `PredefinedFilters`.

**Crowd control.** Buffs raise and clear bits in `StatusFlags`, which the system resolves into `ActionState` (can move / can cast / targetable).

The full details live in [`docs/ADDING_SPELLS.md`](./docs/ADDING_SPELLS.md) — **read it before writing a new spell.** It covers the three registration points, the mandatory buff `stackId` rule, and the engine traps `tsc` cannot catch.

## Assets and ability data

Images and JSON live under `assets/`. `npm run assets:generate` walks that tree and emits `src/generated/assetManifest.ts` with a typed `AssetKey` union, so a typo in an asset name is a compile error rather than a broken image at runtime. To add art, drop the file in the right folder and re-run that script.

Ability data (damage, cooldowns, ranges, icons) is imported from the [LoL Wiki](https://wiki.leagueoflegends.com/) by `scripts/wiki/import-abilities.mjs` into `docs/abilities/<champion>/<slot>.json`, with provenance recorded in `assets/source-manifest.json`.

```bash
npm run ability:import -- --champions Ahri,Zed --slots Q,W,E,R
npm run ability:check
```

`tools/` also holds [shape-maker](./tools/shape-maker/), a standalone p5 app for drawing the map's polygon data.

## Testing

**Unit tests** run under Vitest with no browser: every p5 drawing global is stubbed with a spy, so a test can prove which primitives a spell asks for and how its logic behaves.

```bash
npm test
npx vitest run tests/game/spells/Varus_Q.test.ts   # a single file
```

House rule: **tuning values are exported as constants from the spell file and imported by its test.** Tests assert the wiring, not a copy of the numbers — retuning damage should never mean editing a test.

**End-to-end** tests drive real Chrome through Playwright, because a unit test cannot prove the game boots and paints:

```bash
npx vite --port 5199 --strictPort   # in another terminal
npm run e2e
```

Scripts in `tests/e2e/` reach into the running game through `window.__lol2d`, which only exists in dev builds.

## Contributing

Contributions are welcome. What you need to know:

1. **Fork and branch** off `main`.
2. **Run `npm run verify` before opening a PR.** It runs exactly what CI runs: asset check, ability-data check, both type-check passes, the full test suite, and the build. That is the repository's complete offline check.
3. **Adding a spell?** Read [`docs/ADDING_SPELLS.md`](./docs/ADDING_SPELLS.md) first. There are three registration points, and missing one means the spell never shows up.
4. **Bring tests.** Each spell should have a file in `tests/game/spells/`. Export the tuning constants from the spell and import them in the test rather than copying numbers.
5. **Look at it.** If your change is visual, open the real game — or write a script in `tests/e2e/`. A test asserting `draw()` was called proves nothing about how it looks.
6. **Formatting** follows Prettier (`.prettierrc`: 2 spaces, single quotes, trailing commas, 100 columns).
7. **Comments explain *why*, not *what*.** Prefer recording the reason an approach was chosen, or the trap that forced the code into its current shape.

## Disclaimer

This is a non-commercial, fan-made project, **not affiliated with or endorsed by [Riot Games](https://www.riotgames.com/en)**. The game is free and generates no revenue; it exists for entertainment only.

[League of Legends](https://www.leagueoflegends.com/) and all related trademarks, characters, artwork, and other assets are the property of [Riot Games](https://www.riotgames.com/en). This project claims no ownership over that intellectual property.

## Language support

This README is available in [English](./README-en.md) and [Vietnamese](./README.md).
