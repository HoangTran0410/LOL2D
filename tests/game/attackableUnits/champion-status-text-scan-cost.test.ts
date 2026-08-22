import { describe, expect, it } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import TeamId from '../../../src/game/enums/TeamId';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeChoGath_R from '../../../packs/riot/spells/ChoGath_R';
import Root from '../../../src/game/gameObject/buffs/Root';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import { makeTeemo_R_Buff } from '../../../packs/riot/spells/Teemo_R';
import { context } from '../practice/helpers';
import { stubGameGlobals } from '../fixtures';
const __api = buildContentApi();
const ChoGath_R = makeChoGath_R(__api);
const Teemo_R_Buff = makeTeemo_R_Buff(__api);

/**
 * `Champion.drawHealthBar()`'s crowd-control status line walks
 * `STATUS_TEXT_BUFFS` (9 classes) as the OUTER loop and `this.buffs` as the
 * INNER one — so for every one of the 9 classes it rescans the *whole* buff
 * array looking for the first instance. For a champion carrying many
 * unrelated stacking buffs (Cho'Gath Feast, Veigar Q, Nasus Q) that is 9
 * full passes over an array that never has an Airborne/Root/Silence/... in
 * it: O(9*N) every frame, for a label that is the empty string almost
 * always. Same shape as the `ChoGath_R_Growth.draw()` bug this branch
 * already fixed, one order of magnitude smaller (O(9N) here vs O(N^2)
 * there) — see `.superpowers/perf-healthbar-report.md`.
 *
 * The fix (single pass, prototype-chain lookup) must not change what gets
 * printed: `Teemo_R_Buff extends Slow` and knockback buffs extend `Dash`
 * (`Janna_R_Knockback`, `XinZhao_R_Knockback`), so a naive "exact
 * constructor" fast path would silently stop showing "Chậm"/"Ghosted" for
 * anyone hit by those — a naive `instanceof`-preserving check must walk the
 * prototype chain, not just compare exact constructors.
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

describe('Champion.drawHealthBar status text: scan cost', () => {
  it('reads the buff list O(N) times, not O(9N)', () => {
    const { player } = context();
    const spell = new ChoGath_R(player);
    const stackCount = 60;
    spell.setStackCount(stackCount);

    const { proxy, reads } = countReads(player.buffs);
    player.buffs = proxy as typeof player.buffs;

    player.drawHealthBar();

    // The old O(9N) code reads the array ~9 times over from the status-text
    // loop alone, plus another ~N from the unrelated buff-icon-row loop:
    // ~10N. O(N) leaves comfortable room under 5N without coming close to
    // the old shape.
    expect(reads()).toBeLessThan(stackCount * 5);
  });
});

describe('Champion.drawHealthBar status text: correctness preserved', () => {
  it('finds a status effect through a subclass, in STATUS_TEXT_BUFFS class order, and skips a self-inflicted one', () => {
    const { game, player } = context();
    const enemy = new Champion({ game, position: createVector(500, 500), teamId: TeamId.RED });
    // Re-stub after `context()` so this test holds its own spies (context()
    // already stubbed the globals once to construct `player`).
    const spies = stubGameGlobals();

    // Pushed in *reverse* of STATUS_TEXT_BUFFS class order (Slow is after
    // Root in that list) — the output must still read Root-before-Slow, i.e.
    // class order, not array/insertion order.
    player.addBuff(new Teemo_R_Buff(2000, enemy, player));
    player.addBuff(new Root(5000, enemy, player));
    // Self-inflicted: must not appear at all, and must not block a later
    // enemy-sourced buff of a *different* class from appearing.
    player.addBuff(new Stun(1000, player, player));

    player.drawHealthBar();

    const statusCalls = spies.text.mock.calls.filter(call => typeof call[0] === 'string');
    const statusText = statusCalls.map(call => call[0]).find(text => text.includes(','));
    expect(statusText).toBe('Trói, Chậm');
    expect(statusText).not.toContain('Choáng');
  });
});
