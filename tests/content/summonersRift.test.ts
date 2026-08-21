import { describe, expect, it } from 'vitest';
import { summonersRift } from '../../src/content/maps/summonersRift';
import { validatePack } from '../../src/content/validate';
import { data as bundledData, BUNDLED_PACK_ID } from '../../src/content/bundledPack';
import { PackRegistry } from '../../src/content/PackRegistry';
import { NEUTRAL_SLOTS } from '../../src/game/mapPresets';
import type { MapGeometry, StructureSlot } from '../../src/content/ContentPack';
import mapJson from '../../assets/json/summoner_map.json';

/** `summonersRift.geometry` is a loader now — resolve it once per test that needs it. */
const geometry = (): Promise<MapGeometry> => {
  const source = summonersRift.geometry;
  if (typeof source !== 'function') return Promise.resolve(source);
  return source();
};

describe("the Summoner's Rift map definition", () => {
  it('is a summary only — no terrain or slots on the object itself', () => {
    // The whole point of Task 4's split: the eager half is cheap enough for
    // the menu's own chunk, and nothing about "cheap" survives if the heavy
    // fields ride along on the same object.
    expect(summonersRift).not.toHaveProperty('terrain');
    expect(summonersRift).not.toHaveProperty('slots');
    expect(summonersRift).not.toHaveProperty('lanes');
    expect(summonersRift.name).toBe("Summoner's Rift");
    expect(typeof summonersRift.geometry).toBe('function');
  });

  it('carries every wall, bush and water polygon the JSON has', async () => {
    expect(mapJson.wall.length).toBeGreaterThan(10);
    const { terrain } = await geometry();
    expect(terrain.wall).toHaveLength(mapJson.wall.length);
    expect(terrain.bush).toHaveLength(mapJson.bush.length);
    expect(terrain.water).toHaveLength(mapJson.water.length);
  });

  it('carries both turret rows as structure slots, with their teams', async () => {
    // `turret1` and `turret2` are flat lists of [x, y] points — 11 each,
    // measured, not assumed. `preset.ts`'s `turretsFromSlots` is the reader
    // that turns these slots into turrets; this copies its interpretation of
    // which row is which faction rather than inventing one.
    const { slots } = await geometry();
    const blue: StructureSlot[] = [];
    const red: StructureSlot[] = [];
    for (const slot of slots.structure) {
      (slot.faction === 'blue' ? blue : red).push(slot);
    }
    expect(blue).toHaveLength(mapJson.turret1.length);
    expect(red).toHaveLength(mapJson.turret2.length);
    // Every point survives the conversion, in order and unrounded.
    for (const [index, point] of mapJson.turret1.entries()) {
      expect([blue[index].x, blue[index].y]).toEqual(point);
    }
    for (const [index, point] of mapJson.turret2.entries()) {
      expect([red[index].x, red[index].y]).toEqual(point);
    }
  });

  it('places a spawn slot per faction where the fountains were', async () => {
    const { slots } = await geometry();
    expect(slots.spawn).toHaveLength(2);
    for (const slot of slots.spawn) expect(slot.r).toBeGreaterThan(0);
    const factions = slots.spawn.map(slot => slot.faction).sort();
    expect(factions).toEqual(['blue', 'red']);
  });

  it('declares one neutral slot per distinct camp position, and no monster identities', async () => {
    // Task 7 split position from identity: `mapPresets.ts`'s NEUTRAL_SLOTS is
    // now the one source of camp positions (11 of them — pre-split
    // `MonsterPreset` had 21 entries, 14 of them sharing one of 4 distinct
    // `campId` values (wolf1, wolf2, raptor1, raptor2), and the other 7
    // (baron, blue1, blue2, red1, red2, gomp1, gomp2) carried no campId and
    // so were each their own group — 7 + 4 = 11 distinct camp identities,
    // unchanged by the split). Assert against that real source, not a number
    // typed into this file — an earlier plan draft asserted "9" here, which
    // does not hold up against the source.
    expect(NEUTRAL_SLOTS).toHaveLength(11);

    const { slots } = await geometry();
    expect(slots.neutral).toEqual(NEUTRAL_SLOTS);
    for (const slot of slots.neutral) {
      expect(typeof slot.role).toBe('string');
      expect(slot).not.toHaveProperty('name');
      expect(slot).not.toHaveProperty('health');
    }
  });

  it('passes validation as part of a pack', () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      maps: [summonersRift],
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) expect(result.errors).toEqual([]);
  });

  it('is carried in the bundled pack, qualified by pack id, summary only', () => {
    const registry = new PackRegistry();
    registry.installData(bundledData);
    const maps = registry.maps();
    expect(maps).toHaveLength(1);
    expect(maps[0].id).toBe(`${BUNDLED_PACK_ID}:summoners-rift`);
    expect(maps[0]).not.toHaveProperty('terrain');
    expect(maps[0]).not.toHaveProperty('slots');
  });

  it('lists a map without pulling its geometry into the listing', async () => {
    // The guard the size regression (231,072-byte pregame chunk) would have
    // caught, restated as a behavioural assertion rather than a byte count —
    // `scripts/check-chunks.mjs` and `contentApiChunk.test.ts` cover the
    // structural/byte side.
    const registry = new PackRegistry();
    registry.installData(bundledData);
    const summaries = registry.maps();
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      expect(summary).not.toHaveProperty('terrain');
      expect(summary).not.toHaveProperty('slots');
    }
    const loaded = await registry.loadMapGeometry(summaries[0].id);
    expect(loaded?.terrain.wall.length).toBeGreaterThan(100);
  });
});
