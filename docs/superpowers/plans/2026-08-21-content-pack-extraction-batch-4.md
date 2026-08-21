# Content Pack Extraction — Batch 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file that carries Riot's names, art or numbers lives in `packs/riot/`, and core is a game that ships its own content.

**Architecture:** Three batches built the seam and made everything consume it. Nothing has moved yet — that was deliberate, so a wiring defect and a move defect could never be confused in one diff. This batch is the move: 240 spell files, 378 art files, ~63 champion-named test files, the Summoner's Rift map, and the two vfx modules whose filenames are champion names. `src/content/bundledPack.ts` — scaffolding with a death date written into its own header since batch 2 — is deleted and replaced by a real `packs/riot/pack.ts`.

The consumption path does not change. That is the whole point of having done it first.

**Tech Stack:** TypeScript, Vite, Vitest (`environment: 'node'`), Playwright via `tests/e2e/harness.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-20-content-pack-extraction-design.md` — steps 6 and 7. Step 8 (splitting `packs/riot/` into its own repository) is batch 5 and deliberately out of scope.

**Branch:** `content-pack-batch-4`, based on `content-pack-batch-3`.

## Global Constraints

- **Do not merge to `main`.** Pushing this branch is expected — the user is testing batches 3 and 4 together.
- **`npm run verify` green at the end of every task.** Baseline: **260 test files, 4143 tests, 0 failures.** `verify` is `assets:check` + `catalog:check` + `ability:check` + `typecheck` + `typecheck:core` + tests + `build` + `chunks:check`. Read it cheaply: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`.
- **`npm run chunks:check` green, and the ceiling does not move** (`PREGAME_SIZE_CEILING_BYTES = 225_000`; pregame is at ~213,400 with under 12 KB of headroom). Batch 3 raised it twice and then put it back; this batch moves 240 spells, so if anything is going to breach it, it is this one. **A breach is a finding to report, not a number to edit.**
- **Every test must be shown to fail first.** Batch 3 shipped three near-vacuous tests past their own task reviews; the whole-branch review caught them.
- **`Array.prototype.filter` cannot narrow types** here. Plain loops, never casts.
- **p5 global mode.** `pop`, `text`, `fill`, `line`, `point`, `random`, `map`, `scale`, `rotate`, `image`, `color` are globals; a local of the same name silently shadows one and `tsc` cannot see it.
- **Concurrent agents share this repository.** Commit with explicit paths — never `git add -A`, never `.`, never a bare `git commit`.
- **Prettier** (2 spaces, single quotes, 100 columns). Format only files you touched; several predate it and fail `--check`.
- **Spell names are Riot's** — `'<tên tiếng Việt> (Champion_Slot)'`, checked offline against `docs/spell-names-vi.json` by `vi-spell-names.test.ts`. Moving a file must not change a name.
- Known pre-existing flake in `tests/game/spellRegistry.test.ts` (random champion draw). Re-run rather than chase it.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK`.

## What batch 3 handed over, in its own words

Four items, from the whole-branch review. Tasks below own them; they are listed here so nobody rediscovers them.

1. **A map's faction ids are now positional** — `factions[0]` → BLUE, `factions[1]` → RED. That was a HIGH severity fix: before it, the second map's fountains healed nobody and no wave ever spawned, and every test passed because none of them asserted that a match *runs*.
2. **Summoner's Rift's data still lives in `src/game/`** — `lanes.ts`'s `DEFAULT_LANE_WAYPOINTS` and `mapPresets.ts`'s `NEUTRAL_SLOTS` — and `src/content/maps/summonersRiftGeometry.ts` reaches back into the engine for them. Moving the map out means splitting `lanes.ts` into the live binding (core) and SR's waypoints (the pack).
3. **The ceiling is a backstop, not the guard.** Half of batch 3's pregame growth was one generated file relocating. Keep the pack's `data` and `code` in genuinely separate files.
4. **`src/content/maps/summonersRiftGeometry.ts` statically imports the `game` chunk.** Harmless while geometry is only loaded from `startGame`, but it means a future picker thumbnail would pull 268 KB, and no guard would see it.

