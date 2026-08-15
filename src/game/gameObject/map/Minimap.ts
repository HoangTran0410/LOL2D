/**
 * The minimap: a fog-respecting map of the whole world, drawn on the canvas in
 * screen space beside the touch controls.
 *
 * Geometry and hit-testing live at module level, free of p5 globals, so they
 * run in a plain node test with no canvas — the shape `TouchControls` already
 * uses. Only `draw()` and the buffer builder may touch p5.
 */

export interface MinimapRect {
  x: number;
  y: number;
  size: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Collapsed edge length in screen pixels, and its inset from the corner. */
export const MINIMAP_SIZE = 150;
export const MINIMAP_MARGIN = 12;
/** Expanded edge length, as a fraction of the viewport's shorter side. */
export const EXPANDED_FRACTION = 0.8;

/**
 * One transform, parameterised by the rect: the expanded and collapsed maps
 * differ only in that rect, so the teleport tap and the dot placement cannot
 * disagree with each other.
 */
export const worldToMinimap = (world: Point, rect: MinimapRect, mapSize: number): Point => ({
  x: rect.x + (world.x / mapSize) * rect.size,
  y: rect.y + (world.y / mapSize) * rect.size,
});

export const minimapToWorld = (screen: Point, rect: MinimapRect, mapSize: number): Point => ({
  x: ((screen.x - rect.x) / rect.size) * mapSize,
  y: ((screen.y - rect.y) / rect.size) * mapSize,
});

export const hitTest = (point: Point, rect: MinimapRect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.size &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.size;
