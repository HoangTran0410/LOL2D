import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECTILE_SPEED,
  predictAim,
  targetVelocity,
  type Movable,
} from '../../../src/game/ai/AimPredictor';

const unit = (
  position: { x: number; y: number },
  destination: { x: number; y: number },
  moveSpeed: number
): Movable => ({ position, destination, moveSpeed });

describe('targetVelocity()', () => {
  it('is the step toward the destination, one frame long', () => {
    // destination is 100px east, speed 5 -> the next frame moves (5, 0)
    expect(targetVelocity(unit({ x: 0, y: 0 }, { x: 100, y: 0 }, 5))).toEqual({ x: 5, y: 0 });
  });

  it('is zero once the target is within one step of arriving', () => {
    // 2px left to travel at 5px/frame: it stops this frame, it is not moving
    expect(targetVelocity(unit({ x: 0, y: 0 }, { x: 2, y: 0 }, 5))).toEqual({ x: 0, y: 0 });
  });

  it('is zero for a target standing on its own destination', () => {
    expect(targetVelocity(unit({ x: 40, y: 40 }, { x: 40, y: 40 }, 5))).toEqual({ x: 0, y: 0 });
  });
});

describe('predictAim()', () => {
  const noError = { aimErrorPx: 0, rng: () => 0 };

  it('leads a moving target by flight time', () => {
    // distance 280, projectile 7px/frame -> 280/7 = 40 frames of flight.
    // target moves north at 5px/frame -> 5 * 40 = 200px of lead.
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 280, y: 0 }, { x: 280, y: 1000 }, 5), {
      leadFactor: 1,
      projectileSpeed: 7,
      ...noError,
    });
    expect(aim.x).toBeCloseTo(280, 6);
    expect(aim.y).toBeCloseTo(200, 6);
  });

  it('halves the lead at leadFactor 0.5', () => {
    // same 40 frames * 5px/frame = 200, halved by hand = 100
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 280, y: 0 }, { x: 280, y: 1000 }, 5), {
      leadFactor: 0.5,
      projectileSpeed: 7,
      ...noError,
    });
    expect(aim.y).toBeCloseTo(100, 6);
  });

  it('aims straight at a stationary target however high the lead factor', () => {
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 300, y: 0 }, { x: 300, y: 0 }, 5), {
      leadFactor: 1,
      projectileSpeed: 7,
      ...noError,
    });
    expect(aim).toEqual({ x: 300, y: 0 });
  });

  it('aims straight at leadFactor 0 — this is what makes easy bots dodgeable', () => {
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 280, y: 0 }, { x: 280, y: 1000 }, 5), {
      leadFactor: 0,
      projectileSpeed: 7,
      ...noError,
    });
    expect(aim).toEqual({ x: 280, y: 0 });
  });

  it('scatters by the error radius', () => {
    // rng() === 0.5 -> angle = 0.5 * 2PI = PI, radius = 0.5 * 40 = 20.
    // offset = (cos PI, sin PI) * 20 = (-20, 0). 100 - 20 = 80, by hand.
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 100, y: 0 }, { x: 100, y: 0 }, 5), {
      leadFactor: 1,
      projectileSpeed: 7,
      aimErrorPx: 40,
      rng: () => 0.5,
    });
    expect(aim.x).toBeCloseTo(80, 6);
    expect(aim.y).toBeCloseTo(0, 6);
  });

  it('clamps to maxRange, and clamps after the error so error cannot push it out', () => {
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 100, y: 0 }, { x: 100, y: 0 }, 5), {
      leadFactor: 1,
      projectileSpeed: 7,
      aimErrorPx: 0,
      rng: () => 0,
      maxRange: 60,
    });
    expect(aim.x).toBeCloseTo(60, 6);
    expect(aim.y).toBeCloseTo(0, 6);
  });

  it('leaves a point already inside maxRange alone', () => {
    const aim = predictAim({ x: 0, y: 0 }, unit({ x: 100, y: 0 }, { x: 100, y: 0 }, 5), {
      leadFactor: 1,
      projectileSpeed: 7,
      ...noError,
      maxRange: 500,
    });
    expect(aim.x).toBeCloseTo(100, 6);
  });

  it('never returns the origin itself, so direction is never (0,0)', () => {
    // A target standing on the caster: the aim must still be a distinct point,
    // or every consumer multiplies a zero vector by a range and paints nothing.
    const aim = predictAim({ x: 50, y: 50 }, unit({ x: 50, y: 50 }, { x: 50, y: 50 }, 5), {
      leadFactor: 1,
      projectileSpeed: 7,
      ...noError,
    });
    expect(aim.x === 50 && aim.y === 50).toBe(false);
  });

  it('defaults to the missile speed the engine actually uses', () => {
    expect(DEFAULT_PROJECTILE_SPEED).toBe(7);
  });
});
