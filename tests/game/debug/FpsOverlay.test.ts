import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubGameGlobals } from '../fixtures';
import {
  FPS_SMOOTHING_ALPHA,
  FpsMeter,
  MAX_FRAME_MS,
  MIN_FRAME_MS,
  drawFpsOverlay,
  type FpsOverlayHost,
} from '../../../src/game/debug/FpsOverlay';

/**
 * `FpsMeter` is pure (no p5 global touches its `sample`), so its own suite
 * needs no canvas stub at all — only `drawFpsOverlay` does.
 */
describe('FpsMeter', () => {
  it('seeds the first sample directly, with no ramp up from zero', () => {
    const meter = new FpsMeter();
    // 16ms/frame is 62.5 fps. A meter that started its EMA at 0 and blended
    // in only 10% of the first sample would report ~6.25 here instead.
    expect(meter.sample(16)).toBeCloseTo(62.5, 5);
  });

  it('moves partway toward a new instantaneous rate rather than snapping to it', () => {
    const meter = new FpsMeter();
    meter.sample(16); // seeds smoothed = 62.5
    // 8ms/frame is 125 fps instantaneously. A meter with no smoothing at all
    // would jump straight to 125 on the very next frame.
    const next = meter.sample(8);
    const expected = 62.5 + (125 - 62.5) * FPS_SMOOTHING_ALPHA;
    expect(next).toBeCloseTo(expected, 5);
    expect(next).not.toBeCloseTo(125, 0);
  });

  it('clamps a near-zero delta so a stutter cannot report an unbounded fps', () => {
    const meter = new FpsMeter();
    const fps = meter.sample(0);
    expect(Number.isFinite(fps)).toBe(true);
    expect(fps).toBeCloseTo(1000 / MIN_FRAME_MS, 5);
  });

  it('clamps a huge delta — a backgrounded tab coming back — to a floor rather than near zero', () => {
    const meter = new FpsMeter();
    const fps = meter.sample(5000);
    expect(fps).toBeCloseTo(1000 / MAX_FRAME_MS, 5);
  });
});

describe('drawFpsOverlay', () => {
  let spies: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    spies = stubGameGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  const host = (fpsOn: boolean): FpsOverlayHost => ({ director: { debug: { fps: fpsOn } } });

  it('draws nothing at all with the flag off', () => {
    drawFpsOverlay(host(false), new FpsMeter());
    expect(spies.text).not.toHaveBeenCalled();
  });

  it('draws the smoothed number, rounded, with the flag on', () => {
    vi.stubGlobal('deltaTime', 16); // 62.5 -> rounds to 63
    drawFpsOverlay(host(true), new FpsMeter());
    expect(spies.text).toHaveBeenCalledTimes(1);
    expect(spies.text.mock.calls[0][0]).toBe('63 FPS');
  });

  it('does not sample or draw when the flag is off, even across repeated calls', () => {
    const meter = new FpsMeter();
    drawFpsOverlay(host(false), meter);
    drawFpsOverlay(host(false), meter);
    expect(spies.text).not.toHaveBeenCalled();
  });
});
