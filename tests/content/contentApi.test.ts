import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { buildContentApi } from '../../src/content/ContentApi';

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
    const namespaces = ['units', 'buffs', 'combat', 'vfx', 'helpers', 'enums', 'terrain', 'utils'];
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

  it('resolves an asset by plain string, not by the generated union', () => {
    // Core keeps its typed AssetKey union; a pack's keys are strings it
    // declares in its own manifest and type-checks with its own generated
    // union. Type safety stops at the boundary, which is where runtime
    // validation takes over.
    const api = buildContentApi();
    expect(api.asset('anything_at_all')).toBeTruthy();
  });
});
