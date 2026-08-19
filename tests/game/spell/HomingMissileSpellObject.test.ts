import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomingMissileSpellObject from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import MissileSpellObject from '../../../src/game/gameObject/MissileSpellObject';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import TrailSystem from '../../../src/game/gameObject/helpers/TrailSystem';
import { createGame, createUnit, installSpellObjectGlobals, type TestGame } from './fixtures';

class TestHomingMissile extends HomingMissileSpellObject {
  speed = 5;
  size = 4;
  arrived: AttackableUnit[] = [];

  onTargetArrive(target: AttackableUnit): void {
    this.arrived.push(target);
  }
}

class TerminalMissile extends MissileSpellObject {
  speed = 5;
  arrivals = 0;
  afterMoves = 0;

  onArrive(): void {
    this.arrivals += 1;
  }
  onAfterMove(): void {
    this.afterMoves += 1;
  }
}

class CollisionCheckingHomingMissile extends TestHomingMissile {
  maxHitCount = Infinity;
}

function target(game: TestGame, x: number, collisionRadius = 0): AttackableUnit {
  const unit = createUnit(game, x, 'red');
  unit.collisionRadius = collisionRadius;
  return unit;
}

describe('HomingMissileSpellObject', () => {
  beforeEach(installSpellObjectGlobals);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws a ready missile sprite at visual dimensions independent from collision size', () => {
    const missile = new TerminalMissile(createUnit(createGame()));
    const drawImage = vi.fn();
    Object.assign(missile, {
      image: { status: 'ready', data: { id: 'arrow' }, key: 'spell_varus_q', url: '', path: '' },
      visualWidth: 80,
      visualHeight: 28,
      size: 32,
      destination: createVector(10, 0),
    });
    vi.stubGlobal('push', vi.fn());
    vi.stubGlobal('pop', vi.fn());
    vi.stubGlobal('translate', vi.fn());
    vi.stubGlobal('rotate', vi.fn());
    vi.stubGlobal('imageMode', vi.fn());
    vi.stubGlobal('CENTER', 'center');
    vi.stubGlobal('image', drawImage);

    missile.draw();

    expect(drawImage).toHaveBeenCalledWith({ id: 'arrow' }, 0, 0, 80, 28);
    expect(missile.size).toBe(32);
  });

  it('draws a fallback shaft while a missile asset is loading', () => {
    const missile = new TerminalMissile(createUnit(createGame()));
    const drawLine = vi.fn();
    Object.assign(missile, {
      image: { status: 'loading', data: null, key: 'spell_varus_q', url: '', path: '' },
      visualWidth: 80,
      visualHeight: 28,
      destination: createVector(10, 0),
    });
    for (const name of ['push', 'pop', 'translate', 'rotate', 'stroke', 'strokeWeight']) {
      vi.stubGlobal(name, vi.fn());
    }
    vi.stubGlobal('line', drawLine);

    missile.draw();

    expect(drawLine).toHaveBeenCalledWith(-40, 0, 40, 0);
  });

  it('homes toward the target current position each update', () => {
    const game = createGame();
    const missileTarget = target(game, 10);
    const missile = new TestHomingMissile(createUnit(game), missileTarget);

    missile.update();
    missileTarget.position.x = 20;
    missile.update();

    expect(missile.position.x).toBe(10);
    expect(missile.arrived).toEqual([]);
  });

  it('arrives when a movement segment crosses the target radius', () => {
    const game = createGame();
    const missileTarget = target(game, 5, 1);
    const missile = new TestHomingMissile(createUnit(game), missileTarget);
    missile.speed = 10;

    missile.update();

    expect(missile.arrived).toEqual([missileTarget]);
    expect(missile.toRemove).toBe(true);
  });

  it('does not query generic collision targets in flight', () => {
    const game = createGame();
    const queryObjects = vi.spyOn(game.objectManager, 'queryObjects');
    const missile = new TestHomingMissile(createUnit(game), target(game, 20));

    missile.update();

    expect(queryObjects).not.toHaveBeenCalled();
  });

  it('arrives once and applies its payload once', () => {
    const game = createGame();
    const missileTarget = target(game, 10, 3);
    const missile = new TestHomingMissile(createUnit(game), missileTarget);

    missile.update();
    missile.update();

    expect(missile.arrived).toEqual([missileTarget]);
    expect(missile.toRemove).toBe(true);
  });

  it('preserves ordinary missile strict-step arrival and terminal hooks', () => {
    const game = createGame();
    const queryObjects = vi.spyOn(game.objectManager, 'queryObjects').mockReturnValue([]);
    const missile = new TerminalMissile(createUnit(game));
    const trail = new TrailSystem();
    const addTrail = vi.spyOn(trail, 'addTrail');
    missile.destination = createVector(10, 0);
    missile.trailSystem = trail;

    missile.update();

    expect(missile.arrivals).toBe(0);
    expect(missile.afterMoves).toBe(1);
    expect(addTrail).toHaveBeenCalledTimes(1);
    expect(queryObjects).toHaveBeenCalledTimes(1);

    missile.update();

    expect(missile.arrivals).toBe(1);
    expect(missile.afterMoves).toBe(2);
    expect(addTrail).toHaveBeenCalledTimes(2);
    expect(queryObjects).toHaveBeenCalledTimes(2);
  });

  it('suppresses generic collision after a homing arrival', () => {
    const game = createGame();
    const queryObjects = vi.spyOn(game.objectManager, 'queryObjects').mockReturnValue([]);
    const missile = new CollisionCheckingHomingMissile(createUnit(game), target(game, 10, 3));

    missile.update();

    expect(missile.arrived).toHaveLength(1);
    expect(queryObjects).not.toHaveBeenCalled();
  });

  it('removes itself when a target becomes invalid under remove policy', () => {
    const game = createGame();
    const missileTarget = target(game, 20);
    missileTarget.die({ reviveAfter: 100 });
    const missile = new TestHomingMissile(createUnit(game), missileTarget);

    missile.update();

    expect(missile.toRemove).toBe(true);
    expect(missile.position.x).toBe(0);
  });

  it('continues toward the last position under continue policy', () => {
    const game = createGame();
    const missileTarget = target(game, 20, 3);
    const missile = new TestHomingMissile(createUnit(game), missileTarget);
    missile.targetLossPolicy = 'continue';

    missile.update();
    missileTarget.toRemove = true;
    missile.update();

    expect(missile.position.x).toBe(10);
    expect(missile.destination.x).toBe(20);
    expect(missile.arrived).toEqual([]);
    expect(missile.toRemove).toBe(false);

    missile.update();

    expect(missile.position.x).toBe(15);
    expect(missile.arrived).toEqual([]);
    expect(missile.toRemove).toBe(true);
  });
});
