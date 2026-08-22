# Content pack extraction, batch 5 — the pack becomes a package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packs/riot/` becomes a real npm package that depends on core by name and builds with its own tooling, and core builds, boots and tests with that package absent — all inside this repository.

**Architecture:** Batch 4 moved the content. This batch cuts the last threads in both directions. Core stops value-importing a pack file (`Recall`) and stops spelling a public type from the pack's generated catalogue (`SpellCatalogId`). The pack gets a `package.json`, imports core as `@moba2d/core`, and runs its own asset, catalogue and seam checks. The proof is the last task: move `packs/riot/` aside and watch core still build, boot and pass.

**Tech Stack:** TypeScript, Vite 5, Vitest, npm workspaces, `moduleResolution: bundler`.

**Spec:** `docs/superpowers/specs/2026-08-20-content-pack-extraction-design.md` (this is spec §10 step 8's *preparation*; the physical repo split is deliberately not here).

**Surveys this plan is built on — read the one your task names, not both:**
- `docs/superpowers/surveys/2026-08-22-pack-package-boundary.md` — what crosses the boundary today
- `docs/superpowers/surveys/2026-08-22-pack-departure-breakage.md` — what breaks when the pack leaves

## Global Constraints

- **Core's package name is `@moba2d/core`.** Its bin is `moba2d-check-seams`. The riot pack's package name is `@moba2d/content-riot`; the reference pack's is `@moba2d/content-reference`. These exact strings, everywhere.
- **The player-facing name does not change in this batch.** The PWA manifest name, the `<title>`, the About screen and any in-game copy stay exactly as they are. Renaming the package is not renaming the game.
- **No repo split.** No `git init`, no new git remote, no `git filter-repo`, no publishing to any registry. The user has explicitly deferred that step. A task that finds itself wanting one has misread its brief.
- **`npm run verify` is green at every task boundary**, and every task reports its `Test Files` / `Tests` line.
- **No population floor may be an absolute literal.** Derive it from the tree, or express it as a ratio. Three batches have now had to lower one. A floor that reads `> 200` in a repo whose whole programme is moving files is a landmine.
- **Commit with explicit paths.** Never `git add -A`, never `.`, never a bare `git commit`.
- **Prettier:** several files predate `.prettierrc` and fail `--check` on `main`. Never run `--write` across a directory as a side effect. Hand-scope your formatting to lines you actually changed.
- **Every test must be shown to fail first.** Write it, run it, read the message, then implement. A source-scan test additionally needs its scanned population asserted non-empty, or it passes forever while checking nothing.
- Sessions end commits with `Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK`.

---

### Task 1: Recall comes home

**Why this is first.** `src/game/preset.ts:48` does `import makeRecall from '../../packs/riot/spells/Recall'` — a **value** import, at module scope, from the pack into core. It is the only one left, and it means core does not compile without the riot pack. Spec §10 step 1 said `BasicAttack` and `Recall` both come back to core as built-in mechanism; `BasicAttack` did (`src/game/gameObject/coreSpells/BasicAttack.ts`), `Recall` did not, and batch 4 swept it into the pack with the other 240.

Recall is core mechanism, not content: `CLAUDE.md` records that it is deliberately **not** in `spells[]` — it lives on `Champion.recall`, is bound to `B`, and an eighth kit slot would ripple through the loadout editor, the HUD and every persisted config. A champion that cannot go home is not a champion.

**Files:**
- Create: `src/game/gameObject/coreSpells/Recall.ts` (the 295 lines currently at `packs/riot/spells/Recall.ts`)
- Modify: `src/game/gameObject/coreSpells/index.ts`, `src/game/preset.ts` (line 48 and the comment block above it)
- Delete: `packs/riot/spells/Recall.ts`
- Test: `tests/content/corePacksBoundary.test.ts`, and any test naming Recall's old path

**Interfaces:**
- Consumes: `ContentApi`, `CastContext`, `CastSpec` — Recall's only two imports, both `import type`.
- Produces: core's `Recall` at `@/game/gameObject/coreSpells/Recall`, same factory signature as `BasicAttack`.

- [ ] **Step 1: Write the failing test first**

The rule is "no file under `src/` may value-import from `packs/`". `tests/content/corePacksBoundary.test.ts` already scans for the reverse direction and pins three files by name; today its allow-list carries `src/game/preset.ts`. Tighten it: **type-only** imports of `packs/` remain allowed for the two pinned sites, **value** imports are allowed nowhere.

Run it before you move anything. Expected: FAIL, naming `src/game/preset.ts` and its `makeRecall` import. Record the message in your report — that message is the reason this task exists.

- [ ] **Step 2: Move the file**

`git mv packs/riot/spells/Recall.ts src/game/gameObject/coreSpells/Recall.ts`. Its two imports are `@/content/ContentApi` and `@/content/types`; from `src/` those aliases still resolve, so the file body should need no change. If it needs one, say what and why in your report.

Follow `BasicAttack.ts`'s pattern exactly — read it first; it is the one precedent for a core spell and it is 8.5K, not 400 lines. Export it from `coreSpells/index.ts` the way `BasicAttack` is exported.

- [ ] **Step 3: Repoint `preset.ts` and rewrite its comment**

The comment block above line 48 explains why this file is allowed to name `packs/`. That reason is now gone. Replace it with what is actually true: Recall is core mechanism, resolved once at module scope because `buildContentApi()` is a cached singleton and the class never changes between champions.

- [ ] **Step 4: Check where Recall's art lives**

Recall may resolve asset keys. Core's manifest has 36 entries; the pack's has 378. If any key Recall reads belongs to the pack's tree, the image moves to `assets/` and both manifests are regenerated — a core spell resolving a pack asset key is exactly the `yasuo_q3.png` bug batch 4 turned into a scan (`tests/content/packAssetKeyBoundary.test.ts`), pointed the other way. Run `npm run assets:check && npm run assets:check:riot` and report both.

- [ ] **Step 5: Run the vocabulary scan and record the ruling**

Batch 4 Task 10 built a scan asserting core carries none of Riot's vocabulary. It may now flag `Recall` or the Vietnamese string `Hồi Thành`.

**Ruling, already made — do not re-litigate it.** Return-to-base is a genre-generic mechanic, not a champion, spell or map name; Dota calls it a Town Portal and half the genre has one. If the scan flags it, add it to the scan's allow-list **with that reason written in**, and do not rename anything. The player-facing string stays `Hồi Thành`.

- [ ] **Step 6: Verify and commit**

`npm run verify`. Report `Test Files` / `Tests`.

```bash
git add src/game/gameObject/coreSpells src/game/preset.ts tests/content packs/riot
git commit -m "refactor(content): bring Recall back into core as built-in mechanism

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 2: `SpellCatalogId` stops being spelled by the pack

**The coupling.** `src/game/config/spellCatalog.ts:7` imports `SpellCatalogId as PackSpellCatalogId` from `../../../packs/riot/generated/spellCatalog`, and line 22 declares core's public type as `PackSpellCatalogId | 'BasicAttack'`. So core's public id type is a union of the riot pack's 237 literals. When the pack leaves, that type has no members and every consumer's autocomplete becomes `'BasicAttack'`.

It is type-only, so it costs nothing at runtime — which is exactly why it has survived. It still has to go, because a content-free engine cannot have a public type whose members are one publisher's champion list.

**Measured surface: 22 occurrences across 5 files** — `src/generated/spellCatalog.ts`, `src/scenes/setup/pregameCatalog.ts`, `src/game/preset.ts`, `src/game/config/spellCatalog.ts`, `src/game/hud/config/PregameConfigSource.ts`. That is the whole blast radius. Read all five before writing anything.

**Files:**
- Modify: the five above; `tsconfig.strict-core.json`; `package.json` (one new script)
- Create: `tsconfig.pack-riot.json`
- Test: `tests/content/rosterSource.test.ts` (its allow-list shrinks), plus a new type-level assertion

- [ ] **Step 1: Decide nothing — measure what the union is actually load-bearing for**

Before changing the type, find out what it buys. For each of the 22 sites, answer in one line: does it need *the literal union* (exhaustiveness, a `Record<SpellCatalogId, X>` that must be complete, autocomplete in an editor), or does it only need *a distinct string type* (a parameter that must not be confused with a champion id)?

Write the 22 lines into your report. This measurement decides Step 2's shape, and it is the part the plan cannot do for you.

- [ ] **Step 2: Core declares its own**

Core's `SpellCatalogId` becomes a string type core owns, with no reach into any pack. The default shape, unless Step 1's measurement contradicts it:

```ts
/**
 * A spell's id, qualified `<packId>:<localId>` for pack content and bare for
 * core's own (`BasicAttack`).
 *
 * Deliberately not a literal union. Until batch 5 this was
 * `PackSpellCatalogId | 'BasicAttack'` — the riot pack's 237 generated
 * literals — which made a content-free engine's public type a list of one
 * publisher's champions. What the union bought was editor autocomplete in
 * five files; what it cost was that core did not typecheck without a
 * specific pack installed. Membership is a runtime question now, and
 * `contentCatalog()` is where it is asked.
 */
export type SpellCatalogId = string;
```

If Step 1 found a site that genuinely needs completeness over the installed catalogue, that site gets its answer from `contentCatalog()` at runtime, not from a type. Say in your report which site and how you resolved it.

- [ ] **Step 3: Run it and read what breaks**

`npm run typecheck && npm run typecheck:core`. A widened type turns some errors *off*, so the interesting output is what still fails and what silently stopped being checked. Report both.

- [ ] **Step 4: Core's strict typecheck stops including the pack**

`tsconfig.strict-core.json` currently has `"packs/**/*.ts"` in its `include`. Core's strict pass must not depend on content being present. Remove it — and in the same commit, add `tsconfig.pack-riot.json` so the pack's strict coverage never drops for even one task:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "strict": true },
  "include": ["src/types/**/*.d.ts", "packs/**/*.ts"]
}
```

plus `"typecheck:riot": "tsc -p tsconfig.pack-riot.json"` in `package.json`'s scripts, wired into `verify` immediately after `typecheck:core`.

**Prove the coverage did not drop**: count the files each config includes before and after (`tsc --listFiles -p <config> | wc -l`), and report the four numbers. Task 4 folds this script into the pack's own `package.json`; it exists here so there is no window without it.

- [ ] **Step 5: Verify and commit**

```bash
git add src tsconfig.strict-core.json tsconfig.pack-riot.json package.json tests
git commit -m "refactor(content): core's SpellCatalogId stops being spelled by the riot pack

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 3: Core is `@moba2d/core`, with a surface you have to mean to widen

**What this task is.** Core gets its real package identity and declares — in `exports` — exactly what a content pack may import from it. Nothing else about the app changes.

The measured answer to "what does a pack import from core" is small enough to read in one sitting: **three modules, ~870 lines, 350 import statements, all `import type`, zero value imports.**

| specifier | pack files importing it |
|---|---|
| `@/content/ContentApi` | 246 |
| `@/content/ContentPack` | 7 |
| `@/content/types` | 97 |

Plus `src/seams/` for the seam checker, which is tooling rather than content API.

**Files:**
- Modify: `package.json`
- Test: `tests/content/publicSurface.test.ts` (new)

- [ ] **Step 1: Write the failing test**

A test that reads `package.json`'s `exports` and asserts the public surface is exactly these four subpaths and no more: `./content/ContentApi`, `./content/ContentPack`, `./content/types`, `./seams`. Widening core's surface then has to be a deliberate edit to this list, with a reviewer looking at it.

Assert also that every target path in `exports` exists on disk — an `exports` map pointing at a moved file fails at install time in someone else's repo and never here.

Run it. Expected: FAIL, `exports` undefined.

- [ ] **Step 2: Name the package and declare the surface**

In `package.json`: `"name": "@moba2d/core"`, and

```json
  "exports": {
    "./content/ContentApi": "./src/content/ContentApi.ts",
    "./content/ContentPack": "./src/content/ContentPack.ts",
    "./content/types": "./src/content/types.ts",
    "./seams": "./src/seams/index.ts"
  },
  "bin": {
    "moba2d-check-seams": "./scripts/check-seams.mjs"
  }
```

Subpaths pointing at `.ts` source are correct here and not a shortcut: `moduleResolution` is `bundler`, the consumer is Vite, and the pack is a workspace sibling whose source Vite compiles anyway. There is no build step for core to publish and none is being added.

Three subpaths rather than one `./content` barrel is deliberate — it makes Task 4's codemod a prefix swap over 350 lines instead of a merge of three imports into one in 253 files.

- [ ] **Step 3: Make the bin actually executable**

`scripts/check-seams.mjs` needs a `#!/usr/bin/env node` shebang and the executable bit (`chmod +x`) or the `bin` entry is decoration. Task 4 creates the workspace link that puts the bin on `PATH`, and Task 6 is where the pack actually invokes it. Check the shebang and the mode now, and say so.

- [ ] **Step 4: Confirm nothing player-facing moved**

Grep the PWA manifest config, `index.html`'s `<title>`, and the About screen for the old name. Report each hit and confirm you left it alone. The package is `@moba2d/core`; the game is still called what it was called.

- [ ] **Step 5: Verify and commit**

```bash
git add package.json package-lock.json scripts/check-seams.mjs tests/content/publicSurface.test.ts
git commit -m "feat(content): core becomes @moba2d/core with a declared public surface

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 4: The pack is a package

**The change.** `packs/riot/` gets a `package.json`, the root becomes an npm workspace, and all 350 core-crossing imports in the pack move from core's internal `@/` alias to the package name. After this task the pack's source contains **no specifier that only resolves because it happens to sit inside core's repo**.

That is the whole point: `@/content/ContentApi` resolves only through an alias core declares in three config files. `@moba2d/core/content/ContentApi` resolves through node resolution, which is what will still be true after the split.

**Files:**
- Create: `packs/riot/package.json`, `packs/reference/package.json`
- Modify: root `package.json` (`workspaces`), every pack `.ts` file with a core import (Step 3's scan reports the exact count; expect 250+), `tests/content/packBoundary.test.ts`, `tsconfig.pack-riot.json`
- Test: `tests/content/packBoundary.test.ts`

- [ ] **Step 1: Write the two package manifests**

```json
{
  "name": "@moba2d/content-riot",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@moba2d/core": "*"
  }
}
```

`devDependencies`, not `dependencies`, and this is the single most important line in the file: the measurement says the pack's reach into core is **100% type-only**. At runtime a pack needs nothing of core — it is handed everything through the `ContentApi` object its factory receives. Write that reason into the file as a comment in the README beside it, since JSON cannot hold one.

`packs/reference/` gets the same shape as `@moba2d/content-reference`. It is core's own content and is not leaving, but it is the pack that exists to prove core ships content of its own, and it must be able to prove it under the same rules.

Scripts come in Tasks 5 and 6. Leave `scripts` out rather than writing entries that do not work yet.

- [ ] **Step 2: Make the root a workspace, and install**

Root `package.json` gains `"workspaces": ["packs/*"]`. Then `npm install`, which creates `node_modules/@moba2d/core` and `node_modules/@moba2d/content-riot` as symlinks.

Verify the links exist and point where you expect (`ls -l node_modules/@moba2d/`). Report what you saw. A workspace that silently did not link makes every step below pass for the wrong reason.

- [ ] **Step 3: Write the failing test**

`tests/content/packBoundary.test.ts` today greps pack files for reach into core using `@/`-shaped needles. Repoint it: a pack file may import `@moba2d/core/...` and may not import `@/...`, `src/...`, or any relative path climbing out of its own package.

Run it. Expected: FAIL, listing on the order of 350 imports across ~253 files. Record the count — Step 4 must end with the same number of imports rewritten, and any discrepancy is a file the codemod missed.

- [ ] **Step 4: The codemod**

A prefix swap, `@/content/` → `@moba2d/core/content/`, over `packs/**/*.ts`. Three source specifiers only; anything else the scan reports is a finding, not a case to add to the regex — report it.

Two traps this repo has already paid for, both from batch 4 Task 5:

- **`vi.mock('...')` is not an import statement** and a codemod matching `from '...'` will not see it. Grep the pack for `vi.mock` and any dynamic `import('...')` before you run, and report the counts.
- **Run the suite, do not merely typecheck.** A wrong specifier that still resolves through an alias typechecks fine and loads the wrong file.

- [ ] **Step 5: Prove all three resolvers agree**

Vite, Vitest and `tsc` resolve modules independently, and this repo declares `@/` in three separate places for exactly that reason. Prove each one resolves `@moba2d/core/content/ContentApi`:

- `tsc`: `npm run typecheck && npm run typecheck:riot`
- Vitest: the suite passes
- Vite: `npm run build` succeeds **and** the built output is unchanged in shape — run `npm run chunks:check` and report the pregame and game chunk sizes against the 225,000 ceiling.

The build one is not a formality. A workspace symlink resolved to a real path inside the project root gets Vite's full TS transform; resolved as an external dep it does not, and the failure looks like a bundling error a long way from here.

- [ ] **Step 6: Verify and commit**

```bash
git add package.json package-lock.json packs tests/content tsconfig.pack-riot.json
git commit -m "feat(content): packs become workspace packages importing @moba2d/core by name

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 5: The pack owns its generators

