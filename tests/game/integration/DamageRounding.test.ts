import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import Buff from '../../../src/game/gameObject/Buff';
import CombatText from '../../../src/game/gameObject/helpers/CombatText';

/** A shield that eats a fixed slice, so the residual is a fresh fraction. */
class PartialAbsorb extends Buff {
  modifyIncomingDamage(damage: number): number {
    return damage * 0.37;
  }
}

const lastCombatText = (game: ReturnType<typeof createGame>): string => {
  const texts = [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].filter(
    (object): object is CombatText => object instanceof CombatText
  );
  return texts[texts.length - 1]?.text ?? '';
};

// Damage is built from lerps, percentages and unit-type multipliers, so it
// arrives as things like 23.799999999999997. That went into the floating combat
// text verbatim — a long unreadable number on every hit — and left health pools
// carrying a tail of binary noise.
describe('damage and healing land in whole points', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('rounds a fractional hit for both the health pool and the combat text', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const before = unit.stats.health.value;

    unit.takeDamage(23.799999999999997);

    expect(unit.stats.health.value).toBe(before - 24);
    expect(lastCombatText(game)).toBe('-24');
  });

  it('rounds again after a modifier reintroduces a fraction', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    unit.addBuff(new PartialAbsorb(4_000, unit, unit));
    const before = unit.stats.health.value;

    unit.takeDamage(30);

    // 30 * 0.37 = 11.100000000000001
    expect(unit.stats.health.value).toBe(before - 11);
    expect(lastCombatText(game)).toBe('-11');
  });

  it('never writes a decimal point into the combat text', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    for (const damage of [0.6, 1.5, 7.25, 12.999999, 33.333333]) {
      unit.stats.health.baseValue = 500;
      unit.takeDamage(damage);
      expect(lastCombatText(game)).not.toContain('.');
    }
  });

  it('rounds healing the same way', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    unit.stats.health.baseValue = 10;

    unit.takeHeal(6.6000000000000005);

    expect(unit.stats.health.value).toBe(17);
    expect(lastCombatText(game)).toBe('+7');
  });

  // Everything that deals damage in this game deals at least 2 a tick, so a
  // hit that rounds to nothing is noise, and spending a combat text on it is
  // worse than dropping it.
  it('drops a hit too small to round up to a point', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const before = unit.stats.health.value;

    unit.takeDamage(0.4);

    expect(unit.stats.health.value).toBe(before);
    expect(lastCombatText(game)).toBe('');
  });
});
