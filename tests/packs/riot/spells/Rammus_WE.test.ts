/**
 * Rammus finally does the two things Rammus does.
 *
 * `Defensive Ball Curl` was a shield with a nice hat: nothing came back off it,
 * so curling up next to someone was purely defensive and the enemy's correct
 * play was to keep hitting him. `Frenzying Taunt` was a disarm and a slow,
 * chosen because "there is no walk-at-me crowd control in this game" — which
 * was true right up until it wasn't: `Charm` already drags a unit, and
 * `BasicAttackController` already owns a standing attack order. A taunt is
 * those two facts pointed at the caster.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../../src/game/gameObject/attackableUnits/Champion';
import Taunt from '../../../../src/game/gameObject/buffs/Taunt';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../../../game/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { REFLECT_PERCENT, SHIELD_AMOUNT } from '../../../../packs/riot/spells/Rammus_W';
import makeRammus_W from '../../../../packs/riot/spells/Rammus_W';
import { DAMAGE as TAUNT_DAMAGE, RANGE } from '../../../../packs/riot/spells/Rammus_E';
import makeRammus_E from '../../../../packs/riot/spells/Rammus_E';
const __api = buildContentApi();
const Rammus_W = makeRammus_W(__api);
const Rammus_E = makeRammus_E(__api);

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const champion = (name: string, x: number): Champion => {
  const unit = new Champion({ game, teamId: name });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  unit.stats.maxHealth.baseValue = 500;
  unit.stats.health.baseValue = 500;
  unit.stats.mana.baseValue = 500;
  return unit;
};

const rammusWith = (x = 0): Champion => {
  const unit = champion('rammus', x);
  game.setPlayer(unit);
  return unit;
};

describe('Rammus W returns what it takes', () => {
  it('sends most of a hit back at whoever landed it', () => {
    const rammus = rammusWith();
    const attacker = champion('attacker', 60);
    indexObjects(game, [rammus, attacker]);

    new Rammus_W(rammus).onSpellCast();
    rammus.takeDamage(50, attacker);

    expect(attacker.stats.health.value).toBe(500 - Math.round(50 * REFLECT_PERCENT));
  });

  it('reflects what was swung, not what got past the shield', () => {
    const rammus = rammusWith();
    const attacker = champion('attacker', 60);
    indexObjects(game, [rammus, attacker]);

    new Rammus_W(rammus).onSpellCast();
    // Comfortably inside the shell's own absorption, so Rammus loses nothing.
    const swing = Math.floor(SHIELD_AMOUNT / 2);
    rammus.takeDamage(swing, attacker);

    expect(rammus.stats.health.value).toBe(500);
    expect(attacker.stats.health.value).toBe(500 - Math.round(swing * REFLECT_PERCENT));
  });

  it('does not reflect Rammus into himself', () => {
    const rammus = rammusWith();
    indexObjects(game, [rammus]);

    new Rammus_W(rammus).onSpellCast();
    rammus.takeDamage(40, rammus);

    // The shell ate it; nothing bounced back into the same pool.
    expect(rammus.stats.health.value).toBe(500);
  });

  it('two curled Rammuses settle instead of bouncing forever', () => {
    const one = rammusWith(0);
    const two = champion('rammus-two', 60);
    indexObjects(game, [one, two]);

    new Rammus_W(one).onSpellCast();
    new Rammus_W(two).onSpellCast();

    // Without a re-entrancy guard this is an infinite ping-pong down the stack.
    // Big enough that both shells are overrun, or the shields would swallow the
    // evidence and the test would pass on two units taking nothing.
    one.takeDamage(200, two);

    // `one` keeps the whole hit, less its own shell — nothing bounced back into
    // it, which is what the guard is for.
    expect(one.stats.health.value).toBe(500 - (200 - SHIELD_AMOUNT));
    // `two` pays the reflect exactly once, less its own shell.
    expect(two.stats.health.value).toBe(500 - (Math.round(200 * REFLECT_PERCENT) - SHIELD_AMOUNT));
  });

  it('stops reflecting once the shell is gone', () => {
    const rammus = rammusWith();
    const attacker = champion('attacker', 60);
    indexObjects(game, [rammus, attacker]);

    const spell = new Rammus_W(rammus);
    spell.onSpellCast();
    for (const buff of [...rammus.buffs]) buff.deactivateBuff();

    rammus.takeDamage(50, attacker);
    expect(attacker.stats.health.value).toBe(500);
  });
});

describe('Rammus E is an actual taunt', () => {
  const taunted = () => {
    const rammus = rammusWith();
    const victim = champion('victim', 80);
    indexObjects(game, [rammus, victim]);
    new Rammus_E(rammus).onSpellCast();
    return { rammus, victim };
  };

  it('forces the victim to swing at Rammus', () => {
    const { rammus, victim } = taunted();

    expect(victim.buffs.some(buff => buff instanceof Taunt)).toBe(true);
    expect(victim.basicAttack.target).toBe(rammus);
    expect(victim.stats.health.value).toBe(500 - TAUNT_DAMAGE);
  });

  it('takes everyone in range at once, not the nearest one', () => {
    const rammus = rammusWith();
    const near = champion('near', 60);
    const far = champion('far', 150);
    const outside = champion('outside', RANGE + 220);
    indexObjects(game, [rammus, near, far, outside]);

    new Rammus_E(rammus).onSpellCast();

    for (const inRange of [near, far]) {
      expect(inRange.buffs.some(buff => buff instanceof Taunt)).toBe(true);
      expect(inRange.basicAttack.target).toBe(rammus);
      expect(inRange.stats.health.value).toBe(500 - TAUNT_DAMAGE);
    }
    expect(outside.buffs.some(buff => buff instanceof Taunt)).toBe(false);
    expect(outside.stats.health.value).toBe(500);
  });

  it('takes the order back when the victim is pointed somewhere else', () => {
    const { rammus, victim } = taunted();
    const bystander = champion('bystander', 200);
    indexObjects(game, [rammus, victim, bystander]);

    victim.basicAttack.order(bystander);
    expect(victim.basicAttack.target).toBe(bystander);

    victim.update();
    expect(victim.basicAttack.target).toBe(rammus);
  });

  it('leaves the victim able to attack — the whole point of a taunt', () => {
    const { victim } = taunted();
    victim.update();

    expect(victim.canAttack).toBe(true);
    expect(victim.canCast).toBe(false);
  });

  it('lets go when Rammus dies', () => {
    const { rammus, victim } = taunted();

    rammus.die({ attacker: undefined, reviveAfter: 5_000 });
    victim.update();

    expect(victim.buffs.some(buff => buff instanceof Taunt && !buff.toRemove)).toBe(false);
  });
});