**Read `docs/superpowers/surveys/2026-08-22-pack-package-boundary.md` §4 first.** It measured both scripts and they are not the same problem.

`scripts/generate-assets.mjs --tree=riot` is a pure filesystem walk with **zero** core dependency — it needs its own path constants relocated and nothing else.

`scripts/generate-spell-catalog.mjs --tree=riot` is the real work. Despite the flag it is **not** self-contained: it always boots a Vite server against core's `vite.config.ts` and unconditionally SSR-loads `src/content/ContentApi.ts` and `src/managers/AssetManager.ts` by hardcoded path. It cannot run with the pack as its own root.

That is not an accident and the fix is not to inline copies. The catalogue is generated by **constructing every spell and reading its fields** — which requires a real `ContentApi`. The pack legitimately needs core's runtime for its build step even though it needs none of it at play time.

**Files:**
- Create: `packs/riot/scripts/generate-assets.mjs`. Where the *catalogue* generator ends up is Step 3's decision and deliberately not fixed here — do not create a pack-side copy of it before reading that step.
- Modify: `scripts/generate-assets.mjs`, `scripts/generate-spell-catalog.mjs`, root and pack `package.json`
- Test: whatever proves the generated files are byte-identical before and after

- [ ] **Step 1: Pin the output before you touch anything**

