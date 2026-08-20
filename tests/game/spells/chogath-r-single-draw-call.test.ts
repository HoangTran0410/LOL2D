import { afterEach, describe, expect, it, vi } from 'vitest';
import ChoGath_R, { ChoGath_R_Growth } from '../../../src/game/gameObject/spells/ChoGath_R';
import { context } from '../practice/helpers';

/**
 * The real regime, corrected: the practice panel's cheat calls
 * `ChoGath_R.setStackCount(N)`, which loops `owner.addBuff(...)` N times
 * *synchronously* — no simulation tick runs between iterations, so
 * `updateBuffs()`'s compaction never gets a turn. `addBuff`'s
 * `STACKS_AND_CONTINUE` path only ever evicts `preBuffs[0]`, and since that
 * same already-`toRemove` buff stays at index 0 of the *uncompacted* array
 * for the rest of the loop, every call past the 100th "evicts" it again —
 * a no-op — while every new stack stays live. `maxStacks = 99` never
 * actually holds for a burst add: `setStackCount(1000)` leaves ~999 live
 * instances, not 99. See `.superpowers/perf-healthbar-report.md`.
 *
 * Round 1 made each instance's own `.draw()` call O(1) instead of O(N), but
 * `AttackableUnit.drawBuffs()` still *calls* `.draw()` once per instance —
 * at N=1000 that is a thousand function calls a frame per champion to
 * paint one ring. This is the seam for removing the calls themselves, not
 * just their cost: only the first live stack's `.draw()` should ever run.
 */

afterEach(() => vi.restoreAllMocks());

describe("Cho'Gath R growth ring: draw() is called once per champion per frame, not once per stack", () => {
  it('setStackCount(1000) leaves far more than 99 live instances (the regime this fix targets)', () => {
    const { player } = context();
    const spell = new ChoGath_R(player);
    spell.setStackCount(1000);

    const live = player.buffs.filter(b => b instanceof ChoGath_R_Growth && !b.toRemove).length;
    // Documents the actual reachable N — not asserting this is *correct*
    // behaviour (a separate question), just that it is the real regime a
    // player cheating to "1000" produces, so the draw-call fix has to hold
    // at this magnitude and not just at 99.
    expect(live).toBeGreaterThan(900);
  });

  it('drawBuffs() calls ChoGath_R_Growth.draw() at most once, at 500 live stacks', () => {
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
    // drawn horns, 2 triangles each) — the call-count fix must not have
    // silently broken the count the one surviving call reads.
    expect(triangleSpy).toHaveBeenCalledTimes(28);
  });
});
