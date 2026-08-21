import { describe, expect, it } from 'vitest';
import { summonersRift } from '../../src/content/maps/summonersRift';
import { validatePack } from '../../src/content/validate';
import { data as bundledData, BUNDLED_PACK_ID } from '../../src/content/bundledPack';
import { PackRegistry } from '../../src/content/PackRegistry';
import { MonsterPreset } from '../../src/game/preset';
import type { StructureSlot } from '../../src/content/ContentPack';
import mapJson from '../../assets/json/summoner_map.json';

describe("the Summoner's Rift map definition", () => {
  it('carries every wall, bush and water polygon the JSON has', () => {
    expect(mapJson.wall.length).toBeGreaterThan(10);
    expect(summonersRift.terrain.wall).toHaveLength(mapJson.wall.length);
    expect(summonersRift.terrain.bush).toHaveLength(mapJson.bush.length);
    expect(summonersRift.terrain.water).toHaveLength(mapJson.water.length);
  });

  it('carries both turret rows as structure slots, with their teams', () => {
    // `turret1` and `turret2` are flat lists of [x, y] points — 11 each,
    // measured, not assumed. `getTurretPositions` in preset.ts is the
    // existing reader; this copies its interpretation rather than inventing
    // one.
    const blue: StructureSlot[] = [];
    const red: StructureSlot[] = [];
    for (const slot of summonersRift.slots.structure) {
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

  it('places a spawn slot per faction where the fountains were', () => {
    expect(summonersRift.slots.spawn).toHaveLength(2);
    for (const slot of summonersRift.slots.spawn) expect(slot.r).toBeGreaterThan(0);
    const factions = summonersRift.slots.spawn.map(slot => slot.faction).sort();
    expect(factions).toEqual(['blue', 'red']);
  });

  it('declares one neutral slot per distinct camp identity, and no monster identities', () => {
    // MonsterPreset is a large transcription (21 entries): a pack of wolves
    // or raptors lists every body separately, tied together by a shared
    // campId. Assert the neutral count against that grouping applied to the
    // real source, not against a number typed into this file — a plan draft
    // asserted "9 distinct camp positions" here, which does not hold up:
    // MonsterPreset has 21 entries, 14 of them sharing one of 4 distinct
    // campId values (wolf1, wolf2, raptor1, raptor2), and the other 7
    // (baron, blue1, blue2, red1, red2, gomp1, gomp2) carry no campId and so
    // are each their own group — 7 + 4 = 11 distinct camp identities.
    const groupIds = new Set<string>();
    for (const [key, entry] of Object.entries(MonsterPreset)) {
      groupIds.add(entry.campId ?? key);
    }
    expect(Object.keys(MonsterPreset)).toHaveLength(21);
    expect(groupIds.size).toBe(11);

    expect(summonersRift.slots.neutral).toHaveLength(groupIds.size);
    for (const slot of summonersRift.slots.neutral) {
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

  it('is carried in the bundled pack, qualified by pack id', () => {
    const registry = new PackRegistry();
    registry.installData(bundledData);
    const maps = registry.maps();
    expect(maps).toHaveLength(1);
    expect(maps[0].id).toBe(`${BUNDLED_PACK_ID}:summoners-rift`);
  });
});