## Rulings already made (do not re-litigate)

1. **A file move and a behaviour change never share a commit.** If moving a file requires changing it beyond import specifiers, that change is its own commit with its own reason.
2. **The 63 champion-named test files move with the content.** A test of `Camille_R` is as much Riot content as `Camille_R.ts`. The ~27 generic and seam tests stay in core.
3. **`packs/riot/` is one directory in this repository for now.** Batch 5 extracts it. Do not add a `package.json`, a workspace entry or a `tsconfig` for it here — that is batch 5's shape decision and doing it early would force it.
4. **The pack's own generated files are the pack's.** `assets:generate` and `catalog:generate` grow a notion of which tree they are generating for; core keeps generating its own ~11 assets and generic buff icons.

## File Structure

| Path | What |
|---|---|
| `packs/riot/pack.ts` | The pack. Data half and code half in separate files, per handover item 3. |
| `packs/riot/spells/` | 240 spell files. |
| `packs/riot/spellObjects/`, `packs/riot/vfx/` | The 4 spell objects and the two champion-named vfx modules. |
| `packs/riot/maps/` | Summoner's Rift, summary and geometry. |
| `packs/riot/assets/` | 378 art files. |
| `packs/riot/generated/` | The pack's own asset manifest and spell catalogue. |
| `tests/packs/riot/` | The 63 champion-named test files. |
| `src/content/bundledPack.ts` | **Deleted.** |
| `src/game/gameObject/spells/`, `src/game/vfx/{LuxBeamEffect,DariusAxe}.ts` | **Deleted.** |
| `packages/core-seams/` or `src/seams/` | The exportable seam rules — Task 9 decides which. |

---

### Task 1: `packs/riot/` exists, and the generators know a pack tree from core's

Nothing moves in this task. It builds the destination and teaches the two generators that there is more than one tree to generate for, so that every later task is a move rather than a move plus a build-system change.

`scripts/generate-assets.mjs` walks `assets/` and writes `src/generated/assetManifest.ts` with a typed `AssetKey` union; `assets:check` fails the build when the two drift. `scripts/generate-spell-catalog.mjs` builds `src/generated/spellCatalog.ts` (display data) and `spellModules.ts` (dynamic imports) by loading the barrels through Vite's SSR. Both currently assume one tree at a fixed path.

**Files:**
- Create: `packs/riot/` with an empty `spells/`, `assets/`, `generated/`
- Modify: `scripts/generate-assets.mjs`, `scripts/generate-spell-catalog.mjs`, `package.json`
- Test: `tests/assets/generate-assets.test.ts`, `tests/scripts/` (whatever covers the catalogue generator)

**Interfaces:**
- Produces: both generators take a tree argument (source dir, output file, key prefix) and default to core's, so every existing invocation is unchanged. New npm scripts generate the pack's.

- [ ] **Step 1: Read both generators end to end before changing either.**

They are 6 KB and 12 KB. `generate-spell-catalog.mjs` in particular does something subtle: it builds `coreIds` by parsing `coreSpells/index.ts` separately from `spells/index.ts`, because it needs to know which directory an id names, and it says in its own comments that this is parsed rather than imported for a reason. Understand that before you generalise it.

- [ ] **Step 2: Write the failing test**

The generator tests exist. Extend them so that generating for a **second tree** produces a manifest for that tree and leaves core's untouched. Assert against the real directories, not fixtures — this project's own lesson is that a test which repeats a transcription agrees with it.

- [ ] **Step 3: Generalise, with core's invocation unchanged**

A default argument, not a rewrite. `npm run assets:check` and `npm run catalog:check` must keep passing byte-identically on core's tree; if either generated file changes at all in this task, that is a bug in the generalisation, not an improvement.

- [ ] **Step 4: Verify and commit**

