import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import Chilled from '../../../src/game/gameObject/buffs/Chilled';
import HomingMissileSpellObject from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { BASE_DAMAGE, CHILLED_DAMAGE, MISSILE_SPEED, RANGE, SPAWN_OFFSET_DISTANCE } from '../../../packs/riot/spells/Anivia_E';
import makeAnivia_E, { makeAnivia_E_Bolt } from '../../../packs/riot/spells/Anivia_E';
const __api = buildContentApi();
const Anivia_E = makeAnivia_E(__api);
const Anivia_E_Bolt = makeAnivia_E_Bolt(__api);

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
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
    spellId: 'anivia-e',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 0, y: 1 }),
    ...(target === undefined ? {} : { target }),
  });

function launch(owner: AttackableUnit, target: AttackableUnit): Anivia_E_Bolt {
  const spell = new Anivia_E(owner);
  expect(spell.press(castContext(owner, target))).toBe(true);
  spell.update();
  const bolt = owner.game.objectManager._objectToBeAdd.find(
    (object): object is Anivia_E_Bolt => object instanceof Anivia_E_Bolt
  );
  if (!bolt) throw new Error('Anivia E must create its bolt.');
  return bolt;
}

function arrive(bolt: Anivia_E_Bolt): void {
  for (let i = 0; i < 200 && !bolt.toRemove; i++) bolt.update();
}

describe('Anivia E', () => {
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
    const ally = unit(game, 100, 'blue');
    const outOfRange = unit(game, RANGE + 1, 'red');

    expect(new Anivia_E(owner).press(castContext(owner))).toBe(false);
    expect(new Anivia_E(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Anivia_E(owner).press(castContext(owner, outOfRange))).toBe(false);
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

  it('deals base damage to a target that is not Chilled', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const bolt = launch(owner, target);

    arrive(bolt);

    expect(takeDamage).toHaveBeenCalledWith(BASE_DAMAGE, owner);
  });

  it('doubles its damage against a target already Chilled', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    target.addBuff(new Chilled(3_000, owner, target));
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const bolt = launch(owner, target);

    arrive(bolt);

    expect(takeDamage).toHaveBeenCalledWith(CHILLED_DAMAGE, owner);
    expect(CHILLED_DAMAGE).toBe(BASE_DAMAGE * 2);
  });

  it('does not double damage once the Chilled mark has expired', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const chill = new Chilled(1_000, owner, target);
    target.addBuff(chill);
    chill.update();
    chill.update();
    chill.update();
    chill.update();
    chill.update(); // 5 * 250ms = 1250ms, past the 1000ms mark
    target.updateBuffs(); // drops toRemove buffs from target.buffs, as the unit's own update loop does
    expect(target.hasBuff(Chilled)).toBe(false);
    const takeDamage = vi.spyOn(target, 'takeDamage');

    const bolt = launch(owner, target);
    arrive(bolt);

    expect(takeDamage).toHaveBeenCalledWith(BASE_DAMAGE, owner);
  });

  it('applies its arrival payload exactly once', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 10, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');
    const bolt = launch(owner, target);

    arrive(bolt);
    bolt.update();

    expect(takeDamage).toHaveBeenCalledTimes(1);
  });

  it('draws a procedural icicle rather than blitting the ability icon', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const target = unit(game, 300, 'red');
    const spies = {
      image: vi.fn(),
      beginShape: vi.fn(),
      vertex: vi.fn(),
      endShape: vi.fn(),
      triangle: vi.fn(),
      line: vi.fn(),
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
      'noStroke',
      'strokeWeight',
      'strokeCap',
    ]) {
      vi.stubGlobal(name, vi.fn());
    }
    for (const name of ['ADD', 'BLEND', 'CLOSE', 'SQUARE', 'ROUND']) vi.stubGlobal(name, name);
    const bolt = launch(owner, target);

    bolt.draw();

    expect(spies.image).not.toHaveBeenCalled();
    expect(spies.beginShape).toHaveBeenCalledTimes(1);
    expect(spies.endShape).toHaveBeenCalledTimes(1);
  });
});
