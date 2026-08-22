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
 *   (17px), a champion (27.5px) and a fully stacked size-growing ultimate (60px) then read
 *   the same array with different thresholds. One structure, no per-unit build.
 *
 * ## Resolution
 *
 * 16px cells: 400 x 400 = 160,000 cells, 313KB as an Int16Array, ~4ms to build.
 * The resolution was picked by measurement, not taste — flood-filling the map
 * for each body size at 48/32/24/20/16px shows 48px severs the jungle boss's camp from
 * the lanes for a champion and severs the top lane for a large body, and 32px
 * still severs that camp for a large body; 24px was the original pick on those
 * connectivity grounds alone.
 *
 * It undersold the real cost, though: a second measurement — moat area a
 * champion's body (27.5px) fits on but the grid still refuses, click
 * displacement from `nearestWalkable`, and search cost, all against the
 * shipped map — found 24px cells cost 24.6% of standable ground as an
 * invisible band nobody can walk into, up to 86px wide, and a click near a
 * wall lands up to 59px from where it was clicked. 16px is better on every one
 * of those axes at once: the moat drops to 13.3%, worst case 68px; click
 * displacement drops to a 18px median, 40px worst; and the search itself gets
 * 4.5x cheaper (finer cells mean shorter A* hops to the same wall-hugging
 * routes, more than offsetting there being more of them) with zero routes
 * newly failing their node budget. There is no case in that data for keeping
 * the coarser grid — 16px is not a trade, it is a strict improvement, and it
 * still leaves every camp and both fountains mutually reachable for every
 * body the game spawns.
 *
 * ## Clearance, and why it is conservative — but not maximally so
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
 * That correction fixes the average and leaves the spread, and the spread was
 * the whole problem: a blocked cell's centre can be a half-*diagonal* from the
 * geometry that blocked it, so cells were refused with as much as 19px of room
 * to spare on top of the margin. Per side, that asked ~93px of corridor for a
 * body 55px across — and this map's jungle is built out of 60-90px gaps, so it
 * did not cost a band of wasted ground, it closed passages. A fully stacked
 * champion saw the walkable map break into five disconnected pieces.
 *
 * So `refineNearWalls` replaces the transform's estimate with the *measured*
 * distance to the wall for every cell close enough for it to decide anything —
 * about a tenth of the map, a few milliseconds. Measured against the shipped
 * map that halves the moat (10.4% of standable ground to 5.5% for a champion),
 * drops the worst overshoot from 19px to 8px — which is `requiredClearance`'s
 * margin exactly, i.e. nothing but the deliberate part is left — and puts every
 * body size back on one connected map. Being exact is also strictly safer: the
 * transform could overstate clearance, a measurement cannot, and the sweep in
 * `tests/game/nav/NavGrid.test.ts` moved from 3.7px of accepted overlap to
 * 2.84px on the same bound.
 *
 * Queries then ask for `radius + requiredClearance`'s margin rather than
 * `radius` — see that method for what the margin is and why it is deliberately
 * smaller than the value that would make this structure never wrong. Short
 * version: a route that grazes a wall gets corrected by `pushOutOfWalls`
 * every frame, gracefully, so the grid does not have to be perfect — it has to
 * be close enough that the correction is never visible, and that bar is a lot
 * lower than "never touches."
 */

export interface NavPoint {
  x: number;
  y: number;
}

/** Cell size in world units. See the resolution note above. */
export const NAV_CELL_SIZE = 16;

/**
 * The largest overlap `requiredClearance`'s margin is allowed to let a body
 * have with real wall geometry — see that method's doc for the measurement
 * behind this number and why it is safe. `tests/game/nav/NavGrid.test.ts`
 * sweeps the shipped map densely enough to actually find the rare cells this
 * bounds, so it is the one place this can move: shrinking the margin without
 * lowering this to match is a lie the test will catch, and raising this
 * without re-measuring is a safety margin picked by taste, not evidence.
 *
 * The sweep measures 2.84px against this 4px bound since `refineNearWalls`
 * landed (it was 3.7px when the clearance field was rasterization-derived).
 * What is left is not rasterization at all and will not go away by measuring
 * harder: the margin is half a cell, a body standing at a cell *corner* is
 * half a diagonal from its centre, and the difference is this number.
 */
