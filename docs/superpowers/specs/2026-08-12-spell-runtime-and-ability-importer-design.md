# Spell Runtime, VFX, Lazy Assets, and Ability Importer Design

Date: 2026-08-12

Status: Approved in conversation; pending implementation plan

## Goal

Standardize LOL2D's spell runtime before adding more champions so new abilities can reuse predictable casting, charging, channeling, recast, targeting, projectile, beam, area, VFX, and cancellation behavior.

The same change will make assets lazy and type-safe, introduce a local League Wiki research cache with champion and spell images, and enforce strict TypeScript at the new core boundary without attempting a risky whole-repository rewrite.

## Current Problems

- `Spell.cast()` immediately enters cooldown and calls `onSpellCast()`. There is no reusable windup, hold, release, channel, recast, toggle, cancel, or interrupt lifecycle.
- Input is polled as held keys, so press, repeat, hold, release, and recast are not distinct commands.
- Mana and health are checked but not centrally committed, which lets spells implement resource and cooldown timing inconsistently.
- Existing spell objects mostly cover linear missiles. Homing missiles, beams, maintained areas, and targeted effects are reimplemented ad hoc or absent.
- VFX is embedded in individual spell objects and is not tied to lifecycle phases.
- `AssetManager.loadAssets()` loads every path before entering the menu. String-only paths are not checked by the bundler and typos surface only at runtime.
- The TypeScript migration left broad `any` usage and `strict: false`; changing the whole repository at once would mix unrelated work with the spell redesign.
- Ability mechanics are researched manually from web pages. That is slow, token-heavy, and makes it easy to mix PC League with Wild Rift data.

## Scope

This phase delivers:

1. A typed spell lifecycle and input command layer with legacy compatibility.
2. Reusable targeting and gameplay primitives.
3. Lifecycle-driven VFX and SFX hooks.
4. Lazy, stable, generated, type-safe asset handles.
5. A Wiki-first champion/ability importer that checks data and images into the repository.
6. Strict typing for the new core and migrated examples.
7. Representative migrations for Lux R, Janna R, Janna Q, Anivia R, Varus Q, Pantheon Q, and Malphite Q.

This phase does not migrate every existing ability, globally enable TypeScript strict mode, build a visual spell editor/DSL, or introduce pooling/ECS/network prediction.

## Design Principles

- Keep current class-based spells. Add a small runtime contract rather than replacing all spells with a data-driven framework.
- Separate the player's activation gesture from the spell's runtime state.
- Keep geometry authoritative for both gameplay and rendering.
- Provide procedural VFX defaults; allow optional images or sprite sheets without requiring them.
- Make new APIs strict and typed while adapters narrow legacy `unknown` values at their boundaries.
- Store imported web data locally. Game startup and unit tests never depend on the network.

## Spell Lifecycle

### Activation gesture

```ts
export type ActivationPattern =
  | 'PRESS'
  | 'HOLD_RELEASE'
  | 'RECAST'
  | 'TOGGLE'
  | 'TAP_OR_HOLD';
```

This describes how input activates an ability. It is not a runtime state. In particular, Janna Q is a recast ability whose deployed tornado is active independently of Janna; it is not a channel.

### Runtime state

```ts
export type SpellRuntimeState =
  | 'READY'
  | 'CASTING'
  | 'CHARGING'
  | 'CHANNELING'
  | 'ACTIVE'
  | 'COOLDOWN';
```

- `CASTING`: the caster is performing a windup. Interrupt rules may cancel it.
- `CHARGING`: the caster is holding input to strengthen or alter the release.
- `CHANNELING`: the caster must continuously maintain the effect.
- `ACTIVE`: an independent deployed object or toggle remains active while the caster is otherwise free.
- `COOLDOWN`: activation is unavailable until the cooldown expires.

Common transitions are:

```text
READY -> CASTING -> ACTIVE/COOLDOWN
READY -> CHARGING -> CASTING/ACTIVE/COOLDOWN
READY -> CHANNELING -> COOLDOWN
READY -> ACTIVE -> COOLDOWN
ACTIVE --recast/timeout/tether/resource failure--> COOLDOWN
CASTING/CHARGING/CHANNELING --interrupt/cancel--> READY/COOLDOWN
```

Transitions are owned by the base runtime. Spell hooks request outcomes but do not directly mutate state or charge resources/cooldowns.

### Cast context

Every activation creates an immutable snapshot for values that must not drift after input:

```ts
export interface CastContext {
  readonly spellId: string;
  readonly activationId: string;
  readonly startedAtMs: number;
  readonly caster: SpellOwner;
  readonly origin: Vec2;
  readonly cursorWorld: Vec2;
  readonly direction: Vec2;
  readonly target?: AttackableTarget;
}
```

