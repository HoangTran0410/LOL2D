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
    for (const id of registry.spellIds()) {
      // Recall is declared as an eager class, not a loader (see
      // bundledPack.ts): it is not in spellModules, so there is no chunk to
      // defer, and PackRegistry.install() resolves any non-loader
      // immediately. That immediacy is the documented exception, not a
      // laziness bug — the other 238 real spell modules must still come back
      // null until loadSpellClass is called.
      if (id === `${BUNDLED_PACK_ID}:Recall`) continue;
      expect(registry.spellClass(id)).toBeNull();
    }
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
    const expected = CHAMPION_KITS.filter(wasPlayable)
      .map(kit => kit.name)
      .sort();
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
