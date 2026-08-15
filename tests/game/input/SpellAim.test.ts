import { describe, expect, it, vi } from 'vitest';
import {
  BLIND_POINT_FRACTION,
  DEFAULT_TOUCH_AIM_RANGE,
  UNIT_SNAP_RADIUS,
  resolveSpellAim,
  touchAimRange,
  type SpellAimInput,
} from '../../../src/game/input/SpellAim';
import type { TargetingMode } from '../../../src/game/spell/runtime/types';

const ORIGIN = { x: 1000, y: 1000 };
const RANGE = 800;

const aim = (mode: TargetingMode, over: Partial<SpellAimInput> = {}) =>
  resolveSpellAim({
    mode,
    origin: ORIGIN,
    range: RANGE,
    drag: null,
    dragToRange: 60,
    facing: { x: 1, y: 0 },
    autoTarget: null,
    ...over,
  });

describe('resolveSpellAim — DIRECTION', () => {
  it('fires along the drag, at the spell’s own range', () => {
    const result = aim('DIRECTION', { drag: { x: 0, y: -40 } });

    expect(result.direction.x).toBeCloseTo(0, 6);
    expect(result.direction.y).toBeCloseTo(-1, 6);
    expect(result.distance).toBeCloseTo(RANGE, 6);
    expect(result.cursorWorld).toEqual({ x: 1000, y: 1000 - RANGE });
    expect(result.manual).toBe(true);
  });

  it('ignores how far the drag went — direction is all a thumb can say', () => {
    const short = aim('DIRECTION', { drag: { x: 12, y: 0 } });
    const long = aim('DIRECTION', { drag: { x: 500, y: 0 } });

    expect(short.cursorWorld).toEqual(long.cursorWorld);
  });

  it('aims a tap at the auto-picked victim', () => {
    const result = aim('DIRECTION', { autoTarget: { position: { x: 1000, y: 1400 } } });

    expect(result.direction.y).toBeCloseTo(1, 6);
    expect(result.distance).toBeCloseTo(RANGE, 6);
    expect(result.manual).toBe(false);
    expect(result.target).not.toBeNull();
  });

  it('falls back to the champion’s facing when a tap has nothing to hit', () => {
    const result = aim('DIRECTION', { facing: { x: -1, y: 0 } });

    expect(result.cursorWorld).toEqual({ x: 1000 - RANGE, y: 1000 });
    expect(result.target).toBeNull();
  });
});

describe('resolveSpellAim — POINT', () => {
  it('maps the drag’s length onto the range', () => {
    const half = aim('POINT', { drag: { x: 30, y: 0 } }); // 30 of 60 screen px

    expect(half.distance).toBeCloseTo(RANGE / 2, 6);
    expect(half.cursorWorld.x).toBeCloseTo(1000 + RANGE / 2, 6);
  });

  it('clamps at the edge of the range however far the thumb travels', () => {
    const result = aim('POINT', { drag: { x: 600, y: 0 } });

    expect(result.distance).toBeCloseTo(RANGE, 6);
  });

  it('drops a tap on the auto-picked victim', () => {
    const result = aim('POINT', { autoTarget: { position: { x: 1300, y: 1000 } } });

    expect(result.cursorWorld.x).toBeCloseTo(1300, 6);
    expect(result.cursorWorld.y).toBeCloseTo(1000, 6);
  });

  it('pulls a victim beyond the range back to the edge rather than failing', () => {
    const result = aim('POINT', { autoTarget: { position: { x: 1000 + RANGE * 4, y: 1000 } } });

    expect(result.distance).toBeCloseTo(RANGE, 6);
  });

  it('places a blind tap short of the range, in front of the champion', () => {
    const result = aim('POINT', { facing: { x: 0, y: 1 } });

    expect(result.distance).toBeCloseTo(RANGE * BLIND_POINT_FRACTION, 6);
    expect(result.cursorWorld.y).toBeGreaterThan(ORIGIN.y);
  });
});

describe('resolveSpellAim — UNIT', () => {
  it('snaps the cursor onto the body the drag points at', () => {
    const victim = { position: { x: 1400, y: 1000 } };
    const pickUnitNear = vi.fn(() => victim);
    const result = aim('UNIT', { drag: { x: 40, y: 0 }, pickUnitNear });

    // The cursor lands *on* the body: TargetResolver's UNIT branch only
    // accepts a cursor inside a candidate's selection radius.
    expect(result.cursorWorld).toEqual(victim.position);
    expect(result.target).toBe(victim);
    expect(pickUnitNear).toHaveBeenCalled();
  });

  it('searches the full aim ray even after a short deliberate drag', () => {
    const pickUnitNear = vi.fn(() => null);

    aim('UNIT', { drag: { x: 20, y: 0 }, pickUnitNear });

    expect(pickUnitNear).toHaveBeenCalledWith(
      { x: ORIGIN.x + RANGE, y: ORIGIN.y },
      UNIT_SNAP_RADIUS,
      null
    );
  });

  it('hands the previous lock back to acquisition so close targets do not flicker', () => {
    const lockedTarget = { position: { x: 1500, y: 1010 } };
    const pickUnitNear = vi.fn(() => lockedTarget);

    const result = aim('UNIT', {
      drag: { x: 30, y: 1 },
      lockedTarget,
      pickUnitNear,
    });

    expect(pickUnitNear).toHaveBeenCalledWith(expect.any(Object), UNIT_SNAP_RADIUS, lockedTarget);
    expect(result.target).toBe(lockedTarget);
  });

  it('leaves the cursor on the drag when the drag finds nobody', () => {
    const result = aim('UNIT', { drag: { x: 60, y: 0 }, pickUnitNear: () => null });

    expect(result.target).toBeNull();
    expect(result.cursorWorld.x).toBeGreaterThan(ORIGIN.x);
  });

  it('takes the auto-picked victim on a tap', () => {
    const victim = { position: { x: 900, y: 1200 } };
    const result = aim('UNIT', { autoTarget: victim });

    expect(result.cursorWorld).toEqual(victim.position);
    expect(result.target).toBe(victim);
  });

  it('returns the champion itself when a tap has nobody, so the cast is refused', () => {
    const result = aim('UNIT');

    expect(result.cursorWorld).toEqual(ORIGIN);
    expect(result.target).toBeNull();
  });
});

describe('resolveSpellAim — SELF', () => {
  it('is the champion, drag or no drag', () => {
    expect(aim('SELF').cursorWorld).toEqual(ORIGIN);
    expect(aim('SELF', { drag: { x: 90, y: 90 } }).cursorWorld).toEqual(ORIGIN);
  });
});

describe('touchAimRange', () => {
  it('prefers the range the targeting request declares', () => {
    expect(touchAimRange({ targetingRequest: { range: 525 }, range: 100 })).toBe(525);
  });

  it('falls back to the spell’s own range field', () => {
    expect(touchAimRange({ range: 350 })).toBe(350);
  });

  it('then to castRange, and finally to a default', () => {
    expect(touchAimRange({ castRange: 320 })).toBe(320);
    expect(touchAimRange({})).toBe(DEFAULT_TOUCH_AIM_RANGE);
    expect(touchAimRange(null)).toBe(DEFAULT_TOUCH_AIM_RANGE);
  });

  it('ignores a nonsense range rather than drawing a zero-length telegraph', () => {
    expect(touchAimRange({ range: 0 })).toBe(DEFAULT_TOUCH_AIM_RANGE);
  });
});
