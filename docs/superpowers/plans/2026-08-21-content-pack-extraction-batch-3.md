# Content Pack Extraction — Batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The world a match is played in comes from a `MapDefinition` a pack supplies, not from a hard-coded asset key and four hand-written preset tables.

**Architecture:** Batch 1 declared `MapDefinition` and `PackRegistry.maps()`; both are still **completely dead** — zero readers in `src/game` or `src/scenes`. This batch gives them readers. Summoner's Rift's geometry becomes a `MapDefinition` (still living in core; batch 4 moves the file), and everything that used to be derived or hard-coded — fountains, turret rows, minion muster points, jungle camps, lanes, world size — becomes a **slot** the map declares.

One structural change comes first and pays for the rest: the pack contract splits into a **data half** and a **code half**. A pack's manifest, champions, display data, monsters and maps become readable without building `ContentApi`; only `spells` needs it. That is what lets the menu offer a map picker without dragging the engine into the chunk it loads, and it closes the `Circular chunk: pregame -> game -> pregame` warning batch 2 deliberately left standing.

**Tech Stack:** TypeScript, Vite, Vitest (`environment: 'node'`), Playwright via `tests/e2e/harness.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-20-content-pack-extraction-design.md` — steps 4 and 5, plus the data/code split the spec implies in §9.1 and batch 2's whole-branch review named explicitly.

**Branch:** `content-pack-batch-3`, worktree `/Users/hoangtran/Desktop/Github/LOL2D-batch3`, based on `content-pack-batch-2` @ `a43e479`.

**Survey:** `.superpowers/surveys/2026-08-21-map-touchpoints.md` in the main worktree — every touch point below was measured there. Read it before Task 2; it will save you a file-by-file hunt and it names three traps this plan repeats only in summary.

## Global Constraints

- **Do not merge to `main`.** `.github/workflows/build.yml` triggers on push to `[dev, main]` and on pull requests. Pushing this branch is allowed; merging is not.
- **`npm run verify` must be green at the end of every task.** Baseline at `a43e479`: **253 test files, 4018 tests, 0 skipped, 0 failures.** Read it cheaply: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`. A task that moves the count says so in its report and says why.
- **`npm run chunks:check` must stay green.** Baseline: pregame ~150 KB, game ~310 KB, shared ~3.5 KB, ceiling 175 KB. It scans the **built** pregame bundle for four engine symbols — the only test here that inspects output rather than source. **Task 1 changes what `ContentApi` statically imports, so that guard's needles may stop being literal keys; re-demonstrate it failing after Task 1** or it goes quiet without anyone noticing.
- **Every test must be shown to fail first.** Write it, run it, read the message. Batch 2 shipped three plan-authored tests that were wrong in a way only running them revealed.
- **`Array.prototype.filter` cannot narrow types** (`src/types/global.d.ts` re-declares it). Plain loops, never casts.
- **p5 global mode.** `pop`, `text`, `fill`, `line`, `point`, `random`, `map`, `scale`, `rotate`, `image`, `color` are globals; a local of the same name silently shadows one and `tsc` cannot see it.
- **`Game.update()`/`draw()` return early while paused**, and every `MatchDirector` method runs in that window. Read both `objects` and `_objectToBeAdd`, skip `toRemove`, clamp derived stats at the point of change.
- **Concurrent agents share this repository.** Commit with explicit paths — never `git add -A`, never `.`, never a bare `git commit`.
- **Prettier** (`.prettierrc`: 2 spaces, single quotes, 100 columns). Format only files you touched; several files predate it and fail `--check`, so never run `--write` across the tree.
- Vietnamese is the UI language for any user-visible string.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK`.

## Rulings already made (do not re-litigate)

1. **Build on `MapDefinition` and `PackRegistry.maps()`.** They exist and are dead. Inventing a second map model beside them is the one outcome this batch must not produce.
2. **The data/code split lands here, first.** Batch 2 deferred it with a reason: the menu needs a map picker, which is the same data-without-code problem, so the split lands where it is already paid for.
3. **Slots key by qualified id, like everything else.** Batch 2's last bug was a picker path that used a bare local id while every other population used the qualified one. Maps, monsters and their roles go through `qualify()` from the start.
4. **`lanes` is optional.** A map with none has no waves; `BotBrain`'s PUSH falls through to ROAM, which is an existing path. This is what makes a lane-less map possible later without touching the posture chain.
5. **`role` is a free string, `kind` is core vocabulary.** A monster declares `fills: string[]`; a map slot names a `role` core never interprets. `slots.structure.kind` is core's own word (`turret`) and an unknown one is a validation error.

## File Structure

| File | Created / Modified | Responsibility |
|---|---|---|
| `src/content/ContentPack.ts` | modify | `ContentPackData` split out of `ContentPack`; `MapDefinition` unchanged. |
| `src/content/PackRegistry.ts` | modify | `installData` / `installCode`; maps and monsters served qualified. |
| `src/content/install.ts` | modify | Two arrays: data (no api) and code (api). |
| `src/content/registry.ts` | modify | `contentCatalog()` (data, no `ContentApi`) beside `contentRegistry()`. |
| `src/content/bundledPack.ts` | modify | Splits the same way; gains the SR map. |
| `src/content/maps/summonersRift.ts` | create | SR as a `MapDefinition`. Deleted by batch 4, which moves it into the pack. |
| `src/game/gameObject/map/TerrainMap.ts` | modify | Reads a `MapDefinition`, rejects an unknown layer. |
| `src/game/lanes.ts` | modify | Lanes come from the active map; nothing computed at module load. |
| `src/game/ai/LaneObjectives.ts` | modify | Geometry built per match, not in a module-load IIFE. |
| `src/game/Game.ts` | modify | Takes the map; `mapSize` from it; spawns from slots. |
| `src/game/managers/MinionSpawner.ts` | modify | Muster points come from `minion` slots; `musterPointFor` deleted. |
| `src/game/preset.ts` | modify | `FountainPreset`, `MonsterPreset`, `getTurretPositions`, `TURRET_ROW_TEAMS` all deleted. |
| `packs/reference/map.ts` | create | A deliberately hostile second map (spec §8.2). |
| `tests/game/map/*`, `tests/content/*` | create/modify | Per task. |

---

### Task 1: The pack contract splits into a data half and a code half

`ContentPackFactory` is `(api: ContentApi) => ContentPack`, so **reading a pack's champion list requires building the whole engine surface**. That is why `src/game/config/spellCatalog.ts` — pinned to the `pregame` chunk — reaching `contentRegistry()` once put the 24 buffs, the combat modules and the spell-object base classes into the chunk the menu loads. Batch 2 fixed the symptom by pinning `src/content/` to `game` and leaving a `Circular chunk: pregame -> game -> pregame` warning standing, with the note that the real fix belongs here.

It belongs here because this batch adds a map picker, and a map picker is the same question again: draw a list of worlds without loading the engine that runs them.

