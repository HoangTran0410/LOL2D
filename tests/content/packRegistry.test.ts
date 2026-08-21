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

  it('lists maps for selection rather than merging them', () => {
    // A match has many champions and exactly one world, so this section is a
    // choice, not a union — the asymmetry is deliberate.
    const map = (id: string) => ({
      id,
      size: 4000,
      terrain: { wall: [], bush: [], water: [] },
      factions: [{ id: 'solo' }],
      slots: { spawn: [], minion: [], structure: [], neutral: [] },
    });
    registry.install(pack('one', { maps: [map('arena')] as never }));
    registry.install(pack('two', { maps: [map('forest')] as never }));
    expect(registry.maps().map(m => m.id)).toEqual(['one:arena', 'two:forest']);
  });

  it('finds every monster that can fill a role, in install order', () => {
    registry.install(
      pack('one', {
        monsters: { big: { id: 'big', name: 'Big', fills: ['epic'], health: 1000 } } as never,
      })
    );
    registry.install(
      pack('two', {
        monsters: { huge: { id: 'huge', name: 'Huge', fills: ['epic'], health: 900 } } as never,
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
              size: 4000,
              terrain: { wall: [], bush: [], water: [] },
              factions: [{ id: 'solo' }],
              slots: { spawn: [], minion: [], structure: [], neutral: [] },
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
});
