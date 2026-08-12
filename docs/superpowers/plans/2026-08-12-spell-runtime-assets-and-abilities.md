# Spell Runtime, Assets, and Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed, interruptible spell runtime with reusable targeting/VFX primitives, lazy checked assets, a local League Wiki importer, and seven representative League-accurate abilities.

**Architecture:** Preserve the existing class-based `Spell` API through a compatibility bridge while moving lifecycle decisions into a pure `SpellRuntime`. Input emits edge commands into typed cast contexts; spell objects reuse homing, beam, and area primitives whose geometry also drives VFX. A generated Vite URL manifest validates local assets, while a development-only Wiki importer writes compact source records and images into the repository.

**Tech Stack:** TypeScript 5.4, Vite 5, p5.js, Vue 3, Vitest 1.6, Node.js ESM scripts, MediaWiki Action API, `luaparse` 0.3.1.

## Global Constraints

- Quick Cast remains the default input mode.
- Activation patterns are exactly `PRESS`, `HOLD_RELEASE`, `RECAST`, `TOGGLE`, and `TAP_OR_HOLD`.
- Runtime states are exactly `READY`, `CASTING`, `CHARGING`, `CHANNELING`, `ACTIVE`, and `COOLDOWN`.
- Janna Q and Anivia R use `ACTIVE`; neither is a caster channel.
- Janna Q snapshots spawn position and direction on first press, releases on second press or timeout, and ignores physical key release.
- Anivia R ends on permitted recast, death, insufficient mana, tether violation, or configured interruption.
- New runtime, targeting, primitive, VFX, asset, importer, and migrated spell files contain no explicit `any`.
- Existing non-migrated spells continue working through the zero-cast-time legacy `onSpellCast()` bridge.
- Only `json_summoner_map` blocks initial entry; all other assets load on demand through stable handle objects.
- Asset paths are generated as static Vite `?url` imports and `build.assetsInlineLimit` is `0`.
- League Wiki PC data is primary; `WR Data` and `Module:ChampionDataWR` are rejected.
- Network access occurs only in explicit importer commands; tests, development startup, and production builds use checked-in files.
- Imported English data remains authoritative; Vietnamese descriptions are reviewed adaptation fields.
- Follow TDD for production behavior: write the focused test, observe the expected failure, implement minimally, then observe green.
- Do not migrate unrelated legacy `any`, add a spell DSL, add pooling, or refactor unrelated game objects.

---

### Task 1: Establish the TypeScript Test Harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm test -- <file>` for focused tests and `npm run test:all` for the full suite.
- Produces: deterministic p5-compatible globals used by later unit tests.

- [ ] **Step 1: Add a smoke test before the runner exists**

```ts
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs TypeScript tests', () => expect(2 + 2).toBe(4));
});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/smoke.test.ts`

Expected: npm reports that the `test` script does not exist.

- [ ] **Step 3: Install and configure Vitest**

Run: `rtk npm install --save-dev vitest@1.6.1`

Add these scripts to `package.json`:

```json
"test": "vitest run",
"test:all": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: { environment: 'node', setupFiles: ['tests/setup.ts'], clearMocks: true },
});
```

Create `tests/setup.ts` with only the globals needed by tests:

```ts
import { vi } from 'vitest';

Object.assign(globalThis, {
  deltaTime: 16,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  constrain: (n: number, low: number, high: number) => Math.min(high, Math.max(low, n)),
  random: (min = 1, max?: number) => max === undefined ? Math.random() * min : min + Math.random() * (max - min),
  floor: Math.floor,
  createVector: vi.fn(),
});
```

- [ ] **Step 4: Verify GREEN**

Run: `rtk npm test -- tests/smoke.test.ts`

Expected: one test file and one test pass with no warnings.

- [ ] **Step 5: Commit**

```bash
rtk git add package.json package-lock.json vitest.config.ts tests/setup.ts tests/smoke.test.ts
rtk git commit -m "test: add TypeScript test harness"
```

---

### Task 2: Implement the Typed Spell Lifecycle

**Files:**
- Create: `src/game/spell/runtime/types.ts`
- Create: `src/game/spell/runtime/SpellRuntime.ts`
- Modify: `src/game/enums/SpellState.ts`
- Modify: `src/game/gameObject/Spell.ts`
- Create: `tests/game/spell/SpellRuntime.test.ts`
- Create: `tsconfig.strict-core.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `SpellRuntime`, `SpellRuntimeDelegate`, `CastContext`, `CastSpec`, `CancelReason`, `SpellRuntimeState`, and policy types.
- Produces: `Spell.press(context)`, `Spell.hold(context)`, `Spell.release(context)`, and `Spell.cancel(reason)`.
- Preserves: `Spell.cast()` and `Spell.onSpellCast()` for legacy callers.

- [ ] **Step 1: Write lifecycle tests**

Cover these independent behaviors in `tests/game/spell/SpellRuntime.test.ts`:

```ts
it('moves a timed cast from READY through CASTING to COOLDOWN', () => {});
it('commits start resources exactly once', () => {});
it('commits release resources only when a charge releases', () => {});
it('refunds according to the cancel policy', () => {});
it('starts cooldown at start, release, or end according to policy', () => {});
it('keeps an ACTIVE recast available until completion', () => {});
it('rejects an interrupt disabled by the spell override', () => {});
it('runs cancel cleanup exactly once', () => {});
it('maps legacy cast to an immediate onSpellCast call', () => {});
```

Use a fake delegate that records hook names, resource commits, refunds, and cooldown starts. Advance time only through `runtime.update(deltaMs)`.

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spell/SpellRuntime.test.ts`

