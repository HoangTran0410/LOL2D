import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { PackRegistry } from '../../src/content/PackRegistry';
import {
  installBundledPackData,
  installBundledPackCode,
  BUNDLED_PACK_DATA,
  BUNDLED_PACKS,
  BUNDLED_PACK_ID,
} from '../../src/content/install';
import { data as riotData } from '../../packs/riot/pack';
import { buildContentApi } from '../../src/content/ContentApi';
import type { ContentPackData, ContentPackFactory } from '../../src/content/ContentPack';

/**
 * The loader, and the one file batch 2 replaces — split in two, batch 3's
 * own change: `installBundledPackData` writes the roster and every
 * tooltip, `installBundledPackCode` writes the spell classes against it.
 * Stage 1 holds static arrays of imported data and factories; Stage 2 will
 * fetch a bundle and `import(url)` it. Everything below this file is
 * identical in both, which is the entire reason the pack contract's code
 * half is a factory taking an API rather than a module of exports.
 *
 * `BUNDLED_PACKS` is not a demo array any more: `packs/riot/pack.ts` wraps
 * the game's own 59-row roster and 237 spells in place, so it is the `riot`
 * pack itself, installed first. The reference pack still follows it, now to
 * prove the seam holds for a second, independent pack rather than to stand
 * in for the game's own content. `src/content/catalog.ts`'s `contentCatalog()`
 * calls `installBundledPackData` and `src/content/registry.ts`'s
 * `contentRegistry()` calls `installBundledPackCode` on top of it, both on
 * first read, and `main.ts`'s `setup()` makes that first read happen during
 * the loading screen — so the registry this file builds by hand is the same
 * one every real match, and the pregame screen, already read through.
 */