Spells may deliberately sample a live cursor during `CHARGING`, but snapshots such as Janna Q's spawn position and direction remain fixed.

### Cast specification

```ts
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
  vfx?: SpellVfxSpec;
}
```

Resource policies specify commit timing (`start`, `release`, or `tick`) and refund behavior. Cooldown policies specify whether cooldown begins on activation, release, or end. Active policies specify recast delay, maximum duration, tether behavior, and automatic termination rules.

### Hooks and legacy bridge

The base `Spell` exposes typed hooks such as:

```ts
onCastStart(context: CastContext): void;
onChargeUpdate(context: ChargeContext): void;
onRelease(context: ReleaseContext): void;
onChannelTick(context: ChannelContext): void;
onActivate(context: CastContext): ActiveHandle | void;
onRecast(context: RecastContext): void;
onCancel(context: CancelContext): void;
onComplete(context: CompleteContext): void;
```

Legacy spells keep working through a zero-cast-time `PRESS` default that calls the existing `onSpellCast()` hook. This bridge is temporary and removed only after all spells migrate.

### Cancellation and interrupts

Cancellation is explicit and reports a typed reason:

```ts
export type CancelReason =
  | 'PLAYER_CANCEL'
  | 'DEATH'
  | 'STUN'
  | 'SILENCE'
  | 'DISPLACEMENT'
  | 'MOVE'
  | 'TARGET_INVALID'
  | 'OUT_OF_RANGE'
  | 'OUT_OF_RESOURCE'
  | 'MAX_DURATION'
  | 'SCENE_EXIT';
```

The runtime supplies sensible defaults by phase, and each spell may override only the relevant flags. Cancellation centrally stops looped VFX/SFX, releases temporary movement modifiers, removes owned active handles when appropriate, and applies the configured resource/cooldown policy exactly once.

## Input Commands

Keyboard handling emits edge-triggered commands:

```ts
type SpellInputCommand =
  | { type: 'PRESS'; slot: SpellSlot }
  | { type: 'HOLD'; slot: SpellSlot; heldMs: number }
  | { type: 'RELEASE'; slot: SpellSlot }
  | { type: 'CANCEL'; slot: SpellSlot };
```

Quick Cast remains the default. `PRESS` captures the targeting context. Holding and releasing are meaningful only when the spell's activation pattern uses them. Repeated browser keydown events do not create repeated casts. AI constructs its own target context and never writes through shared `game.worldMouse`.

## Targeting and Gameplay Primitives

### Targeting modes

```ts
export type TargetingMode = 'SELF' | 'DIRECTION' | 'POINT' | 'UNIT';
```

`TargetResolver` validates and snapshots origin, direction, point, unit, range, team, targetability, and line constraints. It has no VFX responsibilities.

### Reusable objects

- `MissileSpellObject`: existing linear projectile, tightened behind typed geometry and payload interfaces.
- `HomingMissileSpellObject`: follows one target, defines target-loss behavior, and avoids generic in-flight collision when configured for a single target.
- `BeamSpellObject`: shared line/capsule geometry for instant or duration beams; collision and rendering read the same geometry.
- `AreaSpellObject`: duration area with `onEnter`, `onTick`, `onExit`, tick cadence, growth, and optional tether.
- `TargetedEffect`: immediate unit-target delivery for effects that do not need a travelling object.

These primitives own movement, lifetime, hit bookkeeping, and geometry. Each spell still owns its payload: damage, buffs, crowd control, stacks, and special rules. No spell-effect DSL is introduced.

## Lifecycle-Driven VFX and SFX

A spell may define phase assets/effects for:

```text
castStart -> castLoop -> release -> active/channelLoop -> impact -> cancel/end
```

Reusable presentation pieces are:

- `CastTelegraph` for range, direction, point, unit, and area previews.
- `CastBar` for cast, charge, and channel progress.
- `BeamRenderer` backed by `BeamSpellObject` geometry.
- `SpriteEffect` for optional image or sprite-sheet effects.
- `ParticleEmitter` for procedural defaults.
- `ImpactEffect` for short-lived hit feedback.

VFX observes lifecycle and geometry; it does not decide hits or state transitions. Missing cosmetic assets fall back to procedural rendering. Looping SFX is stopped on release, cancel, death, scene exit, and object removal. Pooling is deferred until profiling demonstrates a need.

## Lazy and Type-Safe Assets

### Generated manifest

A development script scans the repository asset folders and generates a TypeScript module containing static Vite URL imports:

```ts
import jannaQUrl from '/assets/images/spells/janna_q.png?url';

export const assetManifest = {
  jannaQ: { kind: 'image', url: jannaQUrl },
} as const;

export type AssetKey = keyof typeof assetManifest;
```