Expected: import failure because `SpellRuntime` does not exist.

- [ ] **Step 3: Define the exact contracts**

```ts
export type ActivationPattern = 'PRESS' | 'HOLD_RELEASE' | 'RECAST' | 'TOGGLE' | 'TAP_OR_HOLD';
export type SpellRuntimeState = 'READY' | 'CASTING' | 'CHARGING' | 'CHANNELING' | 'ACTIVE' | 'COOLDOWN';
export type TargetingMode = 'SELF' | 'DIRECTION' | 'POINT' | 'UNIT';
export type ResourceCommitPoint = 'start' | 'release' | 'tick';
export type CooldownStartPoint = 'start' | 'release' | 'end';
export type CancelReason = 'PLAYER_CANCEL' | 'DEATH' | 'STUN' | 'SILENCE' | 'DISPLACEMENT' | 'MOVE' | 'TARGET_INVALID' | 'OUT_OF_RANGE' | 'OUT_OF_RESOURCE' | 'MAX_DURATION' | 'SCENE_EXIT';

export interface Vec2 { readonly x: number; readonly y: number }
export interface CastContext {
  readonly spellId: string;
  readonly activationId: string;
  readonly startedAtMs: number;
  readonly caster: unknown;
  readonly origin: Vec2;
  readonly cursorWorld: Vec2;
  readonly direction: Vec2;
  readonly target?: unknown;
}
export interface ResourcePolicy { commitAt: ResourceCommitPoint; refundOn: readonly CancelReason[]; tickEveryMs?: number }
export interface CooldownPolicy { startAt: CooldownStartPoint; durationMs: number }
export interface InterruptPolicy { death: boolean; stun: boolean; silence: boolean; displacement: boolean; move: boolean }
export interface ChargeSpec { maxDurationMs: number; releaseAtMax: boolean }
export interface ChannelSpec { durationMs: number; tickEveryMs: number }
export interface ActiveSpec { maxDurationMs?: number; recastDelayMs?: number }
export interface CastSpec {
  activation: ActivationPattern;
  targeting: TargetingMode;
  castTimeMs?: number;
  charge?: ChargeSpec;
  channel?: ChannelSpec;
  active?: ActiveSpec;
  resource: ResourcePolicy;
  cooldown: CooldownPolicy;
  interrupts?: Partial<InterruptPolicy>;
}
```

`SpellRuntimeDelegate` supplies `canStart`, `commitResource`, `refundResource`, `onCastStart`, `onChargeUpdate`, `onRelease`, `onChannelTick`, `onActivate`, `onRecast`, `onCancel`, and `onComplete`. Hooks default to no-ops in `Spell`.

- [ ] **Step 4: Implement the minimal state machine and legacy bridge**

Use one terminal helper for completion and one for cancellation. Both guard against duplicate execution. Keep cooldown time inside the runtime; expose read-only `state` and `cooldownRemainingMs`. Update `Spell.state` and `Spell.currentCooldown` as compatibility accessors backed by the runtime.

Create the legacy spec per spell so it keeps the subclass cooldown value:

```ts
const legacyCastSpec = (durationMs: number): CastSpec => ({
  activation: 'PRESS',
  targeting: 'DIRECTION',
  castTimeMs: 0,
  resource: { commitAt: 'start', refundOn: [] },
  cooldown: { startAt: 'start', durationMs },
});
```

`Spell.cast()` builds a context from the owner position and current world mouse, then calls `press()`. Override the legacy delegate release hook to call `onSpellCast()` exactly once. Centralize mana and health deduction in the `Spell` delegate implementation after `castCancelCheck()` succeeds. Keep deprecated `state` and `currentCooldown` getters/setters that forward to explicit runtime compatibility methods because existing recast spells assign `currentCooldown` directly; new and migrated spells must use lifecycle policies instead.

- [ ] **Step 5: Add scoped strict checking**

Create `tsconfig.strict-core.json` extending the main config with `strict: true` and include the new runtime, its tests, and later strict folders. Add:

```json
"typecheck": "tsc --noEmit",
"typecheck:core": "tsc -p tsconfig.strict-core.json"
```

- [ ] **Step 6: Verify GREEN and compatibility**

Run: `rtk npm test -- tests/game/spell/SpellRuntime.test.ts && rtk npm run typecheck && rtk npm run typecheck:core && rtk npm run build`

Expected: all lifecycle tests pass; both TypeScript checks and Vite build exit `0`.

- [ ] **Step 7: Commit**

```bash
rtk git add src/game/spell/runtime src/game/enums/SpellState.ts src/game/gameObject/Spell.ts tests/game/spell/SpellRuntime.test.ts tsconfig.strict-core.json package.json
rtk git commit -m "feat: add typed spell lifecycle"
```

---

### Task 3: Add Edge-Triggered Input and Target Resolution

