import { beforeEach, describe, expect, it } from 'vitest';
import { PackRegistry } from '../../src/content/PackRegistry';
import { lazy } from '../../src/content/ContentPack';
import type { ContentPack } from '../../src/content/ContentPack';

/**
 * Merging packs, and why ids carry their pack.
 *
 * Two packs may both call an ability `Fizz_E`; without a prefix the second
 * install silently replaces the first. Every id is `<packId>:<localId>`, the
 * author writes the local half, and the registry adds the rest.
 *
 * Maps are the one asymmetric section: champions from several packs are
 * concatenated, but a match has exactly one world, so maps are *listed* for
 * selection rather than merged.
 */
const pack = (id: string, extra: Partial<ContentPack> = {}): ContentPack =>
  ({
    manifest: { id, version: '1.0.0', coreRange: '^1' },
    ...extra,
  }) as ContentPack;

describe('PackRegistry', () => {
  let registry: PackRegistry;
  beforeEach(() => {
    registry = new PackRegistry();
  });

  it('prefixes every champion id with its pack', () => {
    registry.install(
      pack('ref', {
        spells: { Alpha_Q: class {} } as never,
        champions: [
          { id: 'alpha', name: 'Alpha', image: null, playable: false, spells: ['Alpha_Q'] },
        ],
      })
    );
    expect(registry.champions()[0].id).toBe('ref:alpha');
    expect(registry.champions()[0].spells).toEqual(['ref:Alpha_Q']);
  });

  it('qualifies a champion recall the same way it qualifies its spells', () => {
    registry.install(
      pack('ref', {
        spells: { Alpha_Q: class {}, Alpha_Recall: class {} } as never,
        champions: [
          {
            id: 'alpha',
            name: 'Alpha',
            image: null,
            playable: false,
            spells: ['Alpha_Q'],
            recall: 'Alpha_Recall',
          },
        ],
      })
    );
    expect(registry.champions()[0].recall).toBe('ref:Alpha_Recall');
  });

  it('leaves recall undefined for a champion whose pack declares none', () => {
    registry.install(
      pack('ref', {
        spells: { Alpha_Q: class {} } as never,
        champions: [
          { id: 'alpha', name: 'Alpha', image: null, playable: false, spells: ['Alpha_Q'] },
        ],
      })
    );
    expect(registry.champions()[0].recall).toBeUndefined();
  });

  it('keeps two packs that use the same local id apart', () => {
    const A = class {};
    const B = class {};
    registry.install(pack('one', { spells: { Shared: A } as never }));
    registry.install(pack('two', { spells: { Shared: B } as never }));
    expect(registry.spellClass('one:Shared')).toBe(A);
    expect(registry.spellClass('two:Shared')).toBe(B);
  });

  it('returns null for an id no pack provides', () => {
    expect(registry.spellClass('missing:Nothing')).toBeNull();
  });

  it('concatenates champions across packs', () => {
    registry.install(
      pack('one', {
        spells: { Q: class {} } as never,
        champions: [{ id: 'a', name: 'A', image: null, playable: false, spells: ['Q'] }],
      })
    );
    registry.install(
      pack('two', {
        spells: { Q: class {} } as never,
        champions: [{ id: 'b', name: 'B', image: null, playable: false, spells: ['Q'] }],
      })
    );
    expect(registry.champions().map(c => c.id)).toEqual(['one:a', 'two:b']);
  });

  /**
   * The test that proves asset namespacing does not exist without it. Two
   * champions from two different packs both declare the same *local* image
   * key (`'hero'`) — the same collision `'concatenates champions across
   * packs'` above proves ids survive, asked one field over. Before batch 4
   * task 4, `image` traveled through `writeData` untouched (see `image:
   * kit.image` — a plain spread, unlike `id`/`spells`/`recall`), so both
   * champions would have carried the literal string `'hero'` and
   * `AssetManager.get('hero')` could resolve only one file, ever — silently
   * shadowing whichever pack loaded first. `manifest.assets` is what turns
   * "declares an art tree of its own" into a real qualifier: each pack's
   * `image` comes back as `<assets>:<localKey>`, and `AssetManager` resolves
   * each qualified form against exactly that pack's own registered manifest
   * (`registerPackAssets`) — see both modules' own doc comments for why the
   * shape matches `qualify()` rather than inventing a second convention.
   */
  it('resolves two packs declaring the same local asset key to two different files', async () => {
    const { default: AssetManager } = await import('../../src/managers/AssetManager');
    AssetManager.registerPackAssets('collision-one', {
      hero: { kind: 'image', url: '/one/hero.png', path: 'packs/one/assets/hero.png' },
    });
    AssetManager.registerPackAssets('collision-two', {
      hero: { kind: 'image', url: '/two/hero.png', path: 'packs/two/assets/hero.png' },
    });

    registry.install(
      pack('collision-one', {
        manifest: {
          id: 'collision-one',
          version: '1.0.0',
          coreRange: '^1',
          assets: 'collision-one',
        },
        spells: { Q: class {} } as never,
        champions: [{ id: 'a', name: 'A', image: 'hero', playable: false, spells: ['Q'] }],
      })
    );
    registry.install(
      pack('collision-two', {
        manifest: {
          id: 'collision-two',
          version: '1.0.0',
          coreRange: '^1',
          assets: 'collision-two',
        },
        spells: { Q: class {} } as never,
        champions: [{ id: 'b', name: 'B', image: 'hero', playable: false, spells: ['Q'] }],
      })
    );

    const [champA, champB] = registry.champions();
    // Qualified, and qualified *differently* — this is the assertion that
    // would have failed before this task: both would have read back as the
    // bare `'hero'` neither pack meant uniquely.
    expect(champA.image).toBe('collision-one:hero');
    expect(champB.image).toBe('collision-two:hero');
    expect(champA.image).not.toBe(champB.image);

    // And the qualified forms resolve to two genuinely different files.
    expect(AssetManager.get(champA.image as never).url).toBe('/one/hero.png');
    expect(AssetManager.get(champB.image as never).url).toBe('/two/hero.png');
  });

  it('lists maps for selection rather than merging them', () => {
    // A match has many champions and exactly one world, so this section is a
    // choice, not a union — the asymmetry is deliberate.
    const map = (id: string) => ({
      id,
      name: id,
      size: 4000,
      factions: [{ id: 'solo' }],
      geometry: {
        terrain: { wall: [], bush: [], water: [] },
        slots: { spawn: [], minion: [], structure: [], neutral: [] },
      },
    });
    registry.install(pack('one', { maps: [map('arena')] as never }));
    registry.install(pack('two', { maps: [map('forest')] as never }));
    expect(registry.maps().map(m => m.id)).toEqual(['one:arena', 'two:forest']);
  });

  it('lists a map summary without pulling its geometry along, and loads it on demand', async () => {
    registry.install(
      pack('one', {
        maps: [
          {
            id: 'arena',
            name: 'Arena',
            size: 4000,
            factions: [{ id: 'solo' }],
            geometry: {
              terrain: { wall: [[{ x: 0, y: 0 }]], bush: [], water: [] },
              slots: { spawn: [], minion: [], structure: [], neutral: [] },
            },
          },
        ] as never,
      })
    );
    const [summary] = registry.maps();
    expect(summary.id).toBe('one:arena');
    expect(summary).not.toHaveProperty('terrain');
    expect(summary).not.toHaveProperty('slots');

    const geometry = await registry.loadMapGeometry('one:arena');
    expect(geometry?.terrain.wall).toHaveLength(1);
  });

  it('returns null for a map geometry id no pack provides', async () => {
    expect(await registry.loadMapGeometry('missing:nowhere')).toBeNull();
  });

  /**
   * `validate.ts`'s `checkMapGeometry` — the terrain-layer whitelist, the
   * structure-kind vocabulary, the faction-declared rule, the muster-per-lane
   * rule — only ever runs against a *plain-object* `geometry`, because it
   * cannot inspect a loader's body synchronously (`checkSpells` makes the
   * identical trade for a `SpellSource` loader). `install()`'s `validatePack`
   * therefore only ever checks a loader map's summary (id/name/size/
   * factions); the resolved geometry itself is never checked unless
   * `loadMapGeometry` checks it once the loader settles. Both shipped maps
   * (`summonersRift`, `referenceMap`) use loaders, so this was a real gap,
   * not a hypothetical one.
   */
  it('validates a loader map’s geometry once it resolves, not just its summary at install', async () => {
    registry.install(
      pack('broken', {
        maps: [
          {
            id: 'arena',
            name: 'Arena',
            size: 4000,
            factions: [{ id: 'solo' }],
            geometry: () =>
              Promise.resolve({
                // `lava` is not `wall`/`bush`/`water` — `TerrainMap` drops an
                // unrecognised layer in silence, which is exactly the
                // failure `checkMapGeometry`'s terrain check exists to name
                // instead.
                terrain: { wall: [], bush: [], water: [], lava: [] },
                slots: { spawn: [], minion: [], structure: [], neutral: [] },
              }),
          },
        ] as never,
      })
    );

    await expect(registry.loadMapGeometry('broken:arena')).rejects.toThrow(/lava/);
  });

  it('does not call a map geometry loader at install time', () => {
    let calls = 0;
    registry.install(
      pack('lazy', {
        maps: [
          {
            id: 'arena',
            name: 'Arena',
            size: 4000,
            factions: [{ id: 'solo' }],
            geometry: () => {
              calls += 1;
              return Promise.resolve({
                terrain: { wall: [], bush: [], water: [] },
                slots: { spawn: [], minion: [], structure: [], neutral: [] },
              });
            },
          },
        ] as never,
      })
    );
    expect(calls).toBe(0);
  });

  it('resolves a map geometry loader once however many callers ask', async () => {
    let calls = 0;
    const geometry = {
      terrain: { wall: [], bush: [], water: [] },
      slots: { spawn: [], minion: [], structure: [], neutral: [] },
    };
    registry.install(
      pack('lazy', {
        maps: [
          {
            id: 'arena',
            name: 'Arena',
            size: 4000,
            factions: [{ id: 'solo' }],
            geometry: () => {
              calls += 1;
              return Promise.resolve(geometry);
            },
          },
        ] as never,
      })
    );
    const [a, b] = await Promise.all([
      registry.loadMapGeometry('lazy:arena'),
      registry.loadMapGeometry('lazy:arena'),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(geometry);
    expect(b).toBe(geometry);
  });

  it('finds every monster that can fill a role, in install order', () => {
    const body = (health: number) => ({
      name: 'Body',
      avatar: 'a',
      speed: 0,
      size: 100,
      attackRange: 400,
      reviveTime: 3000,
      health,
      offset: { x: 0, y: 0 },
    });
    registry.install(
      pack('one', {
        monsters: {
          big: { id: 'big', name: 'Big', fills: ['epic'], members: [body(1000)] },
        } as never,
      })
    );
    registry.install(
      pack('two', {
        monsters: {
          huge: { id: 'huge', name: 'Huge', fills: ['epic'], members: [body(900)] },
        } as never,
      })
    );
    expect(registry.monstersFilling('epic').map(m => m.id)).toEqual(['one:big', 'two:huge']);
    expect(registry.monstersFilling('buff')).toEqual([]);
  });

  it('refuses an invalid pack instead of half-installing it', () => {
    // The manifest id is fine — this pack is rejected for a different reason
    // (a champion naming a spell the pack never declares) — but it still
    // carries payload in every section a write-first install() would touch,
    // so a reordering bug has something to leak. A pack whose only content is
    // `{ manifest: { id: 'bad:id' } }` cannot pin this: there is nothing in
    // it to write in the first place.
    expect(() =>
      registry.install(
        pack('bad', {
          spells: { Q: class {} } as never,
          champions: [{ id: 'a', name: 'A', image: null, spells: ['Q', 'Missing'] }],
          monsters: {
            big: { id: 'big', name: 'Big', fills: ['epic'], health: 1000 },
          } as never,
          maps: [
            {
              id: 'arena',
              name: 'Arena',
              size: 4000,
              factions: [{ id: 'solo' }],
              geometry: {
                terrain: { wall: [], bush: [], water: [] },
                slots: { spawn: [], minion: [], structure: [], neutral: [] },
              },
            },
          ] as never,
        })
      )
    ).toThrow(/Missing/);
    expect(registry.champions()).toEqual([]);
    expect(registry.maps()).toEqual([]);
    expect(registry.spellClass('bad:Q')).toBeNull();
    expect(registry.monstersFilling('epic')).toEqual([]);
  });

  it('rejects a pack whose id is not a bare identifier', () => {
    expect(() => registry.install({ manifest: { id: 'bad:id' } } as never)).toThrow(/id/);
  });

  it('does not call a spell loader at install time', () => {
    let calls = 0;
    registry.install({
      manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
      spells: {
        Late: () => {
          calls += 1;
          return Promise.resolve(class Late {});
        },
      },
    } as never);
    expect(calls).toBe(0);
  });

  it('resolves a loader once however many callers ask', async () => {
    let calls = 0;
    class Late {}
    registry.install({
      manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
      spells: {
        Late: () => {
          calls += 1;
          return Promise.resolve(Late);
        },
      },
    } as never);
    const [a, b] = await Promise.all([
      registry.loadSpellClass('lazy:Late'),
      registry.loadSpellClass('lazy:Late'),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(Late);
    expect(b).toBe(Late);
  });

  it('reports a loader-backed spell as absent to the synchronous reader until it lands', async () => {
    class Late {}
    registry.install({
      manifest: { id: 'lazy', version: '1.0.0', coreRange: '^1' },
      spells: { Late: () => Promise.resolve(Late) },
    } as never);
    expect(registry.hasSpell('lazy:Late')).toBe(true);
    expect(registry.spellClass('lazy:Late')).toBeNull();
    await registry.loadSpellClass('lazy:Late');
    expect(registry.spellClass('lazy:Late')).toBe(Late);
  });

  it('still serves an eagerly declared class synchronously', () => {
    class Now {}
    registry.install({
      manifest: { id: 'eager', version: '1.0.0', coreRange: '^1' },
      spells: { Now },
    } as never);
    expect(registry.spellClass('eager:Now')).toBe(Now);
  });

  it('refuses a second pack with an id already installed', () => {
    const dupPack = { manifest: { id: 'twice', version: '1.0.0', coreRange: '^1' } };
    registry.install(dupPack as never);
    expect(() =>
      registry.install({ ...dupPack, manifest: { ...dupPack.manifest, version: '2.0.0' } } as never)
    ).toThrow(/twice/);
    expect(registry.champions()).toHaveLength(0);
  });

  it('misreads a bare function-expression loader as a class, because prototype alone cannot tell them apart', async () => {
    // `function () {}` has a `.prototype` exactly like a class does, so the
    // structural check alone cannot tell a function-expression loader from
    // the class it might return. Documented here rather than silently true:
    // an author who writes one unwrapped gets back the function itself, not
    // whatever it resolves to. `lazy()` is the fix, proven below.
    class Late {}
    registry.install({
      manifest: { id: 'fn', version: '1.0.0', coreRange: '^1' },
      // eslint-disable-next-line object-shorthand
      spells: {
        Late: function () {
          return Promise.resolve(Late);
        },
      },
    } as never);
    const resolved = await registry.loadSpellClass('fn:Late');
    expect(resolved).not.toBe(Late);
    expect(typeof resolved).toBe('function');
  });

  it('treats a function-expression loader wrapped in lazy() as a loader, not a class', async () => {
    class Late {}
    registry.install({
      manifest: { id: 'fn-lazy', version: '1.0.0', coreRange: '^1' },
      spells: {
        // eslint-disable-next-line object-shorthand
        Late: lazy(function () {
          return Promise.resolve(Late);
        }),
      },
    } as never);
    expect(await registry.loadSpellClass('fn-lazy:Late')).toBe(Late);
  });

  it('serves a pack’s display data under the qualified id', () => {
    const registry2 = new PackRegistry();
    registry2.install({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      spells: { A: class {} },
      spellDisplay: {
        A: {
          name: 'Chiêu A',
          description: 'mô tả',
          iconKey: 'icon_a',
          coolDownMs: 4000,
          manaCost: 30,
          specCoolDownMs: 4000,
        },
      },
    } as never);
    expect(registry2.spellDisplay('p:A')?.name).toBe('Chiêu A');
    expect(registry2.spellDisplay('p:missing')).toBeNull();
  });

  describe('the two-step install', () => {
    it('installData then installCode ends up equivalent to a one-step install()', () => {
      registry.installData({
        manifest: { id: 'two-step', version: '1.0.0', coreRange: '^1' },
        champions: [{ id: 'alpha', name: 'Alpha', image: null, playable: false, spells: ['Q'] }],
      } as never);
      // `champions()` is already populated — the whole point of the split —
      // before any code exists to back it.
      expect(registry.champions().map(c => c.id)).toEqual(['two-step:alpha']);
      expect(registry.spellClass('two-step:Q')).toBeNull();

      registry.installCode('two-step', { spells: { Q: class {} } } as never);
      expect(registry.spellClass('two-step:Q')).toBeTypeOf('function');
    });

    it('installCode refuses a code half that leaves a champion’s ability unpaired', () => {
      // The cross-check `validatePack()` runs in one step for `install()` —
      // split across `installData`/`installCode` here because it needs both
      // halves. Not reachable through either bundled pack today (each is one
      // file), but this is exactly the gap batch 4 opens by splitting the
      // Riot pack across files: a data half naming a spell its code half
      // forgot.
      registry.installData({
        manifest: { id: 'orphan', version: '1.0.0', coreRange: '^1' },
        champions: [
          {
            id: 'alpha',
            name: 'Alpha',
            image: null,
            playable: false,
            spells: ['Q', 'Missing'],
          },
        ],
      } as never);
      expect(() => registry.installCode('orphan', { spells: { Q: class {} } } as never)).toThrow(
        /Missing/
      );
      // Refused before writing, same as `install()`'s own atomicity: the `Q`
      // this call *did* supply never lands either.
      expect(registry.spellClass('orphan:Q')).toBeNull();
      expect(registry.hasSpell('orphan:Q')).toBe(false);
    });

    it('installCode refuses a code half that leaves a recall unpaired', () => {
      registry.installData({
        manifest: { id: 'orphan-recall', version: '1.0.0', coreRange: '^1' },
        champions: [
          {
            id: 'alpha',
            name: 'Alpha',
            image: null,
            playable: false,
            spells: ['Q'],
            recall: 'Missing',
          },
        ],
      } as never);
      expect(() =>
        registry.installCode('orphan-recall', { spells: { Q: class {} } } as never)
      ).toThrow(/Missing/);
    });

    it('installCode refuses a code half that leaves a spellDisplay entry unpaired', () => {
      registry.installData({
        manifest: { id: 'orphan-display', version: '1.0.0', coreRange: '^1' },
        spellDisplay: {
          Ghost: {
            name: 'Ma',
            description: 'mô tả',
            iconKey: null,
            coolDownMs: 1000,
            manaCost: 0,
            specCoolDownMs: 1000,
          },
        },
      } as never);
      expect(() => registry.installCode('orphan-display', { spells: {} } as never)).toThrow(
        /Ghost/
      );
    });
  });
});