Run `npm run verify`. Confirm `git diff --stat src/generated/` is **empty**.

```bash
git add packs/riot scripts package.json tests
git commit -m "build(content): teach the generators there is more than one content tree

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 2: The three files in core whose names are Riot's

`src/game/vfx/LuxBeamEffect.ts` and `src/game/vfx/DariusAxe.ts` are two of the exactly three files in core whose names are Riot's. Batch 2's whole-branch review flagged them as an Important finding and deferred them here, with a sharp observation: `ContentApi` now **exports** them (`vfx.LuxBeamEffect`, `vfx.drawAxeArc`, `vfx.drawDariusAxe`), and `contentApi-surface-seam.test.ts` **enforces their presence** — so the seam that exists to keep core's surface clean is currently requiring the opposite.

**The third is `src/game/gameObject/monsters/Baron.ts`**, and it is not just a name: it exports `BARON_ABILITIES`, real behaviour that `preset.ts:15` imports and merges onto the monster definition. `ContentPack.ts:187` and `bundledPack.ts:155` both carry comments explaining that merge. So this task moves all three, and Baron is the one with actual wiring to unpick — a monster's abilities have to reach it from the pack rather than from a core import.

This task is first among the moves because it exercises the whole path — move a file into the pack, take it off the injected surface, fix the seam that required it — at a scale where a mistake is obvious.

**Files:**
- Create: `packs/riot/vfx/LuxBeamEffect.ts`, `packs/riot/vfx/DariusAxe.ts`, `packs/riot/monsters/Baron.ts`
- Delete: `src/game/vfx/LuxBeamEffect.ts`, `src/game/vfx/DariusAxe.ts`, `src/game/gameObject/monsters/Baron.ts`
- Modify: `src/content/ContentApi.ts`, `src/game/preset.ts`, `src/content/ContentPack.ts`, `tests/content/contentApi-surface-seam.test.ts`
- Modify: the spell files that import them (find them; do not guess)

**Interfaces:**
- Produces: `ContentApi.vfx` no longer carries `LuxBeamEffect`, `drawAxeArc` or `drawDariusAxe`. The pack's spells import them relatively, from inside the pack.

- [ ] **Step 1: Find every importer, and read one of them**

These are drawing helpers. A pack's spell can import a sibling module inside the same pack freely — `packBoundary.test.ts` only restricts what a pack imports **from core**. Confirm that reading is right before relying on it.

- [ ] **Step 2: Write the failing seam assertion**

`contentApi-surface-seam.test.ts` derives its required symbol set from the real spell tree, which is why it currently demands these three. Invert the specific case: assert that `ContentApi.vfx` does **not** carry a champion-named symbol. State the rule in a form that catches the next one — a name matching a champion in the roster, not a hard-coded list of three.

Run it. Expected: FAIL, naming all three.

- [ ] **Step 3: Move, and take them off the api**

- [ ] **Step 4: Verify and commit**

`npm run verify`, and confirm **zero** files under `src/` have a Riot name. Task 10's vocabulary scan will assert that for the whole tree; this task is where the three known ones go.

`BARON_ABILITIES` is the interesting half: `preset.ts` merges it onto the monster definition today because `MonsterDef` carries data and abilities are code. Batch 3's `MonsterDef` split bodies out into `members`; decide whether abilities ride there or arrive through the pack's code half, and say which and why. This is the first monster whose behaviour comes from a pack, so whatever you choose is the pattern.

```bash
git add packs/riot/vfx src/game/vfx src/content/ContentApi.ts tests/content src/game/gameObject/spells
git commit -m "refactor(content): move the champion-named vfx modules into the pack

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 3: The spells move

240 files from `src/game/gameObject/spells/` and 4 from `src/game/gameObject/spellObjects/` into `packs/riot/`. This is the largest mechanical change in the whole extraction, and it is mechanical **only because three batches made it so**: a pack spell imports `@/content/types` as a type and receives everything else as an argument.

