/**
 * The static navigation structure: one clearance grid over the whole map.
 *
 * ## Why a grid rather than a navmesh or a visibility graph
 *
 * The wall layer is 329 polygons / 1468 vertices of unstructured polygon soup,
 * and it never moves. That rules the three candidates as follows:
 *
 * - **Visibility graph over wall corners** would give the shortest paths there
 *   are, but it needs every corner-to-corner segment tested against every wall:
 *   1468² candidate edges, each swept over 1468 segments. That is billions of
 *   tests to build, and a query still has to link a fresh start and goal to all
 *   1468 nodes before it can even begin searching. Wrong shape for a map this
 *   detailed.
 * - **A navmesh** would be the nicest representation to walk, but building one
 *   from arbitrary overlapping polygons needs a constrained triangulation and a
 *   polygon-offset pass to inset by the body radius. Neither exists in this
 *   repo, both are subtle, and the resulting mesh would still be per-radius.
 * - **A uniform grid** rasterizes polygon soup in one linear pass, holds one
 *   number per cell, and — this is the part that matters — can serve *every*
 *   body size from a single build if what it stores is not "walkable" but
 *   **clearance**: the distance from the cell to the nearest wall. A minion
 *   (17px), a champion (27.5px) and a fully stacked Cho'Gath (60px) then read
 *   the same array with different thresholds. One structure, no per-unit build.
 *
 * ## Resolution
 *
 * 24px cells: 267 x 267 = 71,289 cells, 139KB as a Uint16Array, ~7ms to build.
 * The resolution was picked by measurement, not taste — flood-filling the map
 * for each body size at 48/32/24/20/16px shows 48px severs Baron's camp from
 * the lanes for a champion and severs the top lane for a large body, and 32px
 * still severs Baron for a large body. 24px is the coarsest cell that leaves
 * every camp and both fountains mutually reachable for every body the game
 * spawns, and halving it again to 16px only quadruples the memory for paths
 * that string-pulling erases the difference between.
 *
 * ## Clearance, and why it is conservative
 *
 * Cells are marked blocked if a wall polygon covers their centre (scanline) or
 * if a wall *edge* crosses them at all (supercover DDA) — the second pass is
 * what stops a wall thinner than a cell from being invisible to the grid.
 *
 * An exact Euclidean distance transform (Felzenszwalb-Huttenlocher, O(cells))
 * then gives each free cell its distance to the nearest blocked cell centre.
 * A free cell's centre is at least half a cell from real wall geometry, because
 * nothing overlapping its square left it free, so half a cell is subtracted to
 * turn "distance to a blocked cell centre" into a lower bound on "distance to
 * the wall". Stored floored to whole pixels, which only ever understates it.
 *
 * Queries then ask for `radius + cellSize / 2` rather than `radius`: the stored
 * number describes the cell centre, and a body may stand anywhere in the cell.
 * Everything here therefore errs towards calling ground unwalkable, never
 * towards routing a body through a wall.
 */

export interface NavPoint {
  x: number;
  y: number;
}

/** Cell size in world units. See the resolution note above. */
export const NAV_CELL_SIZE = 24;

/** Clearance is stored in a Uint16Array; nothing on this map is further than this from a wall. */
const MAX_STORED_CLEARANCE = 4_096;

/** Sub-millisecond clock where there is one, so a ~7ms build is not reported as 7 or 8. */
export const navNow = (): number =>
  typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export interface NavGridOptions {
  /** Square map edge length in world units. */
  size: number;
  cellSize?: number;
}

/**
 * Felzenszwalb-Huttenlocher exact squared Euclidean distance transform, 1D.
 * Run over rows then columns it produces the exact 2D transform in O(cells).
 * `f` is the input row, `d` the output; `v` and `z` are the parabola hull
 * scratch buffers, passed in so the 2D pass allocates nothing per line.
 */
