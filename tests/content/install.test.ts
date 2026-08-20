import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { PackRegistry } from '../../src/content/PackRegistry';
import { installBundledPacks, BUNDLED_PACKS } from '../../src/content/install';

/**
 * The loader, and the one file batch 2 replaces.
 *
 * Stage 1 holds a static array of imported factories; Stage 2 will fetch a
 * bundle and `import(url)` it. Everything below this file is identical in both,
 * which is the entire reason the pack contract is a factory taking an API
 * rather than a module of exports.
 *
 * The reference pack is here because core has to be a complete game on its
 * own — it is the smoke test, the living documentation of `ContentApi`, and
 * the template someone copies to write their own.
 */
describe('installBundledPacks', () => {
  it('ships at least one pack, so core is playable with no content installed', () => {
    expect(BUNDLED_PACKS.length).toBeGreaterThan(0);
  });

  it('installs the reference pack and its champion', () => {
    const registry = new PackRegistry();
    installBundledPacks(registry);
    const ids = registry.champions().map(champion => champion.id);
    expect(ids).toContain('reference:vera');
  });

  it('every spell a bundled champion names resolves to a class', () => {
    // The failure this catches is a typo in a slot list, which is otherwise
    // invisible until someone picks that champion and the slot comes up empty.
    const registry = new PackRegistry();
    installBundledPacks(registry);
    for (const champion of registry.champions()) {
      for (const spellId of champion.spells) {
        expect(registry.spellClass(spellId), `${champion.id} -> ${spellId}`).toBeTypeOf(
          'function'
        );
      }
    }
  });

  it('hands every pack the same api object', () => {
    // Two copies of core in one process is the failure the factory shape
    // exists to prevent — `instanceof` stops answering and every pack spell
    // object misses its Z_INDEX_MAP key. Object identity is how that is
    // checked: each factory must receive the *same* api, not an equal one.
    const received: unknown[] = [];
    const spy = (factory: (api: never) => unknown) => (api: never) => {
      received.push(api);
      return factory(api);
    };
    const registry = new PackRegistry();
    const originals = [...BUNDLED_PACKS];
    BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...originals.map(spy as never));
    try {
      installBundledPacks(registry);
    } finally {
      BUNDLED_PACKS.splice(0, BUNDLED_PACKS.length, ...originals);
    }
    expect(received.length).toBe(originals.length);
    expect(new Set(received).size).toBe(1);
  });
});
