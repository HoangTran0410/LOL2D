import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { PackRegistry } from '../../src/content/PackRegistry';
import { installBundledPacks, BUNDLED_PACKS } from '../../src/content/install';
import { bundledPack } from '../../src/content/bundledPack';
import type { ContentPackFactory } from '../../src/content/ContentPack';

/**
 * The loader, and the one file batch 2 replaces.
 *
 * Stage 1 holds a static array of imported factories; Stage 2 will fetch a
 * bundle and `import(url)` it. Everything below this file is identical in both,
 * which is the entire reason the pack contract is a factory taking an API
 * rather than a module of exports.
 *
 * `BUNDLED_PACKS` is not a demo array any more: `bundledPack` wraps the
 * game's own 60 champions and 238 spells in place, so it is the `riot` pack
 * itself, installed first. The reference pack still follows it, now to prove
 * the seam holds for a second, independent pack rather than to stand in for
 * the game's own content. `src/content/registry.ts`'s `contentRegistry()`
 * calls `installBundledPacks` on its first read, and `main.ts`'s `setup()`
 * makes that first read happen during the loading screen — so the registry
 * this file builds by hand is the same one every real match, and the
 * pregame screen, already read through.
 */
describe('installBundledPacks', () => {
  it('ships the game core content as its first pack', () => {
    // Not just non-empty: install order is load-bearing — `PackRegistry`'s
    // "where several packs answer the same question, install order decides"
    // (`monstersFilling`'s own doc comment) and `pregameCatalog.ts`'s
    // `sourceOrder` both read it — so this pins `bundledPack` at index 0
    // rather than merely proving the array has *something* in it.
    expect(BUNDLED_PACKS.length).toBeGreaterThan(0);
    expect(BUNDLED_PACKS[0]).toBe(bundledPack);
  });

  it('installs the reference pack and its champion', () => {
    const registry = new PackRegistry();
    installBundledPacks(registry);
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
    installBundledPacks(registry);
    for (const champion of registry.champions()) {
      for (const spellId of champion.spells) {
        const loaded = await registry.loadSpellClass(spellId);
        expect(loaded, `${champion.id} -> ${spellId}`).toBeTypeOf('function');
      }
    }
  });

  it('hands every pack the same api object', () => {
    // Two copies of core in one process is the failure the factory shape
    // exists to prevent — `instanceof` stops answering and every pack spell
    // object misses its Z_INDEX_MAP key. Object identity is how that is
    // checked: each factory must receive the *same* api, not an equal one.
    //
    // `BUNDLED_PACKS` has exactly one real entry today, so
    // `new Set(received).size === 1` would hold no matter what
    // `installBundledPacks` did with the api it built — a one-element set
    // cannot be any other size, and `buildContentApi()`'s own module cache
    // means even a broken loop that rebuilt the api per factory would still
    // hand out one identity. A second, synthetic factory — installed and
    // then reverted, never left in `BUNDLED_PACKS` — gives the set
    // assertion something it could actually fail to distinguish.
    const synthetic: ContentPackFactory = () => ({
      manifest: { id: 'install-test-synthetic', version: '0.0.0', coreRange: '^1' },
    });

    const received: unknown[] = [];
    const spy = (factory: (api: never) => unknown) => (api: never) => {
      received.push(api);
      return factory(api);
    };
    const registry = new PackRegistry();
    const originals = [...BUNDLED_PACKS];
    BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...[...originals, synthetic].map(spy as never));
    try {
      installBundledPacks(registry);
    } finally {
      BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...originals);
    }
    expect(received.length).toBe(originals.length + 1);
    expect(new Set(received).size).toBe(1);
  });
});
