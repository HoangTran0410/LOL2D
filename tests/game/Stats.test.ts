import { describe, expect, it } from 'vitest';
import Stats, { MAX_UNIT_SIZE, Stat, StatModifier } from '../../src/game/gameObject/Stats';
import { packIsInstalled } from '../support/installedPacks';

/**
 * A riot-pack symbol this file needs for a handful of its cases, reached with a
 * *lazy, gated* import so the other 12 — which are about core stat ceilings, floors and regen and have
 * nothing to do with any pack — still run in a checkout that has no riot pack.
 *
 * `packs/riot/...` used to be a plain static import at the top of this file,
 * and one static import is enough to make the whole file unloadable: batch 5
 * task 8's first round excluded all 13 of these tests over it. A dynamic
 * `import()` that is never evaluated is inert — Vite leaves the specifier
 * alone and nothing resolves it — so the ternary is what does the work, and
 * `packIsInstalled` is what the exclusion scanner reads to know this file has
 * handled the pack's absence itself.
 */
const choGathR = packIsInstalled('riot') ? await import('../../packs/riot/spells/ChoGath_R') : null;

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

/**
 * `move()` walks along `destination - position` scaled by `speed`, so a negative
 * speed does not mean "stopped", it means the unit walks *backwards, away from
 * where it was told to go* — it reads in game as being shoved, and as being
 * unable to enter wherever the slow is coming from.
 *
 * The way in is a unit mix-up nothing else catches: `Slow.percent` is a fraction
 * (0.5 is fifty percent) and every caller in the tree passes one, so a single
 * `percent = 35` writes `percentBaseBonus = -35` and the champion reverses.
 * Baron's poison pool shipped exactly that. `tsc` cannot see it — both are
 * numbers — so the floor is what makes the whole class of it survivable: the
 * worst a mis-scaled slow can now do is root you.
 */
describe('speed floor', () => {
  it('never lets a slow reverse a unit, however badly scaled', () => {
    const stats = new Stats();
    stats.speed.baseValue = 3;

    stats.speed.percentBaseBonus = -35;

    expect(stats.speed.value).toBe(0);
  });

  it('still slows normally for a slow that is scaled right', () => {
    const stats = new Stats();
    stats.speed.baseValue = 3;

    stats.speed.percentBaseBonus = -0.35;

    expect(stats.speed.value).toBeCloseTo(1.95);
  });

  it('comes back cleanly when the bad modifier is removed', () => {
    const stats = new Stats();
    stats.speed.baseValue = 3;
    const modifier = new StatModifier(0, 0, 0, 0, -35);

    stats.speed.addModifier(modifier);
    expect(stats.speed.value).toBe(0);

    stats.speed.removeModifier(modifier);
    expect(stats.speed.value).toBe(3);
  });

  it('leaves stats that are allowed to go negative alone', () => {
    const stat = new Stat(10);
    stat.baseBonus = -50;

    expect(stat.value).toBe(-40);
    expect(stat.minValue).toBe(-Infinity);
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
  it.skipIf(!choGathR)('stops Feast growing the model without end', () => {
    const SIZE_PER_STACK = choGathR!.SIZE_PER_STACK;
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

/**
 * `update()` writes the regenerated value back into `health.baseValue`, and it
 * used to source that write from `health.value` — the *modified* read. Any buff
 * holding a modifier on `health` therefore had its bonus folded into the base
 * once per frame and then re-added by the modifier on the next read, so the
 * bonus compounded at the frame rate instead of being an offset.
 *
 * Three ultimates shipped with `health: { baseBonus: N }` on a StatAmp
 * (Singed R, Nasus R, Renekton R) and all three made their champion
 * unkillable: at 60fps a +50 bonus is +3000 health a second, which re-pinned
 * them to full every frame no matter how much damage they were taking.
 *
 * Regen itself is untouched by this: with no modifier on `health`, `value` and
 * `baseValue` are equal by definition, so every unit in the game reads the
 * same as before.
 */
describe('health and mana regeneration', () => {
  const settle = (stats: Stats, frames: number) => {
    for (let i = 0; i < frames; i++) stats.update();
  };

  it('does not fold a health modifier back into the base each frame', () => {
    const stats = new Stats();
    stats.maxHealth.baseValue = 1_000;
    stats.health.baseValue = 100;
    stats.healthRegen.baseValue = 0;

    const modifier = new StatModifier(0);
    modifier.baseBonus = 50;
    stats.health.addModifier(modifier);

    settle(stats, 30);

    expect(stats.health.baseValue).toBe(100);
    // The modifier is still doing its job on the read, just not on the base.
    expect(stats.health.value).toBe(150);
  });

  it('does not fold a mana modifier back into the base each frame', () => {
    const stats = new Stats();
    stats.maxMana.baseValue = 1_000;
    stats.mana.baseValue = 100;
    stats.manaRegen.baseValue = 0;

    const modifier = new StatModifier(0);
    modifier.baseBonus = 50;
    stats.mana.addModifier(modifier);

    settle(stats, 30);

    expect(stats.mana.baseValue).toBe(100);
    expect(stats.mana.value).toBe(150);
  });

  it('still regenerates normally when nothing modifies health', () => {
    const stats = new Stats();
    stats.maxHealth.baseValue = 1_000;
    stats.health.baseValue = 100;
    stats.healthRegen.baseValue = 2;

    settle(stats, 10);

    expect(stats.health.baseValue).toBe(120);
  });
});
