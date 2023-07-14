import * as AllSpells from './gameObject/spells/index.js';

export const ChampionPreset = {
  yasuo: {
    name: 'Yasuo',
    avatar: 'champ_yasuo',
    spells: [
      AllSpells.Heal,
      AllSpells.Yasuo_Q,
      AllSpells.Yasuo_W,
      AllSpells.Yasuo_E,
      AllSpells.Yasuo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  lux: {
    name: 'Lux',
    avatar: 'champ_lux',
    spells: [
      AllSpells.Heal,
      AllSpells.Lux_Q,
      AllSpells.Yasuo_W,
      AllSpells.Lux_E,
      AllSpells.Lux_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  blitzcrank: {
    name: 'Blitzcrank',
    avatar: 'champ_blitzcrank',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Blitzcrank_W,
      AllSpells.Veigar_E,
      AllSpells.Blitzcrank_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  ashe: {
    name: 'Ashe',
    avatar: 'champ_ashe',
    spells: [
      AllSpells.Heal,
      AllSpells.Ashe_W,
      AllSpells.Ashe_W,
      AllSpells.Yasuo_W,
      AllSpells.Ashe_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  teemo: {
    name: 'Teemo',
    avatar: 'champ_teemo',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Blitzcrank_W,
      AllSpells.Teemo_R,
      AllSpells.Teemo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  leblanc: {
    name: 'Leblanc',
    avatar: 'champ_leblanc',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Leblanc_W,
      AllSpells.Leblanc_E,
      AllSpells.Leblanc_W,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  leesin: {
    name: 'Lee Sin',
    avatar: 'champ_leesin',
    spells: [
      AllSpells.Heal,
      AllSpells.LeeSin_Q,
      AllSpells.LeeSin_Q,
      AllSpells.LeeSin_E,
      AllSpells.LeeSin_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  chogath: {
    name: 'Cho Gath',
    avatar: 'champ_chogath',
    spells: [
      AllSpells.Heal,
      AllSpells.ChoGath_Q,
      AllSpells.ChoGath_W,
      AllSpells.Yasuo_E,
      AllSpells.Yasuo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  ahri: {
    name: 'Ahri',
    avatar: 'champ_ahri',
    spells: [
      AllSpells.Heal,
      AllSpells.Ahri_Q,
      AllSpells.Ahri_W,
      AllSpells.Ahri_E,
      AllSpells.Ahri_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  shaco: {
    name: 'Shaco',
    avatar: 'champ_shaco',
    spells: [
      AllSpells.Heal,
      AllSpells.Shaco_Q,
      AllSpells.Shaco_W,
      AllSpells.Shaco_E,
      AllSpells.Shaco_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  olaf: {
    name: 'Olaf',
    avatar: 'champ_olaf',
    spells: [
      AllSpells.Heal,
      AllSpells.Olaf_Q,
      AllSpells.Olaf_Q,
      AllSpells.Olaf_Q,
      AllSpells.Olaf_Q,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
};

export const getPresetRandom = () => {
  return {
    name: 'Random',
    avatar: random(Object.values(ChampionPreset).map(x => x.avatar)),
    spells: [
      AllSpells.Heal,
      ...Array.from({ length: 4 })
        .fill(0)
        .map(() => {
          return random(Object.values(AllSpells));
        }),
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  };
};

export const getRandomChampionPreset = () => {
  const keys = Object.keys(ChampionPreset);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return ChampionPreset[randomKey];
};
