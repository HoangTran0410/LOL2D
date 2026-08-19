import { describe, expect, it } from 'vitest';
import {
  clampToSafeApproach,
  escapePoint,
  insideThreat,
  turretReach,
  type TurretThreatSource,
} from '../../../src/game/ai/TurretThreat';

/**
 * Every expected value here is arithmetic written out by hand, never a second
 * call to the function under test — a transform asked to verify itself agrees
 * with itself however wrong it is (CLAUDE.md).
 *
 * The numbers are chosen so the arithmetic is exact: a turret whose
 * `attackRange` is 400 against a 60-unit body (radius 30) reaches 430, and the
 * keep-out clearance of 60 puts the ring a bot may not cross at 490.
 */
const tower = (x: number, y: number, attackRange = 400): TurretThreatSource => ({
  position: { x, y },
  attackRange,
});

const BODY = 30;
const CLEAR = 60;

describe('turretReach', () => {
  it('is the turret reach plus the body it would have to hit', () => {
    expect(turretReach(tower(0, 0), BODY)).toBe(430);
  });

  it('is the bare attack range for a point body', () => {
    expect(turretReach(tower(0, 0), 0)).toBe(400);
  });
});

describe('insideThreat', () => {
  it('is true one pixel inside the reach and false one pixel outside', () => {
    // 430 is the reach; 429 is in the guns and 431 is not.
    expect(insideThreat(tower(0, 0), { x: 429, y: 0 }, BODY)).toBe(true);
    expect(insideThreat(tower(0, 0), { x: 431, y: 0 }, BODY)).toBe(false);
  });

  it('measures from the turret centre in any direction', () => {
    // 3-4-5: (258, 344) is exactly 430 from the origin, so 429.x is inside.
    expect(insideThreat(tower(0, 0), { x: 258, y: 344 }, BODY)).toBe(false);
    expect(insideThreat(tower(0, 0), { x: 257, y: 343 }, BODY)).toBe(true);
  });

  it('ignores a turret that is dead or leaving', () => {
    expect(insideThreat({ ...tower(0, 0), isDead: true }, { x: 0, y: 0 }, BODY)).toBe(false);
    expect(insideThreat({ ...tower(0, 0), toRemove: true }, { x: 0, y: 0 }, BODY)).toBe(false);
  });
});

describe('escapePoint', () => {
  it('is the clearance ring, on the ray from the turret through the body', () => {
    // Turret at 1000,0 with reach 430 and 60 of clearance: the ring is at 490,
    // and the body at 700,0 is on the turret's -x side, so 1000 - 490 = 510.
    expect(escapePoint(tower(1_000, 0), { x: 700, y: 0 }, BODY, CLEAR)).toEqual({ x: 510, y: 0 });
  });

  it('never returns the turret itself when the body is standing on it', () => {
    // A direction must never be (0,0) — the convention Game.facing() states.
    // The fallback is +x, so the point is 1000 + 490.
    expect(escapePoint(tower(1_000, 0), { x: 1_000, y: 0 }, BODY, CLEAR)).toEqual({
      x: 1_490,
      y: 0,
    });
  });
});

describe('clampToSafeApproach', () => {
  const towers = (...list: TurretThreatSource[]) => list;

  it('stops the order at the ring rather than walking through it', () => {
    // From the origin at the turret at 1000,0: the ring of 490 is first met at
    // x = 1000 - 490 = 510. `toBeCloseTo`, not `toEqual`: the entry point comes
    // out of a square root, so the last bit or two of the mantissa is noise.
    const held = clampToSafeApproach(
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      towers(tower(1_000, 0)),
      BODY,
      CLEAR
    );
    expect(held.x).toBeCloseTo(510, 6);
    expect(held.y).toBeCloseTo(0, 6);
  });

  it('leaves an order that never enters a ring alone', () => {
    // The closest the segment (0,0)->(0,1000) comes to the turret at 1000,0 is
    // 1000, which is well outside 490.
    expect(
      clampToSafeApproach({ x: 0, y: 0 }, { x: 0, y: 1_000 }, towers(tower(1_000, 0)), BODY, CLEAR)
    ).toEqual({ x: 0, y: 1_000 });
  });

  it('clamps to the nearest ring when two lie on the path', () => {
    // Listed far-first, so a version that kept the last hit rather than the
    // earliest would answer 1510 and walk the bot into the near one.
    const held = clampToSafeApproach(
      { x: 0, y: 0 },
      { x: 3_000, y: 0 },
      towers(tower(2_000, 0), tower(1_000, 0)),
      BODY,
      CLEAR
    );
    expect(held.x).toBeCloseTo(510, 6);
    expect(held.y).toBeCloseTo(0, 6);
  });

  it('ignores a turret the body is already inside', () => {
    // Otherwise the clamp lands on t=0 and a bot dragged under a turret is
    // pinned there by its own safety rule. Walking back out is DISENGAGE's job.
    expect(
      clampToSafeApproach(
        { x: 1_000, y: 100 },
        { x: 1_000, y: 0 },
        towers(tower(1_000, 0)),
        BODY,
        CLEAR
      )
    ).toEqual({ x: 1_000, y: 0 });
  });

  it('refuses the step when the body is standing on the ring', () => {
    // The shipped bug, at its smallest. `escapePoint` and this clamp share the
    // 490 ring, so the clamp's own answer parks the body exactly on it — and
    // the entry root there is exactly 0, which used to be discarded as "no
    // crossing". The body walked on in, DISENGAGE walked it back to 490, and it
    // did that four times a second for as long as anyone watched.
    expect(
      clampToSafeApproach({ x: 490, y: 0 }, { x: 0, y: 0 }, towers(tower(0, 0)), BODY, CLEAR)
    ).toEqual({ x: 490, y: 0 });
  });

  it('refuses the step from inside the keep-out band too', () => {
    // 460 is past the 430 guns and short of the 490 ring: outside anything that
    // shoots, inside the margin. Skipping on the outer radius handed this whole
    // band to no rule at all.
    const held = clampToSafeApproach(
      { x: 460, y: 0 },
      { x: 0, y: 0 },
      towers(tower(0, 0)),
      BODY,
      CLEAR
    );
    expect(held.x).toBeCloseTo(460, 6);
    expect(held.y).toBeCloseTo(0, 6);
  });

  it('still lets a body in the band walk away from the turret', () => {
    // The refusal is directional, or a bot that drifted into the margin would
    // be pinned in it — which is the very thing the skip was written to avoid.
    expect(
      clampToSafeApproach({ x: 460, y: 0 }, { x: 2_000, y: 0 }, towers(tower(0, 0)), BODY, CLEAR)
    ).toEqual({ x: 2_000, y: 0 });
  });

  it('ignores a dead turret', () => {
    expect(
      clampToSafeApproach(
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
        towers({ ...tower(1_000, 0), isDead: true }),
        BODY,
        CLEAR
      )
    ).toEqual({ x: 1_000, y: 0 });
  });

  it('returns the destination unchanged when there are no turrets', () => {
    expect(clampToSafeApproach({ x: 0, y: 0 }, { x: 9, y: 9 }, [], BODY, CLEAR)).toEqual({
      x: 9,
      y: 9,
    });
  });
});
