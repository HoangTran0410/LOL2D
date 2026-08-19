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
      // A better bot husbands mana for its ultimate and leans harder on the
      // human. Both consumed by Tasks 5 and 7, so a reversed column here shows
      // up as odd bot behaviour rather than as a failing test.
      expect(higher.manaReservePct).toBeGreaterThan(lower.manaReservePct);
      expect(higher.playerBias).toBeGreaterThan(lower.playerBias);
      // ...and spends more freely on the wave, which is the other direction:
      // clearing a wave with abilities is a mechanic a better player has and a
      // worse one does not, so this goes DOWN as the tier goes up.
      expect(higher.waveClearManaPct).toBeLessThan(lower.waveClearManaPct);
    }
  });

  it('never lets farming eat into the reserve the ultimate is held back with', () => {
    // `withinManaBudget` refuses anything that would spend into the reserve
    // while the ultimate is up, so a wave-clear floor below it is a tier whose
    // bots try to farm with abilities on every think tick and are refused every
    // time — busy work, and invisible except as a bot that never casts.
    for (const tier of BOT_DIFFICULTIES) {
      const profile = profileFor(tier);
      expect(profile.waveClearManaPct).toBeGreaterThanOrEqual(profile.manaReservePct);
    }
  });

  it('keeps every fraction a fraction', () => {
    for (const tier of BOT_DIFFICULTIES) {
      const profile = profileFor(tier);
      for (const knob of ['waveClearManaPct', 'manaReservePct', 'retreatHealthPct'] as const) {
        expect(profile[knob]).toBeGreaterThanOrEqual(0);
        expect(profile[knob]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps normal on today's aggro range so the default match does not change reach", () => {
    expect(profileFor('normal').aggroRange).toBe(420);
  });

  it('carries no way for a tier to see through terrain', () => {
    // The column that used to sit here was on for `normal` and `hard`, i.e. for
    // every bot in every default match, and it is what a player hits as "a bot
    // autoattacked me through a wall while neither of us had vision".
    //
    // It is gone rather than set to false everywhere: a knob that must never be
    // turned on is a trap for whoever reads the table next, and seeing through
    // terrain is not playing better — `Vision.ts` states the promise the rest
    // of the game keeps, that what is dark cannot be hit and what is lit can.
    // `BotBrain.canPerceive` now asks `sees()` at every tier, and
    // `BotBrain.perception.test.ts` is where that is checked.
    for (const tier of BOT_DIFFICULTIES) {
      expect(profileFor(tier)).not.toHaveProperty('seesThroughTerrain');
    }
  });

  it('still separates the tiers by how long they hunt what they lost', () => {
    // The replacement for the X-ray above: the same "I know roughly where you
    // went" advantage, bounded in time instead of unbounded through walls.
    const [easy, normal, hard] = BOT_DIFFICULTIES.map(profileFor);
    expect(normal.memoryTtlMs).toBeGreaterThan(easy.memoryTtlMs);
    expect(hard.memoryTtlMs).toBeGreaterThan(normal.memoryTtlMs);
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
