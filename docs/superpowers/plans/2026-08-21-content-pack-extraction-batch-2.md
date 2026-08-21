# Content Pack Extraction — Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every champion, spell class and summoner spell the game offers is served by `PackRegistry`, and `packs/reference`'s Vera is selectable and playable in a real match.

**Architecture:** Batch 1 built the seam and left it dead — nothing in `src/` imports `install.ts`, so the reference pack ships and cannot be played. This batch makes the seam load-bearing *before* any content moves. The existing Riot content is wrapped, in place, as a `ContentPack` by an adapter (`src/content/bundledPack.ts`) built from `CHAMPION_KITS`, `spellModules` and the generated `spellCatalog`. The roster, the spell loader and `preset.ts` then read `PackRegistry` and nothing else. When batch 4 physically moves the content into `packs/riot/`, the consumption path is already the pack path and the adapter is deleted — the move becomes a file move rather than a rewrite.

Three contract gaps that only a real pack exposes get closed on the way: spells must be able to arrive lazily (240 dynamic imports, not 240 eager classes), a pack must carry its own spell *display* data (the pregame screen renders from data, never from classes), and a pack's types must reach it without importing `@/game/`.

**Tech Stack:** TypeScript, Vite, Vitest (`environment: 'node'`), Playwright via `tests/e2e/harness.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-20-content-pack-extraction-design.md` — this batch is a re-scoping of spec step 6's *consumption* half, taken before steps 4-5, for the reason in the Rulings section below.

**Branch:** `content-pack-batch-2`, worktree `/Users/hoangtran/Desktop/Github/LOL2D-content-batch2`, based on `content-pack-batch-1` @ `0c294ba`.

## Global Constraints

- **Do not push. Do not merge to `main`.** `.github/workflows/build.yml` triggers on push to `[dev, main]` and on pull requests. Both `content-pack-batch-1` and `content-pack-batch-2` stay local until the user says otherwise.
- **`npm run verify` must be green at the end of every task.** It is `assets:check` + `ability:check` + `typecheck` + `typecheck:core` + Vitest + `build`. Baseline at `0c294ba`: **249 test files, 3974 tests, 0 failures.** A task that moves the test count must say so in its report and say why.
- **Every test must be shown to fail first.** Write it, run it, read the message. Two failure shapes have already shipped on this project: asserting on state the code under test already produced, and a check that computes its expected value by calling the thing it checks. Batch 1 shipped two vacuous tests past review; both were mine.
- **`Array.prototype.filter` cannot narrow types** here (`src/types/global.d.ts` re-declares it). Write a plain loop, never a cast.
- **Concurrent agents share one working tree.** Commit with explicit paths — never `git add -A`, never `.`, never a bare `git commit`.
- **Prettier** (`.prettierrc`: 2 spaces, single quotes, 100 columns). Format only files you touched; never run `--write` across the tree.
- **p5 runs in global mode.** `pop`, `text`, `fill`, `line`, `point`, `random`, `map`, `scale`, `rotate`, `image`, `color` are globals; a local of the same name silently shadows one and `tsc` cannot see it.
- **Spell names are Riot's** (`'<tên tiếng Việt> (Champion_Slot)'`). Nothing in this batch rewrites a spell name.
- **Vietnamese is the UI language.** Any user-visible string added here is Vietnamese.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK`.

## Rulings already made (do not re-litigate)

1. **Spec steps 4-8 are four batches, not one.** This is batch 2 (the roster goes through the seam); batch 3 is spec steps 4-5 (map becomes data — a survey of its touch points is saved at `.superpowers/surveys/2026-08-21-map-touchpoints.md`); batch 4 is the physical content move plus the 15 seam repoints; batch 5 is the repo split. Reason: 240 spell files and 414 assets moved in the same batch that rewires the roster gives a reviewer no way to tell a wiring defect from a move defect.
2. **The Riot content becomes a pack *in place* before it moves.** An adapter is ~100 lines and makes the seam carry all 40-odd champions immediately; every coupling the seam cannot express surfaces now, with the content still where it has always been and easy to fix.
3. **Types travel by `import type`; values travel through `ContentApi`.** A pack that is its own package still depends on core's `.d.ts` at build time — type-only imports create no runtime coupling and no second copy of anything. Only *values* have to be injected. `src/content/types.ts` is the pack-facing type barrel.
4. **The adapter lives in `src/content/`, not in `packs/`.** `packs/**` is about to be forbidden from importing `@/game/`, and the adapter's whole job is to read `@/game/config/spellCatalog`. It is core-side scaffolding with a scheduled death, and filing it under `packs/` would either weaken the boundary scan or need an exemption.
5. **The bundled pack's id is `riot`.** It is what the content is, it is what the directory becomes in batch 4, and a euphemism would make the qualified ids change again later.

## File Structure

| File | Created / Modified | Responsibility |
|---|---|---|
| `src/content/types.ts` | create | The pack-facing type barrel. Everything a pack may `import type`, re-exported from one place. |
| `src/content/ContentPack.ts` | modify | `SpellSource`/`SpellLoader`, `SpellDisplayData`, `ContentPack.spellDisplay`, `ChampionEntry.attack`/`playable`. |
| `src/content/ContentApi.ts` | modify | Adds `requireChargeSpec`. |
| `src/content/validate.ts` | modify | Validates the new sections; rejects nothing that was valid before. |
| `src/content/PackRegistry.ts` | modify | Duplicate-id rejection, lazy spell resolution, `spellDisplay`, `championSpellDisplay`. |
| `src/content/registry.ts` | create | The process's single `PackRegistry` and the one-shot install. |
| `src/content/bundledPack.ts` | create | The in-place Riot adapter. Deleted in batch 4. |
| `packs/reference/pack.ts` | modify | Display data, `attack`, `playable` for Vera. |
| `src/game/config/spellCatalog.ts` | modify | Roster reads come from the registry; the generated catalogue is read only by the adapter. |
| `src/game/spellRegistry.ts` | modify | A thin adapter over `PackRegistry.loadSpellClass`. |
| `src/game/preset.ts` | modify | `PLAYABLE_CHAMPION_KITS`, `spellGroups`, `planRandomKit` read the registry. |
| `src/scenes/setup/pregameCatalog.ts` | modify | Shelves built from the registry. |
| `tests/content/*.test.ts` | create/modify | Contract, registry and boundary tests. |
| `tests/e2e/verify-pack-champion.mjs` | create | Vera picked and cast in a real browser. |

---

### Task 1: The pack-facing type barrel, and the boundary that makes it necessary

A pack writing a channelled or charged spell needs `CastContext`, `CastSpec` and the rest of `src/game/spell/runtime/types.ts`. Today it can only get them by importing `@/game/spell/runtime/types` directly — which works while `packs/` is in this repo and stops working the moment it is not. `src/content/types.ts` is the one place a pack imports types from, and a source scan over `packs/**` is what keeps it the only place.

`requireChargeSpec` is the one *value* in that module a pack needs, so it joins `isChargeActivation` on `ContentApi`.

**Files:**
- Create: `src/content/types.ts`
- Modify: `src/content/ContentApi.ts`
- Modify: `packs/reference/spells/Vera_Q.ts` (import path only, if it names any runtime type)
- Test: `tests/content/packBoundary.test.ts` (exists — extend it)
- Test: `tests/content/contentTypes.test.ts` (create)

**Interfaces:**
- Consumes: nothing from a later task.
- Produces: `src/content/types.ts` re-exporting every name listed in Step 3. Task 4's adapter and Task 3's reference-pack edit both import from it.

- [ ] **Step 1: Extend the boundary scan that already exists**

`tests/content/packBoundary.test.ts` is already the rule: it walks `packs/**`, strips comments, parses static imports, re-exports and dynamic imports, and rejects any `@/` specifier outside `ALLOWED_TYPE_ONLY` — plus any relative escape into `/src/`, and any allowed specifier imported as a *value* rather than a type. Read it in full before touching it; it is better than a fresh scan would be and none of its logic changes.

The change is one line: `'@/content/types'` joins `ALLOWED_TYPE_ONLY`. Update the doc comment above that constant — it currently says "the only two specifiers"; there are three now, and the third is the one a pack will actually use most.

- [ ] **Step 2: Prove the scan still catches what it is for**

Temporarily add `import type { CastContext } from '@/game/spell/runtime/types';` to `packs/reference/spells/Vera_Q.ts`.

Run: `npx vitest run tests/content/packBoundary.test.ts`
Expected: FAIL, naming `spells/Vera_Q.ts: @/game/spell/runtime/types`.

Then change it to `import type { CastContext } from '@/content/types';` and run again.
Expected: PASS — which is the whole point of this task, stated as a test.

Then remove the temporary import. Record both outcomes in your report.

- [ ] **Step 3: Write `src/content/types.ts`**

Every name below is re-exported. Nothing is redefined — a second declaration of `CastContext` would be a second type with the same name, and the two would drift.

```ts
/**
 * Everything a content pack may import as a type.
 *
 * Types and values leave core by different doors, and the reason is what a
 * pack becomes: its own package, compiled against core's `.d.ts` and handed
 * core's runtime objects. A type-only import survives that intact — it is
 * erased before anything runs, so it creates no second copy of a class and no
 * `instanceof` that answers wrong. A *value* import would create exactly
 * those, which is why `ContentApi` exists and why nothing here is a value.
 *
 * So: `import type { CastContext } from '@/content/types'` is correct and
 * always will be; `import { Slow } from '@/game/gameObject/buffs/Slow'` is
 * not, and `tests/content/packBoundary.test.ts` fails the build over it.
 */
