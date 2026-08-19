export const HotKeys = {
  A: 65,

  Q: 81,
  W: 87,
  E: 69,
  R: 82,

  D: 68,
  F: 70,

  // Recall (Game.recall). Deliberately absent from SpellHotKeys below: that
  // array is the kit's slot layout, and an eighth entry ripples into the
  // loadout editor, the HUD and every persisted config.
  B: 66,
};

export const SpellHotKeys = [
  // internal spell
  HotKeys.A,

  // normal spells
  HotKeys.Q,
  HotKeys.W,
  HotKeys.E,
  HotKeys.R,

  // summoner spells
  HotKeys.D,
  HotKeys.F,
];
