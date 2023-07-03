import * as AllSpells from './gameObject/spells/index.js';

export const ChampionPreset = {
  yasuo: {
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
    avatar: 'champ_blitzcrank',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Blitzcrank_W,
      AllSpells.Yasuo_E,
      AllSpells.Blitzcrank_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  ashe: {
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
    avatar: 'champ_teemo',
    spells: [
      AllSpells.Heal,
      AllSpells.Blitzcrank_Q,
      AllSpells.Yasuo_W,
      AllSpells.Teemo_R,
      AllSpells.Teemo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
  leblanc: {
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
    avatar: 'champ_chogath',
    spells: [
      AllSpells.Heal,
      AllSpells.ChoGath_Q,
      AllSpells.Yasuo_W,
      AllSpells.Yasuo_E,
      AllSpells.Yasuo_R,
      AllSpells.Flash,
      AllSpells.Ghost,
    ],
  },
};

export const getRandomChampionPreset = () => {
  const keys = Object.keys(ChampionPreset);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return ChampionPreset[randomKey];
};
