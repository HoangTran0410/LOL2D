/**
 * Drawing between two simulation ticks.
 *
 * The simulation is a fixed 60Hz clock of its own (`GameScene.updateLoop`,
 * `Game.fps`), and the render loop is p5's `draw()` on requestAnimationFrame,
 * throttled to the player's FPS preference. Nothing synchronises them, and
 * nothing should: a fixed timestep is what keeps movement, collision and
 * cooldowns identical on every machine, while the draw rate has to be free to
 * drop on a slow phone.
 *
 * The cost of that independence is phase. A rendered frame catches the
 * simulation wherever it happens to be, so a body stepping an even 3px per tick
 * gets *drawn* moving 0px, 3px or 6px between consecutive frames. Measured on
 * the shipped build with `tests/e2e/measure-frame-pacing.mjs`: of 120 rendered
 * frames, 24 saw no tick at all, 48 saw one and 48 saw two — a coefficient of
 * variation of 0.62 on a body moving at a constant speed. That is the jiggle,
 * and it is a phase problem rather than a frame rate one.
 *
 * The fix is to draw the world *between* the two ticks it sits between, at the
 * fraction of a step that has actually elapsed. The simulation is untouched and
 * still authoritative; only the picture is blended. The price is up to one tick
 * of latency — the drawn world is at most 16.7ms behind the simulated one —
 * which is the standard trade and far below what anyone can see.
 *
 * `ObjectManager.draw` applies this by swapping each object's `position` for
 * the blended one and putting it back afterwards, so not one of the hundreds
 * of `draw()` bodies in this codebase has to know it happens.
 */

/**
 * How far a body may move in one tick and still be interpolated.
 *
 * Interpolation assumes the two endpoints are the same journey. A blink, a
 * Flash, a respawn or a minimap teleport are not — blending across one draws
 * the champion sliding the whole way, which is worse than the jump it replaces.
 *
 * 150px is comfortably above any legitimate single tick: the fastest dash on
 * the roster covers well under half of it in one step, while the shortest real
 * teleport (Flash, at 400) is far above. A body that crosses it is snapped to
 * where the simulation actually put it.
 */
export const RENDER_SNAP_PX = 150;

/** `RENDER_SNAP_PX` squared, so the test never takes a square root. */
const SNAP_SQUARED = RENDER_SNAP_PX * RENDER_SNAP_PX;

/**
 * Whether this step is a journey to be blended rather than a jump to be taken
 * whole. See `RENDER_SNAP_PX`.
 */
export const isContinuousStep = (
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number
): boolean => {
  const dx = currentX - previousX;
  const dy = currentY - previousY;
  return dx * dx + dy * dy <= SNAP_SQUARED;
};

/** One axis, blended. Written out rather than via p5's `lerp` so it stays pure. */
export const blend = (from: number, to: number, alpha: number): number =>
  from + (to - from) * alpha;

/**
 * The fraction of a simulation step the renderer is into.
 *
 * Clamped rather than trusted: `performance.now()` can land past the next tick
 * when the loop is running late, and an alpha above 1 would *extrapolate* —
 * drawing a body somewhere the simulation never put it, which reads as
 * overshoot and rubber-banding on exactly the slow devices this exists for.
 */
export const renderAlpha = (elapsedMs: number, stepMs: number): number => {
  if (!(stepMs > 0) || !Number.isFinite(elapsedMs)) return 1;
  const alpha = elapsedMs / stepMs;
  return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
};
