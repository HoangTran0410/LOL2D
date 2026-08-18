import CollideUtils from '@/utils/collide.utils';

/**
 * `qtIndex` answers "which of my four child quadrants does this area touch?"
 * as a bitmask rather than a `number[]`.
 *
 * It is the single hottest call in the tree — once per object per level on
 * every insert (the whole tree is rebuilt each tick) and once per node visited
 * on every query — and the array it used to return was pure garbage, thrown
 * away by the caller's loop. Circle and Line were worse still: each call also
 * built a 4-entry array of 2-entry arrays to name the child origins, so five
 * allocations to return at most four small integers.
 *
 * A mask cannot be reused-as-scratch wrongly either: `insert` recurses while
 * iterating its own result, so a shared scratch array would have been
 * clobbered by the recursive call. A number is copied by value.
 */
const QUADRANT_TOP_RIGHT = 1;
const QUADRANT_TOP_LEFT = 2;
const QUADRANT_BOTTOM_LEFT = 4;
const QUADRANT_BOTTOM_RIGHT = 8;
/** Child index i is set in the mask iff `mask & (1 << i)`. */
const QUADRANT_COUNT = 4;

export class Rectangle {
  x: number;
  y: number;
  w: number;
  h: number;
  data: any;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Dedupe marker for the current `Quadtree.retrieve` — see `_collect`. */
  _qtStamp = 0;

  constructor({ x, y, w, h, data }: { x: number; y: number; w: number; h: number; data?: any }) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.data = data;
    this.bounds = { minX: x, minY: y, maxX: x + w, maxY: y + h }; // for BVH
  }

  qtIndex({ x, y, w, h }: { x: number; y: number; w: number; h: number }): number {
    let quadrants = 0;
    const boundsCenterX = x + w / 2;
    const boundsCenterY = y + h / 2;
    const startIsNorth = this.y < boundsCenterY;
    const startIsWest = this.x < boundsCenterX;
    const endIsEast = this.x + this.w > boundsCenterX;
    const endIsSouth = this.y + this.h > boundsCenterY;
    // top-right quad
    if (startIsNorth && endIsEast) quadrants |= QUADRANT_TOP_RIGHT;
    // top-left quad
    if (startIsWest && startIsNorth) quadrants |= QUADRANT_TOP_LEFT;
    // bottom-left quad
    if (startIsWest && endIsSouth) quadrants |= QUADRANT_BOTTOM_LEFT;
    // bottom-right quad
    if (endIsEast && endIsSouth) quadrants |= QUADRANT_BOTTOM_RIGHT;
    return quadrants;
  }

  // prettier-ignore
  intersect(other: Rectangle | Circle | Line): boolean {
    if (other instanceof Rectangle) {
      return CollideUtils.rectRect(this.x, this.y, this.w, this.h, other.x, other.y, other.w, other.h);
    }
    if (other instanceof Circle) {
      return CollideUtils.circleRect(other.x, other.y, other.r, this.x, this.y, this.w, this.h);
    }
    if (other instanceof Line) {
      return CollideUtils.lineRect(other.x1, other.y1, other.x2, other.y2, this.x, this.y, this.w, this.h);
    }
    return false;
  }
}

export class Circle {
  x: number;
  y: number;
  r: number;
  data: any;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Dedupe marker for the current `Quadtree.retrieve` — see `_collect`. */
  _qtStamp = 0;

  constructor({ x, y, r, data }: { x: number; y: number; r: number; data?: any }) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.data = data;
    this.bounds = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r }; // for BVH
  }

  qtIndex({ x, y, w, h }: { x: number; y: number; w: number; h: number }): number {
    const w2 = w / 2;
    const h2 = h / 2;
    const x2 = x + w2;
    const y2 = y + h2;
    // Child origins, in node-index order, written out rather than built as an
    // array of arrays — see the note on QUADRANT_TOP_RIGHT. Spelled out per
    // quadrant instead of via a local helper because a closure here would be
    // the very allocation this is removing.
    const cx = this.x;
    const cy = this.y;
    const r = this.r;
    let quadrants = 0;
    if (Circle.intersectRect(cx, cy, r, x2, y, x2 + w2, y + h2)) quadrants |= QUADRANT_TOP_RIGHT;
    if (Circle.intersectRect(cx, cy, r, x, y, x + w2, y + h2)) quadrants |= QUADRANT_TOP_LEFT;
    if (Circle.intersectRect(cx, cy, r, x, y2, x + w2, y2 + h2)) quadrants |= QUADRANT_BOTTOM_LEFT;
    if (Circle.intersectRect(cx, cy, r, x2, y2, x2 + w2, y2 + h2))
      quadrants |= QUADRANT_BOTTOM_RIGHT;
    return quadrants;
  }

  static intersectRect(
    x: number,
    y: number,
    r: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    const deltaX = x - Math.max(minX, Math.min(x, maxX));
    const deltaY = y - Math.max(minY, Math.min(y, maxY));
    return deltaX * deltaX + deltaY * deltaY < r * r;
  }

  // prettier-ignore
  intersect(other: Rectangle | Circle | Line): boolean {
    if (other instanceof Rectangle) {
      return CollideUtils.circleRect(this.x, this.y, this.r, other.x, other.y, other.w, other.h);
    }
    if (other instanceof Circle) {
      return CollideUtils.circleCircle(this.x, this.y, this.r, other.x, other.y, other.r);
    }
    if (other instanceof Line) {
      return CollideUtils.lineCircle(other.x1, other.y1, other.x2, other.y2, this.x, this.y, this.r);
    }
    return false;
  }
}

