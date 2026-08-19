import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubGameGlobals } from '../fixtures';
import Camera, {
  baseScaleFor,
  clampZoomFactor,
  FOLLOW_PER_FRAME,
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

/**
 * The follow lerp used a fixed fraction *per frame*, which makes the camera's
 * speed a function of the frame rate rather than of time. Two consequences, and
 * the second is the one players feel: the camera trails further behind on a
 * slow device than on a fast one, and — because no two frames are the same
 * length — its speed jitters with every wobble in frame time even while the
 * champion is walking in a straight line. The whole world shakes slightly, which
 * reads as motion sickness rather than as a frame rate problem.
 */
describe('camera follow is measured in time, not in frames', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Chases a target 1000px away for `totalMs`, at a fixed frame length. */
  const chase = (frameMs: number, totalMs: number): number => {
    stubGameGlobals();
    vi.stubGlobal('deltaTime', frameMs);
    const camera = new Camera();
    camera.position.set(0, 0);
    camera.target = createVector(1000, 0) as unknown as p5.Vector;
    const frames = Math.round(totalMs / frameMs);
    for (let frame = 0; frame < frames; frame++) camera.update();
    return camera.position.x;
  };

  it('is unchanged at 60fps', () => {
    // 500ms at 60fps is 30 frames, each closing FOLLOW_PER_FRAME of what is
    // left: 1000 * (1 - (1 - f)^30), worked out here rather than by asking the
    // camera. The constant is imported so a retune is not a test edit; the
    // exponent is not, because the per-frame-to-per-time conversion is the
    // thing under test.
    expect(chase(1000 / 60, 500)).toBeCloseTo(1000 * (1 - Math.pow(1 - FOLLOW_PER_FRAME, 30)), 0);
  });

  it('covers the same ground in the same wall time at 30fps', () => {
    expect(chase(1000 / 30, 500)).toBeCloseTo(chase(1000 / 60, 500), 0);
  });

  it('covers the same ground again at 144fps', () => {
    expect(chase(1000 / 144, 500)).toBeCloseTo(chase(1000 / 60, 500), 0);
  });

  it('does not overshoot its target after a long freeze', () => {
    expect(chase(5_000, 5_000)).toBeLessThanOrEqual(1000);
  });
});
