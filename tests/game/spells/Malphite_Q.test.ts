import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Malphite_Q, { Malphite_Q_Object } from '../../../src/game/gameObject/spells/Malphite_Q';
import HomingMissileSpellObject from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Speedup from '../../../src/game/gameObject/buffs/Speedup';
import TargetResolver from '../../../src/game/spell/targeting/TargetResolver';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string, speed = 10): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = speed;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

const castContext = (
  owner: AttackableUnit,
  target?: unknown,
  cursorWorld = { x: 0, y: 500 }
): CastContext =>
  Object.freeze({
    spellId: 'malphite-q',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 0, y: 1 }),
    ...(target === undefined ? {} : { target }),
  });

function launch(owner: AttackableUnit, target: AttackableUnit): Malphite_Q_Object {
  const spell = new Malphite_Q(owner);
  expect(spell.press(castContext(owner, target))).toBe(true);
  spell.update();
  const missile = owner.game.objectManager._objectToBeAdd.find(
    (object): object is Malphite_Q_Object => object instanceof Malphite_Q_Object
  );
  if (!missile) throw new Error('Malphite Q must create its homing shard.');
  return missile;
}

function arrive(missile: Malphite_Q_Object): void {
  for (let i = 0; i < 100 && !missile.toRemove; i++) missile.update();
}

describe('Malphite Q', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires a valid enemy unit target in range', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    const resolution = TargetResolver.resolve('UNIT', {
      spellId: 'malphite-q',
      activationId: 'activation',
      startedAtMs: 1,
      caster: owner,
      casterTeamId: owner.teamId,
      origin: owner.position,
      cursorWorld: target.position,
      range: 500,
      targetTeam: 'ENEMY',
      queryCandidates: () => [target],
      getTargetInfo: candidate => candidate === target ? target : null,
      isTargetable: candidate => candidate === target && target.targetable,
    });
    const spell = new Malphite_Q(owner);
    const ally = unit(game, 100, 'blue');
    const outOfRange = unit(game, 501, 'red');

    expect(resolution).toMatchObject({ ok: true, context: { target } });
    expect(spell.press(castContext(owner))).toBe(false);
    game.objectManager.objects.push(target);
    expect(new Malphite_Q(owner).press(castContext(owner))).toBe(false);
    expect(new Malphite_Q(owner).press(castContext(owner, undefined, target.position))).toBe(true);
    expect(new Malphite_Q(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Malphite_Q(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('rejects unseen targets and cancels when the target leaves sight during cast time', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const unseen = unit(game, 100, 'red');
    unseen.willDraw = false;

    expect(new Malphite_Q(owner).press(castContext(owner, unseen))).toBe(false);

    const target = unit(game, 100, 'red');
    const spell = new Malphite_Q(owner);
    const onCancel = vi.spyOn(spell, 'onCancel');
    expect(spell.press(castContext(owner, target))).toBe(true);
    target.willDraw = false;

    spell.update();

    expect(onCancel).toHaveBeenCalledWith(expect.anything(), 'TARGET_INVALID');
    expect(spell.state).toBe('READY');
    expect(owner.stats.mana.value).toBe(100);
    expect(game.objectManager._objectToBeAdd).toEqual([]);
  });

  it('spawns the shard 100 units toward the selected target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');

    const missile = launch(owner, target);

    expect(missile.position).toMatchObject({ x: 100, y: 0 });
    expect(missile.speed).toBe(1_200 / 60);
  });

  it('uses imported rank-one cooldown, mana, and slow values', () => {
    const game = createGame();
    const spell = new Malphite_Q(unit(game, 0, 'blue'));

    expect(spell.coolDown).toBe(8_000);
    expect(spell.manaCost).toBe(70);
    expect(spell.slowPercent).toBe(0.2);
  });

  it('follows the selected target instead of the cursor line', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 20, 'red');
    const missile = launch(owner, target);
    target.position.set(40, 0);

    arrive(missile);

    expect(missile).toBeInstanceOf(HomingMissileSpellObject);
    expect(missile.destination).toMatchObject({ x: 40, y: 0 });
  });

  it('damages and slows only the selected target on arrival', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red', 100);
    const bystander = unit(game, 10, 'red');
    const targetDamage = vi.spyOn(target, 'takeDamage');
    const targetBuff = vi.spyOn(target, 'addBuff');
    const bystanderDamage = vi.spyOn(bystander, 'takeDamage');
    const bystanderBuff = vi.spyOn(bystander, 'addBuff');
    const missile = launch(owner, target);

    arrive(missile);

    expect(targetDamage).toHaveBeenCalledWith(20, owner);
    expect(targetBuff).toHaveBeenCalledWith(expect.any(Slow));
    expect(bystanderDamage).not.toHaveBeenCalled();
    expect(bystanderBuff).not.toHaveBeenCalled();
  });

  it('steals the researched movement speed amount for the researched duration', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue', 10);
    const target = unit(game, 10, 'red', 100);
    const missile = launch(owner, target);

    arrive(missile);

    const slow = target.buffs.find((buff): buff is Slow => buff instanceof Slow);
    const speedup = owner.buffs.find((buff): buff is Speedup => buff instanceof Speedup);
    expect(slow?.duration).toBe(3000);
    expect(speedup?.duration).toBe(3000);
    expect(owner.stats.speed.value).toBe(30);
  });

  it('applies arrival payload once and handles an invalidated target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const missile = launch(owner, target);

    arrive(missile);
    missile.update();

    expect(takeDamage).toHaveBeenCalledTimes(1);

    const invalidOwner = unit(game, 0, 'blue');
    const invalidTarget = unit(game, 30, 'red');
    const invalidDamage = vi.spyOn(invalidTarget, 'takeDamage');
    const invalidMissile = launch(invalidOwner, invalidTarget);
    invalidTarget.die({ reviveAfter: 100 });
    invalidMissile.update();

    expect(invalidMissile.toRemove).toBe(true);
    expect(invalidDamage).not.toHaveBeenCalled();
  });
});
