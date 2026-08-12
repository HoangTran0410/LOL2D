import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomingMissileSpellObject, {
  type HomingTarget,
} from '../../../src/game/gameObject/spellObjects/HomingMissileSpellObject';
import MissileSpellObject from '../../../src/game/gameObject/MissileSpellObject';
import type TrailSystem from '../../../src/game/gameObject/helpers/TrailSystem';

class TestVector {
  constructor(public x = 0, public y = 0) {}

  copy() { return new TestVector(this.x, this.y); }
  add(value: TestVector) { this.x += value.x; this.y += value.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(value: number) {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector) { return Math.hypot(this.x - value.x, this.y - value.y); }
  static sub(a: TestVector, b: TestVector) { return new TestVector(a.x - b.x, a.y - b.y); }
}

type TestTarget = HomingTarget;

class TestHomingMissile extends HomingMissileSpellObject<TestTarget> {
  speed = 5;
  size = 4;
  arrived: TestTarget[] = [];

  onTargetArrive(target: TestTarget): void {
    this.arrived.push(target);
  }
}

class TerminalMissile extends MissileSpellObject {
  speed = 5;
  arrivals = 0;
  afterMoves = 0;

  onArrive(): void { this.arrivals += 1; }
  onAfterMove(): void { this.afterMoves += 1; }
}

class CollisionCheckingHomingMissile extends TestHomingMissile {
  maxHitCount = Infinity;
}

const vector = (x: number, y: number): p5.Vector => new TestVector(x, y) as unknown as p5.Vector;

const owner = (queryObjects = () => []) => ({
  game: { objectManager: { queryObjects } },
  position: vector(0, 0),
  teamId: 'blue',
});

const target = (x: number, collisionRadius = 0): TestTarget => ({
  position: new TestVector(x, 0) as unknown as p5.Vector,
  collisionRadius,
});

describe('HomingMissileSpellObject', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('homes toward the target current position each update', () => {
    const missileTarget = target(10);
    const missile = new TestHomingMissile(owner(), missileTarget);

    missile.update();
    missileTarget.position.x = 20;
    missile.update();

    expect(missile.position.x).toBe(10);
    expect(missile.arrived).toEqual([]);
  });

  it('arrives when a movement segment crosses the target radius', () => {
    const missileTarget = target(5, 1);
    const missile = new TestHomingMissile(owner(), missileTarget);
    missile.speed = 10;

    missile.update();

    expect(missile.arrived).toEqual([missileTarget]);
    expect(missile.toRemove).toBe(true);
  });

  it('does not query generic collision targets in flight', () => {
    const queryObjects = vi.fn(() => []);
    const missile = new TestHomingMissile(owner(queryObjects), target(20));

    missile.update();

    expect(queryObjects).not.toHaveBeenCalled();
  });

  it('arrives once and applies its payload once', () => {
    const missileTarget = target(10, 3);
    const missile = new TestHomingMissile(owner(), missileTarget);

    missile.update();
    missile.update();

    expect(missile.arrived).toEqual([missileTarget]);
    expect(missile.toRemove).toBe(true);
  });

  it('preserves ordinary missile strict-step arrival and terminal hooks', () => {
    const queryObjects = vi.fn(() => []);
    const missile = new TerminalMissile(owner(queryObjects));
    const addTrail = vi.fn();
    missile.destination = vector(10, 0);
    missile.trailSystem = { addTrail } as unknown as TrailSystem;

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
    const queryObjects = vi.fn(() => []);
    const missile = new CollisionCheckingHomingMissile(owner(queryObjects), target(10, 3));

    missile.update();

    expect(missile.arrived).toHaveLength(1);
    expect(queryObjects).not.toHaveBeenCalled();
  });

  it('removes itself when a target becomes invalid under remove policy', () => {
    const missileTarget = { ...target(20), isDead: true };
    const missile = new TestHomingMissile(owner(), missileTarget);

    missile.update();

    expect(missile.toRemove).toBe(true);
    expect(missile.position.x).toBe(0);
  });

  it('continues toward the last position under continue policy', () => {
    const missileTarget = target(20, 3);
    const missile = new TestHomingMissile(owner(), missileTarget);
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