**That is also the property to verify rather than assume.** Before moving anything, measure what the 240 files actually import from core today. Any import that is not a type is a spell reaching past the seam, and each one is a decision — does the symbol belong on `ContentApi`, or was the spell doing something it should not?

**Files:**
- Create: `packs/riot/spells/` (240), `packs/riot/spellObjects/` (4)
- Delete: the originals
- Modify: `src/game/spellRegistry.ts`'s generated inputs, `vite.config.ts`
- Test: `tests/content/packBoundary.test.ts` (its population grows by 244 files)

- [ ] **Step 1: Measure the import surface first, and report it**

Produce the table: every distinct `@/`-prefixed specifier the 240 files import, how many files import it, and whether it is type-only. **Put it in your report.** If everything is type-only or already on `ContentApi`, say so and the move is mechanical. If not, the exceptions are the real content of this task and each needs a named decision.

- [ ] **Step 2: Write the failing boundary assertion**

`packBoundary.test.ts` restricts `packs/**` to `@/content/ContentApi`, `@/content/ContentPack` and `@/content/types`, type-only. It will scan 244 more files after the move. Run it against the moved tree **before** fixing the imports, and record how many offenders it names — that number is the measurement Step 1 predicted, and if they disagree, Step 1 was wrong.

- [ ] **Step 3: Move, and rewrite the imports**

A codemod, not 240 hand edits. Keep it in the commit so a reviewer can see the transformation rather than only its output.

- [ ] **Step 4: Re-point the catalogue generator at the pack tree**

`spellModules.ts` and `spellCatalog.ts` are generated from the barrels. After the move the barrels are the pack's. Task 1 gave the generator a tree argument; use it.

- [ ] **Step 5: Chunking**

`vite.config.ts` carves per-champion spell chunks by path. That path just changed. `chunks:check` asserts 59 of them and is the guard — if the count moves, say why before changing the expectation.

- [ ] **Step 6: Verify and commit**

`npm run verify`, `npm run chunks:check`, and report the pregame/game sizes. This is the task most likely to breach the ceiling.