export type {
  ActivationPattern,
  ActiveSpec,
  AttackOrderPolicy,
  CancelReason,
  CastContext,
  CastSpec,
  ChannelSpec,
  ChargeActivation,
  ChargeCastSpec,
  ChargeSpec,
  CooldownPolicy,
  CooldownStartPoint,
  InterruptPolicy,
  ResourceCommitPoint,
  ResourcePolicy,
  SpellRuntimeState,
  TargetingMode,
  Vec2,
} from '@/game/spell/runtime/types';

export type { ContentApi } from './ContentApi';
export type {
  ChampionEntry,
  ContentPack,
  ContentPackFactory,
  Faction,
  LaneDefinition,
  MapDefinition,
  MinionSlot,
  MonsterDef,
  NeutralSlot,
  PackManifest,
  SpawnSlot,
  SpellClass,
  StructureKind,
  StructureSlot,
} from './ContentPack';
```

Later tasks add to the second list as they add to the contract — `SpellLoader` and `SpellSource` in Task 2, `SpellDisplayData` and `ChampionAttack` in Task 3. Do not list them now: a barrel exporting a name that does not exist is a compile error.


- [ ] **Step 4: Write the barrel-completeness test**

Create `tests/content/contentTypes.test.ts`. A type-only barrel has no runtime surface to assert on, so this scans the source text instead — the same idiom as the other seam scans in `tests/content/`.

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '../../', path), 'utf8');

describe('src/content/types.ts', () => {
  it('re-exports every type src/game/spell/runtime/types.ts declares', () => {
    const runtime = read('src/game/spell/runtime/types.ts');
    const declared = [
      ...runtime.matchAll(/^export (?:interface|type) (\w+)/gm),
    ].map(m => m[1]);

    expect(declared.length).toBeGreaterThan(10);

    const barrel = read('src/content/types.ts');
    const missing = declared.filter(name => !new RegExp(`\\b${name}\\b`).test(barrel));
    expect(missing, 'a pack cannot import these — add them to the barrel').toEqual([]);
  });
});
```

- [ ] **Step 5: Run both tests**

Run: `npx vitest run tests/content/contentTypes.test.ts tests/content/packBoundary.test.ts`
Expected: PASS. If `contentTypes` fails, the barrel is missing a name the runtime module declares — add it rather than weakening the test.

- [ ] **Step 6: Add `requireChargeSpec` to `ContentApi`**

In `src/content/ContentApi.ts`, extend the existing import from `@/game/spell/runtime/types` to bring in `requireChargeSpec`, add `requireChargeSpec: typeof requireChargeSpec;` to the `ContentApi` interface beside `isChargeActivation`, and add it to the frozen object in `buildContentApi()`. It sits at the top level, not in a namespace — same reasoning as `isChargeActivation` and `beamBoundingBox`, which the file's own doc comment already explains.

- [ ] **Step 7: Run the whole content suite**

Run: `npx vitest run tests/content/`
Expected: PASS. `contentApi-surface-seam.test.ts` derives its required symbol set from the real spell tree, so it will not object to an addition.

- [ ] **Step 8: Commit**

```bash
git add src/content/types.ts src/content/ContentApi.ts tests/content/contentTypes.test.ts tests/content/packBoundary.test.ts
git commit -m "feat(content): give packs a type barrel and forbid every other door

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 2: Spells may arrive lazily

`ContentPack.spells` is `Record<string, SpellClass>` — eager classes. The reference pack has four and does not care. The Riot pack has 240, and core deliberately does **not** load them eagerly: `src/generated/spellModules.ts` is a map of dynamic imports and `src/game/spellRegistry.ts` fetches per champion, which is the whole of a chunking optimisation the codebase calls Stage 4. An adapter that handed the registry 240 eager classes would undo it silently — the build would still pass and every match would download every spell.

So a pack's spell value may be a class **or** a thunk returning one. Stage 2 wants the same shape for its own reasons: a pack fetched at runtime will not want to instantiate its whole kit to be installed.

**Files:**
- Modify: `src/content/ContentPack.ts`
- Modify: `src/content/validate.ts` (`checkSpells`, around line 44)
- Modify: `src/content/PackRegistry.ts`
- Modify: `src/content/types.ts` (add `SpellSource`, `SpellLoader` to the export list)
- Test: `tests/content/packRegistry.test.ts`, `tests/content/validate.test.ts`

**Interfaces:**
- Consumes: `src/content/types.ts` from Task 1.
- Produces:
  - `type SpellLoader = () => Promise<SpellClass>`
  - `type SpellSource = SpellClass | SpellLoader`
  - `ContentPack.spells?: Record<string, SpellSource>`
  - `PackRegistry.spellClass(qualifiedId: string): SpellClass | null` — unchanged signature, still synchronous, now returns `null` for a loader that has not been resolved yet
  - `PackRegistry.loadSpellClass(qualifiedId: string): Promise<SpellClass | null>` — resolves a loader at most once per id and memoises the result
  - `PackRegistry.hasSpell(qualifiedId: string): boolean`
  - `PackRegistry.spellIds(): readonly string[]`

- [ ] **Step 1: Write the failing registry tests**

Append to `tests/content/packRegistry.test.ts`. Note what each case is actually for: the first proves laziness (the loader is not called by `install`), the second proves memoisation (two concurrent callers share one import), the third proves the sync door stays shut until the async one has been through.

```ts
it('does not call a spell loader at install time', () => {
  const registry = new PackRegistry();
  let calls = 0;
  registry.install({
    manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
    spells: {
      Late: () => {
        calls += 1;
        return Promise.resolve(class Late {});
      },
    },
  });
  expect(calls).toBe(0);
});

it('resolves a loader once however many callers ask', async () => {
  const registry = new PackRegistry();
  let calls = 0;
  class Late {}
  registry.install({
    manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
    spells: {
      Late: () => {
        calls += 1;
        return Promise.resolve(Late);
      },
    },
  });
  const [a, b] = await Promise.all([
    registry.loadSpellClass('lazy:Late'),
    registry.loadSpellClass('lazy:Late'),
  ]);
  expect(calls).toBe(1);
  expect(a).toBe(Late);
  expect(b).toBe(Late);
});

it('reports a loader-backed spell as absent to the synchronous reader until it lands', async () => {
  const registry = new PackRegistry();
  class Late {}
  registry.install({
    manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
    spells: { Late: () => Promise.resolve(Late) },
  });
  expect(registry.hasSpell('lazy:Late')).toBe(true);
  expect(registry.spellClass('lazy:Late')).toBeNull();
  await registry.loadSpellClass('lazy:Late');
  expect(registry.spellClass('lazy:Late')).toBe(Late);
});

