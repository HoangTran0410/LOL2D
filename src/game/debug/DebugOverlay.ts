import { Circle, Line, Rectangle } from '@/libs/quadtree';

/**
 * The debug hub: one flag per layer, and one draw function per flag.
 *
 * Every layer here paints something the game **already computed** — the wall
 * polygons navigation rasterizes, the bounding boxes collision queries use, the
 * sight polygons the fog draws with, the quadtree the object manager rebuilt
 * this tick. Nothing in this file derives new geometry, which is what keeps it
 * honest: an overlay that computed its own answer could agree with itself while
 * disagreeing with the game.
 *
 * `routes` is the exception in shape but not in spirit: it was here first, as
 * `N` and `NavigationSystem.debugRoutes`, and `NavDebugOverlay.drawNavDebug`
 * still draws it. `createDebugFlags` makes `debug.routes` an accessor **onto
 * that same field** rather than a second boolean, so the key and the panel
 * checkbox cannot disagree about whether routes are on.
 *
 * Same trade as `NavDebugOverlay`: the draw functions reach for p5's globals,
 * so they only run inside `draw()`. Module scope touches nothing — see the
 * comment at the top of `src/main.ts`.
 */

export interface DebugFlags {
  /** Live view of `NavigationSystem.debugRoutes`; drawn by `drawNavDebug`, not here. */
  routes: boolean;
  terrain: boolean;
  collision: boolean;
  vision: boolean;
  quadtree: boolean;
  /** The FPS readout; drawn by `drawFpsOverlay` in `game/debug/FpsOverlay.ts`, not here — same
   *  split as `routes`: this file is world-space layers, that one is a fixed screen-space HUD. */
  fps: boolean;
}

/** The one field `createDebugFlags` proxies into. Structural, so tests need no `Game`. */
interface DebugFlagsContext {
  navigation?: { debugRoutes: boolean };
}

/**
 * The flag set, with `routes` aliased onto navigation's own field.
 *
 * The navigation reference is read through the host on every access rather
 * than captured, because a headless bench (`tests/game/fixtures.ts`) has no
 * navigation system at all and a `Game` builds one long before it builds the
 * director. Missing navigation reads as "off" and swallows the write — the
 * only case where that happens is a bench with nothing to draw.
 */
export function createDebugFlags(context: DebugFlagsContext): DebugFlags {
  return {
    get routes(): boolean {
      return context.navigation?.debugRoutes ?? false;
    },
    set routes(on: boolean) {
      if (context.navigation) context.navigation.debugRoutes = on;
    },
    terrain: false,
    collision: false,
    vision: false,
    quadtree: false,
    fps: false,
  };
}

/** A quadtree node, structurally: `Quadtree` from `libs/quadtree` already is one. */
export interface QuadtreeNode {
  bounds: { x: number; y: number; w: number; h: number };
  level: number;
  nodes: QuadtreeNode[];
}

/** Just enough of a `GameObject` for the layers below to draw it. */
interface DebugDrawable {
  position: { x: number; y: number };
  visibleToPlayerTeam?: boolean;
  visionRadius?: number;
  getCollideBoundingBox?(): Circle | Line | Rectangle;
}

/** The slice of `Game` this overlay needs, kept off the `Game` type. */
export interface DebugOverlayHost {
  director: { debug: DebugFlags };
  terrainMap: { wallPolygons(): { x: number; y: number }[][] };
  objectManager: { objects: DebugDrawable[]; _objectsTree: QuadtreeNode };
  fogOfWar: { getSightPoly(object: DebugDrawable): { x: number; y: number }[] };
}

/**
 * Called from `Game.draw()` inside `camera.makeDraw`, beside `drawNavDebug`.
 *
 * Each flag is checked here, before its function is entered and before any
 * iteration — an overlay that is off has to cost nothing, and two of these
 * (`vision`, `quadtree`) would otherwise walk every object in the match to
 * decide to draw nothing.
 */
