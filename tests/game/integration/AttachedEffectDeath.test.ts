import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import Buff from '../../../src/game/gameObject/Buff';
import BuffAddType from '../../../src/game/enums/BuffAddType';
import SpellObject from '../../../src/game/gameObject/SpellObject';

class TestBuff extends Buff {}

class RenewingBuff extends Buff {
  buffAddType = BuffAddType.RENEW_EXISTING;
}

/**
 * The layer above buffs: spell objects that ride on a body and pick their own
 * exit condition. Every one of them used to invent that condition, and each one
 * could get it wrong on its own — the shell kept orbiting a corpse, the tether
 * stayed strung to it, the marker jumped to the respawn point. `attachTo` is the
 * single place that answers "is the thing I am drawn on still there?".
 */
describe('spell objects attached to a unit', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('leaves an unattached object alone, so a projectile still outlives its caster', () => {
    const game = createGame();
    const caster = createUnit(game, 0, 'blue');
    const missile = new SpellObject(caster);

    caster.die({ reviveAfter: 5_000 });
    missile.update();

    expect(missile.attachmentLost).toBe(false);
    expect(missile.toRemove).toBe(false);
  });

  it('drops an attached effect the moment its unit dies', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const effect = new SpellObject(unit).attachTo(unit);

    effect.update();
    expect(effect.toRemove).toBe(false);

    unit.die({ reviveAfter: 5_000 });

    expect(effect.attachmentLost).toBe(true);
    effect.update();
    expect(effect.toRemove).toBe(true);
  });

  it('drops an attached effect when its unit is taken out of the world', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const effect = new SpellObject(unit).attachTo(unit);

    // units that never respawn (minions, wards) leave the world by `toRemove`
    unit.toRemove = true;
    effect.update();

    expect(effect.toRemove).toBe(true);
  });

  it('stays gone once the unit respawns somewhere else', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const effect = new SpellObject(unit).attachTo(unit);
    game.objectManager.addObject(effect);
    game.objectManager.update();
    expect(game.objectManager.objects).toContain(effect);

    unit.die({ reviveAfter: 5_000 });
    game.objectManager.update();
    expect(game.objectManager.objects).not.toContain(effect);

    unit.respawn();
    unit.position.set(900, 900);
    game.objectManager.update();

    expect(game.objectManager.objects).not.toContain(effect);
    expect(effect.toRemove).toBe(true);
  });

  it('never reattaches to a revived body, whatever the buff layer did on death', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const buff = new TestBuff(4_000, unit, unit);
    unit.addBuff(buff);
    const effect = new SpellObject(unit).attachTo(unit, buff);

    unit.die({ reviveAfter: 5_000 });
    expect(effect.attachmentLost).toBe(true);

    // Revival is the trap: `isDead` goes back to false and the buff may still
    // be sitting there un-expired, so an effect that only asked "is my unit
    // dead right now?" would light back up at the new spawn point.
    unit.respawn();
    unit.position.set(900, 900);
    unit.addBuff(buff);

    expect(effect.attachmentLost).toBe(true);
    effect.update();
    expect(effect.toRemove).toBe(true);
  });

  it('drops an effect when the buff it shadows ends, without a clock of its own', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const buff = new TestBuff(4_000, unit, unit);
    unit.addBuff(buff);
    const effect = new SpellObject(unit).attachTo(unit, buff);

    effect.update();
    expect(effect.toRemove).toBe(false);

    buff.deactivateBuff();
    effect.update();

    expect(effect.toRemove).toBe(true);
  });

  it('shadows the buff that actually landed, not the instance addBuff threw away', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    const landed = new RenewingBuff(4_000, unit, unit);
    unit.addBuff(landed);
    // RENEW_EXISTING renews what is already there and drops the new instance:
    // `discarded` is never pushed into unit.buffs, so it is never updated and
    // its `toRemove` can never flip on its own.
    const discarded = new RenewingBuff(4_000, unit, unit);
    unit.addBuff(discarded);
    expect(unit.buffs).toEqual([landed]);

    const effect = new SpellObject(unit).attachTo(unit, discarded);
    expect(effect._anchorBuff).toBe(landed);

    landed.deactivateBuff();
    effect.update();

    expect(effect.toRemove).toBe(true);
    expect(discarded.toRemove).toBe(false); // the trap: watching this waits forever
  });

  it('treats a buff a corpse refused as an attachment that is already over', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    unit.die({ reviveAfter: 5_000 });

    const refused = new TestBuff(4_000, unit, unit);
    unit.addBuff(refused); // addBuff bails out on a dead unit
    expect(unit.buffs).toHaveLength(0);

    const effect = new SpellObject(unit).attachTo(unit, refused);

    expect(effect._anchorBuff).toBeNull();
    expect(effect.attachmentLost).toBe(true);
  });
});
