# What breaks when `packs/riot/` leaves this tree

Surveyed against the `LOL2D-batch5` worktree, no files changed. `packs/` currently
holds two packs: `packs/riot/` (240 spell files, 1 monster, the map) and
`packs/reference/` (7 files) — this matters throughout: a scan rooted at the
`packs/` *parent* does not throw when `riot/` disappears, because `reference/`
is still there to be found.

---

## 1. Scans rooted in `packs/`

Every test that walks a filesystem path containing `packs/` via `fs`, classified
by what happens when that specific root is missing.

### QUIET (dangerous) — root missing, scan proceeds and checks less, no error

| file:line | root walked | why it's quiet |
|---|---|---|
| `tests/content/packBoundary.test.ts:35,49,94` | `join(__dirname, '../../packs')` (the **parent**, `packs/`) | `packs/reference/` (7 files) still resolves `readdirSync`, so the scan — described in its own header as *"the rule the whole extraction rests on"* — silently drops from checking 258 files to 7, and its own guard (`files.length > 0`, line 94) is satisfied by the 7 that are left. No signal that ~97% of what it certifies is gone. |
| `tests/content/packAssetKeyBoundary.test.ts:46,53,74` | same `../../packs` parent | identical shape: `expect(files.length).toBeGreaterThan(0)` (line 74) passes on `packs/reference/`'s 7 files alone. |
| `tests/game/spells/terrain-field-seam.test.ts:66` (`sourceFiles()`) | `packs/riot/spells` and `packs/riot/monsters`, among 5 roots (lines 50, 54) | `sourceFiles()` explicitly does `if (!existsSync(root)) return [];` (line 63-64, deliberate — comment explains "gone must read as nothing to scan, not a crash"). This *is* quiet at the fs layer. |

### LOUD — root missing, `readdirSync`/import throws `ENOENT` (or fails module resolution)

Every other packs-rooted scan hardcodes `packs/riot/...` directly (not the
`packs/` parent), so losing that exact subdirectory throws immediately, before
any assertion runs:

`tests/content/coreSpellsApiSurface.test.ts:298,310` (`PACK_SPELLS_DIR`) · `tests/content/vocabularyBoundary.test.ts:84,100-102,109,111-112` (self-documents this exact risk at lines 75-80: *"once `packs/riot/` stops being a directory... `readdirSync` above throws `ENOENT` rather than the suite passing or failing"*) · `tests/game/buffs/Ground.test.ts:142,148` (crashes at collection — `it.each` built from module scope) · `tests/game/spells/MatchRules.test.ts:41,44` (same, collection-time) · `tests/game/spells/stat-resource-modifier.test.ts:46,51` · `tests/game/spells/unit-target-team-seam.test.ts:32,50` · `tests/game/spells/dash-onupdate-seam.test.ts:34,44` · `tests/game/spells/mana-spend-seam.test.ts:57,62` · `tests/game/spells/vi-spell-names.test.ts:23,37` (module scope — crashes the whole file) · `tests/game/spells/target-vision-seam.test.ts:28,43` · `tests/game/spells/TargetingModeDeclared.test.ts:13,23` · `tests/game/spells/buff-deactivate-seam.test.ts:24,28` (describe-block scope, line 55 — crashes the whole file at collection) · `tests/game/spells/castspec-frozen-seam.test.ts:39,117` (describe-block scope) · `tests/game/spells/spell-object-display-box-seam.test.ts:58,96,133` · `tests/game/spells/spell-runtime-drive-seam.test.ts:51,126` (root is actually `tests/packs/riot/spells`, the champion-named *test* files, not the source — same LOUD failure) · `tests/game/spells/cooldowns.test.ts:6-7` · `tests/game/integration/SpellAimIntegration.test.ts:611,624` · `tests/game/map/DynamicTerrain.test.ts:191,194` · `tests/e2e/drive-new-spells.mjs:19` (not Vitest, but an HTTP canary of `packs/riot/spells/Malphite_E.ts`; loud after a 60s timeout, not an exception).