it('still serves an eagerly declared class synchronously', () => {
  const registry = new PackRegistry();
  class Now {}
  registry.install({
    manifest: { id: 'eager', version: '1.0.0', coreRange: '^1' },
    spells: { Now },
  });
  expect(registry.spellClass('eager:Now')).toBe(Now);
});
```

- [ ] **Step 2: Write the failing duplicate-id test**

Same file. This closes an Important finding from batch 1's whole-branch review: two packs sharing an id silently overwrite each other's spells and double their champions.

```ts
it('refuses a second pack with an id already installed', () => {
  const registry = new PackRegistry();
  const pack = { manifest: { id: 'twice', version: '1.0.0', coreRange: '^1' } };
  registry.install(pack);
  expect(() => registry.install({ ...pack, manifest: { ...pack.manifest, version: '2.0.0' } }))
    .toThrow(/twice/);
  expect(registry.champions()).toHaveLength(0);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/content/packRegistry.test.ts`
Expected: FAIL — `registry.loadSpellClass is not a function`, `registry.hasSpell is not a function`, and the duplicate case failing because no error is thrown.

- [ ] **Step 4: Widen the contract**

In `src/content/ContentPack.ts`, beside the existing `SpellClass`:

```ts
/** A spell class that has not been fetched yet. Resolved at most once. */
export type SpellLoader = () => Promise<SpellClass>;

/**
 * How a pack hands over a spell.
 *
 * A class outright for a small pack; a thunk for a large one. The Riot pack is
 * 240 spells behind `src/generated/spellModules.ts`'s dynamic imports, and
 * handing those over eagerly would put every spell in the game into the first
 * chunk a match downloads — a chunking optimisation this codebase already made
 * once, on purpose, and which nothing in a type would have caught being undone.
 */
export type SpellSource = SpellClass | SpellLoader;
```

and change `ContentPack.spells` to `Record<string, SpellSource>`.

- [ ] **Step 5: Teach `validate.ts` the union**

`checkSpells` currently requires `typeof value === 'function'`. Both arms of `SpellSource` *are* functions — a class is a function — so the existing check still passes both, and no error message needs to change. Add the doc sentence saying so, and add one case to `tests/content/validate.test.ts` proving a thunk-valued `spells` section validates:

```ts
it('accepts a lazy spell source', () => {
  const result = validatePack({
    manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
    spells: { Late: () => Promise.resolve(class {}) },
  });
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 6: Implement in `PackRegistry`**

Replace the single `spells` map with two, plus the duplicate-id guard at the top of `install()`, before validation writes anything:

```ts
private readonly sources = new Map<string, SpellSource>();
private readonly resolved = new Map<string, SpellClass>();
private readonly inFlight = new Map<string, Promise<SpellClass | null>>();
private readonly installedIds = new Set<string>();
```

In `install()`, immediately after the validation block and before the first write:

```ts
if (this.installedIds.has(packId)) {
  throw new Error(`content pack rejected:\n  pack id "${packId}" is already installed`);
}
```

Note the ordering: validation first (a malformed pack is a worse error and should be named as such), then the duplicate check, then the writes. `install()` still leaves no trace when it throws.

The read side:

```ts
hasSpell(qualifiedId: string): boolean {
  return this.sources.has(qualifiedId);
}

spellIds(): readonly string[] {
  return [...this.sources.keys()];
}

/** The class, if it is already here. A loader that has not run answers `null`. */
spellClass(qualifiedId: string): SpellClass | null {
  return this.resolved.get(qualifiedId) ?? null;
}

/**
 * The class, fetching it if it has to.
 *
 * Memoised on the promise, not on the result, so two callers racing the same
 * spell share one import instead of starting two.
 */
async loadSpellClass(qualifiedId: string): Promise<SpellClass | null> {
  const already = this.resolved.get(qualifiedId);
  if (already) return already;

  const source = this.sources.get(qualifiedId);
  if (!source) return null;

  // A class is itself; only a thunk has anything to await. `prototype` is the
  // discriminator: an arrow function has none, a class always does.
  if (typeof source === 'function' && source.prototype !== undefined) {
    this.resolved.set(qualifiedId, source as SpellClass);
    return source as SpellClass;
  }

  const pending = this.inFlight.get(qualifiedId);
  if (pending) return pending;

  const run = (source as SpellLoader)().then(spellClass => {
    this.resolved.set(qualifiedId, spellClass);
    this.inFlight.delete(qualifiedId);
    return spellClass;
  });
  this.inFlight.set(qualifiedId, run);
  return run;
}
```

`reset()` clears all four containers.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/content/`
Expected: PASS.

- [ ] **Step 8: Add the arrow-vs-class discriminator test**

The `source.prototype !== undefined` line is the one piece of cleverness here and it deserves its own case, because a pack author may reasonably write `Late: function () { return import('./Late'); }` — a `function` expression, which *does* have a prototype and would be misread as a class.

```ts
it('treats a function-expression loader as a loader, not a class', async () => {
  const registry = new PackRegistry();
  class Late {}
  registry.install({
    manifest: { id: 'fn', version: '1.0.0', coreRange: '^1' },
    // eslint-disable-next-line object-shorthand
    spells: { Late: function () { return Promise.resolve(Late); } },
  });
  expect(await registry.loadSpellClass('fn:Late')).toBe(Late);
});
```

Run it. If it fails, the discriminator is wrong and must become explicit instead of structural: add a `lazy()` wrapper to the contract — `export const lazy = (load: SpellLoader): SpellSource => ...` marked with a symbol the registry reads — and require packs to use it. Record which way you went in your report; do **not** leave a structural guess in place after seeing it fail.

- [ ] **Step 9: Add the new names to the type barrel**

`SpellLoader` and `SpellSource` join the `export type { ... } from './ContentPack'` list in `src/content/types.ts`. Re-run `tests/content/contentTypes.test.ts`.

- [ ] **Step 10: Run verify and commit**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: 0 failures; test count up by the cases added here.

```bash
git add src/content/ContentPack.ts src/content/PackRegistry.ts src/content/validate.ts src/content/types.ts tests/content/packRegistry.test.ts tests/content/validate.test.ts
git commit -m "feat(content): let a pack hand over spells lazily, and refuse a duplicate pack id

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 3: A pack carries its own display data

The pregame screen renders a roster of 240 abilities **without loading a single spell class** — that is what `src/generated/spellCatalog.ts` is for, and `spellDisplayOf(id)` is the read. A pack's spells have no entry in that generated file, so today Vera cannot be drawn in the picker even if she is installed. Spec §9 already says a pack repo runs its own `spell-catalog` command; the contract has to have somewhere to put the result.

Two smaller gaps close here as well. `ChampionEntry` has no basic-attack profile, so an installed champion would silently get `DEFAULT_CHAMPION_ATTACK`. And `preset.ts:102` decides whether a kit is a *real, pickable champion* by testing `kit.image?.startsWith('champ_')` — core sniffing an asset-key naming convention that no pack has any reason to follow. That becomes a declared field.

**Files:**
- Modify: `src/content/ContentPack.ts`
- Modify: `src/content/ContentApi.ts`
- Modify: `src/content/validate.ts`
- Modify: `src/content/PackRegistry.ts`
- Modify: `src/content/types.ts`
- Modify: `packs/reference/pack.ts`
- Test: `tests/content/validate.test.ts`, `tests/content/packRegistry.test.ts`, `tests/content/referencePackVeraQ.test.ts`

**Interfaces:**
- Consumes: `SpellSource` (Task 2).
- Produces:
  - `interface SpellDisplayData { name; description; iconKey: string | null; coolDownMs; manaCost; specCoolDownMs }` — deliberately field-for-field identical to `GeneratedSpellDisplay` in `src/generated/spellCatalog.ts`, except that `iconKey` is a plain `string` because a pack's asset keys are its own.
  - `ContentPack.spellDisplay?: Record<string, SpellDisplayData>` — keyed by *local* spell id.
  - `ChampionEntry.attack?: ChampionAttack`
  - `ChampionEntry.playable: boolean`
  - `PackRegistry.spellDisplay(qualifiedId: string): SpellDisplayData | null`

- [ ] **Step 1: Write the failing tests**

In `tests/content/validate.test.ts`:

```ts
it('rejects a spellDisplay entry with no matching spell', () => {
  const result = validatePack({
    manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
    spells: { A: class {} },
    spellDisplay: { B: { name: 'B', description: '', iconKey: null, coolDownMs: 0, manaCost: 0, specCoolDownMs: 0 } },
  });
  expect(result.ok).toBe(false);
  if (result.ok === false) expect(result.errors.join('\n')).toMatch(/spellDisplay.*B/);
});

it('rejects a champion with no playable flag', () => {
  const result = validatePack({
    manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
    spells: { A: class {} },
    champions: [{ id: 'c', name: 'C', image: null, spells: ['A'] }],
  });
  expect(result.ok).toBe(false);
  if (result.ok === false) expect(result.errors.join('\n')).toMatch(/playable/);
});

it('rejects a playable champion with no portrait', () => {
  const result = validatePack({
    manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
    spells: { A: class {}, B: class {}, C: class {}, D: class {} },
    champions: [{ id: 'c', name: 'C', image: null, playable: true, spells: ['A', 'B', 'C', 'D'] }],
  });
  expect(result.ok).toBe(false);
  if (result.ok === false) expect(result.errors.join('\n')).toMatch(/portrait|image/);
});

it('rejects a playable champion without four abilities', () => {
  const result = validatePack({
    manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
    spells: { A: class {} },
    champions: [{ id: 'c', name: 'C', image: 'art', playable: true, spells: ['A'] }],
  });
  expect(result.ok).toBe(false);
});
```

The last two encode what `listSelectableChampions` and `PLAYABLE_CHAMPION_KITS` have always meant by *pickable*: a portrait and all four of Q/W/E/R. Moving that from a filter in core to a validation error in the pack is the point — a pack author who marks a two-ability stub `playable` finds out at install time, not by watching a player pick a champion with two empty slots.

In `tests/content/packRegistry.test.ts`:

```ts
it('serves a pack's display data under the qualified id', () => {
  const registry = new PackRegistry();
  registry.install({
    manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
    spells: { A: class {} },
    spellDisplay: {
      A: { name: 'Chiêu A', description: 'mô tả', iconKey: 'icon_a', coolDownMs: 4000, manaCost: 30, specCoolDownMs: 4000 },
    },
  });
  expect(registry.spellDisplay('p:A')?.name).toBe('Chiêu A');
  expect(registry.spellDisplay('p:missing')).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/content/validate.test.ts tests/content/packRegistry.test.ts`
Expected: FAIL — every new case, because none of the fields exist yet and `validatePack` currently accepts unknown sections silently.

- [ ] **Step 3: Extend the contract**

In `src/content/ContentPack.ts`:

```ts
/**
 * One spell's display fields, as data.
 *
 * Field-for-field the same shape `src/generated/spellCatalog.ts` produces, and
 * that is not a coincidence: the pregame screen renders a whole roster without
 * loading a single spell class, and it can only keep doing that if a pack's
 * spells arrive as data too. A pack repo generates this with its own
 * `spell-catalog` command (spec §9) exactly the way core generates its own.
 *
 * `iconKey` is a plain string, not core's generated `AssetKey` union — a
 * pack's art is its own and its keys type-check inside its own build.
 */
export interface SpellDisplayData {
  name: string;
  /** Vietnamese HTML — `<span class="damage">`/`.buff`/`.time`/plain `<span>`. */
  description: string;
  iconKey: string | null;
  /** The spell's own tuning number, before match rules. */
  coolDownMs: number;
  /** The spell's own tuning number, before match rules. */
  manaCost: number;
  /** `castSpec.cooldown.durationMs` — what a countdown runs before CDR. */
  specCoolDownMs: number;
}

/** A champion's basic-attack profile. Absent means core's default. */
export interface ChampionAttack {
  damage: number;
  attacksPerSecond: number;
  range: number;
}
```

`ChampionAttack` is declared here rather than imported from `@/game/gameObject/attackableUnits/Champion` so the contract file stays readable on its own. It is field-for-field `ChampionAttackTuning`, and Task 4 pins that with a type-level assertion — if the two ever drift, that is the file that stops compiling.

On `ChampionEntry`, add:

```ts
  /**
   * Whether the pregame screen may offer this as a champion.
   *
   * `false` is the normal answer for a shelf — a group of loose abilities, or
   * a one-ability stub that exists only to widen the random pool. Core used to
   * decide this by testing whether the portrait key started with `champ_`,
   * which is a naming convention no pack has any reason to share.
   */
  playable: boolean;
  /** Basic-attack profile. Omitted means core's `DEFAULT_CHAMPION_ATTACK`. */
  attack?: ChampionAttack;
```

and on `ContentPack`, `spellDisplay?: Record<string, SpellDisplayData>;`.

`playable` is **required**, not optional with a default. A pack author choosing must be a choice they made.

- [ ] **Step 4: Extend `validate.ts`**

`checkChampions` gains: `playable` must be a boolean; when it is `true`, `image` must be a non-empty string and `spells` must have exactly four entries; `attack`, when present, must be an object with three finite numbers. A new `checkSpellDisplay` requires every key to name a declared spell and every entry to carry the six fields with the right primitive types. Follow the file's existing style — accumulate into `errors`, never bail on the first.

- [ ] **Step 5: Implement `PackRegistry.spellDisplay`**

A `Map<string, SpellDisplayData>` filled in `install()` under `qualify(packId, localId)`, and read by a method returning `?? null`. Cleared in `reset()`.

`QualifiedChampion` gains `playable` and `attack` by inheriting them through the existing `Omit<ChampionEntry, 'id' | 'spells'>`.

- [ ] **Step 6: Put `lazy()` where a pack can actually reach it**

Task 2 added a `lazy()` wrapper to `src/content/ContentPack.ts` so a `function` expression can be declared as a loader rather than misread as a class. It is a **value**, and `tests/content/packBoundary.test.ts` bans a pack from importing a value out of `@/content/ContentPack` — so as shipped, no pack can call it. Idiomatic arrow thunks do not need it, which is exactly why this would have stayed invisible until someone wrote `function () { return import('./X'); }` and watched their spell get installed as a class.

Values travel through `ContentApi`. Add `lazy` to the `ContentApi` interface and to the frozen object `buildContentApi()` returns, at the top level beside `isChargeActivation` and `requireChargeSpec`. Add a case to `tests/content/contentApi.test.ts` asserting `api.lazy` is a function and that a source it wraps is recognised by the registry as a loader, not a class.

- [ ] **Step 7: Add the new names to the type barrel**

`SpellDisplayData` and `ChampionAttack` join the `export type { ... } from './ContentPack'` list in `src/content/types.ts`. Re-run `tests/content/contentTypes.test.ts`.

- [ ] **Step 8: Give Vera display data**

`packs/reference/pack.ts` gains a `spellDisplay` section for `Vera_Q/W/E/R` and `playable: true` plus an `attack` profile on the champion entry. The four descriptions are Vietnamese HTML in the same idiom as the generated file (`<span class="damage">`, `.buff`, `.time`), and the numbers must be **read from the spell files** — `Vera_Q.ts` and its siblings export their tuning constants, and a description that disagrees with the spell is worse than no description.

`image` is `null` today, so Vera is not `playable` yet — she cannot be, without a portrait. Set `playable: false` here and leave a comment saying the portrait lands in Task 10, where the e2e proof needs it. Do **not** invent art in this task.

- [ ] **Step 9: Run the content suite and verify**

Run: `npx vitest run tests/content/`
Expected: PASS.

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: 0 failures.

- [ ] **Step 10: Commit**

```bash
git add src/content/ContentPack.ts src/content/ContentApi.ts src/content/validate.ts src/content/PackRegistry.ts src/content/types.ts packs/reference/pack.ts tests/content/validate.test.ts tests/content/packRegistry.test.ts
git commit -m "feat(content): a pack carries its own display data, attack profile and playability

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 4: The bundled adapter — the Riot content becomes a pack in place

Nothing moves. `src/content/bundledPack.ts` reads the three sources that already exist — `CHAMPION_KITS` (the roster), `spellModules` (240 dynamic imports) and `spellCatalog` (the generated display data) — and answers with a `ContentPack` whose id is `riot`. From this task on, every champion in the game is a pack champion.

This file has a scheduled death: batch 4 moves the content into `packs/riot/` and deletes it. Say so at the top of the file, because a reader six months from now needs to know it is scaffolding rather than architecture.

**Files:**
- Create: `src/content/bundledPack.ts`
- Modify: `src/content/install.ts`
- Test: `tests/content/bundledPack.test.ts` (create)

**Interfaces:**
- Consumes: `SpellSource`, `SpellDisplayData`, `ChampionEntry.playable`/`attack` (Tasks 2-3).
- Produces: `export const bundledPack: ContentPackFactory`, `export const BUNDLED_PACK_ID = 'riot'`.

- [ ] **Step 1: Write the failing test**

`tests/content/bundledPack.test.ts`. Note the shape of the population assertions: a count that would still pass if the adapter produced one champion is not a test of an adapter over forty.

```ts
import { describe, expect, it } from 'vitest';
import { bundledPack, BUNDLED_PACK_ID } from '../../src/content/bundledPack';
import { buildContentApi } from '../../src/content/ContentApi';
import { PackRegistry } from '../../src/content/PackRegistry';
import { CHAMPION_KITS } from '../../src/game/config/spellCatalog';
import { spellModules } from '../../src/generated/spellModules';

describe('the bundled pack', () => {
  const pack = bundledPack(buildContentApi());

  it('carries every kit the catalogue declares', () => {
    expect(CHAMPION_KITS.length).toBeGreaterThan(30);
    expect(pack.champions).toHaveLength(CHAMPION_KITS.length);
  });

  it('carries every generated spell module, plus Recall', () => {
    expect(Object.keys(spellModules).length).toBeGreaterThan(200);
    expect(Object.keys(pack.spells ?? {})).toHaveLength(Object.keys(spellModules).length + 1);
  });

  it('hands them over lazily — installing loads no spell module', () => {
    const registry = new PackRegistry();
    registry.install(pack);
    for (const id of registry.spellIds()) expect(registry.spellClass(id)).toBeNull();
  });

  it('really can load one', async () => {
    const registry = new PackRegistry();
    registry.install(pack);
    const loaded = await registry.loadSpellClass(`${BUNDLED_PACK_ID}:Yasuo_Q`);
    expect(loaded).toBeTypeOf('function');
    expect(registry.spellClass(`${BUNDLED_PACK_ID}:Yasuo_Q`)).toBe(loaded);
  });

  it('marks exactly the champions the old predicate marked', () => {
    // The predicate this replaces, verbatim from preset.ts before this batch.
    const wasPlayable = (kit: (typeof CHAMPION_KITS)[number]) =>
      Boolean(kit.image?.startsWith('champ_')) && kit.spells.length === 4 && Boolean(kit.attack);
    const expected = CHAMPION_KITS.filter(wasPlayable).map(kit => kit.name).sort();
    expect(expected.length).toBeGreaterThan(20);

    const actual: string[] = [];
    for (const champion of pack.champions ?? []) if (champion.playable) actual.push(champion.name);
    expect(actual.sort()).toEqual(expected);
  });

  it('declares Recall, and keeps it out of the display data', () => {
    expect(pack.spells?.Recall).toBeTypeOf('function');
    expect(pack.spellDisplay?.Recall).toBeUndefined();
    for (const champion of pack.champions ?? []) expect(champion.recall).toBe('Recall');
  });

  it('passes validation', () => {
    expect(() => new PackRegistry().install(pack)).not.toThrow();
  });
});
```

The fifth case is the load-bearing one: it pins the adapter's output against the predicate it replaces, so a rewrite that quietly drops or adds a champion fails here rather than in the picker.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/bundledPack.test.ts`
Expected: FAIL — `Cannot find module '../../src/content/bundledPack'`.

- [ ] **Step 3: Write the adapter**

```ts
import type { ContentApi } from './ContentApi';
import type { ChampionEntry, ContentPack, SpellDisplayData, SpellSource } from './ContentPack';
import { CHAMPION_KITS } from '@/game/config/spellCatalog';
import { spellCatalog } from '@/generated/spellCatalog';
import { spellModules } from '@/generated/spellModules';

/**
 * The game's own content, wrapped as a pack without moving a file.
 *
 * **Scaffolding with a date on it.** Batch 4 moves `src/game/gameObject/spells/`
 * and `assets/` into `packs/riot/` and deletes this file; what survives is the
 * consumption path, which by then will have been the pack path for two batches.
 * That ordering is the whole point — a wiring defect and a move defect look
 * identical in a diff that does both at once.
 *
 * Nothing here is a copy. The roster is `CHAMPION_KITS`, the display data is
 * the generated catalogue, and the spells are the generated dynamic imports,
 * which is why the pack is lazy: 240 eager classes would put every spell in
 * the game into the chunk a match downloads first.
 */
export const BUNDLED_PACK_ID = 'riot';

const spellSources = (): Record<string, SpellSource> => {
  const out: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    out[id] = () => load().then(module => module.default);
  }
  return out;
};

const displayData = (): Record<string, SpellDisplayData> => {
  const out: Record<string, SpellDisplayData> = {};
  for (const [id, entry] of Object.entries(spellCatalog)) {
    out[id] = {
      name: entry.name,
      description: entry.description,
      iconKey: entry.iconKey,
      coolDownMs: entry.coolDownMs,
      manaCost: entry.manaCost,
      specCoolDownMs: entry.specCoolDownMs,
    };
  }
  return out;
};

const championEntries = (): ChampionEntry[] => {
  const out: ChampionEntry[] = [];
  for (const kit of CHAMPION_KITS) {
    // `champ_` was the old test for "a real champion rather than a shelf of
    // loose abilities"; it becomes a declared field here and is never read as
    // a naming convention again.
    const playable = Boolean(kit.image?.startsWith('champ_')) && kit.spells.length === 4 && Boolean(kit.attack);
    out.push({
      id: kit.name,
      name: kit.name,
      image: kit.image,
      playable,
      attack: kit.attack,
      spells: [...kit.spells],
      recall: 'Recall',
    });
  }
  return out;
};

const bundled = (_api: ContentApi): ContentPack => ({
  manifest: { id: BUNDLED_PACK_ID, version: '1.0.0', coreRange: '^1' },
  spells: spellSources(),
  spellDisplay: displayData(),
  champions: championEntries(),
});

export const bundledPack = bundled;
export default bundled;
```

Three details that are decisions, not accidents:

- **`id: kit.name`.** The champion's identity in a persisted loadout is already its display name (`ChampionLoadout.championName`, matched at `preset.ts:359` against `kit.name`). Using the name as the local id keeps every saved config working with no migration.
- **`_api` is unused, and stays in the signature.** The factory shape is the contract; a pack that needs the api and one that does not must be installed the same way.
- **The two attack types are pinned to each other**, by the block below.

Add this at the top of `src/content/bundledPack.ts`:

```ts
import type { ChampionAttackTuning } from '@/game/gameObject/attackableUnits/Champion';
import type { ChampionAttack } from './ContentPack';

// Assignable both ways, checked by the compiler and costing nothing at
// runtime. `ChampionAttack` is declared in the contract rather than imported
// from the engine so the contract file reads on its own; this is what keeps
// the two from drifting apart in silence.
const _attackShapesAgree: [ChampionAttack, ChampionAttackTuning] = [
  {} as ChampionAttackTuning,
  {} as ChampionAttack,
];
void _attackShapesAgree;
```
- **`recall: 'Recall'`, and the adapter must *declare* `Recall` itself.** `Recall` is content (spec §2.2, as corrected) and every champion here has it — but it is **not** in `src/generated/spellModules.ts`, because it is deliberately absent from `spells/index.ts` so it can never show up in the loadout picker. `validate.ts` requires `entry.recall` to name a spell the pack declares, so `recall: 'Recall'` without declaring it rejects all 60 champions.

  Declare it as an **eager class**, beside the 238 thunks:

```ts
import Recall from '@/game/gameObject/spells/Recall';

const spellSources = (): Record<string, SpellSource> => {
  const out: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    out[id] = () => load().then(module => module.default);
  }
  // Not in `spellModules`, on purpose: `Recall` is out of `spells/index.ts` so
  // that it can never reach the loadout picker, which is also why it gets no
  // `spellDisplay` entry below. `preset.ts` already imports it statically, so
  // declaring it eagerly here costs no chunk that was not already paid for —
  // and it makes this pack exercise both arms of `SpellSource`.
  out.Recall = Recall;
  return out;
};
```

  It gets **no `spellDisplay` entry**. That is the mechanism, not an oversight: a spell with no display data cannot be rendered, which is how the "Recall is not in the picker" invariant survives without a hidden-id list.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/content/bundledPack.test.ts`
Expected: PASS. If the "marks exactly the champions" case fails, the adapter is wrong — do not adjust the expectation.

- [ ] **Step 5: Install it**

`src/content/install.ts`: `BUNDLED_PACKS` becomes `[bundledPack, referencePack]`. Order matters — `riot` first, so that when two packs answer the same question install order gives the answer a player expects today.

Update `tests/content/install.test.ts`: it asserts on `BUNDLED_PACKS` and (per batch 1's review) carries two comment claims that core is already a standalone game. Both are now wrong in the other direction — core ships its own content *as a pack*. Fix the comments to say that.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`

```bash
git add src/content/bundledPack.ts src/content/install.ts tests/content/bundledPack.test.ts tests/content/install.test.ts
git commit -m "feat(content): wrap the game's own content as the 'riot' pack, in place

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 5: One registry, installed once, before anything reads it

`installBundledPacks` has no caller. This task gives the process a single `PackRegistry`, installs into it exactly once, and makes that fact testable — Tasks 6-8 all read it, and each of them would otherwise have to answer "what if it is not installed yet" on its own.

**Files:**
- Create: `src/content/registry.ts`
- Modify: `src/main.ts`
- Test: `tests/content/registry.test.ts` (create)

**Interfaces:**
- Consumes: `installBundledPacks` (Task 4).
- Produces:
  - `contentRegistry(): PackRegistry` — installs on first call, returns the same instance after
  - `resetContentRegistryForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { contentRegistry, resetContentRegistryForTests } from '../../src/content/registry';
import { BUNDLED_PACK_ID } from '../../src/content/bundledPack';

describe('the content registry', () => {
  beforeEach(resetContentRegistryForTests);

  it('is the same instance every time', () => {
    expect(contentRegistry()).toBe(contentRegistry());
  });

  it('has both bundled packs installed on the first read', () => {
    const ids = new Set(contentRegistry().champions().map(c => c.packId));
    expect(ids).toEqual(new Set([BUNDLED_PACK_ID, 'reference']));
  });

  it('installs once, not once per read', () => {
    const first = contentRegistry().champions().length;
    contentRegistry();
    contentRegistry();
    expect(contentRegistry().champions()).toHaveLength(first);
  });
});
```

The third case is the one that matters: a duplicate install would double the roster, and after Task 2 it throws instead — either way this catches it, and it is the reason the accessor memoises rather than re-installing.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
import { PackRegistry } from './PackRegistry';
import { installBundledPacks } from './install';

/**
 * The process's content, and the one place anything asks for it.
 *
 * Lazy rather than installed at import time, for the reason every other module
 * in this codebase is: `src/main.ts` polyfills the array prototypes and loads
 * p5 before anything else runs, and a module that does work at eval time runs
 * before both. It is installed on the first read instead, which in a match is
 * the pregame screen and in a test is whatever the test asks for.
 */
let registry: PackRegistry | null = null;

export function contentRegistry(): PackRegistry {
  if (registry) return registry;
  registry = new PackRegistry();
  installBundledPacks(registry);
  return registry;
}

export function resetContentRegistryForTests(): void {
  registry = null;
}
```

- [ ] **Step 4: Warm it at boot**

In `src/main.ts`'s `setup()`, after the polyfills and before the scene manager starts, call `contentRegistry()` once and discard the result. It is not needed for correctness — every reader calls the accessor — but installing 40 champions during the loading screen rather than on the pregame screen's first paint is free here and is not free there.

Read the header comment of `src/main.ts` before editing: it explains why nothing may touch a p5 global at module eval time. `contentRegistry()` does not, but the call must still go inside `setup()`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/content/`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
git add src/content/registry.ts src/main.ts tests/content/registry.test.ts
git commit -m "feat(content): give the process one registry, installed once

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 6: Spell classes resolve through the registry

`src/game/spellRegistry.ts` owns a `loaded` map keyed by bare ids and imports `spellModules` directly. After Task 4 the same modules are behind `PackRegistry`, keyed `riot:Yasuo_Q`. This task makes the registry the only source and leaves `spellRegistry.ts` as a thin, well-documented adapter — its public shape unchanged, so no caller in `preset.ts`, `GameScene.ts` or `MatchDirector.ts` has to move in this task.

**The one behavioural addition is id normalisation.** A stored loadout in a player's browser holds `"Yasuo_Q"`, not `"riot:Yasuo_Q"`. An unqualified id resolves against the bundled pack.

**Files:**
- Modify: `src/game/spellRegistry.ts`
- Test: `tests/game/spellRegistry.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `contentRegistry()` (Task 5), `PackRegistry.loadSpellClass`/`spellClass`/`hasSpell`/`spellIds` (Task 2).
- Produces: same public names as today, plus `export const qualifySpellId = (id: string): string`; and on `PackRegistry`, `registerSpellForTests(qualifiedId: string, spellClass: SpellClass): void`, `spellDisplayIds(): readonly string[]` and `hasDisplayFor(qualifiedId: string): boolean` — the last two read the display map Task 3 added.

- [ ] **Step 1: Write the failing tests**

Append to `tests/game/spellRegistry.test.ts`:

```ts
it('resolves an unqualified id against the bundled pack', async () => {
  resetSpellRegistryForTests();
  await loadSpells(['Yasuo_Q']);
  expect(spellClassOfId('Yasuo_Q')).toBeTypeOf('function');
  expect(spellClassOfId('riot:Yasuo_Q')).toBe(spellClassOfId('Yasuo_Q'));
});

it('resolves a pack-qualified id that is not the bundled pack', async () => {
  resetSpellRegistryForTests();
  await loadSpells(['reference:Vera_Q']);
  expect(spellClassOfId('reference:Vera_Q')).toBeTypeOf('function');
});

it('knows an id from every installed pack', () => {
  expect(isSpellId('Yasuo_Q')).toBe(true);
  expect(isSpellId('reference:Vera_Q')).toBe(true);
  expect(isSpellId('Nobody_Q')).toBe(false);
});

it('leaves Recall out of the pool a random slot is drawn from', () => {
  // Declared by the bundled pack so a champion's `recall` can name it, and
  // given no display data so it can never be rendered — which is also what
  // keeps it out of here. A HELD channel dealt into an ability slot would be
  // drawn by a HUD with no name and no icon for it.
  expect(contentRegistry().hasSpell('riot:Recall')).toBe(true);
  expect(isSpellId('Recall')).toBe(false);
  expect(allSpellIds()).not.toContain('riot:Recall');
  expect(allSpellIds().length).toBeGreaterThan(200);
});

it('still fires onSettled once per id, including for an unknown one', async () => {
  resetSpellRegistryForTests();
  const settled: string[] = [];
  await loadSpells(['Yasuo_Q', 'Nobody_Q', 'Yasuo_Q'], id => settled.push(id));
  // A multiset, deliberately, not an ordered array. The contract is "once per
  // entry of `ids`, after that id is done" — it says nothing about order, and
  // it must not: `onSettled` fires at *completion*, so an unknown id settles
  // instantly while a real chunk is still in flight. Asserting the order would
  // force the implementation to await in `ids` order, which makes one slow
  // champion hold back the callbacks of ids that already landed — the loading
  // bar stalls and then jumps. Pin the count, never the sequence.
  expect([...settled].sort()).toEqual(['Nobody_Q', 'Yasuo_Q', 'Yasuo_Q']);
});
```

The last case is not decoration. `GameScene` paints a loading bar against `ids.length`, and an `onSettled` that fires fewer times than it was given ids stalls that bar short of its own total — the doc comment on `loadSpells` says so, and a rewrite is exactly when that gets lost.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/game/spellRegistry.test.ts`
Expected: FAIL on the `reference:` cases (unknown id, silently settled with nothing loaded) and on `spellClassOfId('riot:Yasuo_Q')`.

- [ ] **Step 3: Rewrite the module over the registry**

Keep every exported name and signature. The changes:

```ts
import { contentRegistry } from '@/content/registry';
import { BUNDLED_PACK_ID } from '@/content/bundledPack';

/**
 * A bare id means the bundled pack.
 *
 * Loadouts persisted before content became packs hold `"Yasuo_Q"`, and a
 * player's saved kit is not something to throw away over a prefix. A pack id
 * is `[A-Za-z0-9][A-Za-z0-9._-]*` and a colon appears in no local id, so the
 * test is unambiguous.
 */
export const qualifySpellId = (id: string): string =>
  id.includes(':') ? id : `${BUNDLED_PACK_ID}:${id}`;
```

- `allSpellIds()` → `contentRegistry().spellDisplayIds()` — **not** `spellIds()`. This is the population a slot is *rolled from*: `preset.ts:290`'s `randomSpellId()` picks out of it for every `'random'` slot and `preset.ts:298` validates a persisted slot choice against it. `Recall` is a declared spell of the bundled pack (Task 4) with deliberately no display data, so `spellIds()` would let a random slot roll it — a HELD channel in an ability slot, drawn by a HUD that has no name or icon for it. A spell you can be dealt is a spell the HUD must draw, and having display data is exactly that test.
- `isSpellId(id)` → `contentRegistry().hasDisplayFor(qualifySpellId(id))` — the same population, for the same reason. `hasSpell` stays the *loadability* question and keeps its own callers.
- `isSpellLoaded(id)` / `spellClassOfId(id)` → `contentRegistry().spellClass(qualifySpellId(id))`
- `loadedSpellIds()` → the registry's resolved ids
- `loadSpells(ids, onSettled)` → `contentRegistry().loadSpellClass(qualifySpellId(id))` per id, **keeping the existing loop's structure**: the dedupe, the `onSettled` fired once per entry of `ids` (not once per distinct id), and the `.catch` that logs and leaves the id unloaded rather than rejecting. **Each callback fires when its own id settles**, the way the pre-existing code does it (`load.then(() => onSettled?.(id))` pushed per id, then one `Promise.all`) — not from a loop that awaits them in `ids` order. Sequenced notification lets one slow chunk hold back ids that already landed, and `GameScene.ts:325` renders that count straight into a progress bar.
- `randomLoadedId()` → over the registry's resolved ids
- `resetSpellRegistryForTests()` → `resetContentRegistryForTests()`
- `registerSpellForTests(id, cls)` → a new `PackRegistry.registerSpellForTests(qualifiedId, spellClass)` writing straight into `resolved`, added in this task with a doc comment saying it exists so tests do not have to await 240 dynamic imports to assert one lookup.

The `everythingRequested` latch in `loadRemainingSpells` stays local to this module.

Rewrite the module header too. Most of it is still true — the chunking argument, the synchronous read side, the random/respawn story — but the first paragraph now describes a registry that is not this file's.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/game/spellRegistry.test.ts tests/content/`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: 0 failures. This is the first task that can break a test far from what it touched; if something in `tests/game/` fails, read it before changing it — it is more likely to be right than the rewrite is.

- [ ] **Step 6: Commit**

```bash
git add src/game/spellRegistry.ts src/content/PackRegistry.ts tests/game/spellRegistry.test.ts
git commit -m "refactor(content): spell classes resolve through the pack registry

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 7: The roster reads the registry

`CHAMPION_KITS` and the generated `spellCatalog` stop being read by anything except the adapter. `listSelectableChampions`, `spellDisplayOf`, `isSpellCatalogId`, `spellCatalogIds`, `listSpellCatalog` and `listSummonerSpells` all answer from `contentRegistry()`.

**Files:**
- Modify: `src/game/config/spellCatalog.ts`
- Modify: `src/scenes/setup/pregameCatalog.ts`
- Test: `tests/scenes/pregameCatalog.test.ts` (exists), `tests/game/config/spellCatalog.test.ts` if present

**Interfaces:**
- Consumes: `contentRegistry()`, `PackRegistry.champions()`/`spellDisplay()`.
- Produces: every name in `src/game/config/spellCatalog.ts` keeps its current signature. `CHAMPION_KITS` stays exported for the adapter and is marked `@internal` in its doc comment.

- [ ] **Step 1: Write the failing test**

Add to `tests/scenes/pregameCatalog.test.ts`:

```ts
it('offers a champion from a pack that is not the bundled one', () => {
  const names = getPregameCatalog().champions.map(c => c.name);
  expect(names).toContain('Vera');
});
```

This fails until Task 10 gives Vera a portrait — which is deliberate. Write it now, watch it fail, and mark it `it.skip` with a one-line comment naming Task 10. Un-skipping it is a step *in* Task 10.

Also add, and this one must pass in this task:

```ts
it('still offers every champion it offered before packs', () => {
  const names = getPregameCatalog().champions.map(c => c.name).sort();
  const before = CHAMPION_KITS.filter(k => k.image && k.spells.length === 4).map(k => k.name).sort();
  expect(before.length).toBeGreaterThan(20);
  expect(names).toEqual(before);
});
```

- [ ] **Step 2: Run to verify the shape of the failure**

Run: `npx vitest run tests/scenes/pregameCatalog.test.ts`
Expected: the Vera case fails (not in the list); the regression case passes, because nothing has changed yet. Record both — the second is your baseline, and it must still pass at the end of the task.

- [ ] **Step 3: Rewire `src/game/config/spellCatalog.ts`**

- `spellDisplayOf(id, matchRules)` reads `contentRegistry().spellDisplay(qualifySpellId(id))`. When the registry has no entry, return the same "missing" shape the function already produces for an id with no icon — do not throw. Its two computed fields (`effectiveCoolDownMs`, `effectiveManaCost`) keep the exact expressions they have now; the file header explains why they are recomputed rather than stored and that argument is unchanged.
- `isSpellCatalogId` / `spellCatalogIds` → **the ids the registry has display data for**, not `spellIds()`. This is load-bearing rather than incidental: `Recall` is a declared spell of the bundled pack (Task 4) and must never appear in the loadout picker, and `listSpellCatalog()` builds that picker from `spellCatalogIds()`. A spell with no display data cannot be rendered anyway, so "has display data" is the honest population — and it reproduces the old invariant without reintroducing a hidden-id list, which is what batch 1 deleted.
- `listSelectableChampions()` → `contentRegistry().champions()`, keeping only `playable` entries, mapping each to `{ name, avatar, spells }`. **The `image`/`spells.length` filter disappears** — Task 3 moved that rule into pack validation, and re-applying it here would mean two definitions of pickable again.
- `listSummonerSpells()` and `SUMMONER_SPELL_IDS` keep their hardcoded id list for now; they name five specific abilities and moving that list is batch 4's job. Qualify them through `qualifySpellId` so they still resolve.
- `CHAMPION_KITS` keeps its export and gains an `@internal` note: only `src/content/bundledPack.ts` may read it, and Task 9's scan enforces that.

`SelectableChampion.avatar` is typed `AssetKey`; a pack's key is a plain string. Widen it to `string`. Follow the compile errors — `pregameCatalog.ts` and the Vue components that pass it to `AssetManager.get` are the sites, and `AssetManager.get` already takes the widened key through `ContentApi`'s `key as never`. If a component needs the narrow type, that is a signal to route it through a helper rather than to narrow the roster back.

- [ ] **Step 4: Rewire `src/scenes/setup/pregameCatalog.ts`**

`getPregameCatalog()` builds its shelves from `CHAMPION_KITS` in three places (`:125`, `:127`, `:179`). All three become `contentRegistry().champions()`. The shelf ordering is "registry order, playable champions before shelves" — the same order `CHAMPION_KITS` had, because the adapter preserves it and the reference pack installs after. `tests/scenes/pregameCatalog.test.ts:39` pins that order; it must keep passing.

- [ ] **Step 5: Run the suite**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: 0 failures, with the Vera case still skipped.

- [ ] **Step 6: Commit**

```bash
git add src/game/config/spellCatalog.ts src/scenes/setup/pregameCatalog.ts tests/scenes/pregameCatalog.test.ts
git commit -m "refactor(content): the roster comes from the pack registry

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 8: `preset.ts` reads the registry

The last consumer. `PLAYABLE_CHAMPION_KITS` (`preset.ts:101-109`), `randomChampionKit`, `spellGroups()` (`:154`) and `planRandomKit`/`planKit` (`:350-375`) all read `CHAMPION_KITS`.

**Files:**
- Modify: `src/game/preset.ts`
- Test: `tests/game/preset*.test.ts` (whatever exists), `tests/game/spellRegistry.test.ts`

**Interfaces:**
- Consumes: `contentRegistry()`, `qualifySpellId`.
- Produces: no signature changes. `PLAYABLE_CHAMPION_KITS` becomes a function, not a module-level array — see Step 3.

- [ ] **Step 1: Write the failing test**

```ts
it('can plan a match around a champion from a non-bundled pack', async () => {
  await loadSpells(['reference:Vera_Q', 'reference:Vera_W', 'reference:Vera_E', 'reference:Vera_R']);
  const plan = planKit({ ...DEFAULT_CHAMPION_LOADOUT, championName: 'Vera' });
  expect(plan.name).toBe('Vera');
  expect(plan.spellIds).toContain('reference:Vera_Q');
});
```

Adjust the import names to whatever the existing preset test file already uses; do not invent a new fixture if one is there.

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `planKit` falls back to a random champion, because `PLAYABLE_CHAMPION_KITS` has never heard of Vera.

- [ ] **Step 3: Rewire**

`PLAYABLE_CHAMPION_KITS` is built at module-eval time today. It cannot stay that way: `contentRegistry()` installs on first read, and a module-level `for` loop runs before `main.ts`'s `setup()`. Make it a memoised function:

```ts
let playableCache: PlayableChampionKit[] | null = null;

/**
 * Built on first use, not at module load.
 *
 * The old array was filled by a `for` loop at module scope, which was fine
 * while the roster was a literal in another module. It is not fine now: the
 * roster comes from `contentRegistry()`, which installs on its first read, and
 * a module-scope loop runs before `main.ts` has done anything at all. Memoised
 * rather than recomputed because random planning runs once per unit at boot
 * and again on every random bot respawn.
 */
const playableKits = (): PlayableChampionKit[] => {
  if (playableCache) return playableCache;
  const out: PlayableChampionKit[] = [];
  for (const champion of contentRegistry().champions()) {
    if (!champion.playable || !champion.image) continue;
    out.push({
      name: champion.name,
      image: champion.image,
      spells: champion.spells,
      attack: champion.attack ?? DEFAULT_CHAMPION_ATTACK,
    });
  }
  playableCache = out;
  return out;
};
```

`PlayableChampionKit.image` and `.spells` widen from `AssetKey`/`SpellCatalogId[]` to `string`/`string[]`. Follow the compile errors outward.

`spellGroups()` maps `contentRegistry().champions()` through `classForId`. `planKit`'s lookup at `:359` becomes `playableKits().find(...)` — still by `name`, which is why the adapter uses the name as the local id and why no saved loadout breaks.

Export a `resetPresetCachesForTests()` that clears `playableCache`, and call it wherever tests call `resetContentRegistryForTests()`. A memo over a resettable singleton that is not itself resettable is a stale-cache bug waiting for the first test that installs a different pack set.

- [ ] **Step 4: Run the suite**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/game/preset.ts tests/game
git commit -m "refactor(content): preset plans matches from the pack registry

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 9: One roster source, enforced

Three tasks moved every reader onto the registry. This is the scan that keeps them there. It is the cheapest test in this plan and the only one that closes the class permanently — the model is `tests/game/spells/mana-spend-seam.test.ts`.

**Files:**
- Create: `src/game/config/packAsset.ts`
- Modify: `src/game/config/spellCatalog.ts`, `src/game/gameObject/attackableUnits/Champion.ts`, `src/content/ContentApi.ts`, `vite.config.ts`
- Test: `tests/content/rosterSource.test.ts` (create)

- [ ] **Step 1: Give the pack-asset cast one home**

`AssetManager.get(key as never)` — the cast that lets a pack's own asset key through a function typed against core's generated `AssetKey` union — now exists in **three** places: `packAsset` in `src/game/config/spellCatalog.ts`, `ContentApi.asset` in `src/content/ContentApi.ts`, and `resolveAvatar` in `src/game/gameObject/attackableUnits/Champion.ts`. The third is a byte-identical copy of the first, and it exists because importing `packAsset` into `Champion.ts` closes a real cycle: `Champion.ts → spellCatalog.ts → registry.ts → install.ts → ContentApi.ts → Champion.ts`, since `ContentApi.ts` imports `Champion` and `Pet` as values. Re-adding that import fails 88 test files with `Class extends value undefined`.

Extract it to a **leaf module** — `src/game/config/packAsset.ts`, importing `AssetManager` and nothing else. `spellCatalog.ts`, `Champion.ts` and `ContentApi.ts` all import it. `Champion.ts` then stops importing `spellCatalog.ts` altogether, so the cycle is gone structurally rather than avoided by duplication.

**Pin its chunk explicitly.** `vite.config.ts` sends `src/game/config/` to `pregame` and `src/content/` to `game`; a module imported by both must not be left to the generic fall-through, which is the "goes wherever Rollup decides" trap the chunk rule's own header warns about and which cost a commit two tasks ago. Give it the same treatment the file already gives `vite/preload-helper` — its own named `shared` chunk — and say in the comment why: it is a two-line function that both the menu and the match need, and duplicating it into either chunk is cheaper than a cycle.

Run `npm run build` and `npm run chunks:check` afterwards and report the pregame/game sizes. The byte-level guard in `scripts/check-chunks.mjs` is what catches a mistake here.

- [ ] **Step 2: Write the scan**

`tests/content/packBoundary.test.ts` carries the walker and the comment stripper this project uses — `readdirSync` + `statSync` recursion, no glob dependency. Copy that idiom rather than importing a new one.

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src');

/** The adapter is the one file allowed to read the old roster. */
const ALLOWED = new Set(['content/bundledPack.ts', 'game/config/spellCatalog.ts']);

/**
 * Import specifiers, not bare words.
 *
 * `CHAMPION_KITS` appears in `src/game/config/spellCatalog.ts` because that is
 * where it is *declared*; the rule is about who reads it from elsewhere, so
 * the needle is the import, not the identifier.
 */
const BANNED = [
  /from\s+'@\/generated\/spellModules'/,
  /from\s+'@\/generated\/spellCatalog'/,
  /import\s*\{[^}]*\bCHAMPION_KITS\b[^}]*\}\s*from/,
];

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function sourcesUnder(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full, base));
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full);
  }
  return out;
}

