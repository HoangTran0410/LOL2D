# Base Unit Type Migration Implementation Plan

> **Execution:** Run the three tasks sequentially with a fresh implementer and
> review checkpoint per task. Do not push the branch.

**Goal:** Replace the root gameplay hierarchy's legacy `any` and string asset
lookups with strict, reusable TypeScript contracts without changing gameplay.

**Architecture:** Tighten the existing inheritance tree in place. Use concrete
domain types and small named interfaces, typed object queries, generated asset
keys, and an incremental strict-core boundary. Avoid a generic framework or a
full spell migration.

**Stack:** TypeScript, p5.js, Vitest, Vite.

---

## Task 1: Base objects and typed queries

**Files:**

- Modify: `src/game/gameObject/GameObject.ts`
- Modify: `src/game/gameObject/SpellObject.ts`
- Modify: `src/game/managers/ObjectManager.ts`
- Create: `tests/game/types/BaseObjectTypes.test.ts`
- Modify: `tsconfig.strict-core.json`

1. Add a failing boundary test that rejects explicit `any` in the three scoped
   production files and exercises object add/update/remove/query behavior.
2. Run the focused test and record the expected failure.
3. Introduce typed construction options and game/owner references.
4. Store `GameObject[]` in `ObjectManager`; type query areas, constructors,
   predicates, predefined filters, and generic query results while preserving the
   current filtering order and quadtree behavior.
5. Replace unsafe debug-global access with a typed `globalThis` seam.
6. Add these files and the focused test to strict-core.
7. Run the focused test, strict-core typecheck, and normal typecheck.
8. Commit as `refactor: type base game objects and queries`.

## Task 2: Buff and attackable-unit contracts

**Files:**

- Modify: `src/game/gameObject/Buff.ts`
- Modify: `src/game/gameObject/attackableUnits/AttackableUnit.ts`
- Modify: `src/game/gameObject/buffs/*.ts`
- Create: `tests/game/types/BuffUnitTypes.test.ts`
- Modify: `tsconfig.strict-core.json`
- Modify: only callers that fail because they violate the new contract

1. Add failing boundary assertions for explicit `any` and deprecated `getAsset`
   across the scoped files, plus focused buff add/remove/stack and damage-pipeline
   behavior tests.
2. Run the focused test and record the expected failure.
3. Define named damage/death/buff constructor contracts using type-only imports
   where the hierarchy is circular.
4. Type buff source/target, description, icon, stack identity, game reference,
   and damage hooks.
5. Type unit buffs, stats, avatar, damage/heal/death data, constructor options,
   and buff lookup methods without changing their runtime branches.
6. Replace scoped buff icon lookups with `AssetManager.get(...)` and canonical
   generated keys.
7. Make only the minimum caller edits required by the stronger contracts.
8. Extend strict-core and run the focused tests plus both typechecks.
9. Commit as `refactor: type buffs and attackable units`.

## Task 3: Champion and direct subclasses

**Files:**

- Modify: `src/game/gameObject/attackableUnits/Champion.ts`
- Modify: `src/game/gameObject/attackableUnits/AIChampion.ts`
- Modify: `src/game/gameObject/attackableUnits/DummyChampion.ts`
- Modify: `src/game/gameObject/attackableUnits/Monster.ts`
- Modify: `src/game/gameObject/structures/Turret.ts`
- Create: `tests/game/types/ChampionTypes.test.ts`
- Modify: `tsconfig.strict-core.json`
- Modify: only callers that fail because they violate the new contract

1. Add failing boundary assertions for explicit `any` and deprecated `getAsset`
   in the five scoped files, plus focused construction, target, buff, and death
   behavior coverage.
2. Run the focused test and record the expected failure.
3. Type champion construction, preset/spell data, buff map access, avatar/icon
   handles, death attacker data, and direct-subclass targets.
4. Replace scoped asset lookups with generated-key `AssetManager.get(...)`.
5. Preserve AI selection, monster/turret targeting, champion spell lifecycle,
   stats, rendering, and score behavior.
6. Make only minimal compatibility edits revealed by the compiler.
7. Extend strict-core and run focused tests, integration tests, and both
   typechecks.
8. Commit as `refactor: type champions and unit subclasses`.

## Final verification and review

1. Verify the scoped production files contain neither explicit `any` nor
   `AssetManager.getAsset(...)`.
2. Run `npm run verify` and retain its complete result.
3. Review the whole branch diff for behavior changes, unsafe assertions, asset-key
   substitutions, and accidental spell migration.
4. Fix findings, rerun the relevant focused checks, then rerun `npm run verify`.
5. Report the local branch and commits. Do not merge or push unless the user asks.

