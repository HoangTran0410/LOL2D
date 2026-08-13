import { describe, expect, it } from 'vitest';
import Stats, { MAX_UNIT_SIZE, Stat, StatModifier } from '../../src/game/gameObject/Stats';
import { SIZE_PER_STACK } from '../../src/game/gameObject/spells/ChoGath_R';

describe('Stat ceiling', () => {
  it('leaves a stat without a ceiling completely unclamped', () => {
    const stat = new Stat(100);
    stat.baseBonus = 1_000_000;

    expect(stat.value).toBe(1_000_100);
    expect(stat.maxValue).toBe(Infinity);
  });

  it('clamps the read once the total passes the ceiling', () => {
    const stat = new Stat(10, 50);

    stat.baseBonus = 30;
    expect(stat.value).toBe(40);

    stat.baseBonus = 300;
    expect(stat.value).toBe(50);
  });

  // Clamping the read rather than the modifiers is what makes this reversible:
  // a buff that pushed the total past the cap still subtracts cleanly.
  it('comes back down when the modifier that breached the ceiling is removed', () => {
    const stat = new Stat(10, 50);
    const modifier = new StatModifier(0, 300);

    stat.addModifier(modifier);
    expect(stat.value).toBe(50);

    stat.removeModifier(modifier);
    expect(stat.value).toBe(10);
  });
});

describe('unit size ceiling', () => {
  it('caps body size, and only body size', () => {
    const stats = new Stats();

    expect(stats.size.maxValue).toBe(MAX_UNIT_SIZE);
    expect(stats.maxHealth.maxValue).toBe(Infinity);
    expect(stats.speed.maxValue).toBe(Infinity);
  });

  // Feast is permanent, stacks to 99 and adds size every time. Without a ceiling
  // it reaches 649 on a 55-wide champion.
  it('stops Feast growing the model without end', () => {
    const stats = new Stats();
    const base = stats.size.value;

    const stacksToReachCap = Math.ceil((MAX_UNIT_SIZE - base) / SIZE_PER_STACK);
    stats.size.baseBonus = stacksToReachCap * SIZE_PER_STACK;
    expect(stats.size.value).toBe(MAX_UNIT_SIZE);

    stats.size.baseBonus = 99 * SIZE_PER_STACK;
    expect(stats.size.value).toBe(MAX_UNIT_SIZE);
  });

  it('keeps the ceiling clear of every unit that is meant to look big', () => {
    // Baron is 100 and a turret 92 — a fully fed Cho'Gath must still out-size
    // them, or the cap has been set too low to read as a threat.
    expect(MAX_UNIT_SIZE).toBeGreaterThan(100);
  });
});