**`terrain-field-seam.test.ts` is quiet-then-loud**: `sourceFiles()` returns `[]`
for the two missing riot roots (quiet), but the aggregate guard at line 117,
`expect(scanned).toBeGreaterThan(200)`, catches it — measured actual scanned
count with all 5 roots present is **269** (240 spells + 1 coreSpells·spellObjects
(4) + buffs (24) + 0 src-monsters + 1 packs/riot/monsters); with `packs/riot/`
gone it drops to **28**, which fails the floor. Net effect: loud, via a floor
that happens to be tuned correctly today.

**Non-scan but same failure class (static imports, not walked directories):**
dozens of files `import ... from '../../../packs/riot/spells/<Name>'` for a
specific spell (e.g. `tests/game/combat/Reach.test.ts`, `ExecuteMarks.test.ts`,
`Pet.test.ts`, `Vision.test.ts`, `tests/game/spells/execute-stacks.test.ts`,
`stacks.test.ts`, `bonus-health-ultimates.test.ts`, `spell-hit-timing.test.ts`,
`attached-effects.test.ts`, plus every `tests/packs/riot/**` file, `tests/game/config/PregameConfig.test.ts:730`,
`tests/game/preset.mapSlots.test.ts:30-31`, `tests/game/structures/Turret.test.ts:14-16`,
`tests/game/monsters/Baron.test.ts:31,41`, `tests/game/map/real-map-sight.test.ts:18,23`,
`tests/game/nav/geometry.ts:3`, `tests/content/Recall.test.ts:22-23`,
`tests/content/laneTurretClearance.test.ts:27`, `tests/content/install.test.ts:15`,
`tests/scenes/pregameCatalog.test.ts:18`). These fail module resolution at
collection — loud, per-file — the moment the specific spell file is gone; not
included in the QUIET/LOUD table above because they are not directory scans.

---

## 2. Absolute population floors

| file:line | literal | counts what | actual now | survives the split? |
|---|---|---|---|---|
| `tests/content/rosterSource.test.ts:61` | `>150` | `.ts`/`.vue` files under `src/` (minus `content/install.ts`) | 214 | **Yes** — root is `src/`, untouched by the pack move. Comment (lines 44-51) already documents this exact "don't pin near the current count" discipline: "198 after task 6, 199 after task 7... 150 is comfortably below". |
| `tests/content/corePacksBoundary.test.ts:101` | `>20` | same `src/` .ts/.vue walk | 215 | **Yes** — same reasoning; comment explicitly calls out "not the current count (203)". |
| `tests/content/vocabularyBoundary.test.ts:148` | `>20` | `src/` .ts/.vue walk | 215 | **Yes**, same shape. |
| `tests/content/summonersRiftCoordinateBoundary.test.ts:114` | `>20` | `src/` .ts/.vue walk | 215 | **Yes**, same shape. |
| `tests/content/vocabularyBoundary.test.ts:144` | `>50` | champion names (from `packs/riot/spells`) + monster names (from `packs/riot/monsters`) + display variants | 65 (58 champions + 1 monster + 6 variants) | **No** — but moot: `readdirSync` on the missing `packs/riot/spells` throws (line 100-102, per §1 LOUD list) before this assertion is ever reached. The file's own doc comment (lines 75-80) already flags this as batch 5's job to fix. |
| `tests/content/coreSpellsApiSurface.test.ts:349` | `>50` | champion roster derived from `packs/riot/spells` + `coreSpells/` filenames | 58 | **No**, same moot-via-exception shape as above (readdirSync at line 310 throws first). Margin is thin (58 vs 50) even before that. |
| `tests/game/spells/unit-target-team-seam.test.ts:59` | `>10` | files under `packs/riot/spells` declaring `targeting: 'UNIT'` | 19 | **No** — moot; `readdirSync(SPELLS_DIR)` (line 50) throws first. |
| `tests/game/spells/target-vision-seam.test.ts:88` | `>15` | files touching `queryObjects` + a single-unit-pick pattern, across `packs/riot/spells` + `coreSpells/` | 26 | **No** — moot; readdirSync (line 43) throws first. |
| `tests/game/spells/buff-deactivate-seam.test.ts:59` | `>100` | `.ts` files across `spells`(→packs/riot), `coreSpells`, `spellObjects`, `buffs`, `attackableUnits` | 276 (240+1+4+24+7) | **No** — moot; without riot, remaining population is 36, and the scan crashes at collection (module-scope `flatMap`, line 55-57) before the assertion runs anyway. |
| `tests/game/spells/spell-object-display-box-seam.test.ts:139` | `>200` | count of `class X extends SpellObject` matches across `packs/riot/spells` + `src/.../spellObjects` | 274 | **No** — moot; readdirSync (line 133) throws first. Without riot the true population (spellObjects only) is far under 200 even if it didn't throw. |
| `tests/game/spells/terrain-field-seam.test.ts:117` | `>200` | `.ts` files across 5 roots, 2 of which are `packs/riot/*` (see §1) | 269 | **No**, and this is the one floor that actually *fires as designed*: fs layer is quiet (`existsSync` guard), population drops to 28, and `expect(scanned).toBeGreaterThan(200)` fails loudly. This is the floor doing its job. |
| `tests/content/packBoundary.test.ts:94` | `>0` | `.ts`/`.vue` files under `packs/` (parent — both packs) | 258 | **Yes, and that's the danger** — trivially survives at 7 (`packs/reference/` alone), silently certifying almost nothing. See §1 QUIET. |
| `tests/content/packAssetKeyBoundary.test.ts:74` | `>0` | same `packs/` parent walk | 258 | **Yes**, same danger as above. |

