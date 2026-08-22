import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeChoGath_R, { makeChoGath_R_Growth } from '../../../packs/riot/spells/ChoGath_R';
import { context } from '../practice/helpers';
const __api = buildContentApi();
const ChoGath_R = makeChoGath_R(__api);
const ChoGath_R_Growth = makeChoGath_R_Growth(__api);

/**
 * Round 4 found that `ChoGath_R.setStackCount(N)`'s burst call left ~N-1
 * live *buff instances* rather than the 99 `maxStacks` implied, and fixed
 * `drawBuffs()` to call `.draw()` on only the first of them. Round 5 removed
 * the N instances themselves: `ChoGath_R_Growth.countedStacks` means
 * `setStackCount(1000)` now produces exactly **one** instance carrying
 * `stacks = 1000`, not ~999 copies of the same buff. This file's first test
 * used to document that magnitude on the array; now it documents the
 * replacement invariant directly. See `.superpowers/perf-healthbar-report.md`.
 */

afterEach(() => vi.restoreAllMocks());

describe("Cho'Gath R growth: setStackCount(1000) is one instance carrying the count, not ~1000 instances", () => {
  it('leaves exactly one live instance, with stacks = 1000', () => {
    const { player } = context();
    const spell = new ChoGath_R(player);
    spell.setStackCount(1000);

    const live = player.buffs.filter(b => b instanceof ChoGath_R_Growth && !b.toRemove);
    expect(live).toHaveLength(1);
    expect(live[0].stacks).toBe(1000);
  });

  it('drawBuffs() calls ChoGath_R_Growth.draw() exactly once, at 500 stacks', () => {
    vi.stubGlobal('frameCount', 1);
    vi.stubGlobal('HALF_PI', Math.PI / 2);
    const triangleSpy = vi.fn();
    vi.stubGlobal('triangle', triangleSpy);
    const { player } = context();
    const spell = new ChoGath_R(player);
    spell.setStackCount(500);

    const drawSpy = vi.spyOn(ChoGath_R_Growth.prototype, 'draw');
    player.drawBuffs();

    expect(drawSpy).toHaveBeenCalledTimes(1);
    // The single call still has to know the real count (500, capped at 14
    // drawn horns, 2 triangles each) — the representation change must not
    // have silently broken the count the one instance's own `draw()` reads.
    expect(triangleSpy).toHaveBeenCalledTimes(28);
  });
});
