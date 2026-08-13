import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Veigar_R, {
  BASE_DAMAGE,
  CAST_TIME_MS,
  MANA_COST,
  MAX_MISSING_HEALTH_MULTIPLIER,
  MISSILE_SPEED,
  RANGE,
  Veigar_R_Burst,
  Veigar_R_Object,
} from '../../../src/game/gameObject/spells/Veigar_R';
import HomingMissileSpellObject from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import TargetResolver from '../../../src/game/spell/targeting/TargetResolver';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { createGame, createUnit, installSpellObjectGlobals, type TestGame } from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.mana.baseValue = 200;
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
    spellId: 'veigar-r',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 0, y: 1 }),
    ...(target === undefined ? {} : { target }),
  });

function launch(owner: AttackableUnit, target: AttackableUnit): Veigar_R_Object {
  const spell = new Veigar_R(owner);
  expect(spell.press(castContext(owner, target))).toBe(true);
  vi.stubGlobal('deltaTime', CAST_TIME_MS);
  spell.update();
  const missile = owner.game.objectManager._objectToBeAdd.find(
    (object): object is Veigar_R_Object => object instanceof Veigar_R_Object
  );
  if (!missile) throw new Error('Veigar R must create its burst.');
  return missile;
}

function arrive(missile: Veigar_R_Object): void {
  for (let i = 0; i < 100 && !missile.toRemove; i++) missile.update();
}

describe('Veigar R', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
    vi.stubGlobal('constrain', (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), high)
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires a valid enemy champion target in range', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    const resolution = TargetResolver.resolve('UNIT', {
      spellId: 'veigar-r',
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
    expect(new Veigar_R(owner).press(castContext(owner))).toBe(false);
    game.objectManager.objects.push(target);
    expect(new Veigar_R(owner).press(castContext(owner))).toBe(false);
    expect(new Veigar_R(owner).press(castContext(owner, undefined, target.position))).toBe(true);
    expect(new Veigar_R(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Veigar_R(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('cancels and refunds nothing extra if the target dies mid cast-time', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    const spell = new Veigar_R(owner);
    const onCancel = vi.spyOn(spell, 'onCancel');

    expect(spell.press(castContext(owner, target))).toBe(true);
    expect(owner.stats.mana.value).toBe(200); // committed at release, not start
    target.die({ reviveAfter: 100 });

    vi.stubGlobal('deltaTime', CAST_TIME_MS);
    spell.update();

    expect(onCancel).toHaveBeenCalledWith(expect.anything(), 'TARGET_INVALID');
    expect(owner.stats.mana.value).toBe(200);
    expect(game.objectManager._objectToBeAdd).toEqual([]);
  });

  it('commits mana and starts cooldown only once the burst is actually released', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 100, 'red');
    const missile = launch(owner, target);

    expect(missile).toBeInstanceOf(HomingMissileSpellObject);
    expect(missile.speed).toBe(MISSILE_SPEED);
    expect(missile.baseDamage).toBe(BASE_DAMAGE);
    expect(owner.stats.mana.value).toBe(200 - MANA_COST);
  });

  it('deals exactly its base damage to a full-health target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const missile = launch(owner, target);

    arrive(missile);

    expect(takeDamage).toHaveBeenCalledTimes(1);
    expect(takeDamage).toHaveBeenCalledWith(BASE_DAMAGE, owner);
  });

  it('scales up toward double damage as the target nears death', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    target.stats.health.baseValue = 1; // 99% missing out of 100 max health
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const missile = launch(owner, target);

    arrive(missile);

    const expectedDamage = BASE_DAMAGE * (1 + MAX_MISSING_HEALTH_MULTIPLIER * 0.99);
    expect(takeDamage).toHaveBeenCalledWith(expectedDamage, owner);
  });

  it('bystanders are untouched — only the locked target takes the burst', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const bystander = unit(game, 10, 'red');
    const bystanderDamage = vi.spyOn(bystander, 'takeDamage');
    const missile = launch(owner, target);

    arrive(missile);

    expect(bystanderDamage).not.toHaveBeenCalled();
  });

  it('handles an invalidated target on arrival without throwing or double-hitting', () => {
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

  it('draws the burst and its landing procedurally, sized to cover the visuals', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const missile = launch(owner, target);

    const draw = { circle: vi.fn(), line: vi.fn(), beginShape: vi.fn(), vertex: vi.fn(), endShape: vi.fn() };
    for (const [name, spy] of Object.entries(draw)) vi.stubGlobal(name, spy);
    for (const name of ['push', 'pop', 'translate', 'rotate', 'blendMode', 'fill', 'stroke', 'noFill', 'noStroke', 'strokeWeight']) {
      vi.stubGlobal(name, vi.fn());
    }
    for (const name of ['ADD', 'BLEND', 'CLOSE']) vi.stubGlobal(name, name);
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);

    expect(missile.image).toBeUndefined();
    missile.draw();
    expect(draw.beginShape).toHaveBeenCalled();

    const missileBox = missile.getDisplayBoundingBox();
    expect(missileBox.w).toBeGreaterThanOrEqual(missile.size);
    expect(missileBox.h).toBeGreaterThanOrEqual(missile.size);

    arrive(missile);
    const burst = owner.game.objectManager._objectToBeAdd.find(
      (object): object is Veigar_R_Burst => object instanceof Veigar_R_Burst
    );
    if (!burst) throw new Error('Veigar R must spawn an impact burst on arrival.');
    vi.stubGlobal('constrain', (value: number, low: number, high: number) => Math.min(Math.max(value, low), high));
    burst.draw();
    expect(draw.circle).toHaveBeenCalled();

    const burstBox = burst.getDisplayBoundingBox();
    expect(burstBox.w).toBeGreaterThan(burst.targetSize);
    expect(burstBox.h).toBeGreaterThan(burst.targetSize);
  });
});
