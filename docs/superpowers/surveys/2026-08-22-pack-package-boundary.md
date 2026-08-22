# Survey: what crosses the core/pack boundary today

Worktree: `/Users/hoangtran/Desktop/Github/LOL2D-batch5`. All counts below are from commands run against this tree on 2026-08-22 (see each section). Nothing was modified.

Pack inventory for scale: `packs/riot/` has 251 `.ts` files (240 in `spells/`, 2 `vfx/`, 1 `monsters/`, 2 `maps/`, 3 top-level `pack.ts`/`code.ts`/`data.ts`) plus 378 files under `assets/`. `packs/reference/` has 7 `.ts` files. `tests/packs/riot/**/*.test.ts` has 68 files (none live inside `packs/` itself).

---

## 1. Pack → core

**Method**: parsed every `import`/`export …from`/dynamic-`import()` statement in all 258 `.ts` files under `packs/` (251 in `packs/riot/`, 7 in `packs/reference/`) with a regex that spans multi-line clauses, classified each specifier as core-resolving (`@/…`, or a relative path whose normalized target climbs outside `packs/`, or a bare `src/…`), and classified each core-resolving statement as type-only vs value.

- **Total import/export/dynamic-import statements in `packs/`**: 1,288.
- **Statements resolving into core**: **350**. All 350 are plain `import` statements (0 `export … from`, 0 dynamic `import()`).
- **All 350 are type-only** — either `import type { … }` or `import { type X, type Y }` where every named member carries `type`. Grep-verified independently: `import type` count anywhere in `packs/` is 352 (350 of them target `@/…`, the other 2 are pack-internal `import type … from './generated/spellCatalog'`); the 62 non-type `import {` statements in `packs/` include **zero** that target `@/`.
- **Zero value imports of core from any pack file.** Zero relative imports climb out of `packs/` into `src/` (`grep -c` for `from '../.../src/'`-style patterns under `packs/` = 0). Zero bare `src/...` specifiers.
- **Distinct core module specifiers: 3**, all under `@/content/`:

  | specifier | files importing it | class |
  |---|---|---|
  | `@/content/ContentApi` | 246 | type-only |
  | `@/content/ContentPack` | 7 | type-only |
  | `@/content/types` | 97 | type-only |

  (350 statements = 246+7+97, one import statement per file per module — no file imports the same module twice.)

- **252 of the 258 pack files** (251 riot + 7 reference) import at least one of the three; 154 import exactly one, 98 import exactly two, none import all three. 6 pack files (all in `packs/riot/`, e.g. `generated/*.ts`, `code.ts`) import no core module at all.
- **By pack**: `packs/riot/` accounts for 342 of the 350 statements; `packs/reference/` accounts for 8 (`packs/reference/map.ts:1`, `provingGroundsGeometry.ts:1`, `pack.ts:1-2`, and each of the four `Vera_*.ts` spell files at line 1).
- **This is an enforced rule, not an accident**: `tests/content/packBoundary.test.ts` scans every pack file and fails on any specifier other than `@/content/ContentApi`, `@/content/ContentPack`, `@/content/types`, and fails unless each is `import type`. My independent scan's numbers match the rule's shape exactly.

**Bottom line for the package boundary**: pack → core reach is 3 type-only modules, ~870 lines total (`src/content/ContentApi.ts` 337, `ContentPack.ts` 436, `types.ts` 97) that erase completely at runtime. Splitting `packs/riot` into its own package needs these three files' *type* shapes available at build time (a `.d.ts` or a workspace dependency on `@lol2d/core`'s types) and nothing at runtime.

---

## 2. Core → pack

**Method**: `grep -rn "packs/"` over `src/`, `tests/`, `scripts/`, and every config file, excluding matches inside `packs/` itself and inside `node_modules`/`.git`/`dist`. Raw hits: 1,009 lines across ~190 files (most of that is doc-comment prose, not code — CLAUDE.md-style long comments narrate the batch-4 migration throughout `src/content/*.ts`, `vite.config.ts`, `src/game/preset.ts`, etc.). Below are the lines that are **actual code** (imports, chunk rules, path config, glob includes), grouped by file; comment-only mentions are noted in aggregate at the end of each group.

