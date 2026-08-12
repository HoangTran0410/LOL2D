import * as AllSpells from './gameObject/spells/index';
import AssetManager, { type AssetKey } from '../managers/AssetManager';
import type { MonsterPresetData } from './gameObject/attackableUnits/Monster';
import type { FountainPresetData } from './gameObject/structures/Fountain';
import type { ChampionPresetData } from './gameObject/attackableUnits/Champion';

// Workaround: AllSpells is a namespace of named Spell class exports.
// Filter out string exports by excluding values whose prototype chain doesn't lead to Spell.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpellClass = Exclude<(typeof AllSpells)[keyof typeof AllSpells], string> | any;

const random = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const getChampionPresetRandom = (): ChampionPresetData & { avatar: AssetKey } => {
  return {
    name: 'Random',
    avatar: random([
      'champ_yasuo',
      'champ_lux',
      'champ_blitzcrank',
      'champ_ashe',
      'champ_teemo',
      'champ_leblanc',
      'champ_leesin',
      'champ_chogath',
      'champ_ahri',
      'champ_shaco',
      'champ_olaf',
      'champ_graves',
    ]),
    spells: [
      AllSpells.Heal,
      ...Array.from({ length: 4 })
        .fill(0)
        .map(() => {
          return random(Object.values(AllSpells) as SpellClass[]);
        }),
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  };
};

export const SpellGroups: {
  name: string;
  image: AssetKey | null;
  background: AssetKey | null;
  spells: SpellClass[];
}[] = [
  {
    name: 'Yasuo',
    image: 'champ_yasuo',
    background: 'champ_background_yasuo',
    spells: [AllSpells.Yasuo_Q, AllSpells.Yasuo_W, AllSpells.Yasuo_E, AllSpells.Yasuo_R],
  },
  {
    name: 'Shaco',
    image: 'champ_shaco',
    background: 'champ_background_shaco',
    spells: [AllSpells.Shaco_Q, AllSpells.Shaco_W, AllSpells.Shaco_E, AllSpells.Shaco_R],
  },
  {
    name: 'Ahri',
    image: 'champ_ahri',
    background: 'champ_background_ahri',
    spells: [AllSpells.Ahri_Q, AllSpells.Ahri_W, AllSpells.Ahri_E, AllSpells.Ahri_R],
  },
  {
    name: 'Lee Sin',
    image: 'champ_leesin',
    background: 'champ_background_leesin',
    spells: [
      AllSpells.LeeSin_Q,
      AllSpells.LeeSin_W,
      AllSpells.LeeSin_E,
      AllSpells.LeeSin_R,
    ],
  },
  {
    name: 'Blitzcrank',
    image: 'champ_blitzcrank',
    background: 'champ_background_blitzcrank',
    spells: [
      AllSpells.Blitzcrank_Q,
      AllSpells.Blitzcrank_W,
      AllSpells.Blitzcrank_E,
      AllSpells.Blitzcrank_R,
    ],
  },
  {
    name: 'Lux',
    image: 'champ_lux',
    background: 'champ_background_lux',
    spells: [AllSpells.Lux_Q, AllSpells.Lux_W, AllSpells.Lux_E, AllSpells.Lux_R],
  },
  {
    name: 'Ashe',
    image: 'champ_ashe',
    background: 'champ_background_ashe',
    spells: [AllSpells.Ashe_Q, AllSpells.Ashe_W, AllSpells.Ashe_E, AllSpells.Ashe_R],
  },
  {
    name: "Cho'Gath",
    image: 'champ_chogath',
    background: 'champ_background_chogath',
    spells: [
      AllSpells.ChoGath_Q,
      AllSpells.ChoGath_W,
      AllSpells.ChoGath_E,
      AllSpells.ChoGath_R,
    ],
  },
  {
    name: 'Leblanc',
    image: 'champ_leblanc',
    background: 'champ_background_leblanc',
    spells: [AllSpells.Leblanc_W, AllSpells.Leblanc_E],
  },
  {
    name: 'Malphite',
    image: 'champ_malphite',
    background: 'champ_background_malphite',
    spells: [AllSpells.Malphite_Q, AllSpells.Malphite_W, AllSpells.Malphite_R],
  },
  {
    name: 'Olaf',
    image: 'champ_olaf',
    background: 'champ_background_olaf',
    spells: [AllSpells.Olaf_Q],
  },
  {
    name: 'Teemo',
    image: 'champ_teemo',
    background: 'champ_background_teemo',
    spells: [AllSpells.Teemo_Q, AllSpells.Teemo_R],
  },
  {
    name: 'Veigar',
    image: 'champ_veigar',
    background: 'champ_background_veigar',
    spells: [AllSpells.Veigar_Q, AllSpells.Veigar_E],
  },
  {
    name: 'Zed',
    image: 'champ_zed',
    background: 'champ_background_zed',
    spells: [AllSpells.Zed_Q, AllSpells.Zed_W, AllSpells.Zed_E, AllSpells.Zed_R],
  },
  {
    name: 'Graves',
    image: 'champ_graves',
    background: 'champ_background_graves',
    spells: [AllSpells.Graves_W],
  },
  {
    name: 'Anivia',
    image: null,
    background: null,
    spells: [AllSpells.Anivia_Q, AllSpells.Anivia_W, AllSpells.Anivia_R],
  },
  {
    name: 'Varus',
    image: 'champ_varus',
    background: null,
    spells: [AllSpells.Varus_Q],
  },
  {
    name: 'Pantheon',
    image: 'champ_pantheon',
    background: null,
    spells: [AllSpells.Pantheon_Q],
  },
  {
    name: 'Thresh',
    image: null,
    background: null,
    spells: [AllSpells.Thresh_Q],
  },
  {
    name: 'Rammus',
    image: null,
    background: null,
    spells: [AllSpells.Rammus_Q],
  },
  {
    name: 'Morgana',
    image: null,
    background: null,
    spells: [AllSpells.Morgana_Q, AllSpells.Morgana_E],
  },
  {
    name: 'Janna',
    image: null,
    background: null,
    spells: [AllSpells.Janna_Q, AllSpells.Janna_R],
  },
  {
    name: 'Alistar',
    image: null,
    background: null,
    spells: [AllSpells.Alistar_W],
  },
  {
    name: 'Nocturne',
    image: null,
    background: null,
    spells: [AllSpells.Nocturne_R],
  },
  {
    name: 'Twitch',
    image: null,
    background: null,
    spells: [AllSpells.Twitch_Q],
  },
  {
    name: 'Amumu',
    image: null,
    background: null,
    spells: [AllSpells.Amumu_Q],
  },
  {
    name: 'Warwick',
    image: null,
    background: null,
    spells: [AllSpells.Warwick_Q],
  },
  {
    name: 'Singed',
    image: null,
    background: null,
    spells: [AllSpells.Singed_W],
  },
  {
    name: 'Cassiopeia',
    image: null,
    background: null,
    spells: [AllSpells.Cassiopeia_W],
  },
  {
    name: 'Fizz',
    image: null,
    background: null,
    spells: [AllSpells.Fizz_E],
  },
  {
    name: 'Nasus',
    image: null,
    background: null,
    spells: [AllSpells.Nasus_Q],
  },
  {
    name: 'Phép Bổ Trợ',
    image: null,
    background: null,
    spells: [
      AllSpells.Flash,
      AllSpells.Ghost,
      AllSpells.Heal,
      AllSpells.Ignite,
      AllSpells.StealthWard,
    ],
  },
];

export const MonsterPreset: Record<string, MonsterPresetData> = {
  baron: {
    name: 'Baron',
    avatar: 'monster_Baron_Nashor',
    camp: { x: 2147, y: 1876, r: 100 },
    speed: 0,
    size: 100,
    attackRange: 400,
    reviveTime: 3000,
    health: 1000,
    // rooted in place with a long reach, so it hits hard but slowly
    damage: 25,
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
    avatar: 'monster_Raptor',
    camp: { x: 3378, y: 2183, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
};

/**
 * The two spawn platforms, in the corners the map's own turret rows point at.
 * Coordinates were picked by scanning the wall polygons in summoner_map.json for
 * the roomiest open spot in each base — both sit ~260px clear of any wall.
 */
export const FountainPreset: FountainPresetData[] = [
  { name: 'Bệ Đá Cổ', x: 400, y: 6075, r: 190 },
  { name: 'Bệ Đá Cổ', x: 6100, y: 375, r: 190 },
];

/**
 * summoner_map.json already ships the two turret rows (`turret1`/`turret2`) as
 * flat [x, y] points — 11 per side, all on open ground at lane chokepoints.
 * They were never read by anything; TerrainMap used to try to parse them as
 * polygons and produced NaN obstacles.
 */
export const getTurretPositions = (): { x: number; y: number }[] => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapData: any = AssetManager.getAsset('json_summoner_map')?.data;
  const positions: { x: number; y: number }[] = [];

  for (const key of ['turret1', 'turret2']) {
    const points = mapData?.[key];
    if (!Array.isArray(points)) continue;
    for (const p of points) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        positions.push({ x: p[0], y: p[1] });
      }
    }
  }

  return positions;
};