Copy the current `packs/riot/generated/assetManifest.ts` and `packs/riot/generated/spellCatalog.ts` somewhere outside the tree. Every step below is judged by one question: **do the regenerated files differ from these by a single byte?** They must not. Report the diff (expected: empty) after each generator moves.

This is the cheapest possible check on a build-tool refactor and it is the only one that can see a subtly reordered or truncated manifest.

- [ ] **Step 2: Move the asset generator**

The easy half. The pack's script walks the pack's `assets/` and writes the pack's `generated/assetManifest.ts`. Wire it as the pack's `assets:generate` / `assets:check`.

Core's own `scripts/generate-assets.mjs` keeps the `--tree` flag only if something still uses it; if the pack now owns its tree entirely, delete the flag and say so. A flag that no caller passes is a trap for the next reader.

- [ ] **Step 3: The catalogue generator, with core as a declared dependency**

The pack's `catalog:generate` runs core's generator against the pack's tree. Core owns the mechanism — it is the one that knows how to build a `ContentApi` and construct a spell — so it stays in core and is *invoked* by the pack, the same relationship `check-seams` has.

State in your report how the pack names it: through the workspace symlink (`node ../../node_modules/@moba2d/core/scripts/…`), through a second `bin` entry, or through a core-exported function. Pick one, say why, and make sure the answer still works when the pack is a sibling repository with core as a devDependency — that is the only version of the question that matters.