export class Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  data: any;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Dedupe marker for the current `Quadtree.retrieve` — see `_collect`. */
  _qtStamp = 0;

  constructor({
    x1,
    y1,
    x2,
    y2,
    data,
  }: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    data?: any;
  }) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.data = data;
    this.bounds = {
      minX: Math.min(x1, x2),
      minY: Math.min(y1, y2),
      maxX: Math.max(x1, x2),
      maxY: Math.max(y1, y2),
    }; // for BVH
  }

  qtIndex({ x, y, w, h }: { x: number; y: number; w: number; h: number }): number {
    const w2 = w / 2;
    const h2 = h / 2;
    const qx = x + w2;
    const qy = y + h2;
    // Same shape as Circle.qtIndex above, and spelled out for the same reason.
    const ax = this.x1;
    const ay = this.y1;
    const bx = this.x2;
    const by = this.y2;
    let quadrants = 0;
    if (Line.intersectRect(ax, ay, bx, by, qx, y, qx + w2, y + h2)) quadrants |= QUADRANT_TOP_RIGHT;
    if (Line.intersectRect(ax, ay, bx, by, x, y, x + w2, y + h2)) quadrants |= QUADRANT_TOP_LEFT;
    if (Line.intersectRect(ax, ay, bx, by, x, qy, x + w2, qy + h2))
      quadrants |= QUADRANT_BOTTOM_LEFT;
    if (Line.intersectRect(ax, ay, bx, by, qx, qy, qx + w2, qy + h2))
      quadrants |= QUADRANT_BOTTOM_RIGHT;
    return quadrants;
  }

  static intersectRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): boolean {
    // Completely outside
    if (
      (x1 <= minX && x2 <= minX) ||
      (y1 <= minY && y2 <= minY) ||
      (x1 >= maxX && x2 >= maxX) ||
      (y1 >= maxY && y2 >= maxY)
    )
      return false;
    // Single point inside
    if (
      (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) ||
      (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY)
    )
      return true;
    const m = (y2 - y1) / (x2 - x1);
    let y = m * (minX - x1) + y1;
    if (y > minY && y < maxY) return true;
    y = m * (maxX - x1) + y1;
    if (y > minY && y < maxY) return true;
    let x = (minY - y1) / m + x1;
    if (x > minX && x < maxX) return true;
    x = (maxY - y1) / m + x1;
    if (x > minX && x < maxX) return true;
    return false;
  }

  // prettier-ignore
  intersect(other: Rectangle | Circle | Line): boolean {
    if (other instanceof Rectangle) {
      return CollideUtils.lineRect(this.x1, this.y1, this.x2, this.y2, other.x, other.y, other.w, other.h);
    }
    if (other instanceof Circle) {
      return CollideUtils.lineCircle(this.x1, this.y1, this.x2, this.y2, other.x, other.y, other.r);
    }
    if (other instanceof Line) {
      return CollideUtils.lineLine(this.x1, this.y1, this.x2, this.y2, other.x1, other.y1, other.x2, other.y2);
    }
    return false;
  }
}

export interface QuadtreeConfig {
  x?: number;
  y?: number;
  w: number;
  h: number;
  maxObjects?: number;
  maxLevels?: number;
}

export class Quadtree {
  /**
   * Monotonic id for the current `retrieve` walk, shared by every tree in the
   * process so nested queries (a vision filter querying the terrain tree from
   * inside an object-tree query) can never be handed the same stamp.
   */
  private static _retrieveStamp = 0;

  bounds: { x: number; y: number; w: number; h: number };
  maxObjects: number;
  maxLevels: number;
  level: number;
  objects: any[];
  nodes: Quadtree[];

  constructor(
    { x = 0, y = 0, w, h, maxObjects = 10, maxLevels = 4 }: QuadtreeConfig = { w: 0, h: 0 },
    level: number = 0
  ) {
    this.bounds = { x, y, w, h };
    this.maxObjects = typeof maxObjects === 'number' ? maxObjects : 10;
    this.maxLevels = typeof maxLevels === 'number' ? maxLevels : 4;
    this.level = level;
    this.objects = [];
    this.nodes = [];
  }

