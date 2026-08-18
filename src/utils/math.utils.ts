/**
 * High-performance 2D math utilities for game loop calculations.
 *
 * Optimized for zero object allocations and direct scalar operations
 * to avoid floating-point / variadic overhead of `Math.hypot` and prototype lookups.
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/**
 * Squared Euclidean distance between two coordinate pairs (dx² + dy²).
 *
 * Use this for range checks, collision proximity, and radius tests to eliminate Math.sqrt.
 */
export function distSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Squared Euclidean distance between two 2D points (dx² + dy²).
 */
export function vecDistSq(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/**
 * True when the distance between `a` and `b` is less than or equal to `radius`.
 * Compares squared distances without invoking Math.sqrt.
 */
export function withinRadius(a: Point2D, b: Point2D, radius: number): boolean {
  if (radius < 0) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * True when the distance between (x1, y1) and (x2, y2) is <= radius.
 * Compares squared distances without invoking Math.sqrt.
 */
export function withinRadiusCoords(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number
): boolean {
  if (radius < 0) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Euclidean distance between two coordinate pairs.
 * Faster than Math.hypot(dx, dy) in V8 / JavaScriptCore by avoiding variadic
 * argument handling and float scaling.
 */
export function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Euclidean distance between two 2D points.
 */
export function vecDist(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamps a number between min and max bounds.
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Linear interpolation between `a` and `b` by amount `t`.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Normalizes an angle in radians into the range (-PI, PI].
 */
export function wrapAngle(rad: number): number {
  let angle = rad % (Math.PI * 2);
  if (angle > Math.PI) angle -= Math.PI * 2;
  if (angle <= -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Converts degrees to radians.
 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Converts radians to degrees.
 */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Computes the angle in radians from point `from` to point `to`.
 */
export function angleBetween(from: Point2D, to: Point2D): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}
