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
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'blue' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            slots: { spawn: [], minion: [], structure: [], neutral: [] },
            lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/red/);
  });

  it('rejects a lane whose faction has no declared muster point', () => {
    // `MinionSpawner.musterPointFor` used to answer this with `null` and drop
    // the whole wave into the fountain, silently, until the first wave walked
    // back out of it (see this file's own header). Task 6 pushes that failure
    // here instead — a lane's faction with nowhere to muster cannot install.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'blue' }, { id: 'red' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            slots: {
              spawn: [],
              // blue musters here; red, which also walks MID, has nothing.
              minion: [{ faction: 'blue', lane: 'MID', x: 0, y: 0 }],
              structure: [],
              neutral: [],
            },
            lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/no muster point.*red.*MID/);
  });

  it('accepts a lane whose two factions both declare a muster point', () => {
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'blue' }, { id: 'red' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            slots: {
              spawn: [],
              minion: [
                { faction: 'blue', lane: 'MID', x: 0, y: 0 },
                { faction: 'red', lane: 'MID', x: 10, y: 10 },
              ],
              structure: [],
              neutral: [],
            },
            lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
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
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'blue' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            slots: {
              spawn: [],
              minion: [],
              structure: [{ faction: 'blue', kind: 'obelisk', x: 0, y: 0 }],
              neutral: [],
            },
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
          name: 'Forest',
          size: 4000,
          factions: [{ id: 'solo' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            slots: { spawn: [], minion: [], structure: [], neutral: [] },
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a terrain layer core does not know', () => {
    // TerrainMap only knows wall/bush/water and used to drop anything else in
    // silence — see this file's own header. A pack that declares `lava` must
    // be told, not ignored.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'solo' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [], lava: [] },
            slots: { spawn: [], minion: [], structure: [], neutral: [] },
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors.join('\n')).toMatch(/lava/);
  });

  it('accepts a map whose geometry is a lazy loader, unvalidated until it resolves', () => {
    // Exactly like `SpellSource`: a loader's own body cannot be inspected
    // synchronously, so validation checks that it is a function and stops —
    // the same discipline `checkSpells` already applies to a spell loader.
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'solo' }],
          geometry: () =>
            Promise.resolve({
              terrain: { wall: [], bush: [], water: [] },
              slots: { spawn: [], minion: [], structure: [], neutral: [] },
            }),
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a map with no name', () => {
    const result = validatePack({
      manifest: goodManifest,
      maps: [
        {
          id: 'arena',
          size: 4000,
          factions: [{ id: 'solo' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            slots: { spawn: [], minion: [], structure: [], neutral: [] },
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/name/);
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

  it('rejects a monster with no members', () => {
    // A camp used to carry position and tuning in one flat MonsterPresetData
    // entry; splitting position out to a NeutralSlot, and composition out to
    // MonsterBody, still leaves a monster with nothing to spawn if its own
    // members array is empty or missing — Game.spawnJungle() loops it
    // unconditionally, so an empty camp here is a silent one there.
    const result = validatePack({
      manifest: goodManifest,
      monsters: { wolves: { id: 'wolves', name: 'Wolves', fills: ['wolves'], members: [] } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/members/);
  });

  it('names a monster body missing the tuning fields Game.spawnJungle needs to build one', () => {
    const result = validatePack({
      manifest: goodManifest,
      monsters: {
        wolves: {
          id: 'wolves',
          name: 'Wolves',
          fills: ['wolves'],
          members: [{ name: 'Wolf', health: 100 }],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/avatar/);
      expect(result.errors.join(' ')).toMatch(/speed/);
      expect(result.errors.join(' ')).toMatch(/size/);
      expect(result.errors.join(' ')).toMatch(/attackRange/);
      expect(result.errors.join(' ')).toMatch(/reviveTime/);
      expect(result.errors.join(' ')).toMatch(/offset/);
    }
  });

  it('rejects a monster body avatar that is not a string', () => {
    const result = validatePack({
      manifest: goodManifest,
      monsters: {
        wolves: {
          id: 'wolves',
          name: 'Wolves',
          fills: ['wolves'],
          members: [
            {
              name: 'Wolf',
              avatar: 42,
              speed: 2,
              size: 40,
              attackRange: 50,
              reviveTime: 3000,
              health: 100,
              offset: { x: 0, y: 0 },
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/avatar/);
  });

  it('rejects a monster body offset that is not {x, y}', () => {
    const result = validatePack({
      manifest: goodManifest,
      monsters: {
        wolves: {
          id: 'wolves',
          name: 'Wolves',
          fills: ['wolves'],
          members: [
            {
              name: 'Wolf',
              avatar: 'reference:wolf',
              speed: 2,
              size: 40,
              attackRange: 50,
              reviveTime: 3000,
              health: 100,
              offset: 'centre',
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/offset/);
  });

  it('accepts a fully specified monster, a pack of several members included', () => {
    const member = (health: number, offset: { x: number; y: number }) => ({
      name: 'Wolf',
      avatar: 'reference:wolf',
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 3000,
      health,
      offset,
    });
    const result = validatePack({
      manifest: goodManifest,
      monsters: {
        wolves: {
          id: 'wolves',
          name: 'Wolves',
          fills: ['wolves'],
          members: [
            member(300, { x: 0, y: 0 }),
            member(100, { x: -83, y: -51 }),
            member(100, { x: 40, y: 97 }),
          ],
        },
      },
    });
    expect(result.ok).toBe(true);
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
          name: 'Arena',
          size: 4000,
          factions: [{ id: 'blue' }],
          geometry: {
            terrain: { wall: [], bush: [], water: [] },
            lanes: [{ id: 'MID', from: 'blue', to: 'red', waypoints: [] }],
          },
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
    // Named, like its three siblings: `ok === false` alone would still pass if
    // an unrelated validator regression rejected this fixture for some other
    // reason, and the rule under test would have stopped being tested.
    if (result.ok === false) expect(result.errors.join('\n')).toMatch(/four abilities/);
  });
});