**Files:**
- Modify: `src/content/ContentPack.ts`, `src/content/PackRegistry.ts`, `src/content/install.ts`, `src/content/registry.ts`, `src/content/bundledPack.ts`, `src/content/validate.ts`, `src/content/types.ts`
- Modify: `packs/reference/pack.ts`
- Modify: `vite.config.ts`, `scripts/check-chunks.mjs`
- Test: `tests/content/packRegistry.test.ts`, `tests/content/install.test.ts`, `tests/content/registry.test.ts`, `tests/content/contentApiChunk.test.ts` (create)

**Interfaces:**
- Consumes: nothing from a later task.
- Produces:
  - `interface ContentPackData { manifest: PackManifest; champions?: ChampionEntry[]; spellDisplay?: Record<string, SpellDisplayData>; monsters?: Record<string, MonsterDef>; maps?: MapDefinition[] }`
  - `type ContentPackCode = { spells?: Record<string, SpellSource> }`
  - `type ContentPackFactory = (api: ContentApi) => ContentPackCode`
  - `PackRegistry.installData(data: ContentPackData): void`
  - `PackRegistry.installCode(packId: string, code: ContentPackCode): void`
  - `contentCatalog(): PackRegistry` — data only, installs on first read, **must not transitively import `ContentApi`**
  - `contentRegistry(): PackRegistry` — the same instance with code installed as well

Both accessors return **one** registry. The split is about *when* the api is built, not about two stores — two stores is the shape that let the match-config panel diverge from the setup screen, and this codebase has a test suite whose whole job is stopping that happening again.

- [ ] **Step 1: Write the failing chunk test**

`tests/content/contentApiChunk.test.ts`. This is the test that would have caught batch 2's leak from source, and it complements — does not replace — the byte-level scan in `scripts/check-chunks.mjs`.

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(__dirname, '../../');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Resolve a `@/`-aliased or relative specifier to a file under src/. */
const resolveSpecifier = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
};

/** Every module reachable from `entry` by a *value* import. */
const valueClosure = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    const pattern = /^\s*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+'([^']+)'/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) continue; // `import type` is erased; it cannot pull code in.
      const target = resolveSpecifier(file, match[2]);
      if (target) queue.push(target);
    }
  }
  return seen;
};

describe('the data half of the pack contract', () => {
  const closure = valueClosure(join(ROOT, 'src/content/catalog.ts'));

  it('walked a real graph', () => {
    expect(closure.size).toBeGreaterThan(3);
  });

  it('does not reach ContentApi, and so does not reach the engine', () => {
    const offenders = [...closure].filter(
      file => file.endsWith('src/content/ContentApi.ts') || file.includes('/src/game/gameObject/')
    );
    expect(offenders.map(f => f.slice(ROOT.length))).toEqual([]);
  });
});
```

Name the data-only entry point `src/content/catalog.ts` and put `contentCatalog()` in it, rather than adding it to `registry.ts` — `registry.ts` imports `install.ts` imports `ContentApi`, and a module cannot be half in a closure.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/contentApiChunk.test.ts`
Expected: FAIL — `src/content/catalog.ts` does not exist yet. Create the file empty, re-run, and record the *second* failure too: with `catalog.ts` re-exporting from `registry.ts` the closure reaches `ContentApi.ts`, which is the state this task is fixing. Both messages go in your report.

- [ ] **Step 3: Split the contract**

In `src/content/ContentPack.ts`, `ContentPackData` takes every section except `spells`; `ContentPackCode` takes `spells`; `ContentPack` becomes their intersection so existing type references keep meaning what they meant. `ContentPackFactory` returns `ContentPackCode`.

A pack module now exports **two** things — its data as a plain value, and its code as the default factory:

```ts
// packs/reference/pack.ts
export const data: ContentPackData = { manifest: {...}, champions: [...], spellDisplay: {...} };
const code = (api: ContentApi): ContentPackCode => ({ spells: { Vera_Q: makeVeraQ(api), ... } });
export default code;
```

The data export must be reachable **without** evaluating anything that needs the api. Keep them in one file — a pack is one file to an author — but make sure nothing at module scope of `pack.ts` calls a spell factory.

- [ ] **Step 4: Split the installers**

`PackRegistry.installData` validates and writes the data sections; `installCode` writes spells against an already-installed pack id and **throws if that id has no data** — an orphan code half is a pack that half-exists, which is the failure mode `install()`'s validate-then-write ordering was built to avoid. `install(pack)` stays, implemented as both in order, so batch 2's tests keep meaning what they meant.

