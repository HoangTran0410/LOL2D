import { describe, expect, it } from 'vitest';
import {
  healthTickStep,
  MAX_TICKS,
  TICK_LADDER,
} from '../../../src/game/gameObject/attackableUnits/Champion';

/**
 * `healthTickStep` walks `TICK_LADDER` for the first step that keeps the tick
 * count at or under `MAX_TICKS`, and falls back to the ladder's last rung
 * (2,500) if none qualify. That fallback is the bug: `TICK_LADDER`'s biggest
 * step times `MAX_TICKS` is exactly 50,000, so above that max health the
 * fallback keeps returning 2,500 and the tick count grows without bound —
 * the cap silently stops holding right where the ladder runs out, not at
 * some documented ceiling.
 *
 * Reachable in a real match, not theoretical: Cho'Gath R's max-health grant
 * (`MAX_HEALTH_PER_STACK` in `ChoGath_R.ts`) has no upper bound on the stat
 * itself — only the buff count is capped, at 99 stacks (~7,525 health, still
 * under the ladder) — but nothing stops several uncapped max-health sources
 * compounding past 50,000 over a long game.
 *
 * Counts ticks the same way `drawHealthBar`'s draw loop does
 * (`for (let mark = step; mark < maxHealth; mark += step)`), rather than
 * re-deriving an expected tick count from a formula — an independent check
 * of the constraint the fix promises (count <= MAX_TICKS), not a
 * restatement of `healthTickStep`'s own arithmetic.
 */
const countTicks = (maxHealth: number, step: number): number => {
  let count = 0;
  for (let mark = step; mark < maxHealth; mark += step) count++;
  return count;
};

describe('healthTickStep', () => {
  it('matches the curated ladder for the health ranges it already covers', () => {
    // One representative value per rung, and the ladder's own ceiling — this
    // is what must stay byte-identical once the fallback changes.
    expect(healthTickStep(100)).toBe(50);
    expect(healthTickStep(1_500)).toBe(100);
    expect(healthTickStep(4_000)).toBe(250);
    expect(healthTickStep(9_000)).toBe(500);
    expect(healthTickStep(18_000)).toBe(1_000);
    expect(healthTickStep(50_000)).toBe(TICK_LADDER[TICK_LADDER.length - 1]);
  });

  it('never draws more than MAX_TICKS ticks, at any max health', () => {
    for (const maxHealth of [50_001, 75_000, 100_000, 1_000_000, 10_000_000]) {
      const step = healthTickStep(maxHealth);
      expect(countTicks(maxHealth, step)).toBeLessThanOrEqual(MAX_TICKS);
    }
  });
});