**Pattern**: every floor rooted at `src/` survives cleanly (four of them, all with
explicit "don't pin to the current count" comments — the discipline the task
description points at is already applied there). Every floor rooted at
`packs/riot/*` directly is moot, not false — the test errors out before the
number is ever compared. The two floors of `>0` rooted at the `packs/` *parent*
are the ones that are dangerous precisely because they're trivially satisfiable
by `packs/reference/` alone.

---

## 3. The literal `'riot'`

| file:line | what it decides | silent-wrong-pick risk? |
|---|---|---|
| `src/game/config/PregameConfig.ts:298` — `export const DEFAULT_MAP_ID = 'riot:summoners-rift';` | The match's default map id, restated because this module cannot import `PackRegistry` (doc comment, lines 286-297: avoids a chunk cycle). | Guarded — `tests/game/config/PregameConfig.test.ts:731` pins it against `qualify(BUNDLED_PACK_ID, summonersRift.id)`, so drift is caught **as long as the pack that provides `summonersRift` is still importable** by that test. |
| `src/game/config/spellCatalog.ts:114` — `const BUNDLED_PACK_PREFIX = 'riot:';` | Which qualified spell ids `bareCatalogId()` (line 132) treats as "the bundled pack's own" vs. foreign; restated for the same chunk-cycle reason (doc comment lines 101-112). | Guarded by `tests/game/config/spellCatalog.test.ts` per its own comment — but if the bundled pack's id ever changed *without* this literal moving with it, `bareCatalogId` would silently return `null` for genuinely-bundled ids instead of erroring (the failure mode the doc comment at lines 155-163 describes actually happening once, for `reference:Vera_Q`). |
| `tests/setup.ts:4,33` | Registers `packs/riot/generated/assetManifest.ts` under the pack id `'riot'` for **every** test in the suite (`AssetManager.registerPackAssets?.('riot', riotAssetManifest)`). | Hardcoded id string, not derived from the pack — see §5. |
| `tests/scenes/matchConfigChunk.test.ts:52` (`BANNED_MODULES` array entry `'packs/riot'`) | Which value-import specifiers are refused into the shared match-config panel chunk (matched by `specifier.includes(module)`, line 91). | **Yes, silently wrong** — this is a substring match against the literal `'packs/riot'`. If the bundled/default pack were ever a *different* pack (e.g. `packs/somethingelse`), a value import of that pack's runtime classes into the shared panel would not match any `BANNED_MODULES` entry and would sail through undetected — exactly the "the whole match rides along into the menu chunk" bug this list exists to catch, reintroduced under a name the list doesn't know. |
| `vite.config.ts:329,464,465` | Chunking rules: `/\/packs\/riot\/(pack\|data\|code)\.ts$/` → `'pregame'` chunk; `packs/riot/spells/Recall.ts` → `'game'` chunk; `/packs\/riot\/spells\/([A-Za-z0-9]+?)(?:_[QWER][0-9]*)?\.ts$/` → per-champion chunk. | Not a correctness risk — if the paths never match (pack gone or renamed), the rules are simply dead code; Rollup falls through to a default chunking. Silent, but degrades bundling, not behavior. |
| `scripts/generate-spell-catalog.mjs:87,115` (`PACK_SPELL_TREES.riot`), `scripts/generate-assets.mjs:174` (`PACK_ASSET_TREES.riot`) | Named registries keyed by tree name, selected via CLI `--tree=<name>`. | Not silent — these are explicit named lookups; a missing `packs/riot/spells` or `packs/riot/assets` directory throws (`readdirSync`/glob ENOENT) when `--tree=riot` is invoked, it does not fall through to a different tree. |
| `package.json:8,9,12,13,34` | `assets:generate:riot`, `assets:check:riot`, `catalog:generate:riot`, `catalog:check:riot` script names, and `verify` (line 34) runs `assets:check:riot` and `catalog:check:riot` unconditionally. | **Loud, not silent** — but severe: `npm run verify` (the CI gate) would fail outright the moment `packs/riot/assets` or `packs/riot/spells` stop resolving, unless these two steps are removed/repointed first. |
| `src/content/install.ts:11-13` | Static imports: `packs/riot/pack`, `packs/reference/pack`, `packs/riot/generated/assetManifest`. Doc comment (lines 47-51) states install order is deliberate: *"`riot` installs first: it is the game's own content... The reference pack follows."* | Not silent — see §4, this is the loudest failure of all (build-time). |

