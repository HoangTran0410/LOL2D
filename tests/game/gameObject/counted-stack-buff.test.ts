import { describe, expect, it } from 'vitest';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import { context } from '../practice/helpers';

/**
 * `AttackableUnit.addBuff`'s array-based stacking (`this.buffs.push(buff)`
 * on every application, `preBuffs.length` standing in for the count) is
 * right for a buff with a per-stack duration — a 10-stack Speedup applied at
 * different moments has to expire its stacks at different moments, which
 * needs a list of instances (or of expiry times, which is the same thing
 * under a different name).
 *
 * It is the wrong model for a *permanent, uniform* stack: Cho'Gath's Feast,
 * Veigar Q's power. Every stack is identical, none has its own expiry or
 * source, and N instances carrying identical bonuses carry exactly zero
 * information the number N does not. `Buff.countedStacks` is the opt-in for
 * that case: one instance, a `stacks` counter, `addBuff` increments it in
 * place instead of pushing a new instance. See
 * `.superpowers/perf-healthbar-report.md` for why this matters at the stack
 * counts a cheat console reaches (900+, not the 99 `maxStacks` implies).
 *
 * A minimal local `StatAmp` subclass, not `ChoGath_R_Growth`/
 * `Veigar_Q_Power` directly — this tests the *mechanism* `AttackableUnit`
 * and `StatAmp` now provide, independent of either spell's own numbers.
 */
class TestCountedBuff extends StatAmp {
  countedStacks = true;
  maxStacks = 5;
  bonuses = { attackDamage: { baseBonus: 10 } };
}

describe('Buff.countedStacks: one instance, a stacks counter', () => {
  it('repeated addBuff calls increment one instance instead of pushing new ones', () => {
    const { player } = context();
    for (let i = 0; i < 3; i++) player.addBuff(new TestCountedBuff(600_000, player, player));

    const matching = player.buffs.filter(b => b instanceof TestCountedBuff);
    expect(matching).toHaveLength(1);
    expect(matching[0].stacks).toBe(3);
  });

  it('scales the live stat modifier by stacks exactly, on every increment', () => {
    const { player } = context();
    const before = player.stats.attackDamage.value;

    player.addBuff(new TestCountedBuff(600_000, player, player));
    expect(player.stats.attackDamage.value).toBe(before + 10);

    player.addBuff(new TestCountedBuff(600_000, player, player));
    expect(player.stats.attackDamage.value).toBe(before + 20);

    player.addBuff(new TestCountedBuff(600_000, player, player));
    expect(player.stats.attackDamage.value).toBe(before + 30);
  });

  it('caps at maxStacks under repeated real-play application', () => {
    const { player } = context();
    for (let i = 0; i < 10; i++) player.addBuff(new TestCountedBuff(600_000, player, player));

    const matching = player.buffs.filter(b => b instanceof TestCountedBuff);
    expect(matching).toHaveLength(1);
    expect(matching[0].stacks).toBe(5);
  });

  it('does not claw back a stack count a cheat set above maxStacks', () => {
    const { player } = context();
    const seeded = new TestCountedBuff(600_000, player, player);
    seeded.stacks = 999; // the cheat path: an absolute, uncapped set
    player.addBuff(seeded);

    // A real-play increment afterwards must not clamp this back down.
    player.addBuff(new TestCountedBuff(600_000, player, player));

    const matching = player.buffs.filter(b => b instanceof TestCountedBuff);
    expect(matching[0].stacks).toBe(999);
  });
});
