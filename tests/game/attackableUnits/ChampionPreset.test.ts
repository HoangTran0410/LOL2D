import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  DEFAULT_CHAMPION_ATTACK,
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import { createGame, stubGameGlobals } from '../fixtures';

// `targetingMode` is mandatory on a legacy spell: without it `castSpec` throws,
// and `replaceSpells` deactivates the outgoing spells, which builds their
// runtime. These two never cast — they only need to be tellable apart.
class RedSpell extends Spell {
  name = 'Red';
  targetingMode = 'SELF' as const;
  coolDown = 1000;
}
class BlueSpell extends Spell {
  name = 'Blue';
  targetingMode = 'SELF' as const;
  coolDown = 2000;
}

const RED: ChampionPresetData = {
  name: 'Red',
  spells: [RedSpell],
  attack: { damage: 11, attacksPerSecond: 1.1, range: 111 },
};
const BLUE: ChampionPresetData = {
  name: 'Blue',
  spells: [BlueSpell],
  attack: { damage: 22, attacksPerSecond: 2.2, range: 222 },
};

const makeChampion = (preset: ChampionPresetData) => {
  const game = createGame();
  const champion = new Champion({ game, position: createVector(0, 0), preset });
  game.setPlayer(champion);
  return champion;
};

describe('Champion.applyPreset', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('is what the constructor uses, so a fresh champion carries its preset', () => {
    const champion = makeChampion(RED);
    expect(champion.name).toBe('Red');
    expect(champion.spells.map(s => s.name)).toEqual(['Red']);
    expect(champion.stats.attackDamage.baseValue).toBe(11);
    expect(champion.stats.attackSpeed.baseValue).toBe(1.1);
    expect(champion.stats.attackRange.baseValue).toBe(111);
  });

  it('replaces name, spells and every attack stat together', () => {
    const champion = makeChampion(RED);
    champion.applyPreset(BLUE);

    expect(champion.name).toBe('Blue');
    expect(champion.spells.map(s => s.name)).toEqual(['Blue']);
    expect(champion.stats.attackDamage.baseValue).toBe(22);
    expect(champion.stats.attackSpeed.baseValue).toBe(2.2);
    expect(champion.stats.attackRange.baseValue).toBe(222);
  });

  it('falls back to DEFAULT_CHAMPION_ATTACK when the preset has no attack profile', () => {
    const champion = makeChampion(RED);
    champion.applyPreset({ name: 'Plain', spells: [] });

    expect(champion.stats.attackDamage.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.damage);
    expect(champion.stats.attackSpeed.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.attacksPerSecond);
    expect(champion.stats.attackRange.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.range);
  });

  it('gives a champion built with no preset at all the default attack profile', () => {
    const game = createGame();
    const champion = new Champion({ game, position: createVector(0, 0) });

    expect(champion.stats.attackDamage.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.damage);
    expect(champion.stats.attackSpeed.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.attacksPerSecond);
    expect(champion.stats.attackRange.baseValue).toBe(DEFAULT_CHAMPION_ATTACK.range);
  });

  it("leaves health and mana alone — refilling the bars is applyLoadout's job, not this one", () => {
    const champion = makeChampion(RED);
    champion.stats.health.baseValue = 7;
    champion.applyPreset(BLUE);
    expect(champion.stats.health.baseValue).toBe(7);
  });

  it('retires the spells it replaces instead of leaking them', () => {
    const champion = makeChampion(RED);
    const outgoing = champion.spells[0];
    const deactivate = vi.spyOn(outgoing, 'deactivate');

    champion.applyPreset(BLUE);

    expect(deactivate).toHaveBeenCalledOnce();
  });
});
