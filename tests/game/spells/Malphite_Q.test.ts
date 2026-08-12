import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { getAsset: () => undefined },
}));

import Malphite_Q, { Malphite_Q_Object } from '../../../src/game/gameObject/spells/Malphite_Q';
import HomingMissileSpellObject from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Speedup from '../../../src/game/gameObject/buffs/Speedup';
import TargetResolver from '../../../src/game/spell/targeting/TargetResolver';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import type { StatsModifier } from '../../../src/game/gameObject/Stats';

class TestVector {
  constructor(public x = 0, public y = 0) {}

  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  add(value: TestVector) { this.x += value.x; this.y += value.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(value: number) {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector) { return Math.hypot(this.x - value.x, this.y - value.y); }
  static add(a: TestVector, b: TestVector) { return a.copy().add(b); }
  static sub(a: TestVector, b: TestVector) { return new TestVector(a.x - b.x, a.y - b.y); }
}

const vector = (x: number, y: number): p5.Vector => new TestVector(x, y) as unknown as p5.Vector;

const speedStats = (base = 10) => {
  let percentBaseBonus = 0;
  let flatBonus = 0;
  const speed = {
    get value() { return base * (1 + percentBaseBonus) + flatBonus; },
  };
  return {
    speed,
    addModifier(modifier: StatsModifier) {
      percentBaseBonus += modifier.speed.percentBaseBonus;
      flatBonus += modifier.speed.flatBonus;
    },
    removeModifier(modifier: StatsModifier) {
      percentBaseBonus -= modifier.speed.percentBaseBonus;
      flatBonus -= modifier.speed.flatBonus;
    },
  };
};

const unit = (x: number, teamId: string, speed = 10) => {
  const stats = speedStats(speed);
  const buffs: unknown[] = [];
  const result = {
    position: vector(x, 0),
    collisionRadius: 1,
    teamId,
    isDead: false,
    canCast: true,
    toRemove: false,
    willDraw: true,
    targetable: true,
    stats: {
      ...stats,
      mana: { value: 100 },
      health: { value: 100 },
    },
    animatedValues: { displaySize: 20 },
    game: undefined as unknown,
    buffs,
    takeDamage: vi.fn(),
    addBuff: vi.fn((buff: Slow | Speedup) => {
      buffs.push(buff);
      buff.activateBuff();
    }),
  };
  return result;
};

const gameFor = () => {
  const objects: unknown[] = [];
  return {
    worldMouse: vector(0, 0),
    eventManager: { emit: vi.fn() },
    objectManager: {
      objects,
      addObject: vi.fn((object: unknown) => { objects.push(object); }),
      queryObjects: vi.fn(() => []),
    },
    objects,
  };
};

const castContext = (
  owner: ReturnType<typeof unit>,
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

const launch = (owner: ReturnType<typeof unit>, target: ReturnType<typeof unit>) => {
  const spell = new Malphite_Q(owner);
  expect(spell.press(castContext(owner, target))).toBe(true);
  spell.update();
  return owner.game.objects[0] as Malphite_Q_Object;
};

const arrive = (missile: Malphite_Q_Object) => {
  for (let i = 0; i < 100 && !missile.toRemove; i++) missile.update();
};

describe('Malphite Q', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requires a valid enemy unit target in range', () => {
    const owner = unit(0, 'blue');
    owner.game = gameFor();
    const target = unit(100, 'red');
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
    const ally = unit(100, 'blue');
    const outOfRange = unit(501, 'red');

    expect(resolution).toMatchObject({ ok: true, context: { target } });
    expect(spell.press(castContext(owner))).toBe(false);
    owner.game.objectManager.objects.push(target);
    expect(new Malphite_Q(owner).press(castContext(owner))).toBe(false);
    expect(new Malphite_Q(owner).press(castContext(owner, undefined, target.position))).toBe(true);
    expect(new Malphite_Q(owner).press(castContext(owner, ally))).toBe(false);
    expect(new Malphite_Q(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('rejects unseen targets and cancels when the target leaves sight during cast time', () => {
    const owner = unit(0, 'blue');
    owner.game = gameFor();
    const unseen = unit(100, 'red');
    unseen.willDraw = false;

    expect(new Malphite_Q(owner).press(castContext(owner, unseen))).toBe(false);

    const target = unit(100, 'red');
    const spell = new Malphite_Q(owner);
    const onCancel = vi.spyOn(spell, 'onCancel');
    expect(spell.press(castContext(owner, target))).toBe(true);
    target.willDraw = false;

    spell.update();

    expect(onCancel).toHaveBeenCalledWith(expect.anything(), 'TARGET_INVALID');
    expect(spell.state).toBe('READY');
    expect(owner.stats.mana.value).toBe(100);
    expect(owner.game.objects).toEqual([]);
  });

  it('spawns the shard 100 units toward the selected target', () => {
    const owner = unit(0, 'blue');
    owner.game = gameFor();
    const target = unit(300, 'red');

    const missile = launch(owner, target);

    expect(missile.position).toMatchObject({ x: 100, y: 0 });
  });

  it('follows the selected target instead of the cursor line', () => {
    const owner = unit(0, 'blue');
    owner.game = gameFor();
    const target = unit(20, 'red');
    const missile = launch(owner, target);
    target.position.set(40, 0);

    arrive(missile);

    expect(missile).toBeInstanceOf(HomingMissileSpellObject);
    expect(missile.destination).toMatchObject({ x: 40, y: 0 });
  });

  it('damages and slows only the selected target on arrival', () => {
    const owner = unit(0, 'blue');
    owner.game = gameFor();
    const target = unit(10, 'red', 100);
    const bystander = unit(10, 'red');
    const missile = launch(owner, target);

    arrive(missile);

    expect(target.takeDamage).toHaveBeenCalledWith(20, owner);
    expect(target.addBuff).toHaveBeenCalledWith(expect.any(Slow));
    expect(bystander.takeDamage).not.toHaveBeenCalled();
    expect(bystander.addBuff).not.toHaveBeenCalled();
  });

  it('steals the researched movement speed amount for the researched duration', () => {
    const owner = unit(0, 'blue', 10);
    owner.game = gameFor();
    const target = unit(10, 'red', 100);
    const missile = launch(owner, target);

    arrive(missile);

    const slow = target.buffs.find(buff => buff instanceof Slow) as Slow;
    const speedup = owner.buffs.find(buff => buff instanceof Speedup) as Speedup;
    expect(slow.duration).toBe(3000);
    expect(speedup.duration).toBe(3000);
    expect(owner.stats.speed.value).toBe(45);
  });

  it('applies arrival payload once and handles an invalidated target', () => {
    const owner = unit(0, 'blue');
    owner.game = gameFor();
    const target = unit(10, 'red');
    const missile = launch(owner, target);

    arrive(missile);
    missile.update();

    expect(target.takeDamage).toHaveBeenCalledTimes(1);

    const invalidTarget = unit(30, 'red');
    const invalidMissile = launch(owner, invalidTarget);
    invalidTarget.isDead = true;
    invalidMissile.update();

    expect(invalidMissile.toRemove).toBe(true);
    expect(invalidTarget.takeDamage).not.toHaveBeenCalled();
  });
});