---

## 4. The default map

`DEFAULT_MAP_ID` is declared at `src/game/config/PregameConfig.ts:298` as
`'riot:summoners-rift'`. It is read at `src/game/config/PregameConfig.ts:413`
(`DEFAULT_PREGAME_CONFIG.mapId`) and `:604` (`sanitizePregameConfig`'s fallback
for an empty/invalid stored id), and seeds `MatchDirector.ts:199`
(`private _mapChoice: string = DEFAULT_MAP_ID`).

**At boot**, `src/scenes/GameScene.ts:227-249` (`startGame()`) resolves it:

```
const maps = contentCatalog().maps();
const mapSummary = maps.find(map => map.id === config.mapId) ?? maps[0];
if (!mapSummary) throw new Error('GameScene.startGame: no map installed');
```

By design (comment at lines 240-247) this is a **graceful, silent substitution**,
not a crash: an unresolvable `mapId` falls back to whichever map installs
first — it only throws if *zero* maps are installed anywhere (line 249), or if
the chosen map's geometry fails to load (line 269).

**But that fallback never gets exercised in the literal scenario this survey
asks about.** `src/content/install.ts:11-13` performs *static, relative-path*
imports of `packs/riot/pack` and `packs/riot/generated/assetManifest`. With
`packs/riot/` gone from the tree, those imports fail module resolution — Vite
cannot build, `npm run dev` cannot boot, and the entire app fails before
`GameScene`, `contentCatalog()`, or `DEFAULT_MAP_ID`'s fallback logic is ever
reached. This is the loudest possible failure: a build-time error, not a
runtime one, and it precedes every other finding in this report. Also note
`tests/setup.ts:4` does the exact same static import for the whole Vitest
suite (see §5) — so the test suite fails to even start for the identical
reason, before `GameScene`'s graceful fallback ever gets a chance to prove
itself in a test.

The graceful `maps[0]` fallback only matters once `install.ts` (and
`tests/setup.ts`) are rewritten to load packs dynamically/from a package
rather than a relative path — which is presumably the point of batch 5.

---

## 5. Test setup

`tests/setup.ts` (69 lines), Vitest's global setup file, runs before every
test file's own top-level code.

