import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import Spell from '../../../src/game/gameObject/Spell';
import {
  CDR_PERCENT_MAX,
  CDR_PERCENT_MIN,
  DEFAULT_PREGAME_CONFIG,
  sanitizePregameConfig,
  toMatchRules,
} from '../../../src/game/config/PregameConfig';
import { context } from './helpers';

afterEach(() => vi.unstubAllGlobals());

/**
 * A spell exists only so the cooldown a rule change is supposed to move is a
 * real number. `targetingMode` is mandatory — `castSpec` throws without one,
 * and `effectiveCoolDownMs` reads `castSpec`.
 */
class BenchSpell extends Spell {
  name = 'Bench';
  targetingMode = 'SELF' as const;
  coolDown = 1000;
  manaCost = 100;
}

describe('MatchDirector world', () => {
  it('clears every monster when the jungle goes off', () => {
    const { context: ctx } = context();
    const camps = [{ toRemove: false }, { toRemove: false }];
    // A copy, not the same array. The director empties `ctx.monsters` in place,
    // so asserting `toRemove` on that array afterwards would be asserting
    // nothing at all — `[].every(…)` is true.
    ctx.monsters = [...camps] as never;
    const director = new MatchDirector(ctx);

    director.jungleEnabled = false;

    expect(camps.every(camp => camp.toRemove)).toBe(true);
    expect(ctx.monsters).toHaveLength(0);
    expect(director.jungleEnabled).toBe(false);
  });

  it('re-runs spawnJungle when it goes back on', () => {
    const { context: ctx } = context();
    ctx.spawnJungle = vi.fn();
    const director = new MatchDirector(ctx);

    director.jungleEnabled = false;
    director.jungleEnabled = true;

    expect(ctx.spawnJungle).toHaveBeenCalledTimes(1);
    expect(director.jungleEnabled).toBe(true);
  });

  it('does not respawn the jungle when it is already on', () => {
    const { context: ctx } = context();
    ctx.spawnJungle = vi.fn();
    const director = new MatchDirector(ctx);

    director.jungleEnabled = true;

    expect(ctx.spawnJungle).not.toHaveBeenCalled();
  });

  /** Flipping "on" twice must not stack a second set of camps on the first. */
  it('does not stack a second jungle when switched on twice', () => {
    const { context: ctx } = context();
    ctx.spawnJungle = vi.fn();
    const director = new MatchDirector(ctx);

    director.jungleEnabled = false;
    director.jungleEnabled = true;
    director.jungleEnabled = true;

    expect(ctx.spawnJungle).toHaveBeenCalledTimes(1);
  });

  it('clears the field and stops the clock when minions go off', () => {
    const { context: ctx } = context();
    const minions = [{ toRemove: false }, { toRemove: false }];
    const setEnabled = vi.fn((on: boolean) => {
      ctx.minionSpawner.enabled = on;
    });
    ctx.minionSpawner = { minions, enabled: true, setEnabled } as never;
    const director = new MatchDirector(ctx);

    director.minionsEnabled = false;

    expect(minions.every(minion => minion.toRemove)).toBe(true);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(ctx.minionSpawner.enabled).toBe(false);
    expect(director.minionsEnabled).toBe(false);
  });

  /**
   * The spawner owns the flag; the director is a view of it. A spawner switched
   * off by anything else must read back as off, or the panel would offer a
   * toggle that disagrees with the match.
   */
  it('reads the flag off the spawner rather than keeping its own copy', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    expect(director.minionsEnabled).toBe(true);
    ctx.minionSpawner.enabled = false;
    expect(director.minionsEnabled).toBe(false);
  });

  it('restarts the clock and leaves the field alone when minions come back on', () => {
    const { context: ctx } = context();
    const minions = [{ toRemove: false }];
    const setEnabled = vi.fn((on: boolean) => {
      ctx.minionSpawner.enabled = on;
    });
    ctx.minionSpawner = { minions, enabled: false, setEnabled } as never;
    const director = new MatchDirector(ctx);

    director.minionsEnabled = true;

    expect(ctx.minionSpawner.enabled).toBe(true);
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(minions[0].toRemove).toBe(false);
  });

  it('seeds the boot-time minion state through the spawner lifecycle API', () => {
    const { context: ctx } = context();
    const setEnabled = vi.fn((on: boolean) => {
      ctx.minionSpawner.enabled = on;
    });
    ctx.minionSpawner.setEnabled = setEnabled;
    const director = new MatchDirector(ctx);

    director.seedWorld({ jungle: true, minions: false });

    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(director.minionsEnabled).toBe(false);
  });
});