`predev` and `prebuild` regenerate and validate this manifest. `assets:check` detects invalid files, duplicate generated keys, unsupported types, and stale output. `build.assetsInlineLimit` is set to `0`, so Vite resolves every imported file at build time but emits separate files instead of embedding their bytes in the startup bundle.

### Stable handles

```ts
export interface AssetHandle<T> {
  readonly key: AssetKey;
  readonly kind: AssetKind;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  url: string;
  error?: Error;
}
```

`AssetManager.get(key)` always returns the same handle object. `ensure(key)` starts loading once and mutates that handle in place, so Vue HUD and p5 consumers do not retain stale placeholder objects. `ensureMany(keys)` supports scene/champion batches. An explicit `AssetManager.placeholder(label)` is used for intentional missing art; a typo cannot masquerade as a placeholder key.

Only the map JSON blocks initial game entry. Menu/champion assets load when their surfaces need them, spell assets load with the selected champion or on first access, and nonessential cosmetics continue in the background. The fake one-second loading delay is removed.

## Wiki-First Ability Importer

### Sources

The primary index is League Wiki's [`Module:ChampionData/data`](https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data). It provides the champion registry, API names, stats, roles, and the ordered `skill_i/q/w/e/r` entries.

Detailed mechanics come from each PC ability data template, such as `Template:Data Janna/Howling Gale`. Those templates expose standardized fields including icon, descriptions, leveling, range, radii, width, speed, cast time, cost, cooldown, targeting, damage classification, projectile flags, and notes.

The importer must reject Wild Rift paths (`WR Data`, `Module:ChampionDataWR`) unless a future explicit game-mode flag is added. Riot champion pages and patch notes remain a manual/currentness cross-check when an ability is being migrated. Data Dragon is an optional image fallback only when Wiki file resolution fails.

### Commands

```bash
npm run wiki:sync-index
npm run ability:import -- --champion Janna
npm run ability:update -- --champion Janna --slots Q,R
npm run ability:check
```

### Import flow

1. Fetch the Wiki module revision through the MediaWiki API and retain the revision ID.
2. Convert the module's Lua data table into normalized JSON without evaluating arbitrary Lua.
3. Resolve each requested `skill_i/q/w/e/r` entry, preserving multiple forms in slot order.
4. Request only the standardized fields required from each ability template rather than downloading rendered article HTML.
5. Resolve original champion and ability image URLs through MediaWiki file metadata and download them to the repository.
6. Normalize Wiki markup to compact plain text while retaining raw field values when normalization could lose formulas or semantics.
7. Validate the complete result in memory, write temporary files, then replace existing generated files only after all validation succeeds.
8. Run the asset manifest generator so newly imported images become typed asset keys.

### Local output

```text
docs/abilities/generated/champions.json
docs/abilities/janna/champion.json
docs/abilities/janna/q.json
docs/abilities/janna/r.json
assets/images/champions/janna.png
assets/images/spells/janna_q.png
assets/images/spells/janna_r.png
assets/source-manifest.json
```

Each ability record includes:

```ts
interface ImportedAbilityRecord {
  schemaVersion: 1;
  champion: string;
  slot: SpellSlot | 'I';
  forms: ImportedAbilityForm[];
  source: {
    pageUrl: string;
    revisionId: number;
    fetchedAt: string;
    contentHash: string;
  };
  adaptation?: {
    implementationStatus: 'unreviewed' | 'planned' | 'implemented';
    gameplayNotes?: string[];
    descriptionVi?: string;
  };
}
```

English Wiki text remains the authoritative imported value. Vietnamese descriptions are hand-reviewed adaptation fields, not silently machine-translated source data.

### Update and failure behavior

- `ability:import` does not overwrite an existing record by default.
- `ability:update` compares revision IDs and hashes, prints a field-level summary, and rewrites only changed records/assets.
- Network failures leave existing files untouched.
- Requests use a clear user agent, bounded concurrency, retries with backoff, and respectful rate limiting.
- Unit tests use checked-in API fixtures. Normal tests and game builds never make live Wiki requests.
- `ability:check` validates schemas, source metadata, referenced images, generated asset keys, and duplicate champion/slot/form identities. Remote freshness is checked only by an explicit update command.

## Strict TypeScript Boundary

The new spell runtime, targeting, interrupt policies, gameplay primitives, VFX contracts, asset handles, generated manifest, importer, and migrated sample spells must compile with strict TypeScript and no explicit `any`.

Legacy p5/Vue/game-object values enter through narrow adapters as `unknown` and are validated before use. Existing unrelated files remain under the current project configuration for this phase. After the core settles, legacy modules can migrate incrementally and global `strict: true` becomes a separate milestone.

## Representative Spell Migrations

### Lux R — casting beam

- Quick-cast direction/point snapshot.
- Visible cast windup and telegraph.
- Interruptible according to its spell policy.
- Release creates an instant beam using shared beam geometry, damage resolution, release VFX, and impact VFX.