describe('the bundled-pack loader', () => {
  it('keeps BUNDLED_PACK_DATA and BUNDLED_PACKS the same length, in the same order', () => {
    // `installBundledPackCode` pairs them by index — a length mismatch would
    // silently install one pack's code against a different pack's id.
    expect(BUNDLED_PACK_DATA.length).toBe(BUNDLED_PACKS.length);
  });

  it('ships the riot pack, core BasicAttack and Recall folded on, as its first pack', () => {
    // Not just non-empty: install order is load-bearing — `PackRegistry`'s
    // "where several packs answer the same question, install order decides"
    // (`monstersFilling`'s own doc comment) and `pregameCatalog.ts`'s
    // `sourceOrder` both read it — so this pins the bundled pack at index 0
    // rather than merely proving the arrays have *something* in them.
    //
    // Not `.toBe(riotData)`: `BUNDLED_PACK_DATA[0]` is `riotData` with
    // core's own `BasicAttack` display entry folded on (`install.ts`'s
    // `riotDataWithCore`), a genuinely different object — champions are
    // untouched by that merge, so those stay a same-reference check.
    expect(BUNDLED_PACKS.length).toBeGreaterThan(0);
    expect(BUNDLED_PACK_DATA[0].manifest.id).toBe(BUNDLED_PACK_ID);
    expect(BUNDLED_PACK_DATA[0].champions).toBe(riotData.champions);
    expect(BUNDLED_PACK_DATA[0].spellDisplay?.BasicAttack).toBeDefined();
    expect(BUNDLED_PACK_DATA[0].spellDisplay?.Yasuo_Q).toBeDefined();
    // `Recall` never gets a display entry — see `packs/riot/pack.test.ts`'s
    // own "keeps it out of the display data" test — so there is nothing to
    // assert here on the data half, only that the code half can build one.
    expect(BUNDLED_PACK_DATA[0].spellDisplay?.Recall).toBeUndefined();

    const code = BUNDLED_PACKS[0](buildContentApi());
    expect(code.spells?.BasicAttack).toBeTypeOf('function');
    expect(code.spells?.Yasuo_Q).toBeTypeOf('function');
    expect(code.spells?.Recall).toBeTypeOf('function');
    expect(code.monsterAbilities?.baron?.length).toBeGreaterThan(0);
  });

  it("resolves every champion's folded-in Recall to a real, constructible class", async () => {
    // `verifyPairing` (`PackRegistry.installCode`) is what actually enforces
    // this at install time — every champion's `recall: 'riot:Recall'` has to
    // resolve against a real spell source or `installBundledPackCode` throws.
    // This proves the resolved class is usable, not just present: `typeof
    // === 'function'` alone (fix round 1's finding) is true of both a real
    // class and the still-unresolved lazy loader that produces it — an
    // arrow function and a class are the same JS type. `.prototype` is the
    // discriminator `tests/packs/riot/pack.test.ts` already uses for the
    // opposite claim ("every entry is a loader, not a resolved class"): a
    // class always has one, an arrow-function loader never does. `.name`
    // pins it further — a bare `class Recall` grabs `Recall` as the name
    // `describe()`/`makeRecall`'s own class declaration in `Recall.ts`, not
    // a name Vite's dynamic `import()` machinery would happen to hand an
    // anonymous loader.
    const registry = new PackRegistry();
    installBundledPackData(registry);
    installBundledPackCode(registry, buildContentApi());
    const loaded = await registry.loadSpellClass('riot:Recall');
    expect(loaded).toBeTypeOf('function');
    expect(loaded).toHaveProperty('prototype');
    expect((loaded as { name?: string } | null)?.name).toBe('Recall');
  });

  it('installs the reference pack and its champion', () => {
    const registry = new PackRegistry();
    installBundledPackData(registry);
    installBundledPackCode(registry, buildContentApi());
    const ids = registry.champions().map(champion => champion.id);
    expect(ids).toContain('reference:vera');
  });

  it('every spell a bundled champion names resolves to a class', async () => {
    // The failure this catches is a typo in a slot list, which is otherwise
    // invisible until someone picks that champion and the slot comes up empty.
    // `loadSpellClass` (not the synchronous `spellClass`) because most of the
    // riot pack's spells are lazy loaders — that is the whole point of it
    // being lazy — so nothing here is resolved until asked for.
    const registry = new PackRegistry();
    installBundledPackData(registry);
    installBundledPackCode(registry, buildContentApi());
    for (const champion of registry.champions()) {
      for (const spellId of champion.spells) {
        const loaded = await registry.loadSpellClass(spellId);
        expect(loaded, `${champion.id} -> ${spellId}`).toBeTypeOf('function');
      }
    }
  });

  it('hands every pack code factory the same api object', () => {
    // Two copies of core in one process is the failure the factory shape
    // exists to prevent — `instanceof` stops answering and every pack spell
    // object misses its Z_INDEX_MAP key. Object identity is how that is
    // checked: each factory must receive the *same* api, not an equal one.
    //
    // A second, synthetic pack — installed and then reverted, never left in
    // `BUNDLED_PACK_DATA`/`BUNDLED_PACKS` — gives the set assertion
    // something it could actually fail to distinguish, the same reasoning
    // batch 2's version of this test used.
    const syntheticData: ContentPackData = {
      manifest: { id: 'install-test-synthetic', version: '0.0.0', coreRange: '^1' },
    };
    const synthetic: ContentPackFactory = () => ({});

    const received: unknown[] = [];
    const spy =
      (factory: ContentPackFactory): ContentPackFactory =>
      api => {
        received.push(api);
        return factory(api);
      };

    const originalData = [...BUNDLED_PACK_DATA];
    const originalCode = [...BUNDLED_PACKS];
    BUNDLED_PACK_DATA.splice(0, BUNDLED_PACK_DATA.length, ...originalData, syntheticData);
    BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...[...originalCode, synthetic].map(spy));

    const registry = new PackRegistry();
    try {
      installBundledPackData(registry);
      installBundledPackCode(registry, buildContentApi());
    } finally {
      BUNDLED_PACK_DATA.splice(0, BUNDLED_PACK_DATA.length, ...originalData);
      BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...originalCode);
    }
    expect(received.length).toBe(originalCode.length + 1);
    expect(new Set(received).size).toBe(1);
  });
});