- **`tests/setup.ts:4`** — `import { assetManifest as riotAssetManifest } from '../packs/riot/generated/assetManifest';` — a static import. This is the single largest blast radius in the whole survey: if `packs/riot/` is gone, **this one line fails module resolution and the entire Vitest suite (all ~4200 tests, not just pack-related ones) fails to start**, because every test file's environment loads this file first.
- **`tests/setup.ts:5`** — `import { installSummonersRiftLanesForTests } from './game/lanesFixture';` — transitively the same failure: `tests/game/lanesFixture.ts:2` imports `summonersRiftGeometry` from `'../../packs/riot/maps/summonersRiftGeometry'`.
- **`tests/setup.ts:33`** — `AssetManager.registerPackAssets?.('riot', riotAssetManifest);` — registers the riot pack's 378-entry asset manifest globally under the literal pack id `'riot'`, so any spell test that constructs a real spell class via `makeX(buildContentApi())` without going through `install.ts`/`contentRegistry()` can still resolve `api.asset('spell_x')`. Depends entirely on the pack being present (see bullet 1).
- **`tests/setup.ts:69`** — `installSummonersRiftLanesForTests();` — installs Summoner's Rift's real lane waypoints as the *ambient default* for every test that reads `LANES`/`getLaneWaypoints` without constructing a real `Game` — most of the AI/minion suite. Depends on the pack (bullet 2).
- **Everything else in the file** — the `fastHypot` polyfill, the p5 global stubs (`deltaTime`, `lerp`, `constrain`, `random`, `floor`, `createVector` via `Object.assign(globalThis, ...)`) — is pack-independent.

Net: `tests/setup.ts` is a single point of failure for the *entire* test suite,
not just pack-related tests, and it fails at the loudest possible point
(module resolution, before a single test runs).

---

## 6. The e2e drivers

Scripts under `tests/e2e/` that pin a **specific** riot champion, spell, or map
by name (as opposed to the general boot dependency every script has via
`install.ts`, per §4):

| script | specific content required |
|---|---|
| `tests/e2e/drive-execute-taunt-terrain.mjs:32,107` + spell refs | champions Nasus, Garen; spells `Anivia_W`, `Annie_E`, `Annie_Q`, `Camille_E`, `ChoGath_R`, `Nasus_Q`, `Rammus_E`, `Rammus_W`, `Veigar_Q` |
| `tests/e2e/drive-hold-move-buff.mjs:30` | champion Ashe |
| `tests/e2e/drive-kit-builder.mjs:352-704` | champions Yasuo, Ahri, Zed; spells `Ahri_Q/W/E/R`, `Fizz_E`, `Graves_W`, `Lux_Q`, `Nasus_Q`, `Olaf_Q`, `Yasuo_Q/W/E/R`, `Zed_R` |
| `tests/e2e/drive-lux-beam-visibility.mjs:68,127` | champions Veigar, Lux; spell `Lux_R` |
| `tests/e2e/drive-practice-panel.mjs:99` | champion Veigar |
| `tests/e2e/drive-rammus-cancel.mjs:68` | dynamic in-browser `import('/packs/riot/spells/Rammus_Q.ts')` |
| `tests/e2e/drive-roster-stats.mjs:28` | champion Garen |
| `tests/e2e/shoot-new-champion-vfx.mjs:37,226` | champions Camille, Garen |
| `tests/e2e/smoke-new-champions.mjs:113,198` + spell ref | champions Darius, Garen; spell `Syndra_W` |
| `tests/e2e/verify-map-picker.mjs:83` | map id `'riot:summoners-rift'` |
| `tests/e2e/drive-new-spells.mjs:19` | HTTP readiness canary is literally `packs/riot/spells/Malphite_E.ts`; also casts `Anivia_E`, `Janna_W`, `Janna_E` |

**Contrast**: `tests/e2e/verify-pack-champion.mjs` deliberately depends on
`packs/reference/`'s "Vera" champion, not riot — it exists specifically to
prove the pack-boundary mechanism using the *other* pack, so it is unaffected
by riot's departure.

The remaining ~17 scripts (`drive-basic-attacks.mjs`, `drive-bugfixes.mjs`,
`drive-attached-effects.mjs`, `drive-bot-discipline.mjs`,
`drive-touch-controls.mjs`, `drive-mobile-hud.mjs`, `drive-minimap.mjs`,
`drive-size-aware-range.mjs`, `verify-nav-fix.mjs`, `verify-render-guard.mjs`,
`verify-touch-aiming.mjs`, `verify-viewport-scaling.mjs`, `hud-mana.mjs`,
`measure-frame-pacing.mjs`, `drive-game.mjs`, `verify-pwa-offline.mjs`) name no
specific champion/spell/map — but every one of them still needs *some* match to
boot at all, which today means `install.ts` succeeding, which today means
`packs/riot/` being present (§4).