### Janna R — true channel

- Starts a maintained channel and periodic effect.
- Movement and configured crowd-control interruptions cancel the channel.
- Cast bar, loop VFX/SFX, tick scheduling, and cleanup exercise the channel path.

### Janna Q — deployed charge and recast

- First press snapshots Janna's current position and the cursor direction.
- A tornado is created at that location and charges independently while Janna remains free to move and cast.
- Pressing Q again releases it; reaching maximum charge automatically releases it.
- Releasing the physical Q key does not release the tornado.
- Charge duration controls the configured range, speed, damage, and crowd-control payload using imported/current reviewed values.

### Anivia R — maintained toggle

- First press creates an active storm area that grows and ticks while draining mana.
- Anivia may move and cast; this is `ACTIVE`, not `CHANNELING`.
- A permitted second press ends it after the recast delay.
- Death, insufficient mana, excessive tether distance, or configured interrupt conditions end it automatically.
- Cooldown begins according to the end policy and cleanup is idempotent.

### Varus Q — hold and release charge

- Keydown enters `CHARGING`; live cursor direction is sampled while held.
- Charge progress modifies range and damage and applies the configured movement slow.
- Keyup releases a linear projectile.
- Reaching maximum hold duration follows the researched cancel/release policy and correctly handles resources and cooldown.

### Pantheon Q — tap or hold

- Early release uses an immediate short line/stab represented by beam geometry.
- Crossing the hold threshold changes the release mode to a thrown linear missile.
- Both forms share activation accounting while retaining their distinct range, damage, collision, and presentation.

### Malphite Q — targeted homing missile

- Unit-target validation happens at activation.
- A homing missile follows the target and defines behavior if the target becomes invalid.
- Damage and movement-speed transfer apply once on arrival.

Exact numeric values are not copied into this design. Each migration reads its checked-in importer record, compares it with Riot's current champion page/patch history, and records deliberate LOL2D adaptations.

## Verification Strategy

Add Vitest as the smallest Vite-native test runner for TypeScript modules. Use deterministic clocks and plain geometry fixtures; rendering tests assert lifecycle events and renderer inputs rather than pixel snapshots.

Core tests cover:

- Valid and invalid state transitions.
- Press/hold/release/recast/toggle input edges and suppression of key-repeat casts.
- Exactly-once resource commitment, refund, cooldown start, completion, and cancellation cleanup.
- Default and per-spell interrupt policies.
- Target snapshots and AI contexts independent from the player's mouse.
- Linear, homing, beam, area, and targeted collision/lifetime behavior.
- Stable asset-handle identity, deduplicated loads, errors, placeholders, and lazy startup groups.
- Generated asset manifest duplicate/missing-path failures.
- Wiki Lua/index conversion, multi-form slots, PC-versus-Wild-Rift rejection, template normalization, atomic update behavior, and image/source-manifest validation using local fixtures.
- The seven representative spell behaviors above.

Repository verification commands will include type checking, unit tests, asset validation, importer fixture validation, and production build.

## Delivery Order

1. Test harness and typed runtime contracts.
2. Input command edges, lifecycle controller, resource/cooldown policies, and legacy bridge.
3. Target resolver and gameplay primitives.
4. Lifecycle VFX/SFX components.
5. Generated asset manifest, stable lazy handles, and loading-scene change.
6. Wiki-first importer and local fixtures.
7. Seven representative spell migrations and their imported assets/data.
8. Full verification and follow-up migration guide.

## Risks and Mitigations

- **Wiki schema changes:** version local schemas, keep raw values and revision metadata, validate before replacing files, and test fixtures for known variants.
- **Lua parsing complexity:** support only the data-table subset used by the module and reject unknown syntax; never execute downloaded Lua.
- **Multi-form abilities:** preserve each `skill_*` entry as an ordered array and give forms stable identities.
- **Lifecycle double cleanup:** make completion/cancellation terminal operations idempotent and test exactly-once effects.
- **Legacy regressions:** retain the immediate-cast bridge and migrate only representative spells in this phase.
- **Lazy rendering races:** stable handles are mutated in place and renderers must tolerate idle/loading/error states.
- **Asset licensing/provenance:** keep source URL, revision/version, fetch date, and content hash in `assets/source-manifest.json`.

## Definition of Done

- New spells can choose activation, targeting, lifecycle, resource, cooldown, interrupt, primitive, and VFX behavior without reimplementing engine state transitions.
- The seven representative spells behave according to their current researched mechanics and have local source records and images.
- Startup blocks only on required map data; other assets load on demand through stable typed handles.
- Misspelled asset references fail during generation, type checking, or build instead of first appearing during gameplay.
- New core and migrated files contain no explicit `any` and pass their strict check.
- All automated verification and the production build pass without requiring network access.
