import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import Buff from '../../../src/game/gameObject/Buff';

class TestBuff extends Buff {
  deactivated = false;
  onDeactivate(): void {
    this.deactivated = true;
  }
}

// AttackableUnit.die() used to only set `deathData`, leaving every buff on the
// corpse active. Buffs kept ticking (updateBuffs() runs regardless of death),
// drawing (drawBuffs() runs regardless of death), and — worse — could still be
// active after a fast respawn if their duration had not yet finished ticking
// down. This covers the general fix: death must deactivate and drop every buff.
describe('a unit dying clears its buffs', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('deactivates and drops every buff the instant a unit dies', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const buff = new TestBuff(4_000, unit, unit);
    unit.addBuff(buff);
    expect(unit.buffs).toHaveLength(1);

    unit.die({ reviveAfter: 5_000 });

    expect(unit.buffs).toHaveLength(0);
    expect(buff.toRemove).toBe(true);
    expect(buff.deactivated).toBe(true);
  });

  it('does not resurrect a buff into the next life, even one only reachable by an external reference', () => {
    // Mirrors how Twitch_Q_Object, Thresh_Q_Object, and Blitzcrank_Q_Object hold
    // their own reference to a buff instance and poll `toRemove` — none of them
    // deactivate the buff themselves, only death (and natural expiry) do.
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const heldByCaster = new TestBuff(4_000, unit, unit);
    unit.addBuff(heldByCaster);

    unit.die({ reviveAfter: 5_000 });
    unit.respawn();

    expect(heldByCaster.toRemove).toBe(true);
    expect(unit.buffs).toHaveLength(0);
  });

  it('refuses new buffs while dead', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    unit.die({ reviveAfter: 5_000 });
    unit.addBuff(new TestBuff(1_000, unit, unit));

    expect(unit.buffs).toHaveLength(0);
  });
});