**Files:**
- Create: `src/game/spell/input/SpellInputController.ts`
- Create: `src/game/spell/targeting/TargetResolver.ts`
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/game/Game.ts`
- Modify: `src/game/gameObject/attackableUnits/AIChampion.ts`
- Create: `tests/game/spell/SpellInputController.test.ts`
- Create: `tests/game/spell/TargetResolver.test.ts`

**Interfaces:**
- Consumes: `CastContext`, `TargetingMode`, and `Spell.press/hold/release/cancel` from Task 2.
- Produces: edge commands and contexts independent of global `game.worldMouse`.

- [ ] **Step 1: Write failing input and targeting tests**

```ts
it('emits one PRESS for repeated keydown events', () => {});
it('emits HOLD updates only while the slot remains down', () => {});
it('emits one RELEASE on keyup', () => {});
it('does not release a RECAST spell from physical keyup', () => {});
it('snapshots origin cursor and normalized direction', () => {});
it('selects the nearest valid UNIT target under the cursor', () => {});
it('rejects enemy, range, or targetability violations', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spell/SpellInputController.test.ts tests/game/spell/TargetResolver.test.ts`

Expected: imports fail because both modules are absent.

- [ ] **Step 3: Implement the controller and resolver**

`SpellInputController` stores a `Map<number, { slot: number; heldMs: number }>` and exposes:

```ts
keyDown(keyCode: number, repeated: boolean): void;
keyUp(keyCode: number): void;
update(deltaMs: number): void;
cancelAll(reason: CancelReason): void;
```

It receives spell lookup and context creation callbacks in its constructor. `TargetResolver.resolve(mode, request)` returns `{ ok: true, context }` or `{ ok: false, reason }`. For `UNIT`, query candidates once, filter by team/targetability/range, then choose the minimum cursor distance.

- [ ] **Step 4: Wire browser and AI input**

- Add `keyReleased(event?: KeyboardEvent)` to `GameScene` and forward both keyboard edges.
- Remove held-key spell casting from `Game.fixedUpdate()`.
- Update the controller once per fixed update.
- On scene exit call `cancelAll('SCENE_EXIT')`.
- Make `AIChampion` construct a context from its chosen enemy or destination and call `press()` without mutating `game.worldMouse`.

- [ ] **Step 5: Verify GREEN**

Run: `rtk npm test -- tests/game/spell/SpellInputController.test.ts tests/game/spell/TargetResolver.test.ts && rtk npm run typecheck && rtk npm run build`

Expected: focused tests pass and build exits `0`.

- [ ] **Step 6: Commit**

```bash
rtk git add src/game/spell/input src/game/spell/targeting src/scenes/GameScene.ts src/game/Game.ts src/game/gameObject/attackableUnits/AIChampion.ts tests/game/spell
rtk git commit -m "feat: add spell input edges and targeting"
```

---

### Task 4: Add Homing and Targeted Primitives

**Files:**
- Create: `src/game/gameObject/spellObjects/HomingMissileSpellObject.ts`
- Create: `src/game/spell/effects/TargetedEffect.ts`
- Modify: `src/game/gameObject/MissileSpellObject.ts`
- Create: `tests/game/spell/HomingMissileSpellObject.test.ts`
- Create: `tests/game/spell/TargetedEffect.test.ts`

**Interfaces:**
- Consumes: existing `MissileSpellObject` movement/lifetime behavior.
- Produces: a unit-following missile with explicit target-loss policy and an immediate targeted payload helper.

- [ ] **Step 1: Write failing tests**

```ts
it('homes toward the target current position each update', () => {});
it('arrives once and applies its payload once', () => {});
it('removes itself when a target becomes invalid under remove policy', () => {});
it('continues toward the last position under continue policy', () => {});
it('TargetedEffect applies only to a still-valid target', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spell/HomingMissileSpellObject.test.ts tests/game/spell/TargetedEffect.test.ts`

Expected: missing module failures.

- [ ] **Step 3: Implement minimal primitives**

```ts
export type TargetLossPolicy = 'remove' | 'continue';

export default abstract class HomingMissileSpellObject<TTarget extends HomingTarget>
  extends MissileSpellObject {
  target: TTarget;
  targetLossPolicy: TargetLossPolicy = 'remove';
  abstract onArrive(target: TTarget): void;
}

export function applyTargetedEffect<T>(
  target: T,
  isValid: (value: T) => boolean,
  apply: (value: T) => void
): boolean;
```

Do not add pathfinding or predictive interception. Arrival is based on the next movement step intersecting the target collision radius.

- [ ] **Step 4: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spell/HomingMissileSpellObject.test.ts tests/game/spell/TargetedEffect.test.ts && rtk npm run typecheck:core`

```bash
rtk git add src/game/gameObject/MissileSpellObject.ts src/game/gameObject/spellObjects src/game/spell/effects tests/game/spell
rtk git commit -m "feat: add homing and targeted spell effects"
```

---

### Task 5: Add Beam, Area, and Lifecycle VFX Primitives

**Files:**
- Create: `src/game/gameObject/spellObjects/BeamSpellObject.ts`
- Create: `src/game/gameObject/spellObjects/AreaSpellObject.ts`
- Create: `src/game/vfx/SpellVfx.ts`
- Create: `src/game/vfx/BeamRenderer.ts`
- Create: `src/game/vfx/CastBar.ts`
- Create: `src/game/vfx/CastTelegraph.ts`
- Create: `src/game/vfx/ParticleEmitter.ts`
- Create: `src/game/vfx/SpriteEffect.ts`
- Create: `src/game/vfx/ImpactEffect.ts`
- Create: `tests/game/spell/BeamSpellObject.test.ts`
- Create: `tests/game/spell/AreaSpellObject.test.ts`
- Create: `tests/game/vfx/SpellVfx.test.ts`
- Modify: `src/game/spell/runtime/types.ts`
- Modify: `src/game/gameObject/Spell.ts`

**Interfaces:**
- Produces: shared capsule beam geometry, ticked/growing areas, and phase-bound disposable VFX handles.

- [ ] **Step 1: Write failing geometry, tick, and cleanup tests**

```ts
it('uses one capsule geometry for beam hit tests and rendering data', () => {});
it('hits each target once when configured as an instant beam', () => {});
it('fires area enter tick and exit callbacks in order', () => {});
it('grows an area radius over its configured duration', () => {});
it('disposes looping VFX once on release cancel and scene exit', () => {});
it('uses procedural VFX when no asset key is configured', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spell/BeamSpellObject.test.ts tests/game/spell/AreaSpellObject.test.ts tests/game/vfx/SpellVfx.test.ts`

Expected: missing module failures.

- [ ] **Step 3: Implement gameplay geometry first**

`BeamSpellObject` stores `{ start, end, width }`, exposes the same object through `geometry`, and queries targets through one injected predicate. `AreaSpellObject` stores center/radius, tick accumulator, members set, and optional `radiusAt(elapsedMs)` function. Both use existing ObjectManager queries in production and injected candidates in tests.

- [ ] **Step 4: Implement minimal VFX pieces**

```ts
export interface VfxHandle { update(deltaMs: number): void; draw(): void; dispose(): void }
export interface SfxHandle { play(): void; stop(): void; }
export interface SpellVfxSpec {
  castStart?: VfxFactory;
  castLoop?: VfxFactory;
  release?: VfxFactory;
  activeLoop?: VfxFactory;
  channelLoop?: VfxFactory;
  impact?: VfxFactory;
  cancel?: VfxFactory;
}
export interface SpellSfxSpec {
  castStart?: SfxFactory;
  castLoop?: SfxFactory;
  release?: SfxFactory;
  activeLoop?: SfxFactory;
  channelLoop?: SfxFactory;
  impact?: SfxFactory;
  cancel?: SfxFactory;
}
```

Extend `CastSpec` with optional `vfx?: SpellVfxSpec` and `sfx?: SpellSfxSpec`, then bind creation/disposal to the runtime hooks in `Spell`. `CastBar` and `CastTelegraph` consume runtime progress/context. `BeamRenderer` consumes the exact `BeamSpellObject.geometry` object used for collision. `SpriteEffect` consumes an optional lazy asset handle. `ParticleEmitter` and `ImpactEffect` are the procedural defaults. Stop looping audio on release, cancel, death, scene exit, and object removal. Do not pool instances.

- [ ] **Step 5: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spell/BeamSpellObject.test.ts tests/game/spell/AreaSpellObject.test.ts tests/game/vfx/SpellVfx.test.ts && rtk npm run typecheck:core && rtk npm run build`

```bash
rtk git add src/game/gameObject/spellObjects src/game/vfx tests/game/spell tests/game/vfx
rtk git commit -m "feat: add beam area and spell VFX primitives"
```

---

### Task 6: Generate and Lazy-Load Typed Assets

**Files:**
- Create: `scripts/generate-assets.mjs`
- Create: `src/generated/assetManifest.ts`
- Modify: `src/managers/AssetManager.ts`
- Modify: `src/scenes/LoadingScene.ts`
- Modify: `src/game/hud/InGameHUD.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Create: `tests/assets/generate-assets.test.ts`
- Create: `tests/assets/AssetManager.test.ts`

**Interfaces:**
- Produces: `assetManifest`, `AssetKey`, `AssetHandle<T>`, `AssetManager.get`, `ensure`, `ensureMany`, and `placeholder`.
- Preserves: deprecated `getAsset(string)` for non-migrated code only.

- [ ] **Step 1: Write failing generator and handle tests**

```ts
it('maps known asset paths to stable legacy-compatible keys', () => {});
it('rejects duplicate generated keys', () => {});
it('generates static ?url imports for every supported file', () => {});
it('returns the same handle before during and after loading', () => {});
it('deduplicates concurrent ensure calls', () => {});
it('keeps a failed handle and error without replacing its identity', () => {});
it('requires an explicit placeholder label', () => {});
```

Required key mapping examples:

```text
assets/images/champions/janna.png -> champ_janna
assets/images/champions/background/janna.png -> champ_background_janna
assets/images/spells/janna_q.png -> spell_janna_q
assets/images/buffs/stun.png -> buff_stun
assets/images/monsters/Blue_Sentinel.png -> monster_Blue_Sentinel
assets/json/summoner_map.json -> json_summoner_map
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/assets/generate-assets.test.ts tests/assets/AssetManager.test.ts`

Expected: generator exports and typed handle API are missing.

- [ ] **Step 3: Implement generator and scripts**

Use Node `fs`, `path`, and `url`; do not add a glob dependency. Walk `assets/`, sort normalized paths, validate duplicates, infer `image`, `json`, `audio`, and plain `url` kinds from extensions, and emit relative static imports. Add:

```json
"assets:generate": "node scripts/generate-assets.mjs",
"assets:check": "node scripts/generate-assets.mjs --check",
"predev": "npm run assets:generate",
"prebuild": "npm run assets:generate"
```

- [ ] **Step 4: Implement stable handles and compatibility**

```ts
export interface AssetHandle<T = unknown> {
  readonly key: AssetKey | null;
  readonly kind: AssetKind;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  url: string;
  readonly path: string;
  error?: Error;
}
```

`get(key: AssetKey)` is fully typed. `ensure(key)` uses injected image/JSON/audio loader adapters and mutates the cached handle; cursor and other plain URL assets need no byte preload. `getAsset(string)` remains a deprecated bridge: known generated keys use `get`; unknown legacy strings use an explicit warning placeholder so existing spells do not break during staged migration.

- [ ] **Step 5: Make startup truly lazy**

- Replace `loadAssets()` in `LoadingScene` with `ensure('json_summoner_map')`.
- Remove the artificial one-second timeout.
- Trigger champion/spell `ensureMany` when HUD entries become visible; render the handle URL while data is loading.
- Replace hardcoded menu/background paths with manifest URLs.
- Remove the copy-runtime-assets Vite plugin and set `assetsInlineLimit: 0`.

- [ ] **Step 6: Verify GREEN**

Run: `rtk npm run assets:generate && rtk npm test -- tests/assets/generate-assets.test.ts tests/assets/AssetManager.test.ts && rtk npm run assets:check && rtk npm run typecheck && rtk npm run build`

Expected: tests pass, generated output is unchanged under `--check`, and the build emits assets without copying the full folder manually.

- [ ] **Step 7: Commit**

```bash
rtk git add scripts/generate-assets.mjs src/generated/assetManifest.ts src/managers/AssetManager.ts src/scenes/LoadingScene.ts src/game/hud/InGameHUD.ts vite.config.ts package.json tests/assets
rtk git commit -m "feat: generate and lazy-load typed assets"
```

---

### Task 7: Build the Wiki-First Ability Importer

**Files:**
- Create: `scripts/wiki/lua-data.mjs`
- Create: `scripts/wiki/mediawiki.mjs`
- Create: `scripts/wiki/normalize.mjs`
- Create: `scripts/wiki/import-abilities.mjs`
- Create: `scripts/wiki/check-abilities.mjs`
- Create: `tests/fixtures/wiki/champion-data.lua`
- Create: `tests/fixtures/wiki/janna-howling-gale.json`
- Create: `tests/wiki/lua-data.test.ts`
- Create: `tests/wiki/import-abilities.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `wiki:sync-index`, `ability:import`, `ability:update`, and `ability:check` commands.
- Produces: normalized champion/ability JSON and source-manifest entries consumed by later migration tasks.

- [ ] **Step 1: Add parser dependency and fixtures**

Run: `rtk npm install --save-dev luaparse@0.3.1`

The Lua fixture must include one champion, comments, string/number/boolean/nil literals, an array field, and `skill_q` with two forms. The ability fixture must contain MediaWiki API responses for template revision, expanded standardized fields, and imageinfo.

- [ ] **Step 2: Write failing parser/import tests**

```ts
it('converts the ChampionData Lua table without executing Lua', () => {});
it('preserves ordered multi-form skill slots', () => {});
it('rejects calls functions and unknown AST nodes', () => {});
it('rejects WR Data and ChampionDataWR sources', () => {});
it('normalizes selected ability fields and preserves raw formulas', () => {});
it('writes nothing when any fetch or validation step fails', () => {});
it('reports field-level hash changes during update', () => {});
```

- [ ] **Step 3: Verify RED**

Run: `rtk npm test -- tests/wiki/lua-data.test.ts tests/wiki/import-abilities.test.ts`

Expected: missing importer module failures.

- [ ] **Step 4: Implement safe Lua data conversion**

Parse with `luaparse`, accept only a top-level return statement containing table constructors, and recursively accept literal keys/values and nested tables. Reject call, function, index-expression side effects, and duplicate normalized keys. Never evaluate downloaded source.

- [ ] **Step 5: Implement MediaWiki client and normalization**

Use `https://wiki.leagueoflegends.com/en-us/api.php` with `fetch`, an identifying user agent, concurrency `2`, request timeout `15_000ms`, and at most two retries. Fetch:

- `Module:ChampionData/data` through revisions content and revision ID.
- Selected template fields through `action=expandtemplates` with sentinel-delimited values.
- Original images through `prop=imageinfo&iiprop=url|sha1|mime`.

Normalize whitespace and presentational Wiki markup but retain `{ raw, text }` for `description`, `description2..6`, `leveling`, `leveling2..6`, and `notes`.

- [ ] **Step 6: Implement CLI and atomic writes**

Accepted invocations are exactly:

```bash
rtk npm run wiki:sync-index
rtk npm run ability:import -- --champion Janna
rtk npm run ability:update -- --champion Janna --slots Q,R
rtk npm run ability:check
```

Validate all JSON and downloaded image bytes in a temporary directory under the destination parent, then rename completed files. `ability:import` refuses to overwrite an existing record. `ability:update` upserts records, compares revision IDs and SHA-256 hashes, and atomically replaces existing image files only after the full requested champion set validates. Write source URL, revision ID, UTC fetch timestamp, content hash, and local asset key.

- [ ] **Step 7: Add package scripts**

```json
"wiki:sync-index": "node scripts/wiki/import-abilities.mjs --index",
"ability:import": "node scripts/wiki/import-abilities.mjs",
"ability:update": "node scripts/wiki/import-abilities.mjs --update",
"ability:check": "node scripts/wiki/check-abilities.mjs"
```

- [ ] **Step 8: Verify GREEN and commit**

Run: `rtk npm test -- tests/wiki/lua-data.test.ts tests/wiki/import-abilities.test.ts && rtk npm run ability:check`

```bash
rtk git add scripts/wiki tests/fixtures/wiki tests/wiki package.json package-lock.json
rtk git commit -m "feat: add League Wiki ability importer"
```

---

### Task 8: Import the Seven Ability Research Sets and Images

**Files:**
- Create/update: `docs/abilities/generated/champions.json`
- Create/update: `docs/abilities/{lux,janna,anivia,varus,pantheon,malphite}/*.json`
- Create/update: `assets/images/champions/{lux,janna,anivia,varus,pantheon,malphite}.png`
- Create/update: `assets/images/spells/{lux_r,janna_q,janna_r,anivia_r,varus_q,pantheon_q,malphite_q}.png`
- Create/update: `assets/source-manifest.json`
- Update: `src/generated/assetManifest.ts`

**Interfaces:**
- Consumes: importer and generator commands from Tasks 6–7.
- Produces: checked-in authoritative local research inputs for Tasks 9–13.

- [ ] **Step 1: Sync the champion index**

Run: `rtk npm run wiki:sync-index`

Expected: PC champion index JSON with revision metadata; no `WR Data` source.

- [ ] **Step 2: Import requested slots**

Run:

```bash
rtk npm run ability:update -- --champion Lux --slots R
rtk npm run ability:update -- --champion Janna --slots Q,R
rtk npm run ability:update -- --champion Anivia --slots R
rtk npm run ability:update -- --champion Varus --slots Q
rtk npm run ability:update -- --champion Pantheon --slots Q
rtk npm run ability:update -- --champion Malphite --slots Q
```

Expected: seven ability records, six champion images, seven ability images, and source entries with hashes. Update mode creates missing records and atomically replaces existing local images only after the complete champion import validates.

- [ ] **Step 3: Add reviewed adaptation notes**

For each record, set `implementationStatus` to `planned`, add a Vietnamese description based on the imported current mechanics, and add only the explicit LOL2D scaling differences required by the current game's lower health/damage scale. Do not silently change activation, targeting, interrupt, recast, tether, or projectile behavior.

- [ ] **Step 4: Validate generated artifacts**

Run: `rtk npm run ability:check && rtk npm run assets:generate && rtk npm run assets:check && rtk npm run build`

Expected: all records/assets validate and Vite resolves every imported file.

- [ ] **Step 5: Commit**

```bash
rtk git add docs/abilities assets/images/champions assets/images/spells assets/source-manifest.json src/generated/assetManifest.ts
rtk git commit -m "data: import representative ability research"
```

---

### Task 9: Migrate Lux R and Add Janna R

**Files:**
- Modify: `src/game/gameObject/spells/Lux_R.ts`
- Create: `src/game/gameObject/spells/Janna_R.ts`
- Modify: `src/game/gameObject/spells/index.ts`
- Modify: `src/game/preset.ts`
- Create: `tests/game/spells/Lux_R.test.ts`
- Create: `tests/game/spells/Janna_R.test.ts`

**Interfaces:**
- Consumes: lifecycle, beam, area, VFX, and imported Lux/Janna records.
- Produces: one casting beam and one true channel reference implementation.

- [ ] **Step 1: Write failing behavior tests**

```ts
it('Lux R snapshots its beam and deals damage only after cast completion', () => {});
it('Lux R uses its per-spell interrupt overrides', () => {});
it('Janna R knocks enemies back once then heals allies on channel ticks', () => {});
it('Janna R stops ticks and loop VFX when movement or allowed CC cancels it', () => {});
it('Janna R completes after its imported maximum channel duration', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spells/Lux_R.test.ts tests/game/spells/Janna_R.test.ts`

Expected: old Lux behavior fails lifecycle assertions and Janna R import is absent.

- [ ] **Step 3: Implement from local research records**

Read the exact imported fields with:

```bash
rtk node -e "for (const p of ['docs/abilities/lux/r.json','docs/abilities/janna/r.json']) console.log(p, JSON.stringify(require('./'+p), null, 2))"
```

- Lux R uses `CASTING`, a frozen beam geometry, telegraph/cast bar, then one release hit pass.
- Janna R uses `CHANNELING`, an initial knockback pass, interval healing, channel loop VFX, and cancel cleanup.
- Use checked-in adaptation values for LOL2D damage/healing, while keeping imported timing and mechanics unless an adaptation note explicitly records a change.

- [ ] **Step 4: Export and register**

Export `Janna_R` and add it to Janna's spell group. Ensure both icons are loaded through typed asset keys.

- [ ] **Step 5: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spells/Lux_R.test.ts tests/game/spells/Janna_R.test.ts && rtk npm run typecheck:core && rtk npm run build`

```bash
rtk git add src/game/gameObject/spells/Lux_R.ts src/game/gameObject/spells/Janna_R.ts src/game/gameObject/spells/index.ts src/game/preset.ts tests/game/spells
rtk git commit -m "feat: migrate Lux R and add Janna R"
```

---

### Task 10: Migrate Janna Q as an Independent Active Recast

**Files:**
- Modify: `src/game/gameObject/spells/Janna_Q.ts`
- Create: `tests/game/spells/Janna_Q.test.ts`

**Interfaces:**
- Consumes: `RECAST`, `ACTIVE`, linear missile behavior, and imported Janna Q record.
- Produces: the reference deployed-charge ability.

- [ ] **Step 1: Write failing tests**

```ts
it('spawns at the first-cast position and snapshots first-cast direction', () => {});
it('allows Janna to move and cast while the tornado remains ACTIVE', () => {});
it('ignores physical Q release', () => {});
it('releases on second Q press', () => {});
it('auto-releases at maximum active charge duration', () => {});
it('scales range speed damage and knockup from the stored charge ratio', () => {});
it('cleans up and starts cooldown once on caster death', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spells/Janna_Q.test.ts`

Expected: old phase/cooldown implementation fails runtime and snapshot assertions.

- [ ] **Step 3: Replace local phase management with runtime hooks**

Use `activation: 'RECAST'` and `ACTIVE`; capture both origin and direction on first press. The tornado object grows in place. Recast and timeout call the same idempotent release method. Do not sample `game.worldMouse` after deployment. Preserve the existing tornado/gust procedural art by moving it behind lifecycle-driven VFX cleanup rather than rewriting its visuals.

- [ ] **Step 4: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spells/Janna_Q.test.ts && rtk npm run typecheck:core && rtk npm run build`

```bash
rtk git add src/game/gameObject/spells/Janna_Q.ts tests/game/spells/Janna_Q.test.ts
rtk git commit -m "feat: migrate Janna Q active recast"
```

---

### Task 11: Migrate Anivia R as a Maintained Toggle

**Files:**
- Modify: `src/game/gameObject/spells/Anivia_R.ts`
- Create: `tests/game/spells/Anivia_R.test.ts`

**Interfaces:**
- Consumes: `TOGGLE`, `ACTIVE`, `AreaSpellObject`, resource ticks, and imported Anivia R record.
- Produces: the reference maintained area toggle.

- [ ] **Step 1: Write failing tests**

```ts
it('creates one ACTIVE storm at the selected point', () => {});
it('lets Anivia move and cast while the storm remains active', () => {});
it('grows and applies damage and slow on imported tick cadence', () => {});
it('drains mana through the central tick resource policy', () => {});
it('ends after a permitted second press', () => {});
it('ends on death no mana tether violation or configured interruption', () => {});
it('starts cooldown and cleans members and VFX exactly once', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spells/Anivia_R.test.ts`

Expected: the current fixed five-second object fails toggle/resource/tether behavior.

- [ ] **Step 3: Implement through shared area/runtime policies**

Create the area at the cast point, use imported growth/tick/tether/recast timings, and route termination conditions through one `finishActive` path. The spell state must remain `ACTIVE`, never `CHANNELING`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spells/Anivia_R.test.ts && rtk npm run typecheck:core && rtk npm run build`

```bash
rtk git add src/game/gameObject/spells/Anivia_R.ts tests/game/spells/Anivia_R.test.ts
rtk git commit -m "feat: migrate Anivia R maintained toggle"
```

---

### Task 12: Add Varus Q and Pantheon Q Charge Patterns

**Files:**
- Create: `src/game/gameObject/spells/Varus_Q.ts`
- Create: `src/game/gameObject/spells/Pantheon_Q.ts`
- Modify: `src/game/gameObject/spells/index.ts`
- Modify: `src/game/preset.ts`
- Create: `tests/game/spells/Varus_Q.test.ts`
- Create: `tests/game/spells/Pantheon_Q.test.ts`

**Interfaces:**
- Consumes: `HOLD_RELEASE`, `TAP_OR_HOLD`, beam, linear missile, cast bar, and imported records.
- Produces: reference hold-release and tap-versus-hold abilities.

- [ ] **Step 1: Write failing tests**

```ts
it('Varus Q enters CHARGING on keydown and releases a missile on keyup', () => {});
it('Varus Q samples live cursor direction and scales range and damage', () => {});
it('Varus Q applies and removes its researched self slow', () => {});
it('Varus Q follows the imported maximum-hold cancel or release rule', () => {});
it('Pantheon Q early release creates an instant short beam stab', () => {});
it('Pantheon Q crossing the hold threshold releases a thrown linear missile', () => {});
it('Pantheon Q commits resource and cooldown once across both forms', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts`

Expected: both modules are absent.

- [ ] **Step 3: Implement only Q for each champion**

Use imported values and adaptation notes. Varus Q updates direction while held and releases one linear projectile. Pantheon Q uses the imported hold threshold: release before it uses short `BeamSpellObject`; release after it uses `MissileSpellObject`. Both share the runtime's resource/cooldown accounting and lifecycle VFX.

- [ ] **Step 4: Export and register champion groups**

Add Varus and Pantheon groups containing their Q spell. Use typed champion, background when present, and spell asset keys; an absent optional background is represented explicitly rather than by an invalid asset key.

- [ ] **Step 5: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts && rtk npm run typecheck:core && rtk npm run build`

```bash
rtk git add src/game/gameObject/spells/Varus_Q.ts src/game/gameObject/spells/Pantheon_Q.ts src/game/gameObject/spells/index.ts src/game/preset.ts tests/game/spells
rtk git commit -m "feat: add Varus and Pantheon charge abilities"
```

---

### Task 13: Migrate Malphite Q to Unit-Targeted Homing

**Files:**
- Modify: `src/game/gameObject/spells/Malphite_Q.ts`
- Create: `tests/game/spells/Malphite_Q.test.ts`

**Interfaces:**
- Consumes: `UNIT` targeting, `HomingMissileSpellObject`, and imported Malphite Q record.
- Produces: the reference targeted homing missile.

- [ ] **Step 1: Write failing tests**

```ts
it('requires a valid enemy unit target in range', () => {});
it('follows the selected target instead of the cursor line', () => {});
it('damages and slows only the selected target on arrival', () => {});
it('steals the researched movement speed amount for the researched duration', () => {});
it('applies arrival payload once and handles an invalidated target', () => {});
```

- [ ] **Step 2: Verify RED**

Run: `rtk npm test -- tests/game/spells/Malphite_Q.test.ts`

Expected: the current piercing direction missile fails target and homing assertions.

- [ ] **Step 3: Replace the projectile behavior**

Use `targeting: 'UNIT'`; create one homing shard bound to the selected target. On arrival apply damage, slow, and a speed transfer based on imported/adapted values. Preserve the existing rock/shatter/rush presentation where it remains compatible, but remove piercing and multi-target bookkeeping.

- [ ] **Step 4: Verify GREEN and commit**

Run: `rtk npm test -- tests/game/spells/Malphite_Q.test.ts && rtk npm run typecheck:core && rtk npm run build`

```bash
rtk git add src/game/gameObject/spells/Malphite_Q.ts tests/game/spells/Malphite_Q.test.ts
rtk git commit -m "feat: migrate Malphite Q to homing target"
```

---

### Task 14: Integrate, Document, and Verify the Whole Feature

**Files:**
- Modify: `.codegraph/ADDING_SPELLS.md` only if it is already tracked; otherwise create `docs/ADDING_SPELLS.md`
- Modify: `README-en.md`
- Modify: `tsconfig.strict-core.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a concise new-spell guide and one complete offline verification command.

- [ ] **Step 1: Add an integration test before documentation**

Create `tests/game/spells/representative-spells.test.ts` that instantiates all seven spells with deterministic fake owners and verifies their activation patterns:

```ts
expect(patterns).toEqual({
  luxR: 'PRESS',
  jannaR: 'PRESS',
  jannaQ: 'RECAST',
  aniviaR: 'TOGGLE',
  varusQ: 'HOLD_RELEASE',
  pantheonQ: 'TAP_OR_HOLD',
  malphiteQ: 'PRESS',
});
```

The same test must assert these paths with real public commands: Lux R `PRESS -> CASTING`; Janna R `PRESS -> CHANNELING`; Janna Q `PRESS -> ACTIVE`; Anivia R `PRESS -> ACTIVE`; Varus Q `PRESS -> CHARGING -> RELEASE`; Pantheon Q covers both sides of its imported hold threshold; Malphite Q rejects an absent unit target. For every successful activation, assert mana decreases by exactly `manaCost` at its configured commit point and cooldown starts only at its configured point.

- [ ] **Step 2: Verify the integrated public API**

Run: `rtk npm test -- tests/game/spells/representative-spells.test.ts`

Expected: all activation, state, resource, and cooldown assertions pass. Any failure is an integration gap to fix before documentation.

- [ ] **Step 3: Fix only integration gaps and document extension points**

Document:

- choosing activation and targeting;
- defining resource/cooldown/interrupt policies;
- choosing missile, homing, beam, area, or targeted delivery;
- binding lifecycle VFX;
- importing Wiki data/images;
- using typed asset keys and intentional placeholders;
- adding focused tests.

Add `verify`:

```json
"verify": "npm run assets:check && npm run ability:check && npm run typecheck && npm run typecheck:core && npm run test:all && npm run build"
```

- [ ] **Step 4: Run fresh full verification**

Run: `rtk npm run verify`

Expected: asset check, ability check, both TypeScript checks, all Vitest tests, and production build exit `0` without network access or warnings.

- [ ] **Step 5: Scan scoped files for explicit any**

Run:

```bash
rtk rg -n "(^|[^[:alnum:]_])any([^[:alnum:]_]|$)" src/game/spell src/game/vfx src/game/gameObject/spellObjects src/generated scripts/wiki src/game/gameObject/spells/{Lux_R,Janna_R,Janna_Q,Anivia_R,Varus_Q,Pantheon_Q,Malphite_Q}.ts
```

Expected: no code occurrences; source text inside imported JSON is outside this check.

- [ ] **Step 6: Commit**

```bash
rtk git add README-en.md docs/ADDING_SPELLS.md tsconfig.strict-core.json package.json tests/game/spells/representative-spells.test.ts
rtk git commit -m "docs: document standardized spell authoring"
```

## Final Review Gate

After Task 14:

1. Generate one review package from the pre-implementation base commit through `HEAD`.
2. Dispatch a fresh senior reviewer against the design spec and this plan.
3. Send all Critical and Important findings together to one fix subagent.
4. Re-run `npm run verify` after fixes.
5. Re-review until the branch is ready to integrate.