- [ ] **Step 4: Prove both are byte-identical, then verify and commit**

Diff against Step 1's pinned copies. Then `npm run verify` and report.

```bash
git add scripts packs package.json package-lock.json
git commit -m "build(content): the riot pack owns its asset and catalogue generation

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 6: The pack's own build goes red, not core's

Spec §8.1 is one sentence long and it is the whole task: *the rule lives with the engine that owns it, the population lives with the content, and a pack that violates a rule reddens **the pack's** build.*

Batch 4 built `src/seams/` — 13 pure `(root, options?) => SeamViolation[]` functions plus `checkSeams()` — and `scripts/check-seams.mjs` as a working CLI. Task 3 gave it a bin name. This task makes the pack run it on itself.

**Files:**
- Modify: `packs/riot/package.json`, `packs/reference/package.json`, root `package.json`
- Test: a test proving a planted violation fails the pack and not core

- [ ] **Step 1: Wire the pack's script**

`"check-seams": "moba2d-check-seams ./spells"` in the pack's `package.json`, run from the pack's own directory. npm puts workspace bins on `PATH`, so this is the form that will still be correct after the split — not a relative path into core's `scripts/`.

Run it. The expected output is **not** zero: batch 4 ran these against the real pack and got 17 violations, every one matching an already-known debt entry (the grandfathered sets, Annie_Q's press exemption, Blitzcrank_E's pinned `worldMouse` line). Those debt sets are the pack's, not core's — they must be passed in as options from the pack's side, and where they live is this step's decision. Report the count you get and reconcile it against 17.

- [ ] **Step 2: Prove the redness lands on the right build**

Plant one real violation in one pack spell — a direct `stats.mana` write, which `mana-spend` catches. Then run, in this order, and record all four outcomes:

1. the pack's `check-seams` — must FAIL, naming the file and line
2. core's `npm run verify` — must PASS, because core did not change
3. remove the violation
4. the pack's `check-seams` — must PASS again

Step 2 is the one that matters and the one that is easy to skip. If core's verify goes red on a pack's violation, the seam has not moved; it has been copied.

- [ ] **Step 3: `verify` splits in two**

Root `verify` becomes core-only. A new `verify:all` runs core's plus every workspace's. CI runs `verify:all`; Task 8 needs plain `verify` to pass with the pack absent.

Move `assets:check:riot`, `catalog:check:riot` and `typecheck:riot` out of `verify` and into the pack's own scripts, reached through `verify:all`. Task 2 put `typecheck:riot` into `verify` deliberately — it existed so the pack's strict coverage never dropped for even one task — and this step is where it moves to its real home. That is a relocation, not a correction. Report the final content of both scripts.

- [ ] **Step 4: Verify and commit**

Run `verify` and `verify:all`, report both.

```bash
git add package.json packs tests
git commit -m "test(content): the riot pack checks its own seams, and its own build goes red

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 7: The scans have to survive the pack's departure

**Read `docs/superpowers/surveys/2026-08-22-pack-departure-breakage.md` §1 and §2.** It measured this exactly and the finding is worse than a broken test — it is a test that keeps passing.

**Two QUIET scans.** Both are rooted at `packs/` and both silently drop from **258 files to 7** (`packs/reference/` alone) when the riot pack leaves. Their own `> 0` guards still pass. One of them is `tests/content/packBoundary.test.ts` — the rule the entire extraction rests on.

| file | lines | population now | after departure |
|---|---|---|---|
| `tests/content/packBoundary.test.ts` | 35, 49, 94 | 258 | 7, silently |
| `tests/content/packAssetKeyBoundary.test.ts` | 46, 53, 74 | 258 | 7, silently |

**Seven absolute floors** that do not survive — all of them moot rather than false, because a hardcoded `readdirSync` throws before the number is compared, except the last, where the floor is what fires:

| file:line | floor | actual now |
|---|---|---|
| `tests/content/vocabularyBoundary.test.ts:144` | > 50 | 65 |
| `tests/content/coreSpellsApiSurface.test.ts:349` | > 50 | 58 |
| `tests/game/spells/unit-target-team-seam.test.ts:59` | > 10 | 19 |
| `tests/game/spells/target-vision-seam.test.ts:88` | > 15 | 26 |
| `tests/game/spells/buff-deactivate-seam.test.ts:59` | > 100 | 276 |
| `tests/game/spells/spell-object-display-box-seam.test.ts:139` | > 200 | 274 |
| `tests/game/spells/terrain-field-seam.test.ts:117` | > 200 | 269 |

The survey records what each floor counts; read it rather than inferring from the name. Note also that Task 4 has already repointed `packBoundary.test.ts`'s *needles* — this task touches only its population and its floor.

- [ ] **Step 1: Make a missing root loud, everywhere**

A scan whose declared root does not exist must throw with a message naming the root. Not return `[]`, not skip. `terrain-field-seam.test.ts:66`'s `sourceFiles()` returns `[]` for a missing root *by design* — that design is the bug, and it is only caught today by a floor that happens to be high enough.

Write one shared helper and use it in every scan that names a root. Prove it: point a scan at a nonexistent directory, run it, read the message.

**A ruling you need before you write a line of this, because it is a real contradiction between this task and the next one.** Task 8 deliberately moves `packs/riot/` out of the tree and requires `npm run verify` to stay **green**. If "a declared root that is missing throws" means these scans hardcode `packs/riot` and throw when it is gone, this task makes Task 8 impossible.

The resolution — and it is the honest one, not a dodge: **a scan's roots are derived from the packs that are actually installed, and a root it derived must then exist.** The two questions are different and only one of them is a bug:

- *the riot pack is not installed* → there is no `packs/riot` root to scan, and the scan legitimately runs over what is there
- *the riot pack is installed and its root does not resolve* → loud failure, naming the root

Task 8 builds the installed-packs fact as a generated barrel. This task may land first, so derive the set the cheapest way that is still a real derivation (read the workspace globs, or the `packs/` listing), and leave a comment pointing at Task 8's barrel as the eventual single source. What is **not** acceptable is a hardcoded list of two pack directories, which is the thing that fails silently the day a third pack appears.

- [ ] **Step 2: Replace every absolute floor**

A floor must come from the tree, not from a literal. The two shapes that work:

- **Per-root**: assert each declared root independently contributed files. `packBoundary` scanning 7 files then reports "packs/riot contributed 0", which is the actual failure.
- **Ratio**: assert the scanned population against a count derived the same way at run time.

Nine files, from the two tables above. For each, say in your report which shape you used and why.

- [ ] **Step 3: Prove each one now fails**

For all nine: make the population empty (temporarily point the root elsewhere), run, read the failure, restore. Nine messages in your report.

This is the tedious step and it is the point. Batch 4 Task 9 did exactly this for fifteen seams and found that **two scans outside the listed fifteen were genuinely broken** — the two nobody had listed, because nobody looked at them. Expect the same here: while you are in these files, check whether any *other* scan in them shares the shape.

- [ ] **Step 4: Verify and commit**

```bash
git add tests
git commit -m "test(content): a scan whose root is missing now fails loudly, and no floor is a literal

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 8: Core builds, boots and tests with the pack moved aside

This is the batch's acceptance test. Everything before it is arrangement; this is the only task that proves the arrangement works.

**What breaks today, measured** (survey §c):

- `src/content/install.ts:11-13` statically imports `packs/riot/pack` and `packs/riot/generated/assetManifest`. With the directory gone this is a **module-resolution failure at build time** — before `vite dev` or `vite build` can start, and long before `GameScene.startGame()`'s graceful `DEFAULT_MAP_ID` fallback (`src/scenes/GameScene.ts:245-249`) could ever run.
- `tests/setup.ts:4-5` does the identical static import as Vitest's global setup, so the **entire ~4200-test suite fails to start**, not just the pack's tests.

**The ruling on mechanism, already made.** The riot pack becomes *optional* through a generated barrel — `src/generated/installedPacks.ts`, produced by a core script that reads which `@moba2d/content-*` packages are actually installed. This is the repo's own idiom (generated asset and catalogue manifests), it keeps `install.ts` static and synchronous, and it makes "which packs are installed" a build fact you can read in a file.

**Task 7 depends on this and will have guessed.** Task 7 makes a scan with a missing root fail loudly, and it derives its roots from the installed set precisely so that this task's drill does not turn it red. When you build the generated barrel here, check whether Task 7's derivation can now read it instead, and repoint it if so — two answers to "which packs exist" is how they drift.

**The reference pack stays a plain static import** and is not optional. It is core's own content, it never leaves, and it is the thing that makes core a complete game standing alone. If it were optional too, core with no packs would be a menu.

**Files:**
- Create: `src/generated/installedPacks.ts` (generated), its generator script
- Modify: `src/content/install.ts`, `tests/setup.ts`, `package.json`
- Test: the departure drill below

- [ ] **Step 1: Write the failing test — the drill itself**

The test is a procedure, and it must be runnable as one command because a procedure nobody runs is a paragraph. Something along the lines of `npm run verify:without-packs`:

1. move `packs/riot/` outside the tree (`mv`, not `rm` — never delete it)
2. `npm install` so the workspace link goes away
3. regenerate `installedPacks.ts`
4. `npm run verify` — core only
5. `npm run build`
6. restore, `npm install`, regenerate, verify again

Run it before you implement anything. Expected: FAIL at step 4 or 5, with a module-resolution error naming `packs/riot/pack`. Record it.

- [ ] **Step 2: Generate the barrel, and make `install.ts` read it**

`install.ts` is spec §9.1's one file that Stage 2 replaces, so keep its shape: a static array of factories. What changes is where the array's entries come from.

- [ ] **Step 3: `tests/setup.ts` reads the same barrel**

Same import, same source of truth. Two files answering "which packs exist" two different ways is how they drift.

- [ ] **Step 4: Run the drill for real, and report every number**

With the pack absent: does the game **boot**? Not just build — run one e2e driver against the pack-free build and confirm you reach a playable match on the reference pack's map. A build that succeeds and a menu that dead-ends is the failure this step exists to catch.

Report: the test count with the pack present, the test count with it absent, the build result both ways, and what the e2e driver saw.

- [ ] **Step 5: Verify and commit**

```bash
git add src/generated src/content/install.ts tests/setup.ts package.json scripts
git commit -m "feat(content): the riot pack is optional — core builds, boots and tests without it

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 9: The whole thing, and what the split still owes

