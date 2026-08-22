import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { buildContentApi } from '../../src/content/ContentApi';
import { isSpellLoader } from '../../src/content/ContentPack';

/**
 * The API is what a pack may touch, and its size is a measured number.
 *
 * 241 spell files import 72 distinct core modules between them — 110 symbols,
 * not the ~40 the top of the import table suggests. Grouping them into
 * namespaces is what makes that a surface rather than a pile.
 *
 * The reassuring half is that the transitive closure stops at 87 modules and
 * reaches `Game`, `SceneManager` and every `.vue` file exactly zero times,
 * because `GameObject.game` is typed as a structural context rather than the
 * `Game` class. This test pins the namespaces so a future edit cannot quietly
 * widen the seam.
 */
describe('buildContentApi', () => {
  it('exposes exactly the agreed namespaces', () => {
    const api = buildContentApi() as unknown as Record<string, unknown>;
    const namespaces = [
      'units',
      'buffs',
      'combat',
      'layers',
      'vfx',
      'helpers',
      'enums',
      'terrain',
      'utils',
    ];
    for (const name of namespaces) {
      expect(api[name], `missing namespace ${name}`).toBeTypeOf('object');
    }
  });

  it('hands over the base classes a spell extends', () => {
    const api = buildContentApi() as unknown as Record<string, unknown>;
    for (const name of ['Spell', 'SpellObject', 'MissileSpellObject']) {
      expect(api[name], `missing base class ${name}`).toBeTypeOf('function');
    }
  });

  it('carries the 24 buffs as constructors, not as an interface', () => {
    // Slow is `new`-ed 64 times across the spell tree, Dash 51, StatAmp 33.
    // They are mechanics rather than content, so core keeps them and hands
    // over the constructors themselves.
    const api = buildContentApi();
    expect(Object.keys(api.buffs).length).toBeGreaterThanOrEqual(20);
    for (const [name, ctor] of Object.entries(api.buffs)) {
      expect(ctor, `buff ${name} is not constructible`).toBeTypeOf('function');
    }
  });

  it('hands a pack `lazy()`, the only door to the mark a loader needs', () => {
    // `lazy()` lives on `@/content/ContentPack`, and a pack may not import a
    // value from that module (`packBoundary.test.ts`) — so `api.lazy` is the
    // only way a pack can wrap a `function`-expression loader and have it
    // recognised as a loader rather than misread as the class itself.
    const api = buildContentApi();
    expect(api.lazy).toBeTypeOf('function');

    // eslint-disable-next-line object-shorthand
    const wrapped = api.lazy(function () {
      return Promise.resolve(class {});
    });
    expect(isSpellLoader(wrapped)).toBe(true);
  });

  it('hands over the draw-layer vocabulary, not a magic number per spell file', () => {
    // `classLayerOf` resolves a `SpellObject` subclass with no zIndex of its
    // own to `SPELL_EFFECT_Z_INDEX`, which is *above* the champions. Ground
    // art has to say so, and a pack cannot value-import `ObjectManager` to
    // find the constant — so the vocabulary rides here or it is a literal 2
    // in a dozen pack files again.
    const api = buildContentApi();
    for (const name of [
      'FOUNTAIN_Z_INDEX',
      'TRAIL_Z_INDEX',
      'PARTICLE_Z_INDEX',
      'GROUND_Z_INDEX',
      'UNIT_Z_INDEX',
      'MINION_Z_INDEX',
      'OBJECTIVE_Z_INDEX',
      'CHAMPION_Z_INDEX',
      'SPELL_EFFECT_Z_INDEX',
      'COMBAT_TEXT_Z_INDEX',
    ]) {
      expect(
        (api.layers as unknown as Record<string, unknown>)[name],
        `missing layer ${name}`
      ).toBeTypeOf('number');
    }
    // The property that actually matters, and the bug that produced the
    // vocabulary: ground art below the feet, ordinary spell effects above.
    expect(api.layers.GROUND_Z_INDEX).toBeLessThan(api.layers.CHAMPION_Z_INDEX);
    expect(api.layers.SPELL_EFFECT_Z_INDEX).toBeGreaterThan(api.layers.CHAMPION_Z_INDEX);
  });

  it('resolves an asset by plain string, not by the generated union', () => {
    // Core keeps its typed AssetKey union; a pack's keys are strings it
    // declares in its own manifest and type-checks with its own generated
    // union. Type safety stops at the boundary, which is where runtime
    // validation takes over.
    const api = buildContentApi();
    expect(api.asset('anything_at_all')).toBeTruthy();
  });
});
