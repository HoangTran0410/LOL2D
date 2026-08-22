/**
 * A compile-time regression test for the *shape* of `SpellCatalogId` itself,
 * not what it resolves an id to at runtime — `spellCatalog.test.ts` already
 * covers that half.
 *
 * `expectTypeOf(...).toEqualTypeOf<...>()` asserts nothing at runtime (the
 * `expect-type` library it comes from is a pure compile-time check; calling
 * it never throws), so this test only has teeth while the file it lives in
 * is part of a `tsc`/`vue-tsc` program. `tsconfig.json`'s own `include` is
 * `src/**\/*` only, so plain `npm run typecheck` never reaches `tests/`.
 * `tsconfig.strict-core.json` is the one config that both reaches `tests/`
 * (by explicit, individually-named entries — see the three
 * `tests/game/types/*.test.ts` files already listed there for the same
 * reason) and applies `strict: true`, so this file's path has to be added to
 * that `include` array or this assertion is dead weight that never runs.
 *
 * Batch 5 task 2 cut core's public `SpellCatalogId` loose from the riot
 * pack's own generated 237-literal union (`config/spellCatalog.ts`'s own
 * header has the full story). Before that cut, this type was
 * `PackSpellCatalogId | 'BasicAttack'` — a union, not `string` — so
 * `toEqualTypeOf<string>()` below fails to compile against it. This pins the
 * replacement shape so a later change cannot quietly re-import a pack's
 * union and narrow this type again without a compile failure here, and
 * without waiting on the 22 call sites the plain `string` choice happens to
 * satisfy today to notice on their own.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { SpellCatalogId } from '../../../src/game/config/spellCatalog';

describe('SpellCatalogId', () => {
  it('is a plain string type core owns, not a union pulled from any pack', () => {
    expectTypeOf<SpellCatalogId>().toEqualTypeOf<string>();
  });
});