### `src/` (real imports/config, 5 statements total — this is the entire enumerated exception list, and it is itself tested)

- `src/content/install.ts:12` — `import riotCode, { data as riotData, BUNDLED_PACK_ID } from '../../packs/riot/pack'` (value import; pack loader).
- `src/content/install.ts:13` — `import referenceCode, { data as referenceData } from '../../packs/reference/pack'` (value import; pack loader).
- `src/content/install.ts:14` — `import { assetManifest as riotAssetManifest } from '../../packs/riot/generated/assetManifest'` (value import; registers the pack's asset manifest).
- `src/game/preset.ts:48` — `import makeRecall from '../../packs/riot/spells/Recall'` (value import; `Recall` is built eagerly for every champion, ahead of the async spell registry).
- `src/game/config/spellCatalog.ts:7` — `import type { SpellCatalogId as PackSpellCatalogId } from '../../../packs/riot/generated/spellCatalog'` (type-only; feeds core's own `SpellCatalogId` union — see Q6).

`tests/content/corePacksBoundary.test.ts:39-53` enumerates exactly these three files as the only permitted exceptions (`install.ts` exempted whole-file; `preset.ts` and `config/spellCatalog.ts` each pinned to one named specifier) and scans all of `src/` to enforce it — so this list is not just what I found, it is what the codebase asserts is the complete list.

### `vite.config.ts` (6 code lines; ~30 more are doc-comment prose explaining the chunking rationale, not counted as crossings)

- `vite.config.ts:329` — `if (/\/packs\/riot\/(pack|data|code)\.ts$/.test(id)) return 'pregame';` — chunk rule.
- `vite.config.ts:370` and `:375` — regex `/\/(?:src\/content\/maps|packs\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?)\/([A-Za-z0-9]+)Geometry\.ts$/` — chunk rule naming per-map geometry chunks, matches any `packs/<name>/…Geometry.ts`.
- `vite.config.ts:380` — `if (id.includes('/src/content/') || id.includes('/packs/reference/')) return 'pregame';` — chunk rule.
- `vite.config.ts:464` — `if (id.endsWith('packs/riot/spells/Recall.ts')) return 'game';` — chunk rule (carve-out ahead of the regex below).
- `vite.config.ts:465` — `const spell = /packs\/riot\/spells\/([A-Za-z0-9]+?)(?:_[QWER][0-9]*)?\.ts$/.exec(id);` — chunk rule, one chunk per champion.

### `tsconfig.strict-core.json`
- `tsconfig.strict-core.json:30` — `"packs/**/*.ts",` in the `include` array — pulls all of `packs/` into the strict typecheck.

### `tsconfig.json` / `vitest.config.ts` / `package.json`
- No direct `packs/` string in any of the three. `tsconfig.json`'s `include` is `["src/**/*"]` only (does not reach `packs/`). `vitest.config.ts` has no pack-specific glob (relies on Vitest's default `**/*.{test,spec}.*` picking up `tests/packs/riot/**/*.test.ts` and `tests/content/*.test.ts` automatically). `package.json` has no literal `"packs"` string, but 4 script names encode the pack indirectly via `--tree=riot`: `assets:generate:riot`, `assets:check:riot`, `catalog:generate:riot`, `catalog:check:riot` — the last two run inside `verify`.

### `scripts/` (real code, not comments)
- `scripts/new-spell.mjs:39` — `const SPELLS_DIR = join(ROOT, 'packs/riot/spells');` — hardcoded output directory for the spell scaffolder.
- `scripts/new-spell.mjs:47` — `const CATALOG_FILE = join(ROOT, 'packs/riot/data.ts');` — hardcoded roster file it edits.
- `scripts/new-spell.mjs:474` — generated spell file's own import line template targets `../../../packs/riot/spells/${slug}`.
- `scripts/wiki/import-abilities.mjs:187,257` — hardcoded output paths `packs/riot/assets/images/champions/…` / `.../spells/…`.
- `scripts/wiki/import-abilities.mjs:333` — checks `packs/riot/generated/assetManifest.ts` for staleness.
- `scripts/generate-assets.mjs:175-176` — `PACK_ASSET_TREES.riot = { assetsDir: 'packs/riot/assets', outputPath: 'packs/riot/generated/assetManifest.ts', … }` (see Q4).
- `scripts/generate-spell-catalog.mjs:88-89,93,115-117` — `PACK_SPELL_TREES.riot` (see Q4).
- `scripts/check-seams.mjs` — no `packs/` literal in the script itself (it takes a target root as a CLI arg); its own doc comment (`:9-10,18`) uses `packs/riot/spells` as the worked example.
- `scripts/check-chunks.mjs:122-135` — doc-comment only, no code line names `packs/`.
- `scripts/migrations/2026-08-batch4-task3-spell-factories/{transform,run-all,fix-tests}.mjs` — one-time, already-run migration scripts with `packs/riot/` in path constants; not part of the live boundary.

### `tests/` (~190 files, ~950 of the 1,009 raw hits)
This is overwhelmingly the boundary's *test coverage*, not incidental leakage:
- **`tests/content/*.test.ts` (22 files)** are the boundary contract itself — `corePacksBoundary.test.ts` (core→pack allow-list, 14 refs), `packBoundary.test.ts` (pack→core allow-list), `rosterSource.test.ts` ("core's own generated spell barrel has exactly one legitimate reader"), `vocabularyBoundary.test.ts` ("core carries none of Riot's vocabulary"), `summonersRiftCoordinateBoundary.test.ts`, `packAssetKeyBoundary.test.ts`, `contentApiChunk.test.ts` ("the data half of the pack contract"), `coreSpellsApiSurface.test.ts`, `install.test.ts`, `packRegistry.test.ts`, `laneTurretClearance.test.ts`, `referenceMap.test.ts`, `referencePackVeraQ.test.ts`, `Recall.test.ts`.
- **`tests/packs/riot/**/*.test.ts` (68 files)** each import one pack spell/module directly by relative path (e.g. `tests/packs/riot/spells/Katarina.test.ts:1` imports `../../../../packs/riot/spells/Katarina`) to unit-test its behaviour — one `packs/riot/…` import per file, occasionally two (a spell plus a fixture).
- **`tests/game/**/*.test.ts` (~70 files)** — general engine tests that happen to use a real pack spell as a concrete example (e.g. `tests/game/spells/representative-spells.test.ts`, `tests/game/combat/Reach.test.ts`, `tests/game/spellRegistry.test.ts` which imports both `src/generated/spellCatalog` and `packs/riot/generated/spellCatalog` to diff them).
- **`tests/scenes/*.test.ts` (3 files)** — chunk-boundary tests (`matchConfigChunk.test.ts`, `pregameBootPath.test.ts`, `pregameCatalog.test.ts`) asserting the Vite `manualChunks` rules in vite.config.ts:329-465 above.
- **`tests/scripts/generateSpellCatalog.{tree,barrelGuardRule}.test.ts`** — test the `--tree=riot` generator path directly (Q4).
- **`tests/wiki/import-abilities.test.ts` (23 refs)** — tests that the wiki importer writes/reads `packs/riot/assets/…` and `packs/riot/generated/assetManifest.ts` correctly, alongside the core equivalents.
- **`tests/setup.ts:4`** — global test setup imports `../packs/riot/generated/assetManifest` to register pack assets for every test run.

### `assets/source-manifest.json` (296 refs — data, not code)
Not an import boundary at all: a provenance manifest (`schemaVersion`, `sources[]`) written by `scripts/wiki/import-abilities.mjs`, each entry a `{contentHash, fetchedAt, localAssetKey, localPath, revisionId, sourceUrl}` record. 296 of its entries have `localPath` starting with `packs/riot/assets/...` — plain JSON string data describing where an asset was written, not a module specifier.

---

## 3. The alias

`@/` is resolved in **3 separate places**, all mapping to `./src`, and none of them touch `packs/`:

1. `tsconfig.json:14` — `"@/*": ["./src/*"]` under `compilerOptions.paths` (type-checking / IDE).
2. `vite.config.ts:121` — `'@': resolve(__dirname, 'src')` under `resolve.alias` (dev server / build).
3. `vitest.config.ts:15` — `resolve: { alias: { '@': resolve(__dirname, 'src') } }` (test runner; Vitest does not read `vite.config.ts`, per that file's own comment at `vitest.config.ts:7-13`, so this is a genuine second declaration of the same mapping, not a re-export).

**`packs/` has no alias of its own anywhere** — grep for any `@packs`/`packs/*`-style path mapping across `vite.config.ts`, `tsconfig.json`, `tsconfig.strict-core.json`, `vitest.config.ts`, `package.json` found nothing. Every reference into `packs/` — from core, from tests, from within `packs/` itself — is a relative path (`../../packs/riot/pack`, `./generated/spellCatalog`, etc.), never an alias.

---

## 4. The generator scripts

### `scripts/generate-assets.mjs`
- `root` is computed once, at the top of the CLI branch (`:229`), as `resolve(dirname(scriptPath), '..')` — the script's own **grandparent directory**, not `process.cwd()`.
- `--tree=riot` looks up `PACK_ASSET_TREES.riot` (`:173-180`), a **hardcoded literal**: `{ assetsDir: 'packs/riot/assets', outputPath: 'packs/riot/generated/assetManifest.ts', keyPrefix: '', regenerateCommand: 'npm run assets:generate:riot' }`. Nothing is derived from an environment variable, CLI arg, or discovered directory — the string `packs/riot/` is written into the script.
- The only thing genuinely *derived* is `importPrefixFor()` (`:190-194`): how many `../` segments the generated file needs to reach `root`, computed from `tree.outputPath`'s depth — this is why the pack's generated file can have 3 levels of `../` and core's has 2, without a second hardcoded constant.
- With `--tree=riot`, `generate()` never touches `src/` or `assets/` (core's tree) at all — it only reads under `resolve(root, 'packs/riot/assets')` and writes `resolve(root, 'packs/riot/generated/assetManifest.ts')`.
- **Could it run with the pack as CWD and no core sibling?** CWD is irrelevant to it either way (root comes from `scriptPath`, not `cwd()`). What's required is that the *script itself* keeps living at `<root>/scripts/generate-assets.mjs` and that `<root>/packs/riot/assets/` exists — i.e., the `packs/riot/` nesting has to be preserved verbatim one level under wherever the script sits. If the pack became a standalone repo whose own root *is* what's today `packs/riot/` (assets at `<pack-root>/assets/`, not `<pack-root>/packs/riot/assets/`), the hardcoded `PACK_ASSET_TREES.riot.assetsDir`/`outputPath` strings would need editing — that's the one hardcoded thing standing between this script and true tree-relocatability. Otherwise it has **no other core dependency**: no Vite, no `src/` import, no network.

### `scripts/generate-spell-catalog.mjs`
- Same `root` derivation (`:51`).
- `--tree=riot` selects `PACK_SPELL_TREES.riot` (`:86-118`), again hardcoded literals: `outputPath: 'packs/riot/generated/spellCatalog.ts'`, `modulesOutputPath: 'packs/riot/generated/spellModules.ts'`, `barrels: [{ path: 'packs/riot/spells/index.ts', importBase: '../spells' }]`, plus `packId: 'riot'` and `assetManifestOutputPath: 'packs/riot/generated/assetManifest.ts'`.
- **This one is not tree-isolated at runtime.** `renderSpellCatalogSource()` (`:166-216`) always boots a Vite dev server with `root` and `configFile: resolve(root, 'vite.config.ts')` (`:167-173`) — i.e. it always loads *core's* `vite.config.ts`, regardless of `--tree`. For a pack-factory tree it also unconditionally SSR-loads two **hardcoded core paths**: `server.ssrLoadModule('/src/content/ContentApi.ts')` (`:188`, to build the real `ContentApi` every factory is called with) and `server.ssrLoadModule('/src/managers/AssetManager.ts')` (`:197`, to register the pack's asset manifest into `AssetManager` before any spell's field initializer runs and needs `api.asset(...)` to resolve).
- **Could it run with the pack as CWD and no core sibling? No.** Even with `--tree=riot`, it hard-requires `<root>/vite.config.ts`, `<root>/src/content/ContentApi.ts`, and `<root>/src/managers/AssetManager.ts` to exist and be loadable — there is no code path that skips them for a pack tree. This is the sharpest concrete blocker in the whole survey for "pack builds independently of core."

### `scripts/check-seams.mjs`
- `repoRoot` again derived from `scriptPath` (`:28`), and `createServer` again pins `configFile: resolve(repoRoot, 'vite.config.ts')` and SSR-loads `'/src/seams/index.ts'` (`:40`) — both hardcoded to *this* repo, unconditionally.
- Its own doc comment (`:1-10`) is explicit about the intended shape: `targetRoot` (the directory to scan for seam violations) is a free CLI argument — `node scripts/check-seams.mjs ./packs/riot/spells` — so the script is *designed* to check an arbitrary external tree. But the checker code itself (`checkSeams`, `src/seams/index.ts`) and the Vite config used to load it always come from core. The doc comment even says the future shape explicitly: "a pack ... runs it as `node <path-to-core>/scripts/check-seams.mjs <root>`" — i.e. the acknowledged design is that this script stays a **core-side tool invoked against a pack**, not a script that ships inside the pack and runs standalone. So: it can check *any* target, but it cannot itself run without core present.

---

## 5. The pack's generated files

`packs/riot/generated/` holds exactly 3 files, all headed `// Generated by scripts/…. Do not edit.`:

| file | size | generated by |
|---|---|---|
| `assetManifest.ts` | 72.8K (756 lines, one `import …png?url` + manifest entry per asset) | `generate-assets.mjs --tree=riot` |
| `spellCatalog.ts` | 117.0K | `generate-spell-catalog.mjs --tree=riot` |
| `spellModules.ts` | 12.0K | `generate-spell-catalog.mjs --tree=riot` |

Note: `assetManifest.ts`'s own per-asset import lines read `../../../packs/riot/assets/images/....png?url` (e.g. `:2`) — three `../` computed by `importPrefixFor()` back to repo root, then straight back down into `packs/riot/assets/`. This is a real relative-import round-trip through the repo root, not a reach into `src/`; flagged in Q1's methodology as a false positive for "climbs out of packs" and excluded from that count (it never leaves `packs/riot/` conceptually, it's just written path-from-root).

**Importers outside `packs/`, by generated file:**

- **`assetManifest.ts`**
  - `tests/setup.ts:4` — `import { assetManifest as riotAssetManifest } from '../packs/riot/generated/assetManifest'` (value; global test bootstrap).
  - `src/content/install.ts:14` — value import (Q2).
  - `scripts/generate-spell-catalog.mjs:116` — path config only (`assetManifestOutputPath`), not an import.
  - `vite.config.ts:187` — chunk rule matches on `id.includes('generated/assetManifest')` (matches both core's and the pack's copy — no `packs/` literal at this line, it's a suffix match).
- **`spellCatalog.ts`**
  - `src/game/config/spellCatalog.ts:7` — type-only import of `SpellCatalogId` (Q2, Q6).
  - `tests/game/spellRegistry.test.ts:36` and `tests/game/config/spellCatalog.test.ts:55` — value imports, diffing pack vs. core catalogues in tests.
- **`spellModules.ts`**
  - `tests/game/spellRegistry.test.ts:35` and `tests/packs/riot/pack.test.ts:5` — value imports, tests only. **No file under `src/` imports `spellModules.ts` from the pack** — `packs/riot/code.ts:3` imports its own copy (`./generated/spellModules`) and hands the dynamic loaders to core only indirectly, through the pack's `ContentPackFactory` return value (data, not a specifier core resolves).

Within `packs/riot/` itself, `data.ts:8-9` imports both `SpellCatalogId` (type) and `spellCatalog` (value) from `./generated/spellCatalog`, and `code.ts:3` imports `spellModules` from `./generated/spellModules` — the pack consumes its own generated output the same way core consumes its.

---

## 6. `SpellCatalogId`

There are **two separate declarations** of a type named `SpellCatalogId`, both produced by the same generator template (`render()` in `scripts/generate-spell-catalog.mjs:271`: `export type SpellCatalogId = keyof typeof spellCatalog;`), one per tree:

- **`packs/riot/generated/spellCatalog.ts`** — its own `SpellCatalogId`, keys of the pack's 240-entry `spellCatalog` object.
- **`src/generated/spellCatalog.ts:47`** — core's own `SpellCatalogId`, keys of core's `spellCatalog` (which, per `CORE_SPELL_TREE.barrels` at `generate-spell-catalog.mjs:76-78`, contains exactly one entry: `'BasicAttack'`).

**The public, consumed type is a third declaration** that unions the two: **`src/game/config/spellCatalog.ts:22`**:
```
export type SpellCatalogId = PackSpellCatalogId | 'BasicAttack';
```
where `PackSpellCatalogId` is the pack's generated type, imported type-only at `src/game/config/spellCatalog.ts:7` from `../../../packs/riot/generated/spellCatalog` — **so yes, core's public `SpellCatalogId` is built directly from the pack's generated catalogue**, by name, with no abstraction in between. The file's own doc comment (`:12-21`) states this is deliberately the *one* file allowed to do so, and `tests/content/rosterSource.test.ts` ("core's own generated spell barrel has exactly one legitimate reader") plus `tests/content/corePacksBoundary.test.ts:52` (`'game/config/spellCatalog.ts': ['../../../packs/riot/generated/spellCatalog']`) enforce that no other file in `src/` may import it.

**Every consumer of the public `SpellCatalogId` in `src/`** (excluding its own declaration site and the unrelated core-local `src/generated/spellCatalog.ts:47`):
- `src/game/preset.ts:26` — `type SpellCatalogId` imported from `./config/spellCatalog`; used at `preset.ts:358` to validate a `SlotChoice` against the known id set.
- `src/scenes/setup/pregameCatalog.ts:112` — referenced only in a comment explaining a deliberate `Set<string>` widening, not a live type annotation.
- No other `src/` file imports the name directly; `src/game/hud/config/PregameConfigSource.ts:52,251` uses the sibling helper `isSpellCatalogId()` from the same module instead of the type itself.

---

## 7. Node types

`src/seams/shared.ts:1-2` is the only file under `src/seams/` (16 files total) using Node builtins: `import { readdirSync, readFileSync } from 'node:fs';` and `import { join } from 'node:path';`. `src/seams/index.ts` and the other 14 files in the directory are plain TS with no `node:` imports.

**Two tsconfig files exist; only one includes `src/seams/`:**

- **`tsconfig.json:17`** — `"include": ["src/**/*"]`, with `"exclude": ["node_modules", "testzone", "tools", "dist"]` (`:18`) — no carve-out for `seams`, so this glob covers `src/seams/**` including `shared.ts`. `npm run typecheck` (`vue-tsc --noEmit`, package.json:30, no `-p` flag → defaults to this file) is the command that actually typechecks it.
- **`tsconfig.strict-core.json`** extends `tsconfig.json` (`:2`) but **replaces** `include` with its own explicit file list (`:6-33`) — TypeScript does not merge a child's `include` with its parent's, it overrides it. That list names specific files/globs under `src/game/spell`, `src/game/combat`, a few `src/game/input/*.ts` files, `src/game/gameObject/**`, `packs/**/*.ts` (`:30`), `src/game/managers/*`, `src/game/vfx/**`, `src/generated/**`, `src/managers/AssetManager.ts`, and matching `tests/**` — **`src/seams/` is not in this list**, and none of the files that are (verified by grepping all of them for `from 'node:` — zero hits) import any Node builtin. So `npm run typecheck:core` (`tsc -p tsconfig.strict-core.json`, package.json:31) never typechecks `src/seams/` at all.

Neither config sets `compilerOptions.types`, so both TypeScript programs auto-include every package under `node_modules/@types` (ambient global augmentation is program-wide, not file-scoped) — `@types/node` (`^22.20.1`, devDependency) is therefore ambiently visible to both `typecheck` and `typecheck:core` regardless of which files each actually includes. The practical dependency is narrower than that: **only `npm run typecheck` needs `@types/node`'s `node:fs`/`node:path` module typings to resolve**, because `src/seams/shared.ts` is only reachable through `tsconfig.json`'s broad include, not through `tsconfig.strict-core.json`'s explicit one. If core shed `@types/node` as a "browser-only" package, `typecheck:core` would keep passing untouched and `typecheck` would break on `src/seams/shared.ts:1-2`.
