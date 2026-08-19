import { describe, expect, it } from 'vitest';
import { BOT_DIFFICULTIES, DEFAULT_DIFFICULTY, profileFor } from '../../../src/game/ai/Difficulty';

describe('difficulty profiles', () => {
  it('defaults to normal, which is the behaviour a match ships with', () => {
    expect(DEFAULT_DIFFICULTY).toBe('normal');
  });

  it('lists exactly three tiers', () => {
    expect([...BOT_DIFFICULTIES]).toEqual(['easy', 'normal', 'hard']);
  });

  // Monotonic in the direction of "plays better", NOT in the direction of the
  // number: a better bot reacts sooner and misses less, so three of these go
  // down as the tier goes up. Asserting `>=` across the board would have
  // passed on a profile table that made hard bots slower than easy ones.
  it('gets better, not merely different, as the tier rises', () => {
    const [easy, normal, hard] = BOT_DIFFICULTIES.map(profileFor);

    for (const [lower, higher] of [
      [easy, normal],
      [normal, hard],
    ]) {
      expect(higher.castIntervalMs).toBeLessThan(lower.castIntervalMs);
      expect(higher.aimErrorPx).toBeLessThan(lower.aimErrorPx);
      expect(higher.noise).toBeLessThan(lower.noise);

      expect(higher.leadFactor).toBeGreaterThan(lower.leadFactor);
      expect(higher.focusBonus).toBeGreaterThan(lower.focusBonus);
      expect(higher.aggroRange).toBeGreaterThan(lower.aggroRange);
      expect(higher.memoryTtlMs).toBeGreaterThan(lower.memoryTtlMs);
      expect(higher.retreatHealthPct).toBeGreaterThan(lower.retreatHealthPct);
    }
  });

  it("keeps normal on today's aggro range so the default match does not change reach", () => {
    expect(profileFor('normal').aggroRange).toBe(420);
  });

  it('only lets easy bots be broken line-of-sight with', () => {
    expect(profileFor('easy').seesThroughTerrain).toBe(false);
    expect(profileFor('normal').seesThroughTerrain).toBe(true);
    expect(profileFor('hard').seesThroughTerrain).toBe(true);
  });

  it('never lets an easy bot throw a spell at a position it can no longer see', () => {
    expect(profileFor('easy').ghostCastWindowMs).toBe(0);
    expect(profileFor('hard').ghostCastWindowMs).toBeGreaterThan(0);
  });

  it('keeps lead factor inside 0..1 so the predictor cannot overshoot', () => {
    for (const tier of BOT_DIFFICULTIES) {
      expect(profileFor(tier).leadFactor).toBeGreaterThanOrEqual(0);
      expect(profileFor(tier).leadFactor).toBeLessThanOrEqual(1);
    }
  });

  it('hands back a frozen profile — a bot must not retune the shared table', () => {
    expect(Object.isFrozen(profileFor('normal'))).toBe(true);
  });
});
