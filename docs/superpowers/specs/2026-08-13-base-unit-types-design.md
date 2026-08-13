# Base Unit Type Migration Design

**Date:** 2026-08-13  
**Status:** Approved for implementation

## Goal

Remove the legacy `any` seams from the gameplay object hierarchy so new spells,
buffs, and champions can rely on stable TypeScript contracts. This phase covers
`GameObject`, `SpellObject`, `ObjectManager`, `Buff`, `AttackableUnit`,
`Champion`, and the direct unit subclasses that inherit their loose types.

The migration must preserve current gameplay behavior. It is a type-system and
asset-access cleanup, not a balance or mechanics rewrite.

## Scope

### Included

- Typed constructor options and ownership for `GameObject` and `SpellObject`.
- Typed storage, filters, and queries in `ObjectManager`.
- Typed buff source/target, damage hooks, descriptions, icons, and stacking IDs.
- Typed unit buffs, damage/heal/death data, avatars, stats, and game references.
- Typed champion data and direct subclasses: `AIChampion`, `DummyChampion`,
  `Monster`, and `Turret`.
- Replace deprecated stringly `AssetManager.getAsset(...)` calls in the migrated
  scope with generated-key `AssetManager.get(...)` calls.
- Extend the strict-core TypeScript boundary to enforce the migrated files.
- Minimal compatibility edits in callers when stronger contracts expose an
  invalid assumption.

### Excluded

- Migrating every legacy spell implementation. The 69 spell files remain a
  later phase unless a small edit is required to compile against a new base
  contract.
- Changing damage formulas, movement, buff stacking, AI decisions, cooldowns,
  targeting rules, or visuals.
- Introducing a new DI container, event bus, ECS, schema library, or runtime
  validation dependency.
- Renaming public gameplay concepts solely for style.

## Design

### 1. Type the hierarchy from the root

Use concrete domain types and small exported interfaces at the existing module
boundaries:

- `GameObject` owns a typed `Game` reference and typed construction options.
- `SpellObject` owns an `AttackableUnit`; spell-specific subclasses can narrow
  that owner without making the base generic.
- `AttackableUnit` stores `Buff[]`, typed `Stats`, and a typed asset handle.
- `Champion` keeps its current runtime shape while exposing typed preset,
  spell, buff, and death data.

Type-only imports are preferred for circular domain references. A broad generic
framework is intentionally avoided because it would force a simultaneous rewrite
of all legacy spells.

### 2. Make object queries typed without changing runtime behavior

`ObjectManager` stores `GameObject[]`. Query options accept spatial constraints,
constructors, and predicates over `GameObject`. The query API is generic so a
caller that supplies a type guard or constructor can receive a narrowed result,
while existing broad queries still return `GameObject[]`.

The quadtree insertion, update cadence, filtering order, debug globals, and
returned object identity remain unchanged.

### 3. Define buff and combat seams explicitly

Buffs use concrete `AttackableUnit` source/target references, string descriptions,
typed asset handles, and a stack identifier represented by the existing string or
constructor identity. Incoming/outgoing damage hooks accept the same gameplay
sources currently passed by callers, expressed as a small domain union instead of
`any`.

`AttackableUnit` keeps the current buff lifecycle and damage pipeline. Death and
heal metadata become named interfaces so optional attacker/revive information is
visible to callers.

### 4. Use generated asset keys inside the migrated boundary

Icons and avatars in the migrated files use `AssetManager.get(AssetKey)`. This
makes misspelled keys fail during TypeScript compilation and keeps runtime lazy
loading intact. Compatibility aliases are resolved only when a canonical generated
key exists; the deprecated string API remains available outside this phase.

### 5. Grow strict mode incrementally

Add the migrated hierarchy and its focused tests to `tsconfig.strict-core.json`.
Tests also guard the phase boundary against reintroducing explicit `any` or
`getAsset` in the migrated files. This gives immediate enforcement without making
the unrelated legacy spell tree block the migration.

## Delivery slices

1. Base/query types: `GameObject`, `SpellObject`, `ObjectManager`.
2. Buff/unit types: `Buff`, `AttackableUnit`, and buff subclasses.
3. Champion types: `Champion`, direct subclasses, strict-core coverage, and any
   minimal caller fixes exposed by the new contracts.

Each slice is test-driven, committed independently, and reviewed before the next
slice starts. The final branch receives a whole-diff review and the repository's
full `npm run verify` gate.

## Acceptance criteria

- No explicit `any` remains in the included production files.
- No deprecated `AssetManager.getAsset(...)` remains in the included production
  files.
- Strict-core typechecking covers the included hierarchy and passes.
- Existing focused gameplay tests pass with no intentional behavior changes.
- Full `npm run verify` passes, including tests, normal/strict typechecks, asset
  validation, ability validation, and production build.
- Work stays local; no remote push is performed.

