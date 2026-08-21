import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomingMissileSpellObject from '../../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import TargetResolver from '../../../../src/game/spell/targeting/TargetResolver';
import type { CastContext } from '../../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { CAST_TIME_MS, DAMAGE, MANA_COST, MARK_DURATION_MS, MISSILE_SIZE, MISSILE_SPEED, RANGE } from '../../../../packs/riot/spells/Leblanc_Q';
import makeLeblanc_Q, { makeLeblanc_Q_Mark, makeLeblanc_Q_Object } from '../../../../packs/riot/spells/Leblanc_Q';
const __api = buildContentApi();
const Leblanc_Q = makeLeblanc_Q(__api);
const Leblanc_Q_Mark = makeLeblanc_Q_Mark(__api);
const Leblanc_Q_Object = makeLeblanc_Q_Object(__api);

function unit(game: TestGame, x: number, teamId: string) {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.animatedValues.displaySize = 20;
  return result;
}

const castContext = (
  owner: AttackableUnit,
  target?: unknown,
  cursorWorld = { x: 100, y: 0 }
): CastContext =>
  Object.freeze({
    spellId: 'leblanc-q',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 1, y: 0 }),
    ...(target === undefined ? {} : { target }),
  });

function launch(owner: AttackableUnit, target: AttackableUnit): Leblanc_Q_Object {
  const spell = new Leblanc_Q(owner);
  expect(spell.press(castContext(owner, target))).toBe(true);
  vi.stubGlobal('deltaTime', CAST_TIME_MS);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
  // pending objects are never flushed in this test (nothing drives
  // objectManager.update()), so pull the freshest match and drop it from the
  // queue — otherwise a second launch() would keep finding the first orb.
  const pending = owner.game.objectManager._objectToBeAdd;
  const index = pending.findLastIndex(object => object instanceof Leblanc_Q_Object);
  if (index === -1) throw new Error('Leblanc Q must create its orb.');
  const [orb] = pending.splice(index, 1);
  return orb as Leblanc_Q_Object;
}

function arrive(orb: Leblanc_Q_Object): void {
  for (let i = 0; i < 200 && !orb.toRemove; i++) orb.update();
}

describe('Leblanc Q (Sigil of Malice)', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is wired to its exported tuning', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const spell = new Leblanc_Q(owner);

    expect(spell.manaCost).toBe(MANA_COST);
    expect(spell.range).toBe(RANGE);
    expect(spell.castSpec).toMatchObject({
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: CAST_TIME_MS,
      cooldown: { startAt: 'release', durationMs: spell.coolDown },
    });
  });

  it('requires a valid enemy unit target in range', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    const resolution = TargetResolver.resolve('UNIT', {
      spellId: 'leblanc-q',
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
    const ally = unit(game, 100, 'blue');
    const outOfRange = unit(game, RANGE + 1, 'red');

    expect(resolution).toMatchObject({ ok: true, context: { target } });
    expect(new Leblanc_Q(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Leblanc_Q(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('fires a homing orb sized and timed from the exported tuning', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');

    const orb = launch(owner, target);

    expect(orb).toBeInstanceOf(HomingMissileSpellObject);
    expect(orb.speed).toBe(MISSILE_SPEED);
    expect(orb.size).toBe(MISSILE_SIZE);
    expect(orb.damage).toBe(DAMAGE);
  });

  it('damages an unmarked target once and leaves a mark', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const orb = launch(owner, target);

    arrive(orb);

    expect(takeDamage).toHaveBeenCalledTimes(1);
    expect(takeDamage).toHaveBeenCalledWith(DAMAGE, owner);
    const mark = target.buffs.find(
      (buff): buff is Leblanc_Q_Mark => buff instanceof Leblanc_Q_Mark
    );
    expect(mark).toMatchObject({ duration: MARK_DURATION_MS, bonusDamage: DAMAGE });
  });

  it('detonates an existing mark for double damage and refreshes it, rather than stacking marks', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');

    arrive(launch(owner, target));
    expect(takeDamage).toHaveBeenCalledTimes(1);
    const firstMark = target.buffs.find(buff => buff instanceof Leblanc_Q_Mark);

    arrive(launch(owner, target));

    // base hit + consumed mark = two damage instances on the second cast
    expect(takeDamage).toHaveBeenCalledTimes(3);
    expect(takeDamage.mock.calls[1]).toEqual([DAMAGE, owner]);
    expect(takeDamage.mock.calls[2]).toEqual([DAMAGE, owner]);
    // RENEW_EXISTING: the mark that was consumed is the same one still on the
    // target afterwards (refreshed), never a second stacked instance
    expect(firstMark?.toRemove).toBe(false);
    const marks = target.buffs.filter(buff => buff instanceof Leblanc_Q_Mark);
    expect(marks).toEqual([firstMark]);
  });

  it('draws a procedural orb rather than blitting the ability icon, and sizes its box to cover it', () => {
    const spies = { circle: vi.fn(), ellipse: vi.fn(), image: vi.fn() };
    for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
    for (const name of [
      'push',
      'pop',
      'translate',
      'rotate',
      'fill',
      'noFill',
      'stroke',
      'noStroke',
      'strokeWeight',
      'blendMode',
    ]) {
      vi.stubGlobal(name, vi.fn());
    }
    for (const name of ['ADD', 'BLEND']) vi.stubGlobal(name, name);

    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const orb = new Leblanc_Q_Object(owner, unit(game, 100, 'red'));

    orb.draw();

    expect(spies.image).not.toHaveBeenCalled();
    expect(spies.circle).toHaveBeenCalled();
    expect(spies.ellipse).toHaveBeenCalled();

    const box = orb.getDisplayBoundingBox();
    expect(box.w).toBeGreaterThanOrEqual(orb.size);
    expect(box.h).toBeGreaterThanOrEqual(orb.size);
  });
});
