import { describe, expect, it } from 'vitest';
import {
  RENDER_SNAP_PX,
  blend,
  isContinuousStep,
  renderAlpha,
} from '../../../src/game/render/Interpolation';

describe('blend', () => {
  it('is the two endpoints at 0 and 1', () => {
    expect(blend(10, 30, 0)).toBe(10);
    expect(blend(10, 30, 1)).toBe(30);
  });

  it('is the midpoint at 0.5', () => {
    expect(blend(10, 30, 0.5)).toBe(20);
  });
});

describe('renderAlpha', () => {
  it('is the fraction of a step that has elapsed', () => {
    // a quarter of a 16.667ms step, worked out by hand
    expect(renderAlpha(1000 / 240, 1000 / 60)).toBeCloseTo(0.25, 6);
  });

  it('never extrapolates past the tick the simulation has actually reached', () => {
    // The loop running late must draw the newest state, not somewhere beyond it.
    expect(renderAlpha(50, 1000 / 60)).toBe(1);
  });

  it('never runs backwards', () => {
    expect(renderAlpha(-5, 1000 / 60)).toBe(0);
  });

  it('falls back to the newest state when there is no step to divide by', () => {
    expect(renderAlpha(8, 0)).toBe(1);
    expect(renderAlpha(Number.NaN, 1000 / 60)).toBe(1);
  });
});

describe('isContinuousStep', () => {
  it('accepts an ordinary tick of walking', () => {
    // Base move speed is 3 per tick; even the fastest dash is far inside this.
    expect(isContinuousStep(0, 0, 3, 0)).toBe(true);
    expect(isContinuousStep(0, 0, 40, 30)).toBe(true);
  });

  it('rejects a jump, so a blink is not drawn as a slide', () => {
    // Flash is 400 units, comfortably past the snap distance.
    expect(isContinuousStep(0, 0, 400, 0)).toBe(false);
  });

  it('measures the diagonal, not either axis alone', () => {
    // 3-4-5: 90 and 120 are each under the 150 limit, the step is exactly on it.
    expect(isContinuousStep(0, 0, 90, 120)).toBe(true);
    expect(isContinuousStep(0, 0, 91, 121)).toBe(false);
    expect(RENDER_SNAP_PX).toBe(150);
  });
});