export const NAV_MAX_ACCEPTED_OVERLAP = 4;

/**
 * The largest body radius terrain is asked to respect — see
 * `AttackableUnit.terrainRadius`, which is where it is applied.
 *
 * Clearance serves every body size from one build, which is the whole point of
 * this structure, but it also means a growing body loses ground to stand on
 * quadratically. Flood-filling the shipped map from the blue fountain, by body
 * size:
 *
 *   size  standable cells  reachable from blue
 *     55 (champion)  79,258   100%
 *     80             70,795    99.8%
 *    110             60,895    97.9%
 *    165 (MAX_UNIT_SIZE) 45,216  93.5%
 *
 * The map never actually severs — a fully stacked size-growing ultimate can still reach
 * 93.5% of what it can stand on. What collapses is the *number of gaps it
 * fits through*: 43% of standable ground is gone, so routes that were a
 * straight line for a champion become long detours, which is what a player
 * sees and reports as broken pathfinding. It is not broken; the body genuinely
 * does not fit, and `TerrainMap.pushOutOfWalls` would refuse the shortcut even
 * with navigation switched off entirely.
 *
 * So terrain stops taking the body literally past this radius. 40 (size 80) is
 * the knee of that table: it keeps 99.8% reachability and cuts the standable
 * loss from 43% to 11%, while still being large enough that a grown champion
 * is visibly clumsier in a corridor than a minion. Above it, the body keeps
 * growing everywhere it is *not* a pathing problem — its drawn size, its
 * hitbox, its attack reach (`combat/Reach.ts`) and how hard it shoves other
 * units (`UnitCollisionSystem`) all still read the real `bodyRadius`. The
 * visible cost is at the top of the range: at MAX_UNIT_SIZE the drawn body
 * overlaps a wall edge by up to 42px.
 */
export const NAV_MAX_TERRAIN_RADIUS = 40;

/**
 * Clearance is stored in an Int16Array, so it caps at 32,767 either way;
 * nothing on this map is further than this from a wall, in the open or buried
 * in one.
 */
const MAX_STORED_CLEARANCE = 4_096;

/**
 * How far from a wall `refineNearWalls` replaces the transform's estimate with
 * a measured distance.
 *
 * Comfortably past the largest margin any body asks for —
 * `requiredClearance(NAV_MAX_TERRAIN_RADIUS)` is 48 at the shipped cell size —
 * with room on top for the worst the transform understates by, so a cell left
 * unrefined cannot be sitting near a threshold.
 */
const REFINE_BAND = 64;

/**
 * How far the nearest open cell must be before a *blocked* cell counts as
 * buried in a wall rather than as part of its surface shell, in cells.
 *
 * One cell away — orthogonally or diagonally — is the shell, and it has to keep
 * the exact positive distance `refineNearWalls` measures, because that is the
 * number routing reads at a wall face. Anything further is inside, whatever the
 * scanline fill decided. See `buildSignedField`.
 */
const BURIED_CELLS = 1.5;

/**
 * Bucket edge for the segment index. Must be at least `REFINE_BAND` — see
 * `buildSegmentIndex` for why the 3x3 lookup depends on it.
 */
const SEGMENT_BUCKET = 128;

