import { describe, expect, it } from 'vitest';
import bundledCode, { data, BUNDLED_PACK_ID } from '../../src/content/bundledPack';
import { buildContentApi } from '../../src/content/ContentApi';
import { PackRegistry } from '../../src/content/PackRegistry';
import { CHAMPION_KITS } from '../../src/game/config/spellCatalog';
// The generated module map split across two trees in batch 4 task 3 — core's
// own (`BasicAttack`) and the riot pack's (everything else) — the same way
// `bundledPack.ts`'s own `spellSources()` merges them, content-last.
import { spellModules as coreSpellModules } from '../../src/generated/spellModules';
import { spellModules as riotSpellModules } from '../../packs/riot/generated/spellModules';
import type { ContentPack } from '../../src/content/ContentPack';

const spellModules = { ...riotSpellModules, ...coreSpellModules };

describe('the bundled pack', () => {
  // The merged shape every reader before the data/code split saw —
  // `data` is reachable with no api at all; `bundledCode(api)` is the spells.
  const pack: ContentPack = { ...data, ...bundledCode(buildContentApi()) };

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
    const ids = registry.spellIds();
    // Guards the loop below: an install that stored no spells at all would
    // make every iteration below pass vacuously and prove nothing.
    expect(ids.length).toBeGreaterThan(200);
    // Recall is a loader too, same as every other entry here — `188c372`
    // moved it off the eager-class shape it used to have (see
    // `spellSources` in `bundledPack.ts`), specifically so an eager import
    // would stop being a static edge into the `game` chunk. No id in this
    // pack gets special treatment: `PackRegistry.install()` only resolves a
    // spell immediately when its source is *not* a loader, and nothing here
    // is.
    for (const id of ids) {
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
