// Batch 4 task 6 moved Summoner's Rift's map out of `assets/json/` and into
// the pack.
import mapData from '../../../packs/riot/maps/summoner_map.json';

/**
 * Clearance measured against the raw wall polygons, independent of the
 * navigation grid.
 *
 * This is the same measurement `tests/game/minions/Lanes.test.ts` makes of the
 * hand-authored lane paths, and it is here for the same reason: a grid checked
 * against itself proves only that it is self-consistent. Every assertion about
 * where a route goes is made against the map file.
 */

export type Point = [number, number];

export const wallPolygons = mapData.wall as Point[][];

const bounds = wallPolygons.map(polygon => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
});

export const pointInPolygon = (px: number, py: number, polygon: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const distanceToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Distance from a point to the nearest wall surface, negative inside a wall.
 * Capped at `ceiling` so the bounding-box reject skips most of the 329 polygons.
 */
export const wallClearance = (px: number, py: number, ceiling = 300): number => {
  let best = ceiling;
  for (let i = 0; i < wallPolygons.length; i++) {
    const box = bounds[i];
    const dx = px < box.minX ? box.minX - px : px > box.maxX ? px - box.maxX : 0;
    const dy = py < box.minY ? box.minY - py : py > box.maxY ? py - box.maxY : 0;
    if (Math.hypot(dx, dy) >= best) continue;

    const polygon = wallPolygons[i];
    let edge = Infinity;
    for (let k = 0, j = polygon.length - 1; k < polygon.length; j = k++) {
      edge = Math.min(
        edge,
        distanceToSegment(px, py, polygon[j][0], polygon[j][1], polygon[k][0], polygon[k][1])
      );
    }
    const signed = pointInPolygon(px, py, polygon) ? -edge : edge;
    if (signed < best) best = signed;
  }
  return best;
};

export interface WorstClearance {
  clearance: number;
  at: { x: number; y: number };
}

/** Worst clearance anywhere along a walked route, sampled every 8 world units. */
export const routeClearance = (
  route: readonly number[],
  fromX: number,
  fromY: number
): WorstClearance => {
  let worst = Infinity;
  let at = { x: fromX, y: fromY };
  let ax = fromX;
  let ay = fromY;

  for (let i = 0; i + 1 < route.length; i += 2) {
    const bx = route[i];
    const by = route[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const clearance = wallClearance(x, y);
      if (clearance < worst) {
        worst = clearance;
        at = { x: Math.round(x), y: Math.round(y) };
      }
    }
    ax = bx;
    ay = by;
  }

  return { clearance: worst, at };
};

/** Straight-line worst clearance, for asserting that a detour was necessary. */
export const segmentClearance = (ax: number, ay: number, bx: number, by: number): WorstClearance =>
  routeClearance([bx, by], ax, ay);
