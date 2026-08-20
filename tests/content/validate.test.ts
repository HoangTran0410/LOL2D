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
});
