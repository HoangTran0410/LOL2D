import * as AllSpells from './gameObject/spells/index';
import AssetManager from '../managers/AssetManager';
import type { MonsterPresetData } from './gameObject/attackableUnits/Monster';
import type { FountainPresetData } from './gameObject/structures/Fountain';

// Workaround: AllSpells is a namespace of named Spell class exports.
// Filter out string exports by excluding values whose prototype chain doesn't lead to Spell.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpellClass = Exclude<(typeof AllSpells)[keyof typeof AllSpells], string> | any;

const random = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const getChampionPresetRandom = (): {
  name: string;
  avatar: string;
  spells: SpellClass[];
} => {
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
  image: string;
  background: string;
  spells: SpellClass[];
}[] = [
  {
    name: 'Yasuo',
    image: 'champ_yasuo',
    background: './assets/images/champions/background/yasuo.png',
    spells: [AllSpells.Yasuo_Q, AllSpells.Yasuo_W, AllSpells.Yasuo_E, AllSpells.Yasuo_R],
  },
  {
    name: 'Shaco',
    image: 'champ_shaco',
    background: './assets/images/champions/background/shaco.png',
    spells: [AllSpells.Shaco_Q, AllSpells.Shaco_W, AllSpells.Shaco_E, AllSpells.Shaco_R],
  },
  {
    name: 'Ahri',
    image: 'champ_ahri',
    background: './assets/images/champions/background/ahri.png',
    spells: [AllSpells.Ahri_Q, AllSpells.Ahri_W, AllSpells.Ahri_E, AllSpells.Ahri_R],
  },
  {
    name: 'Lee Sin',
    image: 'champ_leesin',
    background: './assets/images/champions/background/leesin.png',
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
    background: './assets/images/champions/background/blitzcrank.png',
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
    background: './assets/images/champions/background/lux.png',
    spells: [AllSpells.Lux_Q, AllSpells.Lux_W, AllSpells.Lux_E, AllSpells.Lux_R],
  },
  {
    name: 'Ashe',
    image: 'champ_ashe',
    background: './assets/images/champions/background/ashe.png',
    spells: [AllSpells.Ashe_Q, AllSpells.Ashe_W, AllSpells.Ashe_E, AllSpells.Ashe_R],
  },
  {
    name: "Cho'Gath",
    image: 'champ_chogath',
    background: './assets/images/champions/background/chogath.png',
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
    background: './assets/images/champions/background/leblanc.png',
    spells: [AllSpells.Leblanc_W, AllSpells.Leblanc_E],
  },
  {
    name: 'Malphite',
    image: 'champ_malphite',
    background: './assets/images/champions/background/malphite.png',
    spells: [AllSpells.Malphite_Q, AllSpells.Malphite_W, AllSpells.Malphite_R],
  },
  {
    name: 'Olaf',
    image: 'champ_olaf',
    background: './assets/images/champions/background/olaf.png',
    spells: [AllSpells.Olaf_Q],
  },
  {
    name: 'Teemo',
    image: 'champ_teemo',
    background: './assets/images/champions/background/teemo.png',
    spells: [AllSpells.Teemo_Q, AllSpells.Teemo_R],
  },
  {
    name: 'Veigar',
    image: 'champ_veigar',
    background: './assets/images/champions/background/veigar.png',
    spells: [AllSpells.Veigar_Q, AllSpells.Veigar_E],
  },
  {
    name: 'Zed',
    image: 'champ_zed',
    background: './assets/images/champions/background/zed.png',
    spells: [AllSpells.Zed_Q, AllSpells.Zed_W, AllSpells.Zed_E, AllSpells.Zed_R],
  },
  {
    name: 'Graves',
    image: 'champ_graves',
    background: './assets/images/champions/background/graves.png',
    spells: [AllSpells.Graves_W],
  },
  {
    name: 'Anivia',
    image: 'champ_anivia',
    background: '',
    spells: [AllSpells.Anivia_Q, AllSpells.Anivia_W, AllSpells.Anivia_R],
  },
  {
    name: 'Thresh',
    image: 'champ_thresh',
    background: '',
    spells: [AllSpells.Thresh_Q],
  },
  {
    name: 'Rammus',
    image: 'champ_rammus',
    background: '',
    spells: [AllSpells.Rammus_Q],
  },
  {
    name: 'Morgana',
    image: 'champ_morgana',
    background: '',
    spells: [AllSpells.Morgana_Q, AllSpells.Morgana_E],
  },
  {
    name: 'Janna',
    image: 'champ_janna',
    background: '',
    spells: [AllSpells.Janna_Q],
  },
  {
    name: 'Alistar',
    image: 'champ_alistar',
    background: '',
    spells: [AllSpells.Alistar_W],
  },
  {
    name: 'Nocturne',
    image: 'champ_nocturne',
    background: '',
    spells: [AllSpells.Nocturne_R],
  },
  {
    name: 'Twitch',
    image: 'champ_twitch',
    background: '',
    spells: [AllSpells.Twitch_Q],
  },
  {
    name: 'Amumu',
    image: 'champ_amumu',
    background: '',
    spells: [AllSpells.Amumu_Q],
  },
  {
    name: 'Warwick',
    image: 'champ_warwick',
    background: '',
    spells: [AllSpells.Warwick_Q],
  },
  {
    name: 'Singed',
    image: 'champ_singed',
    background: '',
    spells: [AllSpells.Singed_W],
  },
  {
    name: 'Cassiopeia',
    image: 'champ_cassiopeia',
    background: '',
    spells: [AllSpells.Cassiopeia_W],
  },
  {
    name: 'Fizz',
    image: 'champ_fizz',
    background: '',
    spells: [AllSpells.Fizz_E],
  },
  {
    name: 'Nasus',
    image: 'champ_nasus',
    background: '',
    spells: [AllSpells.Nasus_Q],
  },
  {
    name: 'Phép Bổ Trợ',
    image: '',
    background: '',
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
