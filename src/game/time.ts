/**
 * The one conversion between "per frame" and "per unit of time".
 *
 * Movement in this engine is authored per frame — `Stats.speed` is 3, meaning
 * three world units every time `move()` runs — while everything measured in
 * milliseconds (cooldowns, buff durations, cast times) is authored per second.
 * Two consequences, and both were shipped:
 *
 * - **The 30fps render option halved the game's speed.** `frameRate(30)` runs
 *   `move()` half as often, so a champion crossed the map at 90 units a second
 *   instead of 180 — while its cooldowns, which read `deltaTime`, ticked at the
 *   same rate they always had.
 * - **Everything jiggled.** No two real frames are the same length, so a fixed
 *   step per frame is a *varying* velocity in time. Once `Camera` began
 *   interpolating over time, the mismatch became visible as the attached
 *   champion sliding back and forth against the centre of the screen — the two
 *   used to jitter together, which is what hid it.
 *
 * `frameScale()` is the multiplier that makes a per-frame quantity mean the
 * same thing per unit of time. It is exactly 1 at 60fps, so every tuning value
 * in the codebase keeps the meaning it was tuned with and no test that counts
 * frames at 60fps changes its answer.
 */

/** The frame length every per-frame quantity in the codebase was tuned at. */
export const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * Ceiling on a single frame's scale, in reference frames.
 *
 * A tab returning from the background reports a `deltaTime` in the thousands.
 * Without a cap that is one step of several hundred world units — a champion
 * teleporting through walls, a missile skipping its whole flight and every
 * body it should have hit. Clamping makes the world resume rather than
 * fast-forward, which is the lesser wrong: time it did not simulate is time
 * nobody was watching.
 */
export const MAX_FRAME_SCALE = 3;

/**
 * How many reference frames' worth of time this frame is.
 *
 * Reads p5's `deltaTime` global when given nothing, so a caller in the draw
 * loop needs no argument; takes one explicitly so the pure helpers and their
 * tests never touch a global.
 */
export function frameScale(deltaMs: number = globalDeltaTime()): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 1;
  return Math.min(MAX_FRAME_SCALE, deltaMs / REFERENCE_FRAME_MS);
}

/** `deltaTime` is a p5 global and is absent outside the sketch — in a test, or before setup. */
function globalDeltaTime(): number {
  return typeof deltaTime === 'number' ? deltaTime : REFERENCE_FRAME_MS;
}
