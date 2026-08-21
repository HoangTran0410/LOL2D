import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import HomingMissileSpellObject from '../../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import Slow from '../../../../src/game/gameObject/buffs/Slow';
import Speedup from '../../../../src/game/gameObject/buffs/Speedup';
import TargetResolver from '../../../../src/game/spell/targeting/TargetResolver';
import type { CastContext } from '../../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  withCastTime,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { DAMAGE, MISSILE_SPEED, RANGE, SLOW_DURATION_MS, SLOW_PERCENT, SPAWN_OFFSET_DISTANCE, SPEEDUP_DURATION_MS } from '../../../../packs/riot/spells/Malphite_Q';
import makeMalphite_Q, { makeMalphite_Q_Object } from '../../../../packs/riot/spells/Malphite_Q';
const __api = buildContentApi();
const Malphite_Q = makeMalphite_Q(__api);
const Malphite_Q_Object = makeMalphite_Q_Object(__api);

/** The cast window this suite drives the runtime through — see `withCastTime`. */
const TEST_CAST_TIME_MS = 250;

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
      range: RANGE,
      targetTeam: 'ENEMY',
      queryCandidates: () => [target],
      getTargetInfo: candidate => (candidate === target ? target : null),
      isTargetable: candidate => candidate === target && target.targetable,
    });
    const spell = new Malphite_Q(owner);
    const ally = unit(game, 100, 'blue');
    const outOfRange = unit(game, RANGE + 1, 'red');

    expect(resolution).toMatchObject({ ok: true, context: { target } });
    expect(spell.press(castContext(owner))).toBe(false);
    game.objectManager.objects.push(target);
    // This case is about *who* a cast may take, not what it costs. The first
    // press below now succeeds where it used to be refused, and a successful
    // Malphite Q bills 70 of the fixture's 100 mana — which would make the
    // second press fail for a reason this test is not asking about.
    owner.stats.mana.baseValue = 500;
    // Cursor parked far away (0, 500) and the enemy still in range: this used
    // to refuse, because the acquisition circle was a filter rather than a
    // preference. Range decides what a spell may hit; the cursor only decides
    // which of those it takes. The refusals below are the ones that still mean
    // something — wrong team, and genuinely out of reach.
    expect(new Malphite_Q(owner).press(castContext(owner))).toBe(true);
    expect(new Malphite_Q(owner).press(castContext(owner, undefined, target.position))).toBe(true);
    expect(new Malphite_Q(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Malphite_Q(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('rejects unseen targets and cancels when the target leaves sight during cast time', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const unseen = unit(game, 100, 'red');
    // Hidden the way the game decides hidden: `combat/Vision.ts` is the seam,
    // and `isInsideBush` is the half of it that still holds in a fixture with
    // no terrain. This used to set `willDraw` instead, which is the fog's
    // *draw* flag — it answers "lit for the player", so gating a cast on it
    // meant a bot could only target what the human could see. See the note on
    // `findAttackTargetNearPoint`, which was migrated off it for that reason.
    unseen.isInsideBush = true;

    expect(new Malphite_Q(owner).press(castContext(owner, unseen))).toBe(false);

    const target = unit(game, 100, 'red');
    // The cast window is the test's, not Malphite's: the ability ships
    // instant (`CAST_TIME_MS = 0`) and the rule being checked here — a UNIT
    // spell drops its cast the moment its target stops being a legal one —
    // belongs to the runtime and must stay covered either way. See
    // `withCastTime`.
    const spell = new (withCastTime(Malphite_Q, TEST_CAST_TIME_MS))(owner);
    const onCancel = vi.spyOn(spell, 'onCancel');
    expect(spell.press(castContext(owner, target))).toBe(true);
    target.isInsideBush = true;

    spell.update();

    expect(onCancel).toHaveBeenCalledWith(expect.anything(), 'TARGET_INVALID');
    expect(spell.state).toBe('READY');
    expect(owner.stats.mana.value).toBe(100);
    expect(game.objectManager._objectToBeAdd).toEqual([]);
  });

  it('spawns the shard offset toward the selected target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');

    const missile = launch(owner, target);

    expect(missile.position).toMatchObject({ x: SPAWN_OFFSET_DISTANCE, y: 0 });
    expect(missile.speed).toBe(MISSILE_SPEED);
  });

  it('copies its declared damage and slow tuning onto the shard before it fires', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');
    const spell = new Malphite_Q(owner);

    expect(spell.press(castContext(owner, target))).toBe(true);
    spell.update();
    const missile = owner.game.objectManager._objectToBeAdd.find(
      (object): object is Malphite_Q_Object => object instanceof Malphite_Q_Object
    );
    if (!missile) throw new Error('Malphite Q must create its homing shard.');

    expect(missile.damage).toBe(spell.damage);
    expect(missile.slowPercent).toBe(spell.slowPercent);
    expect(missile.slowDuration).toBe(spell.slowDuration);
    expect(missile.speedupDuration).toBe(spell.speedupDuration);
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

    expect(targetDamage).toHaveBeenCalledWith(DAMAGE, owner);
    expect(targetBuff).toHaveBeenCalledWith(expect.any(Slow));
    expect(bystanderDamage).not.toHaveBeenCalled();
    expect(bystanderBuff).not.toHaveBeenCalled();
  });

  it('steals the researched movement speed amount for the researched duration', () => {
    const game = createGame();
    const ownerBaseSpeed = 10;
    const targetBaseSpeed = 100;
    const owner = unit(game, 0, 'blue', ownerBaseSpeed);
    const target = unit(game, 10, 'red', targetBaseSpeed);
    const missile = launch(owner, target);

    arrive(missile);

    const slow = target.buffs.find((buff): buff is Slow => buff instanceof Slow);
    const speedup = owner.buffs.find((buff): buff is Speedup => buff instanceof Speedup);
    expect(slow?.duration).toBe(SLOW_DURATION_MS);
    expect(speedup?.duration).toBe(SPEEDUP_DURATION_MS);
    // the target's speed is cut by SLOW_PERCENT, and Malphite gains exactly
    // what was taken away
    expect(owner.stats.speed.value).toBeCloseTo(ownerBaseSpeed + targetBaseSpeed * SLOW_PERCENT);
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
