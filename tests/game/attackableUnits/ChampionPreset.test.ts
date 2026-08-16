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

  // Stands in for Nasus Q: state that lives on the instance and nowhere else,
  // so keeping the instance is the only way to keep it.
  private stacks = 0;
  get stackCount(): number {
    return this.stacks;
  }
  setStackCount(count: number): boolean {
    this.stacks = count;
    return true;
  }
}
class BlueSpell extends Spell {
  name = 'Blue';
  targetingMode = 'SELF' as const;
  coolDown = 2000;
}
class GreenSpell extends Spell {
  name = 'Green';
  targetingMode = 'SELF' as const;
  coolDown = 3000;
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

/**
 * Editing one slot must not cost the player the other three.
 *
 * The practice panel's loadout editor commits a whole `ChampionLoadout` even
 * when the player changed a single slot, and `applyLoadout` hands it straight
 * to `applyPreset`. Rebuilding every slot from that throws away per-instance
 * state that has nothing to do with the edit — Nasus Q's stacks are the case
 * that shows it, but a running cooldown and an active phase go the same way.
 *
 * Identity is per slot *and* per class: same class in the same slot is the
 * same spell, so the instance stays.
 */
describe('Champion.applyPreset keeps the slots the preset did not change', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const RED_BLUE: ChampionPresetData = { name: 'RedBlue', spells: [RedSpell, BlueSpell] };
  const RED_GREEN: ChampionPresetData = { name: 'RedGreen', spells: [RedSpell, GreenSpell] };

  it('keeps the instance — and its stacks — of a slot whose spell is unchanged', () => {
    const champion = makeChampion(RED_BLUE);
    const q = champion.spells[0] as RedSpell;
    q.setStackCount(120);

    champion.applyPreset(RED_GREEN);

    expect(champion.spells[0]).toBe(q);
    expect(champion.spells[0].stackCount).toBe(120);
  });

  it('never deactivates a spell it is keeping', () => {
    const champion = makeChampion(RED_BLUE);
    const kept = vi.spyOn(champion.spells[0], 'deactivate');
    const swapped = vi.spyOn(champion.spells[1], 'deactivate');

    champion.applyPreset(RED_GREEN);

    expect(kept).not.toHaveBeenCalled();
    expect(swapped).toHaveBeenCalledOnce();
  });

  it('rebuilds a slot that moved, because a slot is a different spell', () => {
    const champion = makeChampion(RED_BLUE);
    const red = champion.spells[0];

    champion.applyPreset({ name: 'BlueRed', spells: [BlueSpell, RedSpell] });

    expect(champion.spells[1]).not.toBe(red);
    expect(champion.spells.map(s => s.name)).toEqual(['Blue', 'Red']);
  });

  it('still rebuilds everything on a real champion swap', () => {
    const champion = makeChampion(RED_BLUE);
    const before = [...champion.spells];

    champion.applyPreset({ name: 'Green', spells: [GreenSpell] });

    expect(champion.spells).toHaveLength(1);
    expect(before.includes(champion.spells[0])).toBe(false);
  });
});
