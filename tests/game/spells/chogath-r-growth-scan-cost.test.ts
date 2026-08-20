import { describe, expect, it, vi } from 'vitest';
import ChoGath_R, { ChoGath_R_Growth } from '../../../src/game/gameObject/spells/ChoGath_R';
import { context } from '../practice/helpers';

/**
 * `AttackableUnit.drawBuffs()` calls `.draw()` on every buff instance, and one
 * Feast stack is its own buff instance (`STACKS_AND_CONTINUE`, see
 * `ChoGath_R.ts`) — so at N stacks, N `.draw()` calls happen every rendered
 * frame, not one. Only the *first* of them actually paints anything (the ring
 * is one drawing for the whole stack), but the old code found out which one it
 * was by re-scanning `owner.buffs` from *inside every call*: an O(N) scan run
 * N times, i.e. O(N^2) per champion per frame, scaling with stack count alone
 * and independent of the `MAX_UNIT_SIZE` cap that bounds body growth.
 *
 * `tests/e2e/measure-chogath-stacks.mjs` is what proved this costs real frame
 * time in a live scene — see `.superpowers/perf-healthbar-report.md`. This is
 * the fast, falsifiable seam for the algorithmic half of it: instrument
 * `owner.buffs` with a Proxy that counts element reads, call `.draw()` on
 * every stack the way `drawBuffs()` does within one simulated frame, and
 * assert the read count stays linear in N rather than quadratic.
 */

const countReads = (arr: unknown[]): { proxy: unknown[]; reads: () => number } => {
  let reads = 0;
  const proxy = new Proxy(arr, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { proxy, reads: () => reads };
};

describe("Cho'Gath R growth ring: draw cost scales with stacks, not stacks squared", () => {
  it('drawing every stack in one frame reads the buff list O(N) times, not O(N^2)', () => {
    vi.stubGlobal('frameCount', 42);
    vi.stubGlobal('HALF_PI', Math.PI / 2);
    vi.stubGlobal('triangle', vi.fn());

    const { player } = context();
    const spell = new ChoGath_R(player);
    const stackCount = 40;
    spell.setStackCount(stackCount);

    const growthBuffs = player.buffs.filter(b => b instanceof ChoGath_R_Growth);
    expect(growthBuffs).toHaveLength(stackCount);

    const { proxy, reads } = countReads(player.buffs);
    player.buffs = proxy as typeof player.buffs;

    // What `AttackableUnit.drawBuffs()` does every frame: call `.draw()` on
    // every buff the champion is carrying, including every one of the N
    // stacks — not just the one that ends up painting something.
    for (const buff of growthBuffs) buff.draw();

    // O(N) reads at most a small multiple of N once, however many of the N
    // `.draw()` calls run in the same frame. The old O(N^2) code read roughly
    // N times that: N `.draw()` calls, each re-scanning up to N elements.
    expect(reads()).toBeLessThan(stackCount * 3);

    vi.unstubAllGlobals();
  });
});
