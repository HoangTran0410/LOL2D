import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Malphite_E, {
  CAST_TIME_MS,
  COOLDOWN_MS,
  DAMAGE,
  FADE_MS,
  Malphite_E_Object,
  CRIPPLE_PERCENT,
  RADIUS,
  SLOW_DURATION_MS,
  SLOW_PERCENT,
} from '../../../src/game/gameObject/spells/Malphite_E';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 5;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 55;
  return result;
}

const castContext = (owner: AttackableUnit): CastContext =>
  Object.freeze({
    spellId: 'malphite-e',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

const stubDrawGlobals = () => {
  const spies = {
    image: vi.fn(),
    circle: vi.fn(),
    line: vi.fn(),
    triangle: vi.fn(),
  };
  for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
  for (const name of [
    'push',
    'pop',
    'translate',
    'rotate',
    'blendMode',
    'fill',
    'stroke',
    'noFill',
    'noStroke',
    'strokeWeight',
  ]) {
    vi.stubGlobal(name, vi.fn());
  }
  vi.stubGlobal('constrain', (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi));
  vi.stubGlobal('cos', Math.cos);
  vi.stubGlobal('sin', Math.sin);
  for (const name of ['ADD', 'BLEND']) vi.stubGlobal(name, name);
  return spies;
};

function press(owner: AttackableUnit): Malphite_E_Object {
  const spell = new Malphite_E(owner);
  expect(spell.press(castContext(owner))).toBe(true);
  spell.update();
  const slam = owner.game.objectManager._objectToBeAdd.find(
    (object): object is Malphite_E_Object => object instanceof Malphite_E_Object
  );
  if (!slam) throw new Error('Malphite E must create its slam object.');
  return slam;
}

describe('Malphite E', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('deltaTime', 250); // matches CAST_TIME_MS, so one update() completes the cast
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('spends mana and starts cooldown from the exported tuning', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const spell = new Malphite_E(owner);

    expect(spell.press(castContext(owner))).toBe(true);
    // Read off the tuning rather than assuming a cast to finish: at
    // `CAST_TIME_MS = 0` the press has already released and the cooldown is
    // running, so the stubbed 250ms frame this used to spend here would eat a
    // quarter second of it and the assertion below would be about the frame,
    // not about the cooldown the spell starts.
    if (CAST_TIME_MS > 0) spell.update();

    expect(owner.stats.mana.value).toBe(100 - spell.manaCost);
    expect(spell.state).toBe('COOLDOWN');
    expect(spell.currentCooldown).toBe(COOLDOWN_MS);
  });

  it('damages and slows enemies inside the radius, ignoring allies and anyone outside it', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const nearEnemy = unit(game, RADIUS - 10, 'red');
    const farEnemy = unit(game, RADIUS + 40, 'red');
    const ally = unit(game, RADIUS - 10, 'blue');
    game.objectManager.objects.push(owner, nearEnemy, farEnemy, ally);
    game.objectManager.update(); // builds the quadtree the slam's spatial query reads
    const nearDamage = vi.spyOn(nearEnemy, 'takeDamage');
    const farDamage = vi.spyOn(farEnemy, 'takeDamage');
    const allyDamage = vi.spyOn(ally, 'takeDamage');

    const slam = press(owner);
    slam.update();

    expect(nearDamage).toHaveBeenCalledWith(DAMAGE, owner);
    expect(farDamage).not.toHaveBeenCalled();
    expect(allyDamage).not.toHaveBeenCalled();

    const slow = nearEnemy.buffs.find((buff): buff is Slow => buff instanceof Slow);
    expect(slow).toMatchObject({ percent: SLOW_PERCENT, duration: SLOW_DURATION_MS });
    expect(slow?.stackId).toBe('malphite_e_cripple');
  });

  // The Wiki's payload for Ground Slam is a cripple, not a movement slow. There
  // was no attackSpeed stat to bind it to when this spell was written; there is
  // now, so it lands as well as the slow.
  it('cripples the attack speed of everyone it slows', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = unit(game, RADIUS - 10, 'red');
    game.objectManager.objects.push(owner, enemy);
    game.objectManager.update();
    enemy.stats.attackSpeed.baseValue = 1;

    press(owner).update();

    const cripple = enemy.buffs.find(
      (buff): buff is StatAmp =>
        buff instanceof StatAmp && buff.stackId === 'malphite_e_attack_cripple'
    );
    expect(cripple?.duration).toBe(SLOW_DURATION_MS);

    enemy.updateBuffs();
    expect(enemy.stats.attackSpeed.value).toBeCloseTo(1 - CRIPPLE_PERCENT);
  });

  it('deals damage exactly once even across repeated updates', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = unit(game, RADIUS - 10, 'red');
    game.objectManager.objects.push(owner, enemy);
    game.objectManager.update();
    const takeDamage = vi.spyOn(enemy, 'takeDamage');

    const slam = press(owner);
    slam.update();
    slam.update();
    slam.update();

    expect(takeDamage).toHaveBeenCalledTimes(1);
  });

  it('fades out and removes itself after its lifetime, independent of the caster', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const slam = press(owner);

    vi.stubGlobal('deltaTime', 50);
    for (let elapsed = 0; elapsed < FADE_MS - 50; elapsed += 50) slam.update();
    expect(slam.toRemove).toBe(false);

    slam.update();
    expect(slam.toRemove).toBe(true);
  });

  it('draws a procedural shockwave rather than blitting the ability icon', () => {
    const draw = stubDrawGlobals();
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const slam = new Malphite_E_Object(owner);
    slam.onAdded();
    slam.age = 100;

    slam.draw();

    expect(draw.image).not.toHaveBeenCalled();
    expect(draw.circle).toHaveBeenCalled();
    expect(draw.line).toHaveBeenCalled();
    expect(draw.triangle).toHaveBeenCalled();
  });

  it('sizes its display bounding box to cover the full slam radius so it cannot be culled', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const slam = new Malphite_E_Object(owner);

    const box = slam.getDisplayBoundingBox();
    const expectedRadius = RADIUS + 30;

    expect(box).toMatchObject({
      x: slam.position.x - expectedRadius,
      y: slam.position.y - expectedRadius,
      w: expectedRadius * 2,
      h: expectedRadius * 2,
    });

    game.objectManager.addObject(slam);
    game.objectManager.update();
    const visible = game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      area: game.camera.getBoundingBox(),
    });
    expect(visible).toContain(slam);
  });
});