describe('the roster has exactly one source', () => {
  const files = sourcesUnder(SRC).filter(
    file => !ALLOWED.has(file.slice(SRC.length + 1).replace(/\\/g, '/'))
  );

  it('found sources to scan, or this proves nothing', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(BANNED)('nothing outside the adapter reads %s', pattern => {
    const offenders: string[] = [];
    for (const file of files) {
      if (pattern.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders, 'read the roster through contentRegistry() instead').toEqual([]);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/content/rosterSource.test.ts`
Expected: PASS after Tasks 6-8. If it names a file, that file is a reader nobody rewired — **rewire it; do not add it to `ALLOWED`.** The allow-list is closed at the two entries above: the adapter, and the module that declares `CHAMPION_KITS`. An allow-list that grows is a rule that has been repealed one caller at a time.

- [ ] **Step 4: Prove it can fail**

Add `import { CHAMPION_KITS } from '@/game/config/spellCatalog';` to any `src/game/` file, run, watch it name that file, remove it. Report both outcomes.

- [ ] **Step 5: Commit**

```bash
git add src/game/config/packAsset.ts src/game/config/spellCatalog.ts src/game/gameObject/attackableUnits/Champion.ts src/content/ContentApi.ts vite.config.ts tests/content/rosterSource.test.ts
git commit -m "test(content): the roster has exactly one source, and a scan says so

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

### Task 10: Vera, picked and cast, in a real browser

Everything above is provable in Vitest, which runs on `environment: 'node'` and has no renderer, no p5 and no DOM. What it cannot see is the thing this whole batch is for: a champion that exists only in a pack, chosen on the pregame screen, walking around a match and casting four abilities that were never part of core.

**Files:**
- Create: `assets/images/reference/champ_vera.png` (portrait)
- Modify: `packs/reference/pack.ts` (portrait, `playable: true`)
- Create: `tests/e2e/verify-pack-champion.mjs`
- Modify: `package.json` (an `e2e:pack` script)
- Modify: `tests/scenes/pregameCatalog.test.ts` (un-skip the Vera case from Task 7)

- [ ] **Step 1: Draw the portrait**

A 128×128 PNG at `assets/images/reference/champ_vera.png`, matching the reference pack's existing art location and `reference_*`/`champ_*` key convention already established in batch 1. It must be **visibly not a Riot champion** — that is the entire reason this pack exists. Simple, flat, readable at 48px, in Vera's palette (the cold blue-white of her Q's VFX: `fill(120, 200, 255)` / `fill(220, 245, 255)` in `packs/reference/spells/Vera_Q.ts`).

Then `npm run assets:generate` and confirm `assets:check` passes. Never hand-edit `src/generated/assetManifest.ts`.

**Open the PNG and look at it before moving on.** Batch 1 shipped two icons past a code review that could not see them — one indistinguishable from an existing icon, one whose arrows pointed the wrong way. A binary diff tells a reviewer nothing.

- [ ] **Step 2: Stop casting a pack's key back to `AssetKey`**

`src/scenes/GameScene.ts`'s `matchArtKeys` still returns `AssetKey[]` and casts `kit.avatar as AssetKey`. That was harmless while every playable champion came from the bundled pack — this step is where it stops being: Vera's portrait key is the reference pack's own and is not a member of core's generated union. Widen the signature to `string[]` and follow the errors. It does not crash today (each key goes through `AssetManager.ensure(key).catch(() => undefined)`, so a miss degrades to a placeholder portrait rather than throwing), which is exactly why it has to be fixed here rather than discovered later as a champion with no picture.

- [ ] **Step 3: Make her playable**

In `packs/reference/pack.ts`, set `image` to the new key and `playable: true`. Un-skip the pregame test from Task 7 Step 1 and run it.

Run: `npx vitest run tests/scenes/pregameCatalog.test.ts`
Expected: PASS, including the Vera case.

- [ ] **Step 4: Write the e2e script**

`tests/e2e/verify-pack-champion.mjs`, built on `tests/e2e/harness.mjs` — it provides the Vite server, the browser, page-error capture and the `check()`/`report`/`finish()` bookkeeping. Do **not** start your own server or browser; `tests/scripts/e2eHarness.test.ts` fails a script that does.

It must end in a **numeric summary and no screenshots**. `tests/e2e/drive-bot-discipline.mjs` is the model. The checks:

1. The pregame screen offers Vera (find her by name in the champion picker).
2. Picking her and pressing Chơi starts a match whose player champion is named Vera.
3. Her four spells are live: read `window.__lol2d.scene.oScene.game.player.spells` and check the four slots hold instances whose `name` matches the pack's.
4. Casting each of Q/W/E/R produces an effect — count `game.objectManager.objects` before and after each cast, or read each spell's cooldown going from 0 to non-zero. Prefer the cooldown check: it is what "the cast happened" actually means and it does not depend on a spell that spawns an object.
5. No page errors.

- [ ] **Step 5: Prove the script is falsifiable**

Once, now, while it is new. Break one thing it checks — comment out `playable: true` — and confirm the script reports a failure rather than a pass. Restore it, re-run, confirm the pass. **Record both runs' numeric summaries in your report.** Do not repeat this on later changes; the project's notes call re-proving a settled e2e script the single most expensive habit available.

- [ ] **Step 6: Wire the npm script**

`"e2e:pack": "node tests/e2e/verify-pack-champion.mjs"` in `package.json`, beside the existing `e2e:*` entries. It does **not** join `verify` — `verify` is Vitest plus the build, and a Playwright run is minutes.

- [ ] **Step 7: Full verify**

Run: `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"`
Run: `npm run e2e:pack`
Expected: 0 failures in both. Report both summaries.

- [ ] **Step 8: Commit**

```bash
git add assets/images/reference/champ_vera.png src/generated/assetManifest.ts packs/reference/pack.ts tests/e2e/verify-pack-champion.mjs package.json tests/scenes/pregameCatalog.test.ts
git commit -m "feat(content): Vera is playable — a pack champion, end to end

Claude-Session: https://claude.ai/code/session_01U1wfNJ78TNE9N2dFKouSbK"
```

---

## What batch 3 inherits

- `.superpowers/surveys/2026-08-21-map-touchpoints.md` — the map/geometry survey, written before this batch started. Its six SURPRISES are the shape of spec steps 4-5.
- `MapDefinition` and `PackRegistry.maps()` exist and are still dead after this batch. Batch 3 builds on them; it must not invent a second map model.
- Still deferred from batch 1's whole-branch review, all of them tied to content that has not moved yet: `ContentApi` exporting `LuxBeamEffect`/`drawAxeArc`/`drawDariusAxe` (batch 4, when those vfx files move); `PackManifest` has no `assets` field and `asset()` has no pack base (batch 4, when art moves); `ContentApi` has no drawing surface, so a pack's `draw()` stops typechecking once `packs/` is its own project (batch 5); nested `MapDefinition` field validation (batch 3).