function distanceTransform1D(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

export default class NavGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;

  /**
   * Distance in whole pixels from each cell centre to the nearest wall surface.
   * 0 means the cell is wall (or close enough to it to be worthless).
   */
  readonly clearance: Uint16Array;

  /** Wall-clock cost of the build, for the perf harness. */
  readonly buildMs: number;

  private constructor(cellSize: number, cols: number, rows: number, clearance: Uint16Array, buildMs: number) {
    this.cellSize = cellSize;
    this.cols = cols;
    this.rows = rows;
    this.clearance = clearance;
    this.buildMs = buildMs;
  }

  /** Bytes held by the static structure. Reported by the perf harness. */
  get memoryBytes(): number {
    return this.clearance.byteLength;
  }

  static fromPolygons(
    polygons: readonly (readonly NavPoint[])[],
    { size, cellSize = NAV_CELL_SIZE }: NavGridOptions
  ): NavGrid {
    const startedAt = navNow();
    const cols = Math.max(1, Math.ceil(size / cellSize));
    const rows = cols;
    const blocked = new Uint8Array(cols * rows);

    for (const polygon of polygons) {
      if (polygon.length < 2) continue;
      NavGrid.rasterizeEdges(polygon, blocked, cols, rows, cellSize);
      NavGrid.rasterizeInterior(polygon, blocked, cols, rows, cellSize);
    }

    const clearance = NavGrid.buildClearance(blocked, cols, rows, cellSize);
    return new NavGrid(cellSize, cols, rows, clearance, navNow() - startedAt);
  }

  /**
   * Marks every cell each polygon edge passes through (Amanatides-Woo voxel
   * traversal). Without this a wall thinner than a cell, or one whose sliver
   * misses every cell centre, would leave no mark at all.
   */
  private static rasterizeEdges(
    polygon: readonly NavPoint[],
    blocked: Uint8Array,
    cols: number,
    rows: number,
    cellSize: number
  ): void {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const x0 = polygon[j].x / cellSize;
      const y0 = polygon[j].y / cellSize;
      const x1 = polygon[i].x / cellSize;
      const y1 = polygon[i].y / cellSize;

      let cx = Math.floor(x0);
      let cy = Math.floor(y0);
      const endX = Math.floor(x1);
      const endY = Math.floor(y1);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const stepX = dx > 0 ? 1 : -1;
      const stepY = dy > 0 ? 1 : -1;
      const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
      const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
      let nextX = dx === 0 ? Infinity : (dx > 0 ? cx + 1 - x0 : x0 - cx) * deltaX;
      let nextY = dy === 0 ? Infinity : (dy > 0 ? cy + 1 - y0 : y0 - cy) * deltaY;

      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) blocked[cy * cols + cx] = 1;

      // the guard is belt and braces against a degenerate edge; a real one
      // crosses at most cols + rows cells
      let guard = cols + rows + 4;
      while ((cx !== endX || cy !== endY) && guard-- > 0) {
        if (nextX < nextY) {
          nextX += deltaX;
          cx += stepX;
        } else {
          nextY += deltaY;
          cy += stepY;
        }
        if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) blocked[cy * cols + cx] = 1;
      }
    }
  }

  /** Even-odd scanline fill on cell centres, for the body of the polygon. */
  private static rasterizeInterior(
    polygon: readonly NavPoint[],
    blocked: Uint8Array,
    cols: number,
    rows: number,
    cellSize: number
  ): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of polygon) {
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    const firstRow = Math.max(0, Math.floor(minY / cellSize));
    const lastRow = Math.min(rows - 1, Math.floor(maxY / cellSize));
    const crossings: number[] = [];

    for (let row = firstRow; row <= lastRow; row++) {
      const scanY = (row + 0.5) * cellSize;
      crossings.length = 0;

      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j];
        const b = polygon[i];
        if (b.y > scanY !== a.y > scanY) {
          crossings.push(((a.x - b.x) * (scanY - b.y)) / (a.y - b.y) + b.x);
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((left, right) => left - right);

      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k] / cellSize - 0.5));
        const to = Math.min(cols - 1, Math.floor(crossings[k + 1] / cellSize - 0.5));
        const base = row * cols;
        for (let cx = from; cx <= to; cx++) blocked[base + cx] = 1;
      }
    }
  }

  private static buildClearance(
    blocked: Uint8Array,
    cols: number,
    rows: number,
    cellSize: number
  ): Uint16Array {
    const INFINITE = 1e12;
    const squared = new Float64Array(cols * rows);
    for (let i = 0; i < squared.length; i++) squared[i] = blocked[i] === 1 ? 0 : INFINITE;

    const span = Math.max(cols, rows);
    const line = new Float64Array(span);
    const out = new Float64Array(span);
    const hull = new Int32Array(span);
    const bounds = new Float64Array(span + 1);

    for (let y = 0; y < rows; y++) {
      const base = y * cols;
      for (let x = 0; x < cols; x++) line[x] = squared[base + x];
      distanceTransform1D(line, cols, out, hull, bounds);
      for (let x = 0; x < cols; x++) squared[base + x] = out[x];
    }
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) line[y] = squared[y * cols + x];
      distanceTransform1D(line, rows, out, hull, bounds);
      for (let y = 0; y < rows; y++) squared[y * cols + x] = out[y];
    }

    // A free cell's centre is at least half a cell from real geometry, so the
    // distance to the nearest blocked cell centre overstates the true clearance
    // by up to that much. Subtract it, then floor: both directions understate.
    const halfCell = cellSize * 0.5;
    const clearance = new Uint16Array(cols * rows);
    for (let i = 0; i < clearance.length; i++) {
      const px = Math.sqrt(squared[i]) * cellSize - halfCell;
      clearance[i] = px <= 0 ? 0 : Math.min(MAX_STORED_CLEARANCE, Math.floor(px));
    }
    return clearance;
  }

  // ------------------------------------------------------------------ queries

  cellX(x: number): number {
    const cx = Math.floor(x / this.cellSize);
    return cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
  }

  cellY(y: number): number {
    const cy = Math.floor(y / this.cellSize);
    return cy < 0 ? 0 : cy >= this.rows ? this.rows - 1 : cy;
  }

  /** World centre of a cell. Grid paths are lists of these. */
  centreX(cx: number): number {
    return (cx + 0.5) * this.cellSize;
  }

  centreY(cy: number): number {
    return (cy + 0.5) * this.cellSize;
  }

  /**
   * Clearance a cell must report before a body of `radius` may stand in it.
   *
   * The margin is half a cell diagonal, which is the furthest a body standing
   * in the cell can be from the centre the stored number describes. Swept over
   * the shipped map at 11px intervals — 200,000 samples — the stored field
   * never overstates the true distance to wall geometry by more than 13.4px,
   * so a 17px margin leaves the guarantee `isWalkable(p, r)` implies "a body of
   * radius r at p does not touch a wall" with a few pixels to spare. The sweep
   * is a test, so shrinking this is a failing build rather than a silent one.
   *
   * It also decides which bodies fit where. Every champion, minion and camp on
   * this map keeps both fountains, all three lanes and every camp mutually
   * reachable at this margin. A body past roughly twice champion size does not
   * — which is the same chokepoint limit `MAX_UNIT_SIZE` in Stats.ts already
   * documents, and it fails by walking as close as it can rather than by
   * refusing to move.
   */
  requiredClearance(radius: number): number {
    return radius + this.cellSize * Math.SQRT1_2;
  }

  /** Stored clearance at a world point, in px. 0 inside a wall. */
  clearanceAt(x: number, y: number): number {
    return this.clearance[this.cellY(y) * this.cols + this.cellX(x)];
  }

  /** Whether a body of `radius` fits at a world point. */
  isWalkable(x: number, y: number, radius: number): boolean {
    if (x < 0 || y < 0 || x >= this.cols * this.cellSize || y >= this.rows * this.cellSize) {
      return false;
    }
    return this.clearanceAt(x, y) >= this.requiredClearance(radius);
  }

  cellIsWalkable(cx: number, cy: number, required: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    return this.clearance[cy * this.cols + cx] >= required;
  }

  /**
   * Whether a body of `radius` can walk the straight line from a to b.
   *
   * This is the cheap first question every move order asks, and the test the
   * smoother uses to decide it may drop a corner — so it enumerates *every*
   * cell the segment touches (Amanatides-Woo again) rather than sampling along
   * it. Sampling would let a segment slip through a wall it clipped between two
   * samples, which is precisely the corner-cut smoothing must never make.
   *
   * Cost is one array read per cell crossed: about 125 reads for a move order
   * spanning half the map.
   */
  isLineClear(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
    const required = this.requiredClearance(radius);
    const cellSize = this.cellSize;

    const x0 = ax / cellSize;
    const y0 = ay / cellSize;
    const x1 = bx / cellSize;
    const y1 = by / cellSize;

    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const endX = Math.floor(x1);
    const endY = Math.floor(y1);
    if (!this.cellIsWalkable(cx, cy, required)) return false;
    if (cx === endX && cy === endY) return true;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
    let nextX = dx === 0 ? Infinity : (dx > 0 ? cx + 1 - x0 : x0 - cx) * deltaX;
    let nextY = dy === 0 ? Infinity : (dy > 0 ? cy + 1 - y0 : y0 - cy) * deltaY;

    let guard = this.cols + this.rows + 4;
    while (guard-- > 0) {
      if (nextX < nextY) {
        nextX += deltaX;
        cx += stepX;
      } else {
        nextY += deltaY;
        cy += stepY;
      }
      if (!this.cellIsWalkable(cx, cy, required)) return false;
      if (cx === endX && cy === endY) return true;
    }
    return false;
  }

  /**
   * The closest point a body of `radius` can actually stand, to a point that
   * may be inside a wall. This is the answer to "the player clicked on a wall"
   * and to "separation squeezed a unit into one".
   *
   * Rings are scanned outward by Chebyshev distance, but the winner is the best
   * *Euclidean* candidate: a cell one ring further out can still be nearer than
   * a diagonal one in the current ring, so scanning continues until the ring
   * index passes the best distance found. Returns null when nothing within
   * `maxDistance` fits, which is the caller's cue to give up rather than throw.
   */
  nearestWalkable(x: number, y: number, radius: number, maxDistance: number): NavPoint | null {
    const required = this.requiredClearance(radius);
    const startX = this.cellX(x);
    const startY = this.cellY(y);
    if (this.cellIsWalkable(startX, startY, required)) return { x, y };

    const maxRing = Math.max(1, Math.ceil(maxDistance / this.cellSize));
    let bestIndex = -1;
    let bestDistanceSq = Infinity;

    for (let ring = 1; ring <= maxRing; ring++) {
      // once something is found, only rings that could still beat it are worth
      // scanning: the query point sits somewhere inside the start cell, so a
      // cell at Chebyshev ring r is at least (r - 0.5) cells from it
      if (bestIndex >= 0 && (ring - 0.5) * this.cellSize > Math.sqrt(bestDistanceSq)) break;

      for (let dy = -ring; dy <= ring; dy++) {
        const onHorizontalEdge = dy === -ring || dy === ring;
        const stride = onHorizontalEdge ? 1 : ring * 2;
        for (let dx = -ring; dx <= ring; dx += stride) {
          const cx = startX + dx;
          const cy = startY + dy;
          if (!this.cellIsWalkable(cx, cy, required)) continue;

          const px = this.centreX(cx) - x;
          const py = this.centreY(cy) - y;
          const distanceSq = px * px + py * py;
          if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestIndex = cy * this.cols + cx;
          }
        }
      }
    }

    if (bestIndex < 0 || bestDistanceSq > maxDistance * maxDistance) return null;
    return {
      x: this.centreX(bestIndex % this.cols),
      y: this.centreY(Math.floor(bestIndex / this.cols)),
    };
  }
}
