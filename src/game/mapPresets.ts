import type { MonsterPresetData } from './gameObject/attackableUnits/Monster';

/**
 * The jungle-camp positions, split out of `preset.ts` so they can be read
 * without pulling in the engine.
 *
 * `preset.ts` is a kitchen-sink file: champion-kit planning needs `Spell`,
 * `Champion` and the rest of `src/game/gameObject/`, and that surface used
 * to come along for free with `MonsterPreset` too, since both lived in one
 * module. `src/content/maps/summonersRiftGeometry.ts` (batch 3's content-pack
 * assembly) only wants the *positions* — but it sits in `src/content/`, which
 * `tests/content/contentApiChunk.test.ts` and `vite.config.ts`'s `pregame`
 * chunk both require to never reach `src/game/gameObject/`. Importing
 * `preset.ts` for this data broke exactly that: `MonsterPreset.baron.abilities`
 * alone (`BARON_ABILITIES`, from `gameObject/monsters/Baron.ts`) dragged in
 * `SpellObject`, every buff and the rest of the engine.
 *
 * This module is that data, minus Baron's `abilities` — the one field that
 * needed the engine — with the exact same values otherwise. `preset.ts`
 * re-exports the constant under its original name, merging `BARON_ABILITIES`
 * back onto `baron` there, so every existing reader of `preset.ts`'s
 * `MonsterPreset` sees the identical shape it always did.
 *
 * The fountain positions that used to live beside this (`FountainPreset`)
 * are gone as of Task 5: a fountain now comes from the active map's own
 * `slots.spawn` (see `summonersRiftGeometry.ts`'s `spawnSlots`), read through
 * `preset.ts`'s `fountainsFromSlots`. Nothing needs the two coordinates as a
 * standalone table any more.
 */
export const MonsterPreset: Record<string, Omit<MonsterPresetData, 'abilities'>> = {
  baron: {
    name: 'Baron',
    avatar: 'monster_Baron_Nashor',
    camp: { x: 2147, y: 1876, r: 100 },
    speed: 0,
    size: 100,
    attackRange: 400,
    reviveTime: 3000,
    health: 1000,
    // Rooted in place with a long reach. The bite is small because it is the
    // one part of the fight nobody can dodge — the damage that makes Baron
    // frightening lives in `BARON_ABILITIES` (`preset.ts` merges it back in),
    // and all of it is avoidable.
    damage: 12,
    attackInterval: 2000,
    aggroRange: 480,
  },
  blue1: {
    name: 'Blue',
    avatar: 'monster_Blue_Sentinel',
    camp: { x: 1631, y: 2958, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  blue2: {
    name: 'Blue',
    avatar: 'monster_Blue_Sentinel',
    camp: { x: 4794, y: 3419, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  red1: {
    name: 'Red',
    avatar: 'monster_Red_Brambleback',
    camp: { x: 3368, y: 4698, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  red2: {
    name: 'Red',
    avatar: 'monster_Red_Brambleback',
    camp: { x: 3085, y: 1672, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolf1: {
    name: 'Greater Wolf',
    campId: 'wolf1',
    avatar: 'monster_Greater_Murk_Wolf',
    camp: { x: 1685, y: 3562, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolf1_a: {
    name: 'Wolf',
    campId: 'wolf1',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 1602, y: 3511, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  wolf1_b: {
    name: 'Wolf',
    campId: 'wolf1',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 1725, y: 3659, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  wolf2: {
    name: 'Greater Wolf',
    campId: 'wolf2',
    avatar: 'monster_Greater_Murk_Wolf',
    camp: { x: 4728, y: 2835, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolf2_a: {
    name: 'Wolf',
    campId: 'wolf2',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 4709, y: 2743, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  wolf2_b: {
    name: 'Wolf',
    campId: 'wolf2',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 4816, y: 2888, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  gomp1: {
    name: 'Gromp',
    avatar: 'monster_Gromp',
    camp: { x: 914, y: 2784, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  gomp2: {
    name: 'Gromp',
    avatar: 'monster_Gromp',
    camp: { x: 5540, y: 3599, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptor1: {
    name: 'Crimson_Raptor',
    campId: 'raptor1',
    avatar: 'monster_Crimson_Raptor',
    camp: { x: 2954, y: 4110, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptor1_a: {
    name: 'Raptor',
    campId: 'raptor1',
    avatar: 'monster_Raptor',
    camp: { x: 3045, y: 4026, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor1_b: {
    name: 'Raptor',
    campId: 'raptor1',
    avatar: 'monster_Raptor',
    camp: { x: 3149, y: 4095, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor1_c: {
    name: 'Raptor',
    campId: 'raptor1',
    avatar: 'monster_Raptor',
    camp: { x: 3060, y: 4169, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor2: {
    name: 'Crimson_Raptor',
    campId: 'raptor2',
    avatar: 'monster_Crimson_Raptor',
    camp: { x: 3498, y: 2258, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptor2_a: {
    name: 'Raptor',
    campId: 'raptor2',
    avatar: 'monster_Raptor',
    camp: { x: 3432, y: 2356, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor2_b: {
    name: 'Raptor',
    campId: 'raptor2',
    avatar: 'monster_Raptor',
    camp: { x: 3307, y: 2295, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor2_c: {
    name: 'Raptor',
    campId: 'raptor2',
    avatar: 'monster_Raptor',
    camp: { x: 3378, y: 2183, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
};
