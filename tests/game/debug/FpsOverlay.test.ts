import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubGameGlobals } from '../fixtures';
import {
  FPS_DISPLAY_INTERVAL_MS,
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

describe('the printed number holds still', () => {
  /** Feeds `frames` frames of `deltaMs` each. */
  const feed = (meter: FpsMeter, frames: number, deltaMs: number) => {
    for (let frame = 0; frame < frames; frame++) meter.sample(deltaMs);
  };

  it('publishes something on the very first frame rather than a zero', () => {
    const meter = new FpsMeter();
    meter.sample(16);
    expect(meter.displayFps).toBeCloseTo(62.5, 5);
  });

  it('does not move while the smoothed rate drifts inside one window', () => {
    const meter = new FpsMeter();
    meter.sample(16);
    const first = meter.displayFps;

    // 400ms of much faster frames: the EMA is climbing the whole time, and the
    // printed number must not follow it until the window closes.
    feed(meter, 50, 8);
    expect(meter.displayFps).toBe(first);
  });

  it('picks up the new rate once the window closes', () => {
    const meter = new FpsMeter();
    meter.sample(16);
    const first = meter.displayFps;

    // Past FPS_DISPLAY_INTERVAL_MS of wall time, by hand: 8ms x 70 = 560ms.
    feed(meter, 70, 8);
    expect(meter.displayFps).not.toBe(first);
    expect(meter.displayFps).toBeGreaterThan(first);
  });

  it('reports the slowest single frame of the window, not the average', () => {
    const meter = new FpsMeter();
    // 30 smooth frames and one 100ms hitch, all inside one 500ms window.
    feed(meter, 30, 16);
    meter.sample(100);
    feed(meter, 1, 16); // closes the window: 30*16 + 100 + 16 = 596ms

    // 100ms is 10 fps by hand. The average over the same window is near 60, so
    // a readout that only showed the average would call this a smooth window.
    expect(meter.displayLow).toBeCloseTo(10, 5);
    expect(meter.displayFps).toBeGreaterThan(30);
  });

  it('forgets the previous window’s hitch', () => {
    const meter = new FpsMeter();
    feed(meter, 30, 16);
    meter.sample(100);
    feed(meter, 1, 16);
    expect(meter.displayLow).toBeCloseTo(10, 5);

    // A clean window afterwards must read clean.
    feed(meter, 40, 16); // 640ms, no hitch
    expect(meter.displayLow).toBeCloseTo(62.5, 5);
  });

  it('holds the number for the interval it advertises', () => {
    const meter = new FpsMeter();
    meter.sample(16);
    const first = meter.displayFps;
    // One frame short of the advertised interval, counted in the same clamped
    // milliseconds the meter accumulates.
    feed(meter, Math.floor(FPS_DISPLAY_INTERVAL_MS / 16) - 1, 16);
    expect(meter.displayFps).toBe(first);
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

  it('draws the held number and the window’s worst frame, with the flag on', () => {
    vi.stubGlobal('deltaTime', 16); // 62.5 -> rounds to 63, and it is its own worst frame
    drawFpsOverlay(host(true), new FpsMeter());
    expect(spies.text).toHaveBeenCalledTimes(1);
    expect(spies.text.mock.calls[0][0]).toBe('63 FPS · min 63');
  });

  it('does not sample or draw when the flag is off, even across repeated calls', () => {
    const meter = new FpsMeter();
    drawFpsOverlay(host(false), meter);
    drawFpsOverlay(host(false), meter);
    expect(spies.text).not.toHaveBeenCalled();
  });
});