describe('MatchDirector rules', () => {
  it('writes the derived multipliers Spell.ts reads live', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 40, manaFree: true });

    expect(ctx.matchRules.cooldownMultiplier).toBeCloseTo(0.6);
    expect(ctx.matchRules.manaFree).toBe(true);
  });

  it('reports back what it was set to', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 25, manaFree: true });

    expect(director.getRules()).toEqual({ cooldownReductionPercent: 25, manaFree: true });
  });

  it('starts from the no-rules default, which reproduces an untouched match', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    expect(director.getRules()).toEqual({
      cooldownReductionPercent: CDR_PERCENT_MIN,
      manaFree: false,
    });
  });

  it('mutates the object Game already handed out rather than replacing it', () => {
    const { context: ctx } = context();
    const rules = ctx.matchRules;
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 10, manaFree: true });

    expect(ctx.matchRules).toBe(rules);
    // The reference surviving is only half of it: every spell context Game
    // handed this object to must see the new numbers *through* it.
    expect(rules.cooldownMultiplier).toBeCloseTo(0.9);
    expect(rules.manaFree).toBe(true);
  });

  it('clamps out-of-range CDR the same way the pregame screen does', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 999, manaFree: false });
    expect(director.getRules().cooldownReductionPercent).toBe(CDR_PERCENT_MAX);
    expect(ctx.matchRules.cooldownMultiplier).toBeCloseTo(0.1);

    director.setRules({ cooldownReductionPercent: -50, manaFree: false });
    expect(director.getRules().cooldownReductionPercent).toBe(CDR_PERCENT_MIN);
    expect(ctx.matchRules.cooldownMultiplier).toBe(1);
  });

  /**
   * The claim the whole "rules are cheap" design rests on: `Spell.ts` reads
   * `game.matchRules` at cast time (`:320`, `:369`), never at construction, so
   * a spell built long before the player touched the panel runs the new rule.
   * The spell here is built first, deliberately.
   */
  /**
   * Why `Game` *must* call `setRules(pregameConfig.rules)` right after building
   * the director, and why leaving it out is not a cosmetic bug: the director's
   * own default is a match nobody retuned, so an unseeded director sitting on a
   * 40%-CDR match reports 0%. The panel would open on a lie, and the player's
   * first nudge of the slider would push that lie into `matchRules` and
   * genuinely reset the match.
   */
  it('an unseeded director does not know what the match was booted with', () => {
    const { context: ctx } = context();
    ctx.matchRules = toMatchRules({ cooldownReductionPercent: 40, manaFree: true });

    const director = new MatchDirector(ctx);

    expect(ctx.matchRules.cooldownMultiplier).toBeCloseTo(0.6);
    expect(director.getRules()).toEqual({
      cooldownReductionPercent: CDR_PERCENT_MIN,
      manaFree: false,
    });
  });

  /**
   * The other half of that seed: it has to be free. `Game` already derived
   * `matchRules` from the same `pregameConfig.rules` before the director
   * existed, so seeding must land on exactly the numbers already there — two
   * clamps that disagreed (the director rounds in `clampPercent`, the config
   * rounds in `clampInt`) would silently retune the match at boot.
   */
  it('seeding from the config the match booted with changes nothing about it', () => {
    for (const percent of [CDR_PERCENT_MIN, 1, 25, 40, 89, CDR_PERCENT_MAX, 999, -5]) {
      const { context: ctx } = context();
      // Through the sanitizer, because that is the only shape `Game` ever sees:
      // `loadPregameConfig` hands it nothing else.
      const config = sanitizePregameConfig({
        rules: { cooldownReductionPercent: percent, manaFree: true },
      });
      ctx.matchRules = toMatchRules(config.rules);
      const asBooted = { ...ctx.matchRules };

      new MatchDirector(ctx).setRules(config.rules);

      expect(ctx.matchRules).toEqual(asBooted);
    }
  });

  it('a seeded director opens on the rules the match is actually running', () => {
    const { context: ctx } = context();
    const config = sanitizePregameConfig({
      rules: { cooldownReductionPercent: 40, manaFree: true },
    });
    ctx.matchRules = toMatchRules(config.rules);

    const director = new MatchDirector(ctx);
    director.setRules(config.rules);

    expect(director.getRules()).toEqual({ cooldownReductionPercent: 40, manaFree: true });
    // The panel's percentages and the numbers the match is actually casting at
    // have to be the same statement in two units, or the panel is lying about
    // a match it can also retune.
    expect(toMatchRules(director.getRules())).toEqual(ctx.matchRules);
  });

  /** The default config seeds to the untouched match, i.e. today's behaviour. */
  it('seeding a default config leaves the no-rules match alone', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules(DEFAULT_PREGAME_CONFIG.rules);

    expect(director.getRules()).toEqual({
      cooldownReductionPercent: CDR_PERCENT_MIN,
      manaFree: false,
    });
    expect(ctx.matchRules).toEqual({ cooldownMultiplier: 1, manaFree: false });
  });

  it('a spell built before the change reports the new cooldown and cost', () => {
    const { context: ctx, player } = context();
    player.applyPreset({ name: 'Bench', spells: [BenchSpell] });
    const spell = player.spells[0];
    expect(spell.effectiveCoolDownMs).toBe(1000);
    expect(spell.effectiveManaCost).toBe(100);

    const director = new MatchDirector(ctx);
    director.setRules({ cooldownReductionPercent: 50, manaFree: true });

    expect(spell.effectiveCoolDownMs).toBe(500);
    expect(spell.effectiveManaCost).toBe(0);
  });
});
