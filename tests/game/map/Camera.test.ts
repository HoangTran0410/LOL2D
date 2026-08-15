import { afterEach, describe, expect, it, vi } from 'vitest';
import Camera, {
  baseScaleFor,
  clampZoomFactor,
  SCALE_MIN,
  VISION_SPAN,
} from '../../../src/game/gameObject/map/Camera';

describe('baseScaleFor', () => {
  // The spec's table. A landscape phone is the case the whole feature exists
  // for, and 0.39 is below the clamp floor the old code shipped (0.5) — which
  // is why SCALE_MIN is asserted here rather than left implicit.
  it.each<[string, number, number, number]>([
    ['phone landscape', 844, 390, 0.39],
    ['phone portrait', 390, 844, 0.39],
    ['tablet', 1180, 820, 0.82],
    ['laptop', 1440, 900, 0.9],
    ['desktop', 2560, 1440, 1.44],
    ['ultrawide', 3440, 1440, 1.44],
  ])('%s: %ix%i -> %f', (_name, w, h, expected) => {
    expect(baseScaleFor(w, h)).toBeCloseTo(expected, 5);
  });

  it('keys off the shorter side, so an ultrawide is not punished for its width', () => {
    expect(baseScaleFor(3440, 1440)).toBe(baseScaleFor(1440, 1440));
  });

  it('admits a landscape phone: the floor is below 0.39, not the old 0.5', () => {
    expect(baseScaleFor(844, 390)).toBeGreaterThan(SCALE_MIN);
    expect(SCALE_MIN).toBeLessThan(0.39);
  });

  it('VISION_SPAN is the full vision circle, not the radius', () => {
    expect(VISION_SPAN).toBe(1000);
  });
});

describe('clampZoomFactor', () => {
  it('clamps to the manual range and passes the default through', () => {
    expect(clampZoomFactor(1)).toBe(1);
    expect(clampZoomFactor(0.1)).toBe(0.6);
    expect(clampZoomFactor(99)).toBe(1.6);
  });
});

describe('constantSize', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a world size that renders as `px` on screen, at any scale', () => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    for (const scale of [0.39, 1, 1.44]) {
      c.currentScale = scale;
      expect(c.constantSize(12) * scale).toBeCloseTo(12, 5);
    }
  });

  it('does not divide by zero', () => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    c.currentScale = 0;
    expect(Number.isFinite(c.constantSize(12))).toBe(true);
  });
});
