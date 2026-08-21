import { describe, expect, it } from 'vitest';
import { validatePack } from '../../src/content/validate';

/**
 * Validation is the only thing standing at the boundary.
 *
 * A pack is authored in TypeScript, but types are erased at compile time, so
 * by the time core holds a pack object nothing has checked it. Stage 2 makes
 * that acute — the object will come from a URL — but it is already true of a
 * pack built from a different core version.
 *
 * The failure mode this exists to prevent is the silent one. `TerrainMap`
 * drops an unknown terrain layer without a word, and `MinionSpawner` returns
 * null for a team with fewer than two turrets and lets the whole wave fall
 * back into the fountain; both surface as a broken match minutes later
 * instead of a named error at load.
 */
const goodManifest = { id: 'ref', version: '1.0.0', coreRange: '^1' };

describe('validatePack', () => {
  it('accepts a minimal pack that declares only a manifest', () => {
    const result = validatePack({ manifest: goodManifest });
    expect(result.ok).toBe(true);
  });

  it('rejects a pack with no manifest', () => {
    const result = validatePack({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/manifest/);
  });

  it('rejects a pack id that is not a bare identifier', () => {
    // Ids are namespaced as `<packId>:<localId>`, so a colon in the pack id
    // makes the qualified id ambiguous.
    const result = validatePack({ manifest: { ...goodManifest, id: 'ref:extra' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/id/);
  });

  it('names the champion whose spell id does not exist in the pack', () => {
    const result = validatePack({
      manifest: goodManifest,
      spells: { Alpha_Q: class {} },
      champions: [{ id: 'alpha', name: 'Alpha', image: null, spells: ['Alpha_Q', 'Alpha_W'] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Alpha_W/);
  });

  it('names the champion whose recall id does not exist in the pack', () => {
    const result = validatePack({
      manifest: goodManifest,
      spells: { Alpha_Q: class {} },
      champions: [
        {
          id: 'alpha',
          name: 'Alpha',
          image: null,
          spells: ['Alpha_Q'],
          recall: 'Alpha_Recall',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Alpha_Recall/);
  });

  it('accepts a champion whose recall names a spell the pack declares', () => {
    const result = validatePack({
      manifest: goodManifest,
      spells: { Alpha_Q: class {}, Alpha_Recall: class {} },
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
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a map whose lane names a faction it never declared', () => {
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'blue' }],
          slots: { spawn: [], minion: [], structure: [], neutral: [] },
          lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/red/);
  });

  it('rejects a structure slot whose kind is not core vocabulary', () => {
    // `role` on a neutral slot is a free string the packs agree on between
    // themselves; `kind` on a structure is core's own vocabulary, because
    // Turret and Fountain are core classes.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'blue' }],
          slots: {
            spawn: [],
            minion: [],
            structure: [{ faction: 'blue', kind: 'obelisk', x: 0, y: 0 }],
            neutral: [],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/obelisk/);
  });

  it('accepts a map with no lanes at all', () => {
    // A battle-royale map has none, and that must be a shape rather than an
    // error: no lanes means no minion waves, and BotBrain's PUSH posture —
    // the only one that needs a lane — falls through to ROAM.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'forest',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'solo' }],
          slots: { spawn: [], minion: [], structure: [], neutral: [] },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('names the monster whose fills is not an array of strings', () => {
    // PackRegistry.install() iterates pack.monsters, and monstersFilling(role)
    // calls monster.fills.includes(role) — a fills that is a string rather
    // than an array turns into a runtime TypeError one layer downstream.
    const result = validatePack({
      manifest: goodManifest,
      monsters: { wolf: { id: 'wolf', name: 'Wolf', fills: 'jungle', health: 20 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/fills/);
  });

  it('rejects a spells entry that is not a class', () => {
    // The success cast claims spells: Record<string, SpellClass>. A string
    // sitting where a constructor belongs must be named at load, not `new`-ed
    // by whatever eventually instantiates it.
    const result = validatePack({
      manifest: goodManifest,
      spells: { Alpha_Q: 'not-a-class' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Alpha_Q/);
  });

  it('accepts a lazy spell source', () => {
    const result = validatePack({
      manifest: goodManifest,
      spells: { Late: () => Promise.resolve(class {}) },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a champion whose name is not a string', () => {
    const result = validatePack({
      manifest: goodManifest,
      champions: [{ id: 'alpha', name: 42, image: null, spells: [] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/name/);
  });

  it('rejects a champion whose image is neither a string nor null', () => {
    const result = validatePack({
      manifest: goodManifest,
      champions: [{ id: 'alpha', name: 'Alpha', image: 42, spells: [] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/image/);
  });

  it('reports every defect in a single map, not just the first', () => {
    // Regression for the early-return bug: a map missing `slots` used to
    // `return` immediately, so the lane below — naming a faction nobody
    // declared — was never reached or reported in the same pass.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          size: 4000,
          terrain: { wall: [], bush: [], water: [] },
          factions: [{ id: 'blue' }],
          lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(' ');
      expect(joined).toMatch(/slots/);
      expect(joined).toMatch(/red/);
    }
  });

  it('rejects a spellDisplay entry with no matching spell', () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      spells: { A: class {} },
      spellDisplay: {
        B: {
          name: 'B',
          description: '',
          iconKey: null,
          coolDownMs: 0,
          manaCost: 0,
          specCoolDownMs: 0,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors.join('\n')).toMatch(/spellDisplay.*B/);
  });

  it('rejects a champion with no playable flag', () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      spells: { A: class {} },
      champions: [{ id: 'c', name: 'C', image: null, spells: ['A'] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors.join('\n')).toMatch(/playable/);
  });

  it('rejects a playable champion with no portrait', () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      spells: { A: class {}, B: class {}, C: class {}, D: class {} },
      champions: [
        { id: 'c', name: 'C', image: null, playable: true, spells: ['A', 'B', 'C', 'D'] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors.join('\n')).toMatch(/portrait|image/);
  });

  it('rejects a playable champion without four abilities', () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      spells: { A: class {} },
      champions: [{ id: 'c', name: 'C', image: 'art', playable: true, spells: ['A'] }],
    });
    expect(result.ok).toBe(false);
  });
});