export function drawDebugOverlay(host: DebugOverlayHost): void {
  const { debug } = host.director;
  if (debug.terrain) drawTerrain(host);
  if (debug.collision) drawCollision(host);
  if (debug.vision) drawVision(host);
  if (debug.quadtree) drawQuadtree(host);
}

/**
 * The wall layer, outlined. This is `TerrainMap.wallPolygons()` — the exact
 * array handed to `NavigationSystem`, so a wall drawn here and a wall the grid
 * rasterized are the same wall by construction.
 */
function drawTerrain(host: DebugOverlayHost): void {
  push();
  noFill();
  stroke(255, 120, 200, 220);
  strokeWeight(2);
  for (const polygon of host.terrainMap.wallPolygons()) {
    beginShape();
    for (const point of polygon) vertex(point.x, point.y);
    endShape(CLOSE);
  }
  pop();
}

/**
 * Every body's collision shape — the *collide* box, not the display one, so
 * this is the outline spells and the wall push-out actually test against. The
 * three shapes are the three `getCollideBoundingBox` can return; the missing
 * case is real (`ObjectManager.queryObjects` guards for it) and means an object
 * that never collides.
 */
function drawCollision(host: DebugOverlayHost): void {
  push();
  noFill();
  stroke(120, 255, 160, 200);
  strokeWeight(1.5);
  for (const object of host.objectManager.objects) {
    if (typeof object.getCollideBoundingBox !== 'function') continue;
    const box = object.getCollideBoundingBox();
    if (box instanceof Circle) circle(box.x, box.y, box.r * 2);
    else if (box instanceof Line) line(box.x1, box.y1, box.x2, box.y2);
    else if (box instanceof Rectangle) rect(box.x, box.y, box.w, box.h);
  }
  pop();
}

/**
 * The visibility polygon behind the fog, per unit that has one.
 *
 * `visibleToPlayerTeam` is the fog's own answer to "does the player see this",
 * written by
 * `FogOfWar.calculateSight()` earlier in the same frame, so this layer shows
 * vision for exactly what is on screen. `getSightPoly` is cached per unit and
 * position, so for the allies the fog already asked about this frame it is a
 * map lookup; a visible *enemy* is a real computation, which is the one cost
 * this flag adds and the reason it is off by default.
 */
function drawVision(host: DebugOverlayHost): void {
  push();
  noFill();
  stroke(255, 230, 120, 170);
  strokeWeight(1.5);
  for (const object of host.objectManager.objects) {
    if (!object.visibleToPlayerTeam) continue;
    if (!object.visionRadius || object.visionRadius <= 0) continue;
    const polygon = host.fogOfWar.getSightPoly(object);
    if (polygon.length === 0) continue;
    beginShape();
    for (const point of polygon) vertex(point.x, point.y);
    endShape(CLOSE);
  }
  pop();
}

/**
 * The spatial index itself: one rectangle per live node, brightening with
 * depth. What this is for is seeing *where* the tree split — a cluster of deep
 * nodes is a crowd, and a query that returns too much is usually a leaf that
 * never split under it.
 */
function drawQuadtree(host: DebugOverlayHost): void {
  push();
  noFill();
  strokeWeight(1);
  for (const node of quadtreeNodeBounds(host.objectManager._objectsTree)) {
    stroke(90, 170, 255, 60 + node.level * 45);
    rect(node.x, node.y, node.w, node.h);
  }
  pop();
}

/**
 * Every node's bounds, root first, depth first after that.
 *
 * Pure, and separate from the drawing so it can be asserted headlessly. The
 * quadtree needed nothing added to it for this: `Quadtree.bounds`, `.level`
 * and `.nodes` are all already public, and `nodes` is empty until a node
 * splits, which is what makes this walk terminate.
 */
export function quadtreeNodeBounds(
  node: QuadtreeNode,
  out: { x: number; y: number; w: number; h: number; level: number }[] = []
): { x: number; y: number; w: number; h: number; level: number }[] {
  out.push({ ...node.bounds, level: node.level });
  for (const child of node.nodes) quadtreeNodeBounds(child, out);
  return out;
}