- [ ] **Step 1: Full verify, both shapes**

`npm run verify`, `npm run verify:all`, `npm run chunks:check`. Report `Test Files` / `Tests` and the pregame and game chunk sizes against the 225,000 ceiling.

The chunk numbers matter more than usual here: Task 4 changed how every one of 240 spell files names its imports, and batch 4's headline result was cutting the chunk-hash cascade from 59/59 spell chunks re-downloading on a core edit to 0/59. Run `npm run e2e:chunk-cascade` and report it. If the cascade came back, this batch reintroduced a static import from a spell chunk into `game-*`, and that is a finding, not a footnote.

- [ ] **Step 2: Every e2e script, each with its numeric summary**

`e2e:pack`, `e2e:map-picker`, `e2e:bots`, `e2e:pwa`, `e2e:render`, `e2e:champions`, `e2e:attacks`, `e2e:hud`, and the touch drivers. Two do not use the shared harness and both must still pass: `drive-game.mjs` spawns its own Vite and honours `LOL2D_URL`/`LOL2D_PORT`; `verify-pwa-offline.mjs` serves the built `dist/` with the network cut.

Known flakes, not worth chasing: `drive-new-spells.mjs` (~1 in 4, `oScene` undefined during scene boot) and `drive-touch-controls.mjs` (rare freeze). A stray dev server on port 5173 makes both far likelier — check for one first.

Report each script's summary line. Do not read screenshots.

- [ ] **Step 3: Write the handover**

`docs/superpowers/plans/2026-08-22-content-pack-extraction-batch-5.md` gains a closing section, or a sibling note, answering exactly one question: **what is left to do when the user authorises the physical split?**

At minimum it must cover: which files move to the new repository and which stay; how the pack's `devDependencies` change from `"*"` to a git dependency; what `npm install` looks like for someone who clones core alone; whether `@types/node` travels with core (survey §7: only `tsconfig.json` includes `src/seams/`, so only `npm run typecheck` needs it, not `typecheck:core`); the fact that spec §1 already records — moving files does not remove them from git history, and a genuinely clean core needs `git filter-repo`, which is a separate decision nobody has made yet; and **the 64 pack test files still living at `tests/packs/riot/` in core's tree**, which this batch deliberately did not move because they are the pack's tests written against core's Vitest config, and deciding where they run is part of the split rather than part of the packaging.

Be specific and be short. This note is the brief for a session that has none of this context.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(content): batch 5 complete — what the repo split still owes

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

## Handover: what the physical split still owes

Batch 5 finished preparation, entirely inside one repository — no `git init`, no remote,
no history rewrite. This section is the brief for the session that does the actual split.
It answers one question: **what is left to do once the user authorises it?**

### Files that move, files that stay

**Moves to the new repository, as a unit:**
- `packs/riot/` (`@moba2d/content-riot`) — 239 spell `.ts` files, **378** image files (373
  `.png` + 5 `.gif`, `packs/riot/assets/images/spells/thresh_e{,2..5}.gif`; the note used to
  say 373, contradicting `scripts/verify-without-packs.mjs`'s own header, which says 378 three
  times), its own `package.json`, `tsconfig.json` and generator scripts. Confirmed by the
  drill: this is the only directory `scripts/verify-without-packs.mjs` ever relocates
  (`DEPARTING = ['riot']`).
- `tests/packs/riot/` — **69 test files today** (not 64; the number moved during this batch).
  They live in CORE's tree, not inside `packs/riot/`, because they're written against core's
  own `vitest.config.ts` / `tests/setup.ts`. Batch 5 deliberately left them here — task 9 is
  where that gets decided, not packaging. Whether they move with the pack (rewritten against
  its own test runner) or stay in core forever is the actual open question.