/** Wall edges bucketed for exact nearest-distance queries. */
interface SegmentIndex {
  /** Buckets per axis. */
  cols: number;
  /** Indices into `coords`, one list per bucket. */
  buckets: number[][];
  /** x1, y1, x2, y2 per segment. */
  coords: Float64Array;
}

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
   * Signed distance in whole pixels from each cell centre to the nearest wall
   * surface: positive out in the open, **negative inside a wall**, and larger
   * in magnitude the further from the surface either way.
   *
   * Navigation only ever asks "is this at least `required`", and every negative
   * value fails that the same way the old 0 did — which is why `PathFinder` and
   * `isWalkable` read this array unchanged. The inside half exists for
   * `map/TerrainField.ts`, which resolves a body out of a wall by reading the
   * field and its gradient instead of testing polygons.
   *
   * That sharing is the point rather than a convenience. Routes used to be
   * planned against this grid and then enforced against the SAT polygons, two
   * different answers to "where is the wall" that `NAV_MAX_ACCEPTED_OVERLAP`
   * exists to paper over. One field cannot disagree with itself.
   */
  readonly clearance: Int16Array;

  /** Wall-clock cost of the build, for the perf harness. */
  readonly buildMs: number;

  private constructor(
    cellSize: number,
    cols: number,
    rows: number,
    clearance: Int16Array,
    buildMs: number
  ) {
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
    // Kept apart from `blocked`, which is the union of the two passes. A cell an
    // edge merely clips has its centre out in the open; only a cell the scanline
    // filled is genuinely inside the wall, and `refineNearWalls` needs to tell
    // those two apart to know which centres it may measure from.
    const interior = new Uint8Array(cols * rows);

    for (const polygon of polygons) {
      if (polygon.length < 2) continue;
      NavGrid.rasterizeEdges(polygon, blocked, cols, rows, cellSize);
      NavGrid.rasterizeInterior(polygon, interior, cols, rows, cellSize);
    }
    for (let i = 0; i < blocked.length; i++) if (interior[i] === 1) blocked[i] = 1;

    const { clearance, buried } = NavGrid.buildSignedField(blocked, interior, cols, rows, cellSize);
    NavGrid.refineNearWalls(clearance, buried, polygons, cols, rows, cellSize);
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

  /**
   * Squared cell distance from every cell to the nearest source cell, where a
   * source is `mask[i] === 1`, or `mask[i] === 0` when `invert` is set.
   *
   * Split out of the field build because the signed field runs it twice over
   * complementary masks — once outward from the walls, once outward from the
   * open ground — and the buffers are the largest allocation in the build.
   */
  private static distanceField(
    mask: Uint8Array,
    invert: boolean,
    cols: number,
    rows: number
  ): Float64Array {
    const INFINITE = 1e12;
    const source = invert ? 0 : 1;
    const squared = new Float64Array(cols * rows);
    for (let i = 0; i < squared.length; i++) squared[i] = mask[i] === source ? 0 : INFINITE;

    const span = Math.max(cols, rows);
    const lane = new Float64Array(span);
    const out = new Float64Array(span);
    const hull = new Int32Array(span);
    const bounds = new Float64Array(span + 1);

    for (let y = 0; y < rows; y++) {
      const base = y * cols;
      for (let x = 0; x < cols; x++) lane[x] = squared[base + x];
      distanceTransform1D(lane, cols, out, hull, bounds);
      for (let x = 0; x < cols; x++) squared[base + x] = out[x];
    }
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) lane[y] = squared[y * cols + x];
      distanceTransform1D(lane, rows, out, hull, bounds);
      for (let y = 0; y < rows; y++) squared[y * cols + x] = out[y];
    }
    return squared;
  }

  /**
   * The signed field: distance to the nearest wall surface, negative inside.
   *
   * Two transforms over complementary masks, meeting at the surface. The
   * outward half is the clearance field this grid has always had. The inward
   * half is what lets a body buried in a wall be resolved by reading a number
   * instead of by asking each convex piece of that wall which way *it* would
   * like to push — the question that has no good answer when a thick wall is
   * authored as several boxes and the pieces disagree.
   *
   * The two masks do different jobs here and swapping them breaks it in two
   * different ways, both measured on the shipped map.
   *
   * **Which side a cell is on comes from `interior`.** `blocked` also holds the
   * cells an edge merely clips, whose centres are out in the open — they are
   * there so a wall thinner than a cell survives rasterization — and calling
   * those "inside" would put a negative distance on ground a body legitimately
   * stands on.
   *
   * **How deep an inside cell is is measured to the nearest cell that is not
   * `blocked`,** which is not the same as the nearest cell that is not
   * `interior`. Hand-drawn convex pieces do not meet exactly: polygon 286 ends
   * at y = 4810 where polygon 208 begins at y = 4811, and a hairline like that
   * runs along most of the map's seams. No scanline fills a cell whose centre
   * lands in the gap, so measuring escape distance against `interior` finds
   * open ground in the middle of a solid wall — the field read 12px deep at
   * (6315, 4827), which is 100px inside the right-hand wall, and a body
   * resolving against it oscillated across the seam forever instead of coming
   * out. Both polygons' *edges* cross those cells, so `blocked` closes the
   * crack and the seam goes back to being invisible.
   *
   * The cost is that the blocked shell around the true surface is also not an
   * escape target, so depth runs about a cell long and a body inside a wall is
   * pushed a few pixels further out than it strictly needs. That only applies
   * to bodies already inside a wall; the outward half, which is what every
   * ordinary wall-hugging body reads, is untouched and still exact.
   */
  private static buildSignedField(
    blocked: Uint8Array,
    interior: Uint8Array,
    cols: number,
    rows: number,
    cellSize: number
  ): { clearance: Int16Array; buried: Uint8Array } {
    const toWall = NavGrid.distanceField(blocked, false, cols, rows);
    const toOpen = NavGrid.distanceField(blocked, true, cols, rows);

    // Which side of the surface each cell is on.
    //
    // The scanline fill answers this for almost every cell, and misses one kind:
    // a cell whose centre lands in the hairline between two abutting pieces. No
    // polygon contains it, so `interior` says outside — while it sits in the
    // middle of solid rock, because both pieces' *edges* cross it. Those cells
    // then kept a positive clearance, `refineNearWalls` "corrected" it to the
    // distance to the seam edge (about zero), and the result was a cliff: a cell
    // reading 0 with neighbours reading -100. That is not a rounding error, it
    // is a hole in the wall as far as anything reading the field is concerned,
    // and it made the field fall by nearly 12px per pixel travelled — enough
    // that a sphere-traced sweep could step clean through a wall.
    //
    // Burial is the honest test, and the transform already has it: how far the
    // nearest genuinely-open cell is. One cell away is the surface shell, which
    // must keep its exact positive distance because that is what routing reads.
    // Further than that and the cell is inside, whatever the scanline thought.
    const buried = new Uint8Array(cols * rows);
    for (let i = 0; i < buried.length; i++) {
      if (interior[i] === 1) buried[i] = 1;
      else if (blocked[i] === 1 && toOpen[i] > BURIED_CELLS * BURIED_CELLS) buried[i] = 1;
    }

    // A cell centre is at least half a cell from the real geometry either way,
    // so a distance measured to the nearest *cell centre* on the far side
    // overstates by up to that much. Subtract it, then floor: on both sides
    // that understates the magnitude, which is the safe direction — navigation
    // refuses a gap it could have taken, and push-out under-corrects by a
    // fraction of a pixel and finishes the job on the next frame.
    const halfCell = cellSize * 0.5;
    const clearance = new Int16Array(cols * rows);
    for (let i = 0; i < clearance.length; i++) {
      if (buried[i] === 1) {
        const depth = Math.sqrt(toOpen[i]) * cellSize - halfCell;
        clearance[i] = depth <= 0 ? 0 : -Math.min(MAX_STORED_CLEARANCE, Math.floor(depth));
      } else {
        const px = Math.sqrt(toWall[i]) * cellSize - halfCell;
        clearance[i] = px <= 0 ? 0 : Math.min(MAX_STORED_CLEARANCE, Math.floor(px));
      }
    }
    return { clearance, buried };
  }

  /**
   * Replaces the transform's answer with the *exact* distance to the wall, for
   * every cell close enough to a wall for the difference to decide anything.
   *
   * `buildSignedField` measures to the nearest blocked cell *centre*, and a
   * blocked cell's centre can be a half-diagonal away from the geometry that
   * blocked it. Subtracting a half-cell corrects the average and leaves the
   * spread: measured against the shipped map, a cell could be refused with as
   * much as 19px of room to spare on top of the margin. Per side, that is a
   * corridor needing ~93px of width for a body 55px across — and the jungle is
   * built out of gaps in the 60-90px range, so the error was not a band of
   * wasted ground, it was *closed passages*. The overlay drew them: an orange
   * moat meeting in the middle of a gap the champion visibly fits through.
   *
   * There are two sources and this pass removes both. Free cells stop
   * inheriting a neighbour's rasterization, and cells an edge merely clipped —
   * blocked to keep a wall thinner than a cell visible, but with their centres
   * out in the open — stop being worth nothing. A thin wall stays impassable
   * regardless, because the true distance *around* a thin wall is small in
   * every direction, which is the honest reason rather than a rasterization
   * artefact standing in for one.
   *
   * Only the decision band is refined. `REFINE_BAND` is well past the largest
   * `requiredClearance` any body can ask for (`NAV_MAX_TERRAIN_RADIUS` plus a
   * half-cell), by more than the transform's own worst understatement, so no
   * cell left alone can be near a threshold. That keeps this to roughly a
   * tenth of the map and a few milliseconds.
   *
   * Being exact is also strictly *safer*: the transform could overstate
   * clearance by a few pixels, which is what `NAV_MAX_ACCEPTED_OVERLAP` exists
   * to bound. A measured distance never overstates.
   */
  private static refineNearWalls(
    clearance: Int16Array,
    buried: Uint8Array,
    polygons: readonly (readonly NavPoint[])[],
    cols: number,
    rows: number,
    cellSize: number
  ): void {
    const index = NavGrid.buildSegmentIndex(polygons, cols * cellSize);
    if (index === null) return;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        // Outside the walls only, and that restriction is load-bearing rather
        // than left over.
        //
        // The segment index holds *every* polygon edge, including the internal
        // ones where a thick wall was authored as several convex boxes. From
        // outside a wall those are harmless: an internal edge is further away
        // than the surface between it and the query, so the nearest edge is
        // always a real one. From inside, an internal edge is the nearest edge
        // there is — so refining a cell 55px deep in a split slab, 5px off the
        // seam between its halves, "corrects" its depth to 5 and the body
        // resolving against it barely moves.
        //
        // The transform's own estimate has no such blind spot: it is measured
        // from the rasterized union, where a seam is buried in the middle of
        // the blocked region and there is nothing to measure to. It costs
        // about half a cell of understated depth, which push-out finishes off
        // over the following frame. Being seam-blind is the property that
        // matters here, and it is the coarse pass that has it.
        //
        // `buried`, not `interior`: a cell in the hairline between two abutting
        // pieces is not inside any polygon and would be refined to the distance
        // to that hairline — about zero — in the middle of solid wall. See
        // `buildSignedField`.
        if (buried[i] === 1) continue;
        if (clearance[i] > REFINE_BAND) continue;

        const exact = NavGrid.nearestWallDistance(
          index,
          (cx + 0.5) * cellSize,
          (cy + 0.5) * cellSize
        );
        if (exact === Infinity) continue;
        // Positive unconditionally: every buried cell was skipped above, so
        // anything reaching here is on the open side of the surface. The sign
        // used to be picked by a ternary that could never take its other branch,
        // which read as though inside cells were refined when the whole point of
        // the skip is that they must not be.
        clearance[i] = exact <= 0 ? 0 : Math.min(MAX_STORED_CLEARANCE, Math.floor(exact));
      }
    }
  }

  /**
   * Wall edges bucketed by their bounding boxes.
   *
   * `SEGMENT_BUCKET` is at least `REFINE_BAND`, which is what lets
   * `nearestWallDistance` look at a fixed 3x3 of buckets instead of searching
   * outward: the closest point of any segment within `REFINE_BAND` of a query
   * lies in a bucket at most one step away, and bbox bucketing always registers
   * a segment in the bucket holding any point of it.
   */
  private static buildSegmentIndex(
    polygons: readonly (readonly NavPoint[])[],
    size: number
  ): SegmentIndex | null {
    const coordinates: number[] = [];
    for (const polygon of polygons) {
      if (polygon.length < 2) continue;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        coordinates.push(polygon[j].x, polygon[j].y, polygon[i].x, polygon[i].y);
      }
    }
    if (coordinates.length === 0) return null;

    const cols = Math.max(1, Math.ceil(size / SEGMENT_BUCKET));
    const buckets: number[][] = [];
    for (let i = 0; i < cols * cols; i++) buckets.push([]);

    const coords = Float64Array.from(coordinates);
    for (let s = 0; s < coords.length; s += 4) {
      const fromX = Math.max(0, Math.floor(Math.min(coords[s], coords[s + 2]) / SEGMENT_BUCKET));
      const toX = Math.min(
        cols - 1,
        Math.floor(Math.max(coords[s], coords[s + 2]) / SEGMENT_BUCKET)
      );
      const fromY = Math.max(
        0,
        Math.floor(Math.min(coords[s + 1], coords[s + 3]) / SEGMENT_BUCKET)
      );
      const toY = Math.min(
        cols - 1,
        Math.floor(Math.max(coords[s + 1], coords[s + 3]) / SEGMENT_BUCKET)
      );
      for (let by = fromY; by <= toY; by++) {
        for (let bx = fromX; bx <= toX; bx++) buckets[by * cols + bx].push(s);
      }
    }
    return { cols, buckets, coords };
  }

  /**
   * Distance from a point to the nearest wall edge, or Infinity past a bucket
   * step. Kept squared until the last line: this is the inner loop of the build
   * and `Math.hypot` per segment per cell costs more than everything else here
   * put together.
   */
  private static nearestWallDistance(index: SegmentIndex, px: number, py: number): number {
    const { cols, buckets, coords } = index;
    const bx = Math.floor(px / SEGMENT_BUCKET);
    const by = Math.floor(py / SEGMENT_BUCKET);
    let best = Infinity;

    const fromY = by - 1 < 0 ? 0 : by - 1;
    const toY = by + 1 >= cols ? cols - 1 : by + 1;
    const fromX = bx - 1 < 0 ? 0 : bx - 1;
    const toX = bx + 1 >= cols ? cols - 1 : bx + 1;

    for (let y = fromY; y <= toY; y++) {
      for (let x = fromX; x <= toX; x++) {
        const bucket = buckets[y * cols + x];
        for (let k = 0; k < bucket.length; k++) {
          const s = bucket[k];
          const x1 = coords[s];
          const y1 = coords[s + 1];
          const dx = coords[s + 2] - x1;
          const dy = coords[s + 3] - y1;
          const lengthSquared = dx * dx + dy * dy;
          let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ox = px - (x1 + t * dx);
          const oy = py - (y1 + t * dy);
          const squared = ox * ox + oy * oy;
          if (squared < best) best = squared;
        }
      }
    }
    return best === Infinity ? Infinity : Math.sqrt(best);
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
   * The margin used to be a full half-cell *diagonal* — the worst-case
   * distance from a cell's centre to a body standing at its farthest corner —
   * which makes `isWalkable(p, r)` imply "a body of radius r at p does not
   * touch a wall" unconditionally. That guarantee is stronger than this game
   * needs and it was expensive: on the shipped map it left a band of ground
   * up to 86px wide that a champion's body physically fits on but navigation
   * refused to route across, 24.6% of all standable ground. `pushOutOfWalls`
   * resolves real wall contact every frame, gracefully — a route that grazes
   * a wall is corrected, not broken — so the margin only has to be wide
   * enough that the correction is never visible, not wide enough that contact
   * never happens.
   *
   * Reduced to half a cell (axis-aligned, the same correction `buildSignedField`
   * already applies once to turn "distance to a blocked cell centre" into a
   * lower bound on wall distance), a dense sweep of the shipped map — 9 points
   * per free cell, centre plus every corner and edge midpoint, ~700,000
   * samples per body size — finds this margin is not quite enough to keep the
   * guarantee unconditional: a handful of cells (3 of 713,322 for a champion,
   * 1 of 739,692 for a minion) let a body stand up to 3.7px closer to a wall
   * than its own radius. That is the deliberately accepted trade: 3.7px is
   * far smaller than the overlap `pushOutOfWalls` already corrects routinely
   * from body-to-body separation, and nothing here routes a body *through* a
   * wall — `isLineClear` still refuses any line whose cells fall short of
   * this same margin, so the walk is never more than a graze away from the
   * shipped-with guarantee. `tests/game/nav/NavGrid.test.ts` encodes the
   * bound (`NAV_MAX_ACCEPTED_OVERLAP`) rather than "always zero" — shrinking
   * this further than that measurement supports is a failing build.
   *
   * It also decides which bodies fit where. Every champion, minion and camp on
   * this map keeps both fountains, all three lanes and every camp mutually
   * reachable at this margin. A body past roughly twice champion size does not
   * — which is the same chokepoint limit `MAX_UNIT_SIZE` in Stats.ts already
   * documents, and it fails by walking as close as it can rather than by
   * refusing to move.
   */
  requiredClearance(radius: number): number {
    return radius + this.cellSize * 0.5;
  }

  /**
   * Stored clearance at a world point, in px. 0 inside a wall.
   *
   * The clamp is what keeps this method's answer identical to what it gave
   * before the field learned to go negative — everything that routes reads
   * clearance through here or compares the raw array against a non-negative
   * `required`, so navigation cannot tell the difference. Depth belongs to
   * `signedDistanceAt`.
   */
  clearanceAt(x: number, y: number): number {
    const stored = this.clearance[this.cellY(y) * this.cols + this.cellX(x)];
    return stored < 0 ? 0 : stored;
  }

  /**
   * Signed distance from a world point to the nearest wall surface: positive
   * out in the open, negative inside a wall.
   *
   * Bilinear between the four surrounding cell centres rather than the raw cell
   * value, because the callers are physics rather than routing. A body resolved
   * against a piecewise-constant field lands on one of a few hundred discrete
   * positions per cell and visibly stair-steps along a wall it walks past;
   * interpolating costs three multiplies and makes the surface a surface.
   *
   * Off the grid the edge cells are extended outward, so a query past the map
   * border answers as the border does. Nothing walks out there — `isWalkable`
   * refuses out-of-bounds outright — and giving it a defined answer keeps every
   * caller from needing its own bounds test.
   */
  signedDistanceAt(x: number, y: number): number {
    const { cellSize, cols, rows, clearance } = this;
    // -0.5 puts the sample in cell-*centre* space: world (0.5 * cellSize) is
    // the centre of cell 0, and must interpolate to exactly that cell's value.
    const gx = x / cellSize - 0.5;
    const gy = y / cellSize - 0.5;
    const fx = Math.floor(gx);
    const fy = Math.floor(gy);
    const tx = gx - fx;
    const ty = gy - fy;

    const x0 = fx < 0 ? 0 : fx > cols - 1 ? cols - 1 : fx;
    const y0 = fy < 0 ? 0 : fy > rows - 1 ? rows - 1 : fy;
    const x1 = fx + 1 < 0 ? 0 : fx + 1 > cols - 1 ? cols - 1 : fx + 1;
    const y1 = fy + 1 < 0 ? 0 : fy + 1 > rows - 1 ? rows - 1 : fy + 1;

    const rowTop = y0 * cols;
    const rowBottom = y1 * cols;
    const topLeft = clearance[rowTop + x0];
    const topRight = clearance[rowTop + x1];
    const bottomLeft = clearance[rowBottom + x0];
    const bottomRight = clearance[rowBottom + x1];

    const top = topLeft + (topRight - topLeft) * tx;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
    return top + (bottom - top) * ty;
  }

  /**
   * Unit vector pointing away from the nearest wall — the direction to push a
   * body that is in one, and the outward normal of the surface it is touching.
   *
   * Central differences on the interpolated field. The stencil widens rather
   * than giving up: a body exactly equidistant from two surfaces sits on the
   * field's medial axis, where the gradient really is zero, and that is where
   * a champion buried in the middle of a thick wall ends up. Widening finds
   * the nearer way out; the fixed vector at the end is the convention from
   * `Game.facing()`, because a direction must never be (0, 0).
   */
  outwardAt(x: number, y: number): { x: number; y: number } {
    for (const step of [this.cellSize * 0.5, this.cellSize * 2, this.cellSize * 6]) {
      const dx = this.signedDistanceAt(x + step, y) - this.signedDistanceAt(x - step, y);
      const dy = this.signedDistanceAt(x, y + step) - this.signedDistanceAt(x, y - step);
      const length = Math.hypot(dx, dy);
      if (length > 1e-6) return { x: dx / length, y: dy / length };
    }
    return { x: 0, y: -1 };
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
    return this.isLineClearAt(ax, ay, bx, by, this.requiredClearance(radius));
  }

  /**
   * `isLineClear`, but against a caller-supplied clearance rather than
   * `requiredClearance(radius)`. The one legitimate reason to reach past that
   * margin is `smoothPath`'s snapped-start check: the nav margin is what makes
   * the start of a route unwalkable in the first place when a unit is
   * standing in the moat `requiredClearance`'s doc describes, so testing
   * against that same margin can never answer "does this body actually fit
   * here" — only the bare `radius` can. Every other caller should keep using
   * `isLineClear`.
   */
  isLineClearAt(ax: number, ay: number, bx: number, by: number, required: number): boolean {
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
