import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Janna_W, {
  DAMAGE,
  Janna_W_Bolt,
  Janna_W_Passive,
  MISSILE_SPEED,
  PASSIVE_SPEED_PERCENT,
  RANGE,
  SLOW_DURATION_MS,
  SLOW_PERCENT,
  SPAWN_OFFSET_DISTANCE,
} from '../../../src/game/gameObject/spells/Janna_W';
import Janna_E, { notifyJannaControlLanded } from '../../../src/game/gameObject/spells/Janna_E';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import HomingMissileSpellObject from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { createGame, createUnit, installSpellObjectGlobals, type TestGame } from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

function champion(game: TestGame, x: number, teamId: string): Champion {
  const result = new Champion({ game, position: createVector(x, 0), teamId });
  result.collisionRadius = 1;
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
    spellId: 'janna-w',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 0, y: 1 }),
    ...(target === undefined ? {} : { target }),
  });

function launch(owner: AttackableUnit, target: AttackableUnit): Janna_W_Bolt {
  const spell = new Janna_W(owner);
  expect(spell.press(castContext(owner, target))).toBe(true);
  spell.update();
  const bolt = owner.game.objectManager._objectToBeAdd.find(
    (object): object is Janna_W_Bolt => object instanceof Janna_W_Bolt
  );
  if (!bolt) throw new Error('Janna W must create its bolt.');
  return bolt;
}

function arrive(bolt: Janna_W_Bolt): void {
  for (let i = 0; i < 200 && !bolt.toRemove; i++) bolt.update();
}

describe('Janna W', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('grants a permanent ghost and speed passive that survives repeated updates without stacking', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const spell = new Janna_W(owner);

    spell.onUpdate();
    spell.onUpdate();
    spell.onUpdate();

    const passives = owner.buffs.filter((buff): buff is Janna_W_Passive => buff instanceof Janna_W_Passive);
    expect(passives).toHaveLength(1);
    expect(passives[0].statusFlagsToEnable & StatusFlags.Ghosted).toBeTruthy();
    expect(passives[0].bonuses).toEqual({ speed: { percentBaseBonus: PASSIVE_SPEED_PERCENT } });
  });

  it('does not apply the passive while the caster is dead, and reapplies once alive again', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const spell = new Janna_W(owner);
    owner.deathData = { reviveAfter: 5_000 };
    expect(owner.isDead).toBe(true);

    spell.onUpdate();
    expect(owner.hasBuff(Janna_W_Passive)).toBe(false);

    owner.respawn();
    expect(owner.isDead).toBe(false);
    spell.onUpdate();
    expect(owner.hasBuff(Janna_W_Passive)).toBe(true);
  });

  it('rejects an out-of-range or allied target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const ally = unit(game, 100, 'blue');
    const outOfRange = unit(game, RANGE + 1, 'red');

    expect(new Janna_W(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Janna_W(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('spawns the bolt offset toward the selected target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');

    const bolt = launch(owner, target);

    expect(bolt.position).toMatchObject({ x: SPAWN_OFFSET_DISTANCE, y: 0 });
    expect(bolt.speed).toBe(MISSILE_SPEED);
    expect(bolt).toBeInstanceOf(HomingMissileSpellObject);
  });

  it('damages and slows only the selected target on arrival', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const bystander = unit(game, 10, 'red');
    const targetDamage = vi.spyOn(target, 'takeDamage');
    const bystanderDamage = vi.spyOn(bystander, 'takeDamage');
    const bolt = launch(owner, target);

    arrive(bolt);

    expect(targetDamage).toHaveBeenCalledWith(DAMAGE, owner);
    expect(bystanderDamage).not.toHaveBeenCalled();
    const slow = target.buffs.find((buff): buff is Slow => buff instanceof Slow);
    expect(slow).toMatchObject({ percent: SLOW_PERCENT, duration: SLOW_DURATION_MS });
  });

  it('notifies Eye of the Storm when the slow lands on an enemy champion', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const eye = new Janna_E(owner);
    eye.currentCooldown = 10_000;
    owner.spells = [eye];
    const target = champion(game, 10, 'red');
    target.stats.mana.baseValue = 100;
    target.stats.health.baseValue = 100;
    target.stats.maxHealth.baseValue = 100;

    const bolt = launch(owner, target);
    arrive(bolt);

    expect(eye.currentCooldown).toBeLessThan(10_000);
  });

  it('is a no-op against a non-champion target (minions do not trigger the passive)', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const eye = new Janna_E(owner);
    eye.currentCooldown = 10_000;
    owner.spells = [eye];
    const minion = unit(game, 10, 'red');

    expect(() => notifyJannaControlLanded(owner, minion)).not.toThrow();
    expect(eye.currentCooldown).toBe(10_000);
  });

  it('draws a procedural wisp rather than blitting the ability icon', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');
    const spies = { image: vi.fn(), beginShape: vi.fn(), vertex: vi.fn(), endShape: vi.fn(), ellipse: vi.fn(), circle: vi.fn() };
    for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
    for (const name of ['push', 'pop', 'translate', 'rotate', 'fill', 'stroke', 'noStroke', 'strokeWeight']) {
      vi.stubGlobal(name, vi.fn());
    }
    vi.stubGlobal('CLOSE', 'CLOSE');
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);
    const bolt = launch(owner, target);

    bolt.draw();

    expect(spies.image).not.toHaveBeenCalled();
    expect(spies.beginShape).toHaveBeenCalledTimes(1);
    expect(spies.endShape).toHaveBeenCalledTimes(1);
  });
});