- `docs/abilities/<champion>/` — 54 champion directories of Riot Wiki ability data
  (`scripts/wiki/import-abilities.mjs`'s output). Lives at **core's repo root**, not under
  `packs/riot/`. Easy to miss with a plain `git mv packs/riot`.
- `assets/source-manifest.json` — 296 provenance rows, every `localPath` pointing at
  `packs/riot/assets/...`. Also at core's root, also entirely about Riot content, also
  outside `packs/riot/`. Since the whole-branch fix pass it is no longer an *asset*: it is
  in `scripts/generate-assets.mjs`'s `MANIFEST_EXCLUDED_FILES`, so it has no key in
  `src/generated/assetManifest.ts` and no longer travels in core's published tarball. It is
  still on disk here, still Riot's, and still has to move.
- `scripts/wiki/*.mjs` (`import-abilities.mjs`, `check-abilities.mjs`, `sync-spell-names.mjs`,
  `mediawiki.mjs`, `lua-data.mjs`, `normalize.mjs`) — the tooling that produces the two files
  above. Lives at core root; only meaningful with the riot pack present.

**Also Riot's, also at core's root, and missing from the first version of this list:**
- `docs/spell-names-vi.json` — the Data Dragon `vi_VN` cache `npm run names:sync` writes and
  `tests/game/spells/vi-spell-names.test.ts` reads offline. 11 KB of Riot spell names.
- `docs/all-champions.jpg` (149 KB) and `docs/Health_bar_guide.webp` — documentation art.

**Stays in core:**
- `packs/reference/` (`@moba2d/content-reference`) — never departs, not even in the drill.
  It is core's own content: `src/content/install.ts` imports it unconditionally, and it is
  what makes core "a complete game standing alone" rather than a menu (see the open question
  below). Since the whole-branch fix pass it is also **in `package.json`'s `files`**, so it
  travels in the published tarball — `install.ts`'s `'../../packs/reference/pack'` was a
  static import of a path the tarball did not contain. The asymmetry with riot (package name,
  through the generated barrel) is deliberate and is argued in
  `tests/content/corePackTarball.test.ts`.
- Everything else: `src/`, the generated barrels, `scripts/*.mjs` other than `scripts/wiki/`,
  and `tests/` minus `tests/packs/riot/`.

**But a third of the root scripts name the departing pack.** Nine `scripts/*.mjs` hard-code
`packs/riot` or `@moba2d/content-riot`: `check-chunks.mjs`, `check-seams.mjs`,
`installed-packs.mjs`, `generate-installed-packs.mjs`, `generate-spell-catalog.mjs`,
`generate-assets.mjs`, `pack-dependent-tests.mjs`, `new-spell.mjs`, `verify-without-packs.mjs`.
Most name it only as a *tree name* or in prose, and `installed-packs.mjs` is deliberately the
one derivation — but `new-spell.mjs` (which writes into `packs/riot/spells` and edits
`packs/riot/data.ts`) only functions with the pack present, and root `package.json` carries two
riot-only scripts reachable from neither `verify` nor `verify:all`, `assets:generate:riot`
(`node packs/riot/scripts/generate-assets.mjs`) and `catalog:generate:riot`, each duplicating
the pack's own script with a *different* invocation. All four are decisions the split has to
make.

**`npm run verify` itself loses a step at departure, not just `verify:all`.** `ability:check`
(`scripts/wiki/check-abilities.mjs`) runs over `docs/abilities/` and is the fourth entry in
plain `verify`. The note flags the consequence of departure for `verify:all` and was silent
about this one.

### `devDependencies`: `"*"` to a git dependency

Both `packs/riot/package.json` and `packs/reference/package.json` declare
`"@moba2d/core": "*"` today — resolvable only because npm workspaces link it locally
(`workspaces: [".", "packs/*"]` in the root `package.json`). Once `packs/riot/` is a separate
repository, that line has to become something npm can fetch on its own:
`"@moba2d/core": "github:<org>/<core-repo>#<tag-or-commit>"`, or a published npm version once
one exists. `packs/reference/` stays inside core's own workspace, so its manifest does not
need this change.

### `npm install` for someone who clones core alone

Today, root `npm install` links both packs via the `packs/*` workspace glob. After the split,
a bare clone of core has no `packs/` directory beyond `packs/reference/` (which travels with
core) — `npm install` still succeeds, because core has no hard runtime dependency on the riot
pack. What changes: `src/generated/installedPacks.ts` regenerates with `installedPackNames`
naming only `[reference]` — and the `installedPacks` **array**, which is what `install.ts`
reads, empty, since `CORE_OWN` deliberately filters the reference pack out of it;
`verify` runs the pack-absent shape by default (154 files / 1579 tests + 9 skipped, measured
at the whole-branch fix pass; it was 161 / 1632 before that pass removed seven test files that
duplicated `check-seams`), and `verify:all` — which reaches into `packs/riot/` explicitly for
its pack-specific checks — has nothing to run against and needs its own guard, or removal
from a core-alone `package.json`.

### `@types/node`

`@types/node` (root `devDependencies`) is needed by every program that reaches `src/seams/`,
whose modules import `node:fs` / `node:path`. `tsconfig.json` (`npm run typecheck`, i.e.
`vue-tsc --noEmit`) has always reached it through `include: ["src/**/*"]`. **The whole-branch
fix pass added `src/seams/**/*.ts` and `tests/seams/**/*.ts` to `tsconfig.strict-core.json`
as well** — the review measured `tsc --listFiles` for all three programs and found zero files
under `tests/seams/`, i.e. 900 lines of this batch's own seam tests that nothing typechecked,
with a duplicate import in one clause sitting there to prove it. So `typecheck:core` needs
`@types/node` too now, and no core repo can drop it. Whether a split-off core keeps the
broader `vue-tsc` check or narrows to `typecheck:core` is still a scoping call, not a
technical blocker.

**There is a third tsconfig, and it is `verify:all`-only:**
`tsconfig.strict-core-boundary.json` (`npm run typecheck:pack-boundary`). Its six include
roots are core's own test files that import pack spells by relative path, so it structurally
cannot pass with the pack absent — which is why it is out of plain `verify`. A session reading
"only `tsconfig.json` … `typecheck:core`" would not know it exists.

### Moving files does not clean git history

Spec §1 already says this, and it is worth restating so nobody re-discovers it mid-split:
moving a file does not remove it from git history. Every Riot asset this repo has ever held
is in every commit that ever touched it. A `git mv packs/riot new-repo/` (or a `git subtree
split`, or a fresh orphan commit) leaves a "core" repository whose `.git` still contains every
Riot image and spell file ever committed — retrievable with `git log -p` by anyone who clones
it. A genuinely IP-clean core needs `git filter-repo` run against core's own history, which
rewrites every commit SHA and breaks every existing clone, tag and PR reference downstream.
That is a separate, disruptive decision nobody has made yet — flag it to the user explicitly
before touching history, do not fold it into "the split."

### The 131-file exclusion list, and its one hand-maintained corner

`scripts/pack-dependent-tests.mjs` derives which of core's own `tests/` files cannot run
without an absent pack, three ways: (1) an import — static or deferred — of an absent pack,
followed transitively through local helpers; (2) living under `tests/packs/<pack>/`; (3)
`PACK_CONTENT_FIXTURE_TESTS` — **nine hand-listed entries**, for tests that depend on pack
*content* without ever naming the pack in a way an import scan can see (six lane tests
reading Summoner's Rift coordinates out of `LANES`, plus `cc-buff-icons.test.ts`,
`vi-spell-names.test.ts` and `generateSpellCatalog.siblingRepo.test.ts`, which `readFileSync`/
`readdirSync` pack files by path). Each of the nine is checked to exist at config-load time
and throws by name if a path rots.

With riot absent and reference present — the real departure condition, since reference never
leaves — the derived list is **131 files** (reconfirmed live this session via
`packDependentTests(root, ['reference'])`, matching where task 8's fix round landed). It is
provably **0** in an ordinary checkout with both packs installed, and a test asserts that
emptiness directly.

This is the one place a human must keep a list in step by hand, and **the split is exactly
when it stops being maintainable in this form**: once `packs/riot/` is a separate repository,
the 69 files under `tests/packs/riot/` plus the 62 entries elsewhere either move with it
(rewritten against its own test runner) or stay in core and require the nine-entry list to
keep growing by hand indefinitely. Deciding which is part of executing the split, not a
prerequisite to it — but whoever does it should budget time for exactly this decision, because
it touches 131 files, not a handful.

Those 62 are **not** all `.test.ts`, and the note used to say they were
"(`tests/game/`, `tests/scenes/`, `tests/content/`)", which omitted the second-largest bucket.
Measured: `tests/game` 47, **`tests/e2e` 10**, `tests/content` 2, `tests/scenes` 1,
`tests/scripts` 1, `tests/wiki` 1. The ten under `tests/e2e/` are Playwright `.mjs` drivers,
a different disposition problem from a Vitest file — only **118 of the 131** are `.test.ts`
at all.

### The open product question spec §8.2 leans on

Core alone ships **no summoner spells** — `D` and `F` fall back to `BasicAttack`
(`SpellHotKeys` in `src/game/constants.ts`; summoner spells are Riot content and live only in
`packs/riot/`). So "a complete game standing alone," the claim spec §8.2 uses to justify
shipping the reference pack unconditionally, is today: one champion (Vera), four abilities,
one map (Proving Grounds), zero summoner spells.
`tests/e2e/verify-core-alone.mjs` proves that much boots and is genuinely playable — **13/13**
checks (the note said 12; the script has thirteen unconditional `check(` calls and has had one
commit and none since, so it was never 12), confirmed both with riot present and with riot
absent. Whether that is
"complete enough" to ship core as a standalone product, or whether core needs its own
summoner-spell pair before that claim holds, is a product decision for the user to make. It
is not a defect this batch found and left unfixed.

### Two pre-existing e2e failures — not this batch's, and not swept under it

Task 9's full sweep found two scripts failing on re-run (each run twice, identically both
times — the standard for treating a failure as real rather than the documented flakes). Both
were checked against `git diff --stat 04d4946..HEAD` (this batch's whole range) and against
`git log 04d4946..HEAD` for the driver script and the source it exercises. Neither the script
nor the underlying game code appears anywhere in that range. **They are not this batch's bug
and were left alone**, exactly as instructed, so the next session inherits a fact instead of a
rumour:

- **`tests/e2e/drive-touch-controls.mjs`** fails two checks:
  - `a short UNIT drag releases the nearest auto-lock and selects along the aim ray` — a short
    eastward drag after a tap-target auto-lock keeps the *nearest* target instead of releasing
    to the *intended* one along the drag's aim ray.
  - `dragging back onto the button spends nothing` — dragging a spell gesture back onto its
    own button (the cancel gesture) spawns one object where zero is expected.
  - Exercises `src/game/input/TouchControls.ts`. Not touched by this batch.
- **`tests/e2e/drive-lux-beam-visibility.mjs`** fails one check:
  - `the caster was unrendered for the whole cast (visibleToPlayerTeam false, Champion.draw at
    zero)` — an off-camera, out-of-vision caster's `visibleToPlayerTeam` flag reads `true` for
    the whole cast when it should read `false`; `Champion.draw` correctly never runs
    (`casterDraws=0` both times), so only the flag itself is wrong, not the render skip it's
    supposed to describe.
  - Exercises `src/game/gameObject/map/FogOfWar.ts`. Not touched by this batch.

### Fix round 1 — `verify-pwa-offline.mjs`'s precache floor stopped being a literal

The one item the coordinator asked for after this handover note first shipped:
`tests/e2e/verify-pwa-offline.mjs`'s `check('precache is populated', cached > 200, ...)` was
exactly the class of bug this batch's own Global Constraints forbid — *"No population floor
may be an absolute literal... A floor that reads `> 200` in a repo whose whole programme is
moving files is a landmine."* Task 7 swept that class out of the Vitest scans; it never reached
this e2e script, so `200` survived and failed every pack-free run at 57-65 entries.

Fixed by deriving the expectation from the build's own output: `declaredPrecacheCount()` reads
`dist/sw.js`'s own precache manifest and counts **distinct** URLs. The dedup is not
cosmetic — the manifest deterministically lists `manifest.webmanifest` and all seven
`favicon/*` icons twice (the asset glob and the PWA icon list both find them), in both build
shapes, and `CacheStorage` collapses a duplicate URL to one entry at runtime. The check is now
`cached === expectedPrecache`, an exact match, non-vacuous in both directions because
`expectedPrecache` is read from the static manifest while `cached` is measured from the live
service worker's actual `CacheStorage` — a genuine precache failure moves one without moving
the other. Proven both ways, both shapes:

| Build | Before falsification | After deleting real cache entries |
|---|---|---|
| pack-present | `467 of 467 declared entries cached` — PASS | deleted 12 → `455 of 467` — FAIL |
| pack-free | `57 of 57 declared entries cached` — PASS | deleted 5 → `52 of 57` — FAIL |

`npm run verify` stayed green at 279 files / 3807 tests after the change. The whole-branch
fix pass that followed moved that to **272 files / 3755 tests** (seven test files removed as
duplicates of `check-seams`, four tests added by the new tarball and sibling-repo properties),
and the pack-free shape to **154 / 1579 + 9 skipped**. `verify-pwa-offline.mjs`'s exact-match
check is derived from each build's own manifest, so it needed no edit for that.