```bash
git add packs/riot src/game/gameObject vite.config.ts src/generated tests scripts
git commit -m "refactor(content): move the 240 spells into packs/riot

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 4: The art moves, and a pack resolves its own asset keys

378 of the 415 files under `assets/` are champion portraits, spell icons and monster art. `PackManifest` has no `assets` field despite spec §4 promising one, and `ContentApi.asset` is `AssetManager.get(key as never)` with no pack base — batch 2's whole-branch review named both.

**Files:**
- Create: `packs/riot/assets/`, `packs/riot/generated/assetManifest.ts`
- Modify: `src/content/ContentPack.ts`, `src/content/ContentApi.ts`, `src/managers/AssetManager.ts`
- Modify: `src/game/config/packAsset.ts` (the leaf batch 2 extracted)
- Test: `tests/assets/*`, `tests/content/*`

**Interfaces:**
- Produces: `PackManifest.assets` names the pack's asset base; `ContentApi.asset(key)` resolves against the calling pack's base rather than core's flat namespace.

- [ ] **Step 1: Decide how a pack's key is namespaced, and write that down first**

Core's keys are a generated union (`champ_yasuo`, `spell_ahri_q`). A pack's are its own. Two keys from two packs can collide. Say how the resolver disambiguates before writing it, and put the reasoning in the doc comment — this is the same question `qualify()` answered for spells and monsters, and the answer should look like that one rather than invent a second convention.

- [ ] **Step 2: Write the failing test**

Two packs declaring the same local asset key must resolve to different files. That is the case that proves namespacing, and it does not exist today because only one pack has art.

- [ ] **Step 3: Move the art and regenerate both manifests**

`assets:check` fails the build when a manifest and its tree drift, which makes it the guard for this task. Core's manifest should shrink to ~37 entries; the pack's should hold 378.

- [ ] **Step 4: Verify, and check the PWA precache**

`npm run verify`, then `npm run e2e:pwa`. Moving 378 files changes what the service worker precaches, and the first offline launch is exactly what that script exists to prove. Report its result and the precache entry count.

```bash
git add packs/riot assets src/content src/managers src/game/config/packAsset.ts src/generated tests
git commit -m "refactor(content): move the art into packs/riot and namespace a pack's asset keys

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 5: The champion-named tests move

`tests/game/spells/` holds about 90 files. Roughly 63 are named for a champion — `Camille.test.ts`, `Veigar_R.test.ts`, `Ahri_palette.test.ts` — and they test Riot content. They are content. The remaining ~27 are the seam scans and the generic behaviour tests (`aoe-display-bounds`, `cancel-policy`, `cooldowns`, `mana-spend-seam`, `range-preview`, `representative-spells`, `spell-hit-timing`, `stacks`, and the rest), and those stay in core.

The split is not always obvious. `representative-spells.test.ts` is a generic test that *names* specific spells; `ahri-palette.test.ts` sounds champion-specific but may be enforcing a palette rule that applies to everyone. **Read each one you are unsure about rather than sorting by filename**, and put the borderline calls in your report with a sentence each.

**Files:**
- Create: `tests/packs/riot/`
- Move: the champion-named tests
- Modify: `vitest.config.ts` if its include patterns need it

- [ ] **Step 1: Classify, and report the classification before moving**

A table: every file, and content or core, and for the borderline ones, why. This is the deliverable of the task as much as the move is — a wrong call here puts a core rule in a repository that is about to leave.

- [ ] **Step 2: Move, and fix the import paths**

- [ ] **Step 3: Verify**

`npm run verify`. The test count must not change — **a moved test that stops running is the failure mode here**, and a total that stays the same is the only thing that proves it did not happen. If the count moves at all, find out why before committing.

```bash
git add tests packs vitest.config.ts
git commit -m "test(content): move the champion-named tests into the pack's tree

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 6: Summoner's Rift moves, and `lanes.ts` splits

Batch 3's handover item 2: SR's data still lives in core. `lanes.ts` holds `DEFAULT_LANE_WAYPOINTS`, `mapPresets.ts` holds `NEUTRAL_SLOTS`, and `src/content/maps/summonersRiftGeometry.ts` reaches back into the engine for both.

`lanes.ts` splits in two: **the live binding** (`LANES`, `setActiveLanes`, `clearActiveLanes`, `getLaneWaypoints`, `nextWaypointIndexFrom` — core, because they are the mechanism) and **Summoner's Rift's waypoints** (the pack, because they are that map's shape).

**Files:**
- Create: `packs/riot/maps/summonersRift.ts`, `packs/riot/maps/summonersRiftGeometry.ts`
- Delete: `src/content/maps/`, `src/game/mapPresets.ts`
- Modify: `src/game/lanes.ts`

- [ ] **Step 1: Write the failing boundary test**

After this task, **core must contain no Summoner's Rift coordinate at all.** That is a scan: no file under `src/` may contain the map's fountain or turret coordinates. Write it, run it, and record which files it names — that list is your work item.

- [ ] **Step 2: Split `lanes.ts`**

Task 8 of batch 3 left `setActiveLanes` throwing if a previous match's lanes are still installed, cleared from `Game.destroy()`. That guard is core's and stays. What moves is only the SR literal.

- [ ] **Step 3: Fix the static import batch 3 flagged**

Handover item 4: the SR geometry chunk statically imports the `game` chunk, for `DEFAULT_LANE_WAYPOINTS` and `Lane`. After the split there is nothing to reach back for. Verify by building and reading the emitted chunk's imports, not by reading the source.

- [ ] **Step 4: Verify and commit**

`npm run verify`, `npm run e2e:map-picker` (both maps must still load and play), and report the chunk sizes.

```bash
git add packs/riot/maps src/content src/game/lanes.ts src/game/mapPresets.ts tests
git commit -m "refactor(map): Summoner's Rift moves into the pack; lanes.ts keeps only the mechanism

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 7: The adapter dies

`src/content/bundledPack.ts` has carried a death sentence in its own header since batch 2: *scaffolding with a date on it*. Everything it adapted now lives in `packs/riot/`. Replace it with a real `packs/riot/pack.ts` whose data and code halves are in **separate files** (batch 3 handover item 3 — half of that batch's menu-chunk growth was one generated file relocating).

**Files:**
- Create: `packs/riot/pack.ts` and its data/code split
- Delete: `src/content/bundledPack.ts`
- Modify: `src/content/install.ts`, `src/game/config/spellCatalog.ts` (`CHAMPION_KITS` finally goes), `tests/content/rosterSource.test.ts`

- [ ] **Step 1: Delete `CHAMPION_KITS` and its allow-list entry**

`rosterSource.test.ts` allows exactly two files to read the old roster: `bundledPack.ts` and the module that declares it. Both disappear here, so **the allow-list should become empty**. An allow-list that never empties is a rule that was never really adopted; this is the moment it either empties or you explain why not.

- [ ] **Step 2: Write the failing test**

The pack id stays `riot`, so every qualified id in a player's stored config keeps resolving. Assert that: a loadout persisted before this batch still names a champion that exists. That is the compatibility promise batch 2 made when it chose the kit name as the local id, and this is the task that could break it.

- [ ] **Step 3: Replace, and delete**

- [ ] **Step 4: Verify and commit**

`npm run verify`, `npm run e2e:pack`, `npm run e2e:map-picker`.

```bash
git add packs/riot src/content src/game/config/spellCatalog.ts tests
git commit -m "refactor(content): delete the adapter; packs/riot is a real pack

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 8: Does the chunk-hash cascade actually die?

Measured on `main`: a built `spell-yasuo-*.js` carries `from "./game-<hash>.js"` — a **static import of the game chunk by its hashed filename**. Any change under `src/game/` re-hashes `game`, which changes the bytes of all 59 spell chunks, which re-hashes every one of them. A player's browser re-downloads dozens of files it already had, and `workbox-precaching` installs changed entries **strictly sequentially** (`GoogleChrome/workbox#2528`) — which is why a normal deploy takes 19 seconds before the update prompt becomes actionable. Branch `perf-pwa-update` has the measurements.

A migrated pack spell imports only a type. It should have **no runtime dependency on core at all**, so its chunk's bytes should not move when core does.

**That is a prediction, and this task is where it is tested.** It is also the batch's most direct user-visible payoff, so it gets its own task rather than a footnote.

- [ ] **Step 1: Write the guard**

Build. Change one thing under `src/game/` — something real, not a comment. Build again. **Assert the emitted `spell-*.js` filenames are unchanged.**

Make it a script that reports the numbers, and run it **before** you rely on it: on this branch as it stands, it must **fail**, because the cascade is exactly what it measures. Record that failure — it is the measurement of the problem.

- [ ] **Step 2: If it fails after the move, find the edge**

A surviving static import from a pack spell into core is a defect in the migration, not a chunking nicety. Read the emitted chunk's own import list; do not reason from the source graph, because a `manualChunks` **path rule silently defeats a dynamic import** — batch 3 lost a task to exactly that and only measuring the built output showed it.

- [ ] **Step 3: Report the number that matters**

How many files change on a typical `src/game/` edit, before and after. That is what a player's browser downloads.

```bash
git add scripts tests package.json
git commit -m "test(build): a core change must not re-hash every spell chunk

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 9: The seams become exportable, and the 15 are repointed

Spec §8.1: core exports its rules as something runnable, and a pack checks its own tree against them.

```
core exports:  @lol2d/core/seams
pack runs:     lol2d-check-seams ./src
```

The rule lives with the engine that owns it, so it evolves with the engine; the population lives with the content. A pack that violates a rule fails **its own** build, not the engine's.

**The 15 that must be repointed** — their module specifiers and scan roots all changed: `mana-spend`, `dash-onupdate`, `target-vision`, `unit-target-team`, `castspec-frozen`, `cooldowns`, `TargetingModeDeclared`, `terrain-field`, `cc-buff-icons`, `buff-deactivate`, `stat-resource-modifier`, `spell-object-display-box`, `attack-gate`, `spell-runtime-drive`, and half of `SpellAimIntegration`.

**Left alone on purpose:** `bot-aim-seam` and half of `TeamBlackboard.lanes` depend on no content at all. `matchConfigChunk` stays but gains the content package's specifier in its banned list. `pregameBootPath` **must** be repointed — the specifier it greps no longer exists.

- [ ] **Step 1: Prove each repointed scan still catches its violation**

This is the whole task. A scan whose root moved and now matches nothing passes silently forever, and fifteen of those is worse than having no seams. For **each** of the 15: introduce the violation it exists to catch, watch it fail, remove it. Record the fifteen messages in your report.

That is tedious and it is the point. This project's own notes call a scan that has only ever been seen passing "a scan nobody has tested".

- [ ] **Step 2: Decide the export shape and say why**

`@lol2d/core/seams` as a real package entry, or a directory core exposes. **Task ruling 3 says do not add a `package.json` to `packs/riot/`** — batch 5 owns that. So this task builds the rules as *runnable functions with a documented entry point*, and batch 5 decides how they are published.

- [ ] **Step 3: Verify and commit**

```bash
git add tests src packs scripts
git commit -m "test(content): repoint the 15 seams and make the rules exportable

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 10: Core is clean, and the game still plays

Two proofs, and neither is optional.

**Core is clean.** A scan over `src/` for Riot's vocabulary: champion names, ability names, the map's coordinates. `CLAUDE.md` is explicit that the *terminology* stays — `Champion`, `Minion`, `Turret`, `Fountain` are ordinary words for ordinary things and are not Riot's property. What must be gone is the specific: a champion's name, a spell's name, a coordinate from Summoner's Rift.

Write the scan so its expected result is **zero**, and list in your report anything you deliberately allowed with a sentence each. A long allow-list means the move is incomplete and the scan is documenting that rather than enforcing anything.

**The game still plays.** Run every e2e script that exists — `e2e:pack`, `e2e:map-picker`, `e2e:bots`, `e2e:pwa`, and the touch drivers — and report each one's numeric summary. This is the batch that moved 240 spells, 378 images and 63 test files; a green unit suite is necessary and nowhere near sufficient.

- [ ] **Step 1: Write the vocabulary scan and run it**

Expected: FAIL, listing what is left. That list is the last of the work.

- [ ] **Step 2: Clear the list**

- [ ] **Step 3: Run every e2e script and report every summary**

Note the two that do not use the shared harness — `drive-game.mjs` spawns its own Vite and honours `LOL2D_URL`/`LOL2D_PORT`; `verify-pwa-offline.mjs` serves the built `dist/` with the network cut. Both are deliberate and both must still pass.

- [ ] **Step 4: Full verify, and report the shape of the result**

`npm run verify`, `npm run chunks:check`, and the final chunk sizes against the 225,000 ceiling.

```bash
git add tests src packs
git commit -m "test(content): core carries none of Riot's vocabulary, and the game still plays

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

## What batch 5 inherits

Batch 5 extracts `packs/riot/` into its own repository: a `package.json`, a workspace or git dependency, publishing `@lol2d/core/seams`, and the `lol2d-check-seams` binary a pack repo runs against its own tree. Everything before that is done here.

Two things it will need that this batch deliberately does not decide:

- **How the pack depends on core.** npm workspace in development, git dependency for a release — spec §9 says so, and it also says **not** to publish the Riot pack to a public registry: a public package carrying 378 Riot art files under an author's name is a more exposed surface than a GitHub repository, for no useful gain.
- **`package.json`'s `name` is still `"lol2d"`.** Spec §11 calls that out: "LOL" is in it. Changing it is cheap now and expensive later.