`src/content/install.ts` gains `BUNDLED_PACK_DATA: ContentPackData[]` (no api anywhere in the module's value closure — move `buildContentApi` out of its imports) and keeps `BUNDLED_PACKS` for the code half.

- [ ] **Step 5: Two accessors, one registry**

`src/content/catalog.ts` exports `contentCatalog()`: builds the registry on first read and installs **only** the data. `src/content/registry.ts`'s `contentRegistry()` calls `contentCatalog()` and then installs the code half once, memoised. `resetContentRegistryForTests()` clears both.

Every current reader keeps calling `contentRegistry()` and keeps working. Move only the ones that need data alone: `src/game/config/spellCatalog.ts` and `src/scenes/setup/pregameCatalog.ts`.

- [ ] **Step 6: Re-pin the chunks and re-prove the byte guard**

With `src/content/catalog.ts` free of `ContentApi`, `vite.config.ts` can stop pinning all of `src/content/` to `game`. Pin `src/content/catalog.ts` and the data modules to `pregame`, leave the rest in `game`, and read the existing comment there for the reasoning style — it carries the measured edge list from batch 2.

Then **re-demonstrate `scripts/check-chunks.mjs` failing**. Its four needles are `ContentApi.ts`'s own object-literal property keys; if this task changed that file's shape they may no longer be literal keys and the guard would go quiet without failing. Break the chunking deliberately, watch it fail, restore. Record the message. Report the new chunk sizes and whether the `Circular chunk` warning is gone — if it is not, say what edge still closes it.

- [ ] **Step 7: Verify and commit**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"` and `npm run chunks:check`.

```bash
git add src/content/ContentPack.ts src/content/PackRegistry.ts src/content/install.ts src/content/registry.ts src/content/catalog.ts src/content/bundledPack.ts src/content/validate.ts src/content/types.ts packs/reference/pack.ts vite.config.ts scripts/check-chunks.mjs src/game/config/spellCatalog.ts src/scenes/setup/pregameCatalog.ts tests/content
git commit -m "feat(content): split the pack contract into a data half and a code half

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 2: No geometry at module-eval time

Two module-load computations stand between this codebase and a second map, and both are documented as deliberate:

- `src/game/lanes.ts:117-121` builds `RED_LANE_WAYPOINTS` by reversing `LANE_WAYPOINTS` **once at module load** — the comment at `:115` says "Reversed once at module load rather than per wave".
- `src/game/ai/LaneObjectives.ts:122-140` is an IIFE building per-lane arc-length tables, keyed by the literal strings `'top' | 'mid' | 'bot'`, with a comment saying "Built once at module load."

Both were right when there was one map. Neither survives a map being chosen per match.

**Read the survey's SURPRISE 4 before starting.** `getLaneWaypoints`, `nearestLane`, `laneApproach`, `assignLanes` and `TeamBlackboard`'s per-lane bucketing all assume exactly three globally-named lanes exist for the process lifetime. This task does **not** fix that assumption — Task 9 does. This task only moves the *computation* from module load to first use, so that Task 9 has somewhere to put a map.

**Files:**
- Modify: `src/game/lanes.ts`, `src/game/ai/LaneObjectives.ts`
- Test: `tests/game/minions/Lanes.test.ts`, `tests/game/ai/LaneObjectives.test.ts`, `tests/scenes/pregameBootPath.test.ts`

**Interfaces:**
- Produces: `lanes.ts` and `LaneObjectives.ts` keep every exported name and signature. What changes is that nothing is computed until something asks.

- [ ] **Step 1: Write the failing scan**

A source scan, because "nobody may compute geometry at module load" is a rule about a whole class of file, and this project's own notes say a source-scan test is the right tool for that: milliseconds, and it closes the class permanently.

Add to `tests/game/ai/LaneObjectives.test.ts` (or a new `tests/game/map/moduleEvalGeometry.test.ts` if that reads better) a scan over `src/game/lanes.ts`, `src/game/ai/LaneObjectives.ts` and `src/game/Game.ts` that fails on a top-level IIFE (`= (() => {`, `= (function`) or a top-level `.map(`/`.reverse()` assigned to a `const`. Strip comments first — both files *document* the thing being banned, and a scan that flags its own explanation is a scan someone deletes.

Run it. Expected: FAIL, naming both sites.

- [ ] **Step 2: Make both lazy**

`RED_LANE_WAYPOINTS` becomes a memoised function. `GEOMETRY` becomes a memoised builder keyed by whatever identifies the lane set — for now the module's own `LANES`, so behaviour is unchanged; Task 9 replaces the key with the active map.

Memoise on the input's identity, not on a boolean. Batch 2 landed the same rule for `preset.ts`'s roster memo and the reason is the same: a boolean-keyed memo goes stale the first time the input changes, and a test that installs a different map is exactly when that happens.

- [ ] **Step 3: Run the scan and the suites**

Run: `npx vitest run tests/game/minions/Lanes.test.ts tests/game/ai/`
Expected: PASS. `Lanes.test.ts` checks lane coordinates against the wall polygons and `LaneObjectives.test.ts` covers the arc-length maths — if either moves, you have changed behaviour, not just timing. Say so rather than updating them.

- [ ] **Step 4: Verify and commit**

```bash
git add src/game/lanes.ts src/game/ai/LaneObjectives.ts tests/game
git commit -m "refactor(map): build lane geometry on first use, not at module load

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 3: Summoner's Rift becomes a `MapDefinition`

The data exists in four places that do not know about each other: `assets/json/summoner_map.json` holds `wall`/`bush`/`water` polygons **and** the two turret rows; `preset.ts:666-669` holds `FountainPreset` (two entries, index order load-bearing); `preset.ts:422-654` holds `MonsterPreset` (21 entries mixing position with identity); `lanes.ts:72-113` holds the waypoints. This task assembles them into one `MapDefinition` and registers it. **Nothing reads it yet** — Tasks 4-9 move the readers one at a time, so a break is attributable.

**Files:**
- Create: `src/content/maps/summonersRift.ts`
- Modify: `src/content/bundledPack.ts`
- Test: `tests/content/summonersRift.test.ts` (create)

**Interfaces:**
- Consumes: `ContentPackData` (Task 1), `MapDefinition` (batch 1, `src/content/ContentPack.ts`).
- Produces: `export const summonersRift: MapDefinition`, id `summoners-rift`, carried in `bundledPack`'s `data.maps`.

- [ ] **Step 1: Write the failing test**

The point of this test is that the assembled map says the same thing the four sources said. So assert it **against those sources**, not against transcribed numbers — a transcription this large will contain a typo, and a test that repeats the typo agrees with it.

```ts
import { describe, expect, it } from 'vitest';
import { summonersRift } from '../../src/content/maps/summonersRift';
import { validatePack } from '../../src/content/validate';
import mapJson from '../../assets/json/summoner_map.json';

describe('the Summoner’s Rift map definition', () => {
  it('carries every wall, bush and water polygon the JSON has', () => {
    expect(mapJson.wall.length).toBeGreaterThan(10);
    expect(summonersRift.terrain.wall).toHaveLength(mapJson.wall.length);
    expect(summonersRift.terrain.bush).toHaveLength(mapJson.bush.length);
    expect(summonersRift.terrain.water).toHaveLength(mapJson.water.length);
  });

  it('carries both turret rows as structure slots, with their teams', () => {
    // `turret1` and `turret2` are flat lists of [x, y] points — 11 each,
    // measured, not assumed. `getTurretPositions` in preset.ts is the existing
    // reader; copy its interpretation rather than inventing one.
    const blue: StructureSlot[] = [];
    const red: StructureSlot[] = [];
    for (const slot of summonersRift.slots.structure) {
      (slot.faction === 'blue' ? blue : red).push(slot);
    }
    expect(blue).toHaveLength(mapJson.turret1.length);
    expect(red).toHaveLength(mapJson.turret2.length);
    // Every point survives the conversion, in order and unrounded.
    for (const [index, point] of mapJson.turret1.entries()) {
      expect([blue[index].x, blue[index].y]).toEqual(point);
    }
  });

  it('places a spawn slot per faction where the fountains were', () => {
    expect(summonersRift.slots.spawn).toHaveLength(2);
    for (const slot of summonersRift.slots.spawn) expect(slot.r).toBeGreaterThan(0);
  });

  it('declares nine neutral slots and no monster identities', () => {
    expect(summonersRift.slots.neutral).toHaveLength(9);
    for (const slot of summonersRift.slots.neutral) {
      expect(typeof slot.role).toBe('string');
      expect(slot).not.toHaveProperty('name');
      expect(slot).not.toHaveProperty('health');
    }
  });

  it('passes validation as part of a pack', () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      maps: [summonersRift],
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) expect(result.errors).toEqual([]);
  });
});
```

Read the exact turret-row shape out of the JSON before writing the conversion — the survey records it as flat `[x, y]` pairs, 11 points on one side, and `preset.ts:693-709`'s `getTurretPositions` is the existing reader to copy the interpretation from, not to guess at.

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Write the definition**

`size: 6400` (the literal `Game.ts:107` and `TerrainMap.ts:25` both carry today; Task 4 makes it the map's). `factions: [{ id: 'blue' }, { id: 'red' }]`. Terrain from the JSON. Structure slots from `turret1`/`turret2` via `TURRET_ROW_TEAMS`'s mapping. Spawn slots from `FountainPreset`, with `r` the healing radius. Neutral slots from `MonsterPreset`'s nine distinct `camp` positions — **positions only**; the monsters themselves are Task 7. Lanes from `LANE_WAYPOINTS`.

Import the JSON directly rather than through `AssetManager`: this is build-time data assembly, and going through the asset manager would make the definition depend on a load having happened.

Nine camps, not 21 entries. The survey records 21 `MonsterPreset` entries of which 14 carry a `campId` — a pack of wolves is three entries tied together by that field. A slot is a **place**; how many bodies stand in it is the monster's business (Task 7).

- [ ] **Step 4: Register it, and run**

`bundledPack`'s data half gains `maps: [summonersRift]`. Run `npx vitest run tests/content/` — the registry's `maps()` should now answer with one qualified map, `riot:summoners-rift`.

- [ ] **Step 5: Verify and commit**

```bash
git add src/content/maps/summonersRift.ts src/content/bundledPack.ts tests/content/summonersRift.test.ts
git commit -m "feat(map): assemble Summoner's Rift as a MapDefinition

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 4: A map's geometry arrives lazily, and the world reads it

**Read this first, because it changes what the task is.** Task 3 put Summoner's Rift's full geometry — 329 wall polygons, 40 bush, 26 water — into the pack's **data** half, which Task 1 pinned to the `pregame` chunk. The chunk the menu loads went 207,858 → 231,072 bytes, and `PREGAME_SIZE_CEILING_BYTES` was raised for the second time in three tasks: 175,000 → 225,000 → 250,000.

Trace the whole trajectory: **158.8 KB at batch 1 → 149.96 after batch 2 → 207.9 → 231.1 now.** Task 9 adds a second map and Task 10 adds a picker, so on the current shape it grows twice more. Two ceiling raises in three tasks is a guard being renegotiated instead of a design being fixed, and this is the point to stop.

**The menu needs a map's name to draw a picker. It does not need the map's polygons.** So `MapDefinition` splits the way `SpellSource` already did in batch 2, for the same reason and with the same shape:

- **Eager, and tiny:** `id`, `name`, `size`, `factions`. Enough to list, name and describe a world.
- **Lazy, and heavy:** `terrain`, `slots`, `lanes`. Fetched when a match is actually starting.

This is not extra scope invented mid-batch — it is the same rule this batch has already applied twice (`SpellSource`, then Task 1's data/code split), applied to the one payload that is bigger than both. **The ceiling does not move again in this batch.** If your change needs it to, that is a finding to report, not a number to edit.

**Files:**
- Modify: `src/content/ContentPack.ts` (the `MapDefinition` split), `src/content/PackRegistry.ts`, `src/content/validate.ts`
- Modify: `src/content/maps/summonersRift.ts`, `src/content/bundledPack.ts`
- Modify: `src/game/Game.ts`, `src/game/gameObject/map/TerrainMap.ts`
- Modify: `scripts/check-chunks.mjs` (lower the ceiling back toward where it was, and say what the new number is measured against)
- Test: `tests/content/contentApiChunk.test.ts`, `tests/game/map/TerrainMap.test.ts`, `tests/content/validate.test.ts`

**Interfaces:**
- Produces:
  - `interface MapSummary { id: string; name: string; size: number; factions: Faction[] }`
  - `type MapGeometrySource = MapGeometry | (() => Promise<MapGeometry>)` — a plain object or a loader, exactly like `SpellSource`
  - `PackRegistry.maps(): readonly QualifiedMapSummary[]` — the listing, always cheap
  - `PackRegistry.loadMapGeometry(qualifiedId): Promise<MapGeometry | null>` — memoised on the promise, like `loadSpellClass`
- Consumes: `summonersRift` (Task 3), threaded into `Game` and `TerrainMap` below.

- [ ] **Step 1: Write the failing size test**

The guard that would have caught this, and the one that keeps Tasks 9 and 10 honest:

```ts
it('lists a map without pulling its geometry into the listing', async () => {
  const summaries = contentCatalog().maps();
  expect(summaries.length).toBeGreaterThan(0);
  for (const summary of summaries) {
    expect(summary).not.toHaveProperty('terrain');
    expect(summary).not.toHaveProperty('slots');
  }
  const geometry = await contentCatalog().loadMapGeometry(summaries[0].id);
  expect(geometry?.terrain.wall.length).toBeGreaterThan(100);
});
```

Extend `tests/content/contentApiChunk.test.ts`'s closure walk to assert the data-only entry point does not statically reach `src/content/maps/`. That is the structural version of the same rule, and it is what stops a later task quietly importing the geometry back into the listing path.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — `maps()` returns full definitions today and `loadMapGeometry` does not exist. Record it.

- [ ] **Step 3: Split, and make the geometry a dynamic import**

`src/content/maps/summonersRift.ts` exports the summary eagerly and the geometry behind `() => import('./summonersRiftGeometry')`. Rollup will then emit the polygons as their own chunk, fetched when a match starts rather than when the menu paints.

Note Task 3's finding: a plain `.json` import compiles and passes Vitest but **breaks `vite build`**, because `vite.config.ts`'s `assetsInclude: ['**/*.json']` claims the extension. Task 3 works around it with `?raw` + `JSON.parse`. Keep that, and keep the parse inside the lazily-imported module so the raw string is not in the listing chunk either.

- [ ] **Step 4: Lower the ceiling**

Set `PREGAME_SIZE_CEILING_BYTES` from what you actually measure after the split, with a sentence saying what the number is and what it is headroom for. It should land near where it was before Task 3 — if it does not, the geometry has not really left the chunk and you should say so rather than pick a bigger number.

- [ ] **Step 5: The world size and the terrain come from the map**



`Game.ts:107` is `readonly mapSize = 6400` — a literal, unrelated to what the map says. `TerrainMap.ts:25` repeats it as a fallback. Six test files repeat it again. Everything downstream is derived correctly from it (`ObjectManager`'s two quadtree roots, `NavigationSystem`, `Minimap`, `Soraka_R`, `BotBrain`'s wander target), so the fix is at the source, not at the twelve call sites.

`TerrainMap` reads `AssetManager.get('json_summoner_map').data` synchronously and walks a fixed allow-list of three layer names, with `if (!terrains?.[t]) continue` and **no else branch** — an unrecognised layer is dropped without a word. `src/content/validate.ts`'s own header names that as one of the silent failures the validator exists to catch.

**Files:**
- Modify: `src/game/Game.ts`, `src/game/gameObject/map/TerrainMap.ts`
- Modify: `src/content/validate.ts`
- Test: `tests/game/map/TerrainMap.test.ts` (create or extend), `tests/content/validate.test.ts`

**Interfaces:**
- Consumes: `summonersRift` (Task 3).
- Produces: `Game` takes the active `MapDefinition` and exposes `mapSize` from it; `TerrainMap`'s constructor takes a `MapDefinition` instead of reading the asset manager.

- [ ] **Step 6: Write the failing tests**

```ts
it('takes its size from the map, not from a constant', () => {
  const game = makeGame({ map: { ...summonersRift, size: 3200 } });
  expect(game.mapSize).toBe(3200);
  expect(game.objectManager.objectsTreeBounds().w).toBe(3200);
});

it('refuses a terrain layer core does not know', () => {
  const result = validatePack({
    manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
    maps: [{ ...summonersRift, terrain: { ...summonersRift.terrain, lava: [] } }],
  });
  expect(result.ok).toBe(false);
  if (result.ok === false) expect(result.errors.join('\n')).toMatch(/lava/);
});
```

The first case is the one that matters and it must assert a **derived** value, not just the field — `objectManager`'s quadtree bounds, or the nav grid's extent. A test that only reads back `game.mapSize` would pass against a `Game` that stored the number and kept building 6400-wide quadtrees, which is exactly the bug shape.

Use the existing `tests/game/fixtures.ts` helper rather than inventing a second way to build a `Game`; its `mapSize = 6_400` default parameter is one of the six literals the survey found, and it becomes the map's size here.

- [ ] **Step 7: Run to verify they fail**

Expected: FAIL — `Game` has no map parameter; `validatePack` accepts the unknown layer silently.

- [ ] **Step 8: Thread the map through**

`Game`'s constructor takes the chosen `MapDefinition`; `mapSize` is `map.size`. `TerrainMap` takes the definition and reads `terrain.wall/bush/water` from it. Delete the `'json_summoner_map'` read from `TerrainMap` and the `|| 6400` fallback — a missing map is now a programming error, not something to paper over with a default, and `validate` has already refused a map without a size.

`validate.ts` gains the layer check: a key in `terrain` outside `TerrainType`'s three values is an error naming the key.

The survey's SURPRISE 3 is the trap here: `Game`'s constructor reads the map **synchronously**, and there is no `await AssetManager.ensure(...)` anywhere in `GameScene`. Once the definition comes from the registry rather than the asset manager that specific hazard is gone — but say in your report what now guarantees the map is present before `new Game(...)`, because "it happens to be" is what the old code relied on.

- [ ] **Step 9: Follow it outward**

`ObjectManager`, `NavigationSystem` and `Minimap` already derive from `game.mapSize`, so they need no change — **verify that rather than assuming it**, and list in your report every site the survey named (`Game.ts:521-522,805`, `Soraka_R.ts:54-56`, `BotBrain.ts:1337-1338`, `AIChampion.ts:195`) with whether it still reads correctly.

- [ ] **Step 10: Take the map off the boot path**

`LoadingScene.enter()` blocks the menu on `AssetManager.ensure('json_summoner_map')`, and spec §9 calls that a boot blocker: the map has to load **after** the menu for choosing one at pregame to be possible at all. Task 3 imports the JSON at build time, so once `TerrainMap` stops reading the asset manager nothing needs that `ensure` — delete it and let `LoadingScene` go straight to the menu.

Then confirm the three remaining `'json_summoner_map'` code readers the survey found are gone: `LoadingScene.ts:40`, `preset.ts:695`, `TerrainMap.ts:40`. The generated `assetManifest.ts` entry stays until batch 4 moves the file; the eleven test files referencing the key are updated by whichever task touches them.

- [ ] **Step 11: Verify and commit**

Run the nav suites specifically — `npx vitest run tests/game/nav/` — because they hard-code 6400 in four files and they are the ones that will notice a threading mistake.

```bash
git add src/game/Game.ts src/game/gameObject/map/TerrainMap.ts src/content/validate.ts tests
git commit -m "feat(map): the world's size and terrain come from the map definition

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 5: Fountains and turrets come from slots

`Game.spawnFountains()` reads `FountainPreset` — a two-element array whose **index order is load-bearing**, because the method reads the team off the index. `Game.spawnTurrets()` reads `getTurretPositions()`, which reaches into the map JSON for the literal keys `'turret1'` and `'turret2'` and maps them to teams through `TURRET_ROW_TEAMS`. That is a second hard-coded coupling to the map file, separate from the asset key, and it is why moving a turret row means editing TypeScript.

**Files:**
- Modify: `src/game/Game.ts`, `src/game/preset.ts`
- Test: `tests/game/structures/Turret.test.ts`, `tests/game/minions/helpers.ts`, `tests/game/minions/Lanes.test.ts`

**Interfaces:**
- Consumes: `summonersRift.slots.spawn` / `.structure` (Task 3), `Game`'s map (Task 4).
- Produces: `FountainPreset`, `getTurretPositions` and `TURRET_ROW_TEAMS` are **deleted** from `preset.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it('spawns one fountain per spawn slot, on the slot’s faction', () => {
  const game = makeGame({ map: summonersRift });
  const fountains = game.objects.filter(o => o instanceof Fountain);
  expect(summonersRift.slots.spawn.length).toBe(2);
  expect(fountains).toHaveLength(summonersRift.slots.spawn.length);
  for (const slot of summonersRift.slots.spawn) {
    const match = fountains.find(f => f.position.x === slot.x && f.position.y === slot.y);
    expect(match, `no fountain at the ${slot.faction} spawn slot`).toBeDefined();
  }
});

it('spawns a turret per structure slot and keeps the rows asymmetric', () => {
  const game = makeGame({ map: summonersRift });
  const turrets = game.objects.filter(o => o instanceof Turret);
  expect(turrets).toHaveLength(summonersRift.slots.structure.length);
  const perFaction = new Map<string, number>();
  for (const slot of summonersRift.slots.structure) {
    perFaction.set(slot.faction, (perFaction.get(slot.faction) ?? 0) + 1);
  }
  expect([...perFaction.keys()].sort()).toEqual(['blue', 'red']);
  for (const count of perFaction.values()) expect(count).toBe(11);
});
```

`filter` cannot narrow here, so these will need plain loops or a cast-free helper — see `MatchDirector.bots()` for the shape the codebase uses.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — `makeGame` takes no map yet in these suites, or the counts come from the presets rather than the slots. Record the message.

- [ ] **Step 3: Spawn from slots**

`spawnFountains` walks `map.slots.spawn` and reads the faction from the slot's own `faction` field rather than from its index. `spawnTurrets` walks `map.slots.structure`, and a slot whose `kind` is not `'turret'` is a validation error already caught at install, so the loop does not need to defend against it — say so in a comment rather than adding a runtime check that can never fire.

Delete `FountainPreset`, `getTurretPositions` and `TURRET_ROW_TEAMS`. The test files that consumed the raw JSON — the survey names `Turret.test.ts:165-174`, `Lanes.test.ts:14-15,300,378,406-409,474-485`, `minions/helpers.ts:40-44` — read the map definition instead. **Do not** leave a compatibility shim; a second way to ask where the turrets are is the thing this task exists to remove.

- [ ] **Step 4: Verify and commit**

```bash
git add src/game/Game.ts src/game/preset.ts tests/game
git commit -m "feat(map): fountains and turrets come from the map's slots

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 6: A wave musters where the map says, not where two turrets happen to be

`MinionSpawner.musterPointFor(teamId)` walks `this.game.turrets` on every call, finds the two nearest that team's fountain, and returns their midpoint — or `null` when a team has fewer than two turrets, in which case **the whole wave falls back into the fountain and nobody finds out until the first wave arrives**. `src/content/validate.ts`'s header names this exact failure. It exists only because no map ever declared where a wave forms up.

Now one does.

**Files:**
- Modify: `src/game/managers/MinionSpawner.ts`
- Test: `tests/game/minions/MinionSpawner.test.ts`, `tests/game/minions/Lanes.test.ts`, `tests/game/minions/MinionLaneJoin.test.ts`

**Interfaces:**
- Consumes: `map.slots.minion` (Task 3), which carries `faction`, `lane`, `x`, `y`.
- Produces: `MinionSpawner.musterPoint(faction: string, lane: string): { x: number; y: number }` — non-nullable, because a lane with no slot is now refused at install. `musterPointFor` and `MUSTER_SCATTER_PX` are **deleted**.

- [ ] **Step 1: Write the failing test**

`Lanes.test.ts:455-494` already has a `describe('the muster point a wave forms up on', …)` block that recomputes the midpoint independently and checks the whole scatter ring against the wall polygons. That block is the specification of what must not regress. Rewrite it to assert against the **slot** — and keep the wall-polygon check, because it is what proves a muster point is somewhere a minion can actually stand.

Add the case the old design could not express:

```ts
it('musters a lane whose team has fewer than two turrets', () => {
  // The old midpoint rule returned null here and dropped the whole wave into
  // the fountain, silently, until the first wave walked out of it.
  const sparse = withStructureSlots(summonersRift, slots => slots.slice(0, 1));
  const spawner = makeSpawner({ map: sparse });
  const point = spawner.musterPoint('blue', 'MID');
  expect(point).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: the new case fails — `musterPointFor` returns `null` for a one-turret team. Record it; that null is the bug this task deletes.

- [ ] **Step 3: Read the slot**

The muster point for `(faction, lane)` is the `minion` slot with those two fields. A lane with no slot is a **validation error at install**, not a `null` at spawn time — push that check into `validate.ts` so a map that would drop waves cannot be installed. That is the whole difference between this design and the old one: the failure moved from the first wave of a live match to the moment the pack loads.

`MUSTER_SCATTER_PX` goes with it. The survey records its value (55) and the reason (it must stay under the gap between the two base turrets so scatter cannot land inside one) — that reason was about a derived midpoint. A declared slot can carry its own scatter if it needs one; if you keep a scatter, put it on the slot, not in a module constant.

- [ ] **Step 4: Verify and commit**

Run `npx vitest run tests/game/minions/` — three files in that directory reference muster points and all three must be updated deliberately, not until-green.

```bash
git add src/game/managers/MinionSpawner.ts src/content/validate.ts tests/game/minions
git commit -m "feat(map): a wave musters on a declared slot, not on a derived midpoint

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 7: A camp is a place; a monster is a thing that fills it

`MonsterPreset` is 21 entries that mix **where** with **what**: a pack of three wolves is three entries carrying the same `campId` to tie them together, each repeating the camp's position. `campId` exists only because the two are stored together — `Monster.alertCamp` uses it to wake the pack when one member is hit.

Split them, as spec §6 says: nine slots and six monster definitions, with `campId` gone.

**Files:**
- Modify: `src/game/preset.ts`, `src/game/Game.ts`, `src/game/gameObject/attackableUnits/Monster.ts`
- Modify: `src/content/bundledPack.ts`
- Test: `tests/game/monsters/*` (whatever exists), `tests/content/monsterDefault.test.ts`

**Interfaces:**
- Consumes: `map.slots.neutral` (Task 3) — `role`, `x`, `y`, `r`; `MonsterDef` (batch 1) — `id`, `name`, `fills: string[]`, `health`; `PackRegistry.monstersFilling(role)` (batch 1, still unread by anything).
- Produces: `MonsterPreset` and `campId` are **deleted**. `Game.spawnJungle()` resolves each neutral slot through `monstersFilling`.

- [ ] **Step 1: Write the failing tests**

```ts
it('fills every neutral slot the map declares', () => {
  const game = makeGame({ map: summonersRift });
  const monsters = onlyMonsters(game.objects);
  expect(summonersRift.slots.neutral.length).toBe(9);
  for (const slot of summonersRift.slots.neutral) {
    const here = monsters.filter(m => distance(m.position, slot) <= slot.r);
    expect(here.length, `nothing filled the ${slot.role} camp`).toBeGreaterThan(0);
  }
});

it('leaves a slot empty rather than failing when no monster fills its role', () => {
  const withStranger = withNeutralSlots(summonersRift, s => [...s, { role: 'nobody-fills-this', x: 3000, y: 3000, r: 100 }]);
  expect(() => makeGame({ map: withStranger })).not.toThrow();
});

it('wakes the whole camp when one member is hit, without a campId', () => {
  // alertCamp used to read `preset.campId`. The camp is now the slot, so
  // membership is a fact the slot already carries and needs no shared field.
  const game = makeGame({ map: summonersRift });
  const slot = summonersRift.slots.neutral.find(s => s.role === 'wolves')!;
  const pack = onlyMonsters(game.objects).filter(m => distance(m.position, slot) <= slot.r);
  expect(pack.length).toBeGreaterThan(1);

  const attacker = makeChampion(game);
  pack[0].takeDamage(1, attacker);
  for (const member of pack) {
    expect(member.actionState, 'a camp wakes together').toBe(pack[0].actionState);
  }
});
```

The second case is the rule from spec §6: *a slot nobody fills is left empty and the map still plays*. A map that referenced a monster no installed pack provides must not be unplayable — that is the whole reason `role` is a free string core never interprets.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — `spawnJungle` iterates `MonsterPreset` and knows nothing about slots.

- [ ] **Step 3: Split the data**

Six monster definitions in the bundled pack's `monsters` section: the epic one, the two buff camps, wolves, gromp, raptors — each with `fills` naming the role or roles it can occupy, and its own count if a camp holds several bodies. Nine neutral slots already exist from Task 3.

`Game.spawnJungle()` walks `map.slots.neutral`, asks `contentRegistry().monstersFilling(slot.role)`, and takes the first — install order decides, which is `PackRegistry`'s documented rule and already has a doc comment saying the match config may override it later.

`Monster.alertCamp` stops reading `campId`. Camp membership is now "inside this slot", which is a fact the slot already carries; give the monster the slot it was spawned into rather than re-deriving membership from positions every alert.

**`killCredit` must stay `'minion'` on these** — camps are CS, and `Pet` needing `'none'` explicitly is the precedent for how easily this gets lost when a constructor path changes.

- [ ] **Step 4: Verify and commit**

```bash
git add src/game/preset.ts src/game/Game.ts src/game/gameObject/attackableUnits/Monster.ts src/content/bundledPack.ts tests
git commit -m "feat(map): a camp is a slot, a monster is a thing that fills it

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 8: Lanes come from the map, and a map may have none

The last hard-coded geometry. `lanes.ts` holds three waypoint paths as a module literal keyed by the bare strings `'top' | 'mid' | 'bot'`, and — per the survey's SURPRISE 4 — `getLaneWaypoints`, `nearestLane`, `laneApproach`, `assignLanes` and `TeamBlackboard`'s bucketing all assume those exact three exist for the process lifetime. Task 2 made the computation lazy; this task makes the *content* the map's.

**A map with no lanes must play.** Spec §7 is explicit that this is the cheap half of the battle-royale question: no `lanes[]` means no waves, `BotBrain`'s **PUSH** posture finds no objective and falls through to ROAM and FIGHT, which are existing paths. Nothing in the posture chain changes.

**Files:**
- Modify: `src/game/lanes.ts`, `src/game/ai/LaneObjectives.ts`, `src/game/ai/TeamBlackboard.ts`, `src/game/managers/MinionSpawner.ts`
- Test: `tests/game/minions/Lanes.test.ts`, `tests/game/ai/TeamBlackboard.lanes.test.ts`, `tests/game/ai/BotBrain.push.test.ts`

**Interfaces:**
- Consumes: `map.lanes` (optional) from Task 3/4's threading.
- Produces: lane identity is the map's `LaneDefinition.id`, not a member of a frozen `Lane` enum. `LANES` becomes a per-match list.

- [ ] **Step 1: Write the failing tests**

```ts
it('walks the lanes the map declares, whatever they are called', () => {
  const twoLane = { ...summonersRift, lanes: summonersRift.lanes!.slice(0, 2) };
  const game = makeGame({ map: twoLane });
  expect(laneIdsFor(game)).toEqual(twoLane.lanes.map(l => l.id));
});

it('plays a map with no lanes at all', () => {
  const laneless = { ...summonersRift, lanes: undefined };
  const game = makeGame({ map: laneless });
  expect(() => runTicks(game, 120)).not.toThrow();
  expect(onlyMinions(game.objects)).toHaveLength(0);
});

it('a bot on a laneless map falls through PUSH to a posture it can act on', () => {
  const board = makeBlackboard({ map: { ...summonersRift, lanes: undefined } });
  const trace = driveTicks(brain, bot, board, 12);
  expect(countOf(trace, 'PUSH')).toBe(0);
  expect(trace.every(t => t.posture !== undefined)).toBe(true);
});
```

The third case uses `tests/game/ai/botTrajectory.ts`'s `driveTicks`. **Use it rather than calling `drive` once.** This codebase's own notes are blunt about why: a posture layer is a feedback loop, a rule can be stable within one tick and unstable across two, and every turret-standoff bug it has shipped was invisible to a suite that took one sample.

- [ ] **Step 2: Run to verify they fail**

Expected: the laneless cases throw or hang — `LANE_WAYPOINTS` has no entry, and something walks `undefined`. Record the actual message; it tells you which of the five assuming call sites to fix first.

- [ ] **Step 3: Make the lane set the map's**

`lanes.ts` stops exporting a literal and starts answering about the active map. Keep `getLaneWaypoints`, `nextWaypointIndexFrom` and `LANES` as names — the four importers and seven test files depend on them — but make them read the match's lane set.

Waypoint 0 of every lane is the fountain, which is why the old hard-coded `startWaypointIndex: 1` pointed *backwards* on MID and BOT and why `nextWaypointIndexFrom` projects the muster onto the path instead. That projection stays exactly as it is; it is now projecting onto a lane the map declared rather than onto a module constant.

`TeamBlackboard`'s lane buckets are built inside its **one** pass over `objectManager.objects` — the only full-list walk the whole AI layer is allowed, and `tests/game/ai/TeamBlackboard.lanes.test.ts` is a source scan that counts the reads and fails on a second one. Making the lane set dynamic must not add a second walk. If your first attempt needs one, that is a signal to bucket by lane id inside the existing pass rather than to re-scan per lane.

- [ ] **Step 4: Verify and commit**

Run `npx vitest run tests/game/ai/ tests/game/minions/` — the AI suites are where a lane assumption breaks, and `TeamBlackboard.lanes.test.ts` is the scan that will tell you if you added a walk.

```bash
git add src/game/lanes.ts src/game/ai src/game/managers/MinionSpawner.ts tests/game
git commit -m "feat(map): lanes come from the map, and a map may declare none

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 9: A second map, deliberately hostile

Spec §8.2 is unusually specific about this, and gives its reasons: a reference pack cures "the scan found nothing" but **not** coverage, and with maps it is worse — twelve nav/lane/muster tests use Summoner's Rift's polygon soup as a stress fixture, and the `NavGrid` clearance bug only surfaced because SR's jungle has 60-90px gaps.

So the reference map is not a smoke test. It is a **hostile fixture**, and the two properties below are load-bearing rather than decorative:

- **A corridor of 60-90px.** Narrower than that and nothing can path; wider and the clearance maths is never exercised. The `NavGrid` bug this catches was a conservative approximation whose error matched the feature size — it refused cells with 19px to spare and broke a stacked champion's walkable map into five pieces.
- **An asymmetric structure row.** SR's two rows are not symmetric (one turret listed on one side, two on the other), and the muster rule is phrased as "the two nearest the fountain" *because* of that. A symmetric fixture would let a rule that assumes symmetry pass.

**Files:**
- Create: `packs/reference/map.ts`
- Modify: `packs/reference/pack.ts`
- Test: `tests/content/referenceMap.test.ts` (create)

**Interfaces:**
- Consumes: `MapDefinition`, `ContentPackData` (Task 1).
- Produces: `export const referenceMap: MapDefinition`, carried in the reference pack's `data.maps`.

- [ ] **Step 1: Write the failing test — the hostility is the assertion**

`wallGapWidths` does not exist — write it in the test file. It does not need to be a general narrowest-corridor solver, which is hard; it needs to answer *this* question about *this* fixture. The cheap honest version is to sample the map on a grid at the nav cell size, mark cells blocked by any wall polygon, and report the run lengths of free cells between blocked ones along each row and column. `NavGrid.fromPolygons` already rasterises exactly this way, so the measurement matches what the pathfinder will actually see rather than what the polygons look like on paper.

```ts
it('has a corridor between 60 and 90 px, which is what exercises NavGrid clearance', () => {
  const gaps = wallGapWidths(referenceMap.terrain.wall, referenceMap.size);
  expect(gaps.some(g => g >= 60 && g <= 90)).toBe(true);
});

it('has an asymmetric structure row, which is what the muster rule assumes', () => {
  const perFaction = countBy(referenceMap.slots.structure, s => s.faction);
  expect(new Set(perFaction.values()).size).toBeGreaterThan(1);
});

it('is navigable end to end despite that', () => {
  const nav = new NavigationSystem(wallPolygons(referenceMap), referenceMap.size);
  const path = nav.findPath(spawnOf(referenceMap, 'a'), spawnOf(referenceMap, 'b'));
  expect(path.length).toBeGreaterThan(1);
});
```

The third case is what stops the first two being satisfied by a map nobody can walk across. Write all three before drawing anything.

- [ ] **Step 2: Run to verify they fail**

Expected: module not found.

- [ ] **Step 3: Draw it**

`tools/shape-maker/` is a standalone p5 app for exactly this — `a` add, `d` delete, `e` export, `i` import — and it emits the polygon point arrays this format wants.

Keep it **small and legible**: this is a fixture, not a second Summoner's Rift. Two factions, one or two lanes, a handful of walls including the narrow corridor, an asymmetric structure row, and at least one neutral slot with a `role` the reference pack's own monster fills so Task 7's path is exercised by something other than the bundled pack.

It must be visibly **not** a Riot map — that is the point of the reference pack, and batch 4 is about to move the Riot one out.

- [ ] **Step 4: Verify and commit**

```bash
git add packs/reference/map.ts packs/reference/pack.ts tests/content/referenceMap.test.ts
git commit -m "feat(content): a second map, deliberately hostile

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 10: Choosing a map, and playing the one you chose

The seam is not proven until a player can pick the second map and land in it. `MapDefinition` has been dead since batch 1 and `PackRegistry.maps()` still has no reader outside tests.

The control belongs in the match-config panel's **Trận đấu** tab (rules and world). Read `docs/` and `CLAUDE.md` on that panel first — the two rules it is built on are that everything it changes persists, and that **the shared panel must not import a `src/game/` runtime value**, with `MatchDirectorSource.ts` the single exempt file. `tests/scenes/matchConfigChunk.test.ts` and `tests/game/config/matchConfigSource.contract.test.ts` are what enforce both, and the contract test runs one suite against **both** implementations — a control has to be served by `PregameConfigSource` *and* `MatchDirectorSource` or it does not land.

Task 1's data half is what makes this possible without dragging the engine into the menu chunk.

**Files:**
- Modify: `src/game/config/PregameConfig.ts`, `src/game/hud/config/MatchConfigSource.ts`, `src/game/hud/config/PregameConfigSource.ts`, `src/game/hud/config/MatchDirectorSource.ts`, `src/game/hud/config/RulesTab.vue`
- Modify: `src/scenes/GameScene.ts`
- Test: `tests/game/config/matchConfigSource.contract.test.ts`, `tests/e2e/verify-map-picker.mjs` (create)

- [ ] **Step 1: Extend the contract test first**

It is one suite run against both sources, so a case added there is a case both must satisfy. Add: reading the available maps, reading the chosen map, choosing a different one, and that the choice survives a round trip through storage. Run it and watch **both** implementations fail.

Changing the map of a **running** match is a different question from choosing one before it starts — a live match has a terrain map, a nav grid and objects standing on the old geometry. Decide deliberately: either `MatchDirectorSource` reports the live map read-only and offers the choice only through a reset, or it rebuilds the world. Whichever you choose, say it in the doc comment and make the contract test assert it, because the panel is mounted over a paused match and **`Game.update()`/`draw()` return early while paused, so nothing has settled** — that window is where four bugs have already come from.

- [ ] **Step 2: Persist the choice**

`PregameConfig` gains the chosen map id, sanitised the way every other field is: validated independently, falling back to its own default, so a config naming a map no installed pack provides still boots. The qualified id is what is stored — Ruling 3 above, and batch 2's last bug was exactly a bare id where a qualified one was expected.

- [ ] **Step 3: The control**

A select in the Trận đấu tab listing `contentCatalog().maps()`. **Every HUD control needs a touch handler beside its click handler** — `GameScene` calls `preventDefault()` on every touch on the page, so the browser synthesises neither the trailing `click` nor its own scrolling, and a plain `@click` is dead under a thumb and perfect under a mouse. `RulesTab.vue` and `RosterTab.vue` carry the shapes to copy.

- [ ] **Step 4: Boot the chosen map**

`GameScene.startGame()` resolves the configured map id through `contentCatalog()` and hands the definition to `Game`. A missing id falls back to the first available map rather than throwing — a stale config must not make the game unbootable.

- [ ] **Step 5: The e2e proof**

`tests/e2e/verify-map-picker.mjs`, on `tests/e2e/harness.mjs`, ending in a numeric summary with **no screenshots**. It must: open the panel, pick the reference map, start a match, and assert the world is that map — the terrain polygon count, the world size, and the structure count all differ from Summoner's Rift, so assert on those rather than on a picture.

Note the harness now provides `guard(body)`; a bare `try`/`finally` is banned by `tests/scripts/e2eHarness.test.ts`, because `process.exit()` inside a `finally` swallowed a mid-run throw and let a script print "all checks passed" having run only a prefix of its checks.

**Prove this script falsifiable once, now, while it is new**, and record both summaries.

- [ ] **Step 6: Full verify and commit**

Run `npm run verify`, `npm run chunks:check`, `npm run e2e:pack` and the new script. Report all four.

```bash
git add src/game/config/PregameConfig.ts src/game/hud/config src/scenes/GameScene.ts tests package.json
git commit -m "feat(map): choose a map before the match, and play the one you chose

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

## What batch 4 inherits

- `src/content/maps/summonersRift.ts` is the file batch 4 moves into `packs/riot/`, together with the 240 spell files and 368 art files. By then nothing reads it directly — the registry does.
- `src/content/bundledPack.ts` is the adapter batch 4 **deletes**, replacing it with a real `packs/riot/pack.ts`.
- The 15 seams listed in spec §8.1 have to be repointed, and `@lol2d/core/seams` published so a pack repo can run them against its own tree.
- `Monster.ts:154` still calls `AssetManager.get(preset.avatar)` typed against core's generated `AssetKey` — the one avatar path batch 2's `packAsset` sweep missed, and it bites the moment a pack supplies monster art.

### The chunk-hash cascade, and why batch 4 is where it dies

Measured on `main`: a built `spell-yasuo-*.js` carries `from "./game-<hash>.js"` — a **static import of the game chunk by its hashed filename**. So any change under `src/game/` re-hashes `game`, which changes the bytes of all 59 spell chunks, which re-hashes every one of them. A user's browser then re-downloads dozens of files it already had, and `workbox-precaching` installs changed entries **strictly sequentially** (upstream `GoogleChrome/workbox#2528`), which is why the update prompt takes 19 seconds to become actionable on a normal deploy. `docs/COMBAT_TEXT_PERF.md`'s sibling report on branch `perf-pwa-update` has the measurements.

A migrated pack spell has no such import. `packs/reference/spells/Vera_Q.ts` imports exactly one thing — `import type { ContentApi }` — which is erased at compile time; the api arrives as the factory's argument. A pack spell module therefore has **no runtime dependency on core at all**, and its chunk's bytes do not move when core does.

So the cascade should die as a consequence of batch 4 doing its job. **Do not assume it did.** Batch 4 owes a guard that measures the thing the player actually pays:

> Build. Change one thing under `src/game/`. Build again. Assert the emitted `spell-*.js` **filenames are unchanged**.

If they move, the migration left a static edge from a pack into core, and that is a defect in the migration rather than a chunking nicety. Do not fix the cascade on `main` beforehand — it would be a fix written for a module graph batch 4 replaces.