  getIndex(areaObj: { qtIndex: (bounds: any) => number }): number {
    return areaObj.qtIndex(this.bounds);
  }

  split(): void {
    const level = this.level + 1;
    const w = this.bounds.w / 2;
    const h = this.bounds.h / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;
    // Child origins in node-index order (TR, TL, BL, BR), written out rather
    // than built as a throwaway `coords` array.
    const maxObjects = this.maxObjects;
    const maxLevels = this.maxLevels;
    this.nodes[0] = new Quadtree({ x: x + w, y, w, h, maxObjects, maxLevels }, level);
    this.nodes[1] = new Quadtree({ x, y, w, h, maxObjects, maxLevels }, level);
    this.nodes[2] = new Quadtree({ x, y: y + h, w, h, maxObjects, maxLevels }, level);
    this.nodes[3] = new Quadtree({ x: x + w, y: y + h, w, h, maxObjects, maxLevels }, level);
  }

  insert(areaObj: { qtIndex: (bounds: any) => number }): void {
    // if we have subnodes, call insert on matching subnodes
    if (this.nodes.length) {
      const quadrants = this.getIndex(areaObj);
      for (let i = 0; i < QUADRANT_COUNT; i++) {
        if (quadrants & (1 << i)) this.nodes[i].insert(areaObj);
      }
      return;
    }
    // otherwise, store object here
    this.objects.push(areaObj);
    // maxObjects reached
    if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
      // split if we don't already have subnodes
      if (!this.nodes.length) {
        this.split();
      }
      // add all objects to their corresponding subnode
      for (let i = 0; i < this.objects.length; i++) {
        const object = this.objects[i];
        const quadrants = this.getIndex(object);
        for (let k = 0; k < QUADRANT_COUNT; k++) {
          if (quadrants & (1 << k)) this.nodes[k].insert(object);
        }
      }
      // clean up this node — truncate rather than rebind, so the array itself
      // survives the tick instead of becoming garbage on every split.
      this.objects.length = 0;
    }
  }

  retrieve(
    areaObj: { qtIndex: (bounds: any) => number; intersect: (other: any) => boolean },
    cleanUp = true
  ): any[] {
    if (!cleanUp) {
      // Internal recursive step (called by a parent node's cleanUp pass):
      // just gather this node's + matching children's objects, duplicates
      // and all. Only the root call below dedupes/filters, so this path is
      // left as-is for anyone calling retrieve(area, false) directly.
      const quadrants = this.getIndex(areaObj);
      let returnObjects = this.objects;
      if (this.nodes.length) {
        for (let i = 0; i < QUADRANT_COUNT; i++) {
          if (quadrants & (1 << i)) {
            returnObjects = returnObjects.concat(this.nodes[i].retrieve(areaObj, false));
          }
        }
      }
      return returnObjects;
    }

    // Root call: one depth-first walk that dedupes, intersect-tests and
    // collects in a single pass into a single array.
    //
    // Dedupe is a stamp written onto the area object itself rather than a
    // `Set`: an object inserted into several quadrants is visited several
    // times, and comparing one number beats hashing a reference — a query
    // now allocates exactly one array instead of a Set plus an accumulator
    // plus the array `.filter` returned. The stamp is bumped per query and
    // never reset, so it cannot collide with a previous one.
    //
    // Traversal order (this node's own objects, then each matching child in
    // index order) is unchanged, and the intersect test moved inside the walk
    // cannot reorder anything, so callers still see first-occurrence order.
    const stamp = ++Quadtree._retrieveStamp;
    const returnObjects: any[] = [];
    this._collect(areaObj, returnObjects, stamp);
    return returnObjects;
  }

  private _collect(
    areaObj: { qtIndex: (bounds: any) => number; intersect: (other: any) => boolean },
    accumulator: any[],
    stamp: number
  ): void {
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      // Stamp before testing: a rejected object must still be marked seen, or
      // the next quadrant holding it pays for the same intersect test again.
      if (obj._qtStamp === stamp) continue;
      obj._qtStamp = stamp;
      if (areaObj.intersect(obj)) accumulator.push(obj);
    }
    if (this.nodes.length) {
      const quadrants = this.getIndex(areaObj);
      for (let i = 0; i < QUADRANT_COUNT; i++) {
        if (quadrants & (1 << i)) this.nodes[i]._collect(areaObj, accumulator, stamp);
      }
    }
  }

  clear(): void {
    this.objects.length = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes.length) {
        this.nodes[i].clear();
      }
    }
    this.nodes = [];
  }
}
