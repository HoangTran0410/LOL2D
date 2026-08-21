import { describe, expect, it } from 'vitest';
import riotCode, { data, BUNDLED_PACK_ID } from '../../../packs/riot/pack';
import { buildContentApi } from '../../../src/content/ContentApi';
import { PackRegistry } from '../../../src/content/PackRegistry';
import { spellModules as riotSpellModules } from '../../../packs/riot/generated/spellModules';
import type { ContentPack } from '../../../src/content/ContentPack';

/**
 * `packs/riot/pack.ts` — the replacement for `src/content/bundledPack.ts`
 * (batch 4 task 7). Moved from `tests/content/bundledPack.test.ts`, whose own
 * assertions leaned on `CHAMPION_KITS` — gone along with the file it was
 * declared in — so every check below reads the pack's own exported `data`
 * instead of a second, independent source to compare it against.
 *
 * `pack.ts` itself is just a re-export (`./pack.ts`'s own header explains
 * why): `data` from `./data.ts`, the default code factory from `./code.ts`.
 *
 * **This pack, on its own, is not installable — deliberately, and the last
 * test below pins that.** `data.champions` names `'BasicAttack'` (the "Đánh
 * Thường" shelf) and gives every champion a `Recall`; `code.ts` supplies
 * `Recall` but not `BasicAttack` — core's own spell, which
 * `tests/content/packBoundary.test.ts` refuses this pack any direct reach
 * for. `src/content/install.ts` is what folds core's `BasicAttack` onto
 * this pack's data and code before installing either half
 * (`tests/content/install.test.ts` covers that composed, actually-installed
 * shape); a bare `{ ...data, ...riotCode(api) }` was never meant to stand
 * alone, which the old `bundledPack.ts` obscured by doing that folding
 * internally, in the same file its `data`/`code` were declared in.
 */
describe('the riot pack', () => {
  const api = buildContentApi();

  it('carries a real roster', () => {
    expect(data.champions?.length).toBeGreaterThan(30);
  });

  it("carries every generated spell module, plus Recall — core's BasicAttack is install.ts's to add", () => {
    const code = riotCode(api);
    expect(Object.keys(riotSpellModules).length).toBeGreaterThan(200);
    expect(Object.keys(code.spells ?? {})).toHaveLength(Object.keys(riotSpellModules).length + 1);
    expect(code.spells?.BasicAttack).toBeUndefined();
  });

  it('hands every spell over lazily — each one is a loader, not a resolved class', () => {
    const code = riotCode(api);
    const entries = Object.entries(code.spells ?? {});
    expect(entries.length).toBeGreaterThan(200);
    for (const [id, source] of entries) {
      expect(typeof source, id).toBe('function');
      // A class has a `prototype`; an arrow-function loader (the shape both
      // `spellModules`'s entries and `Recall`'s own loader use) never does —
      // see `isSpellLoader`'s own doc comment for this exact discriminator.
      expect((source as { prototype?: unknown }).prototype, id).toBeUndefined();
    }
  });

  it('really can load one', async () => {
    const code = riotCode(api);
    const loader = code.spells?.Yasuo_Q as (() => Promise<unknown>) | undefined;
    expect(loader).toBeTypeOf('function');
    const loaded = await loader!();
    expect(loaded).toBeTypeOf('function');
  });

  it('marks playable exactly the champions with a real portrait, a full kit and an attack profile', () => {
    // The predicate `packs/riot/data.ts`'s `championEntries()` applies,
    // restated here so a regression in that function (not just in this
    // pack's own roster data) would still be visible: `playable` is not an
    // opinion this test takes on faith.
    const wasPlayable = (champion: NonNullable<typeof data.champions>[number]) =>
      Boolean(champion.image?.startsWith('champ_')) &&
      champion.spells.length === 4 &&
      Boolean(champion.attack);
    const expected = (data.champions ?? [])
      .filter(wasPlayable)
      .map(c => c.name)
      .sort();
    expect(expected.length).toBeGreaterThan(20);

    const actual = (data.champions ?? []).filter(c => c.playable).map(c => c.name);
    expect(actual.sort()).toEqual(expected);
  });

  it('declares Recall on every champion, and keeps it out of the display data', () => {
    const code = riotCode(api);
    expect(code.spells?.Recall).toBeTypeOf('function');
    expect(data.spellDisplay?.Recall).toBeUndefined();
    for (const champion of data.champions ?? []) expect(champion.recall).toBe('Recall');
  });

  it("supplies Baron's abilities", () => {
    const code = riotCode(api);
    expect(code.monsterAbilities?.baron?.length).toBeGreaterThan(0);
  });

  it("is not independently installable — it depends on core's own BasicAttack", () => {
    // `src/content/install.ts` folds `BasicAttack` onto this pack before
    // installing it (`riotDataWithCore`/`riotCodeWithCore`); a bare
    // `{ ...data, ...riotCode(api) }`, installed on its own, is missing a
    // spell its own roster names. This pins the *reason* — a champion named
    // "Đánh Thường" whose one ability is `'BasicAttack'` — so a future
    // reader who hits this throw does not mistake it for a bug in the pack.
    const pack: ContentPack = { ...data, ...riotCode(api) };
    expect(() => new PackRegistry().install(pack)).toThrow(/BasicAttack/);
  });

  it('is the pack `BUNDLED_PACK_ID` names — the composed, installable shape lives in tests/content/install.test.ts', () => {
    expect(data.manifest.id).toBe(BUNDLED_PACK_ID);
    expect(BUNDLED_PACK_ID).toBe('riot');
  });
});
