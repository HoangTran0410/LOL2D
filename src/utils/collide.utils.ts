import SAT from '@/libs/SAT';
import PolyDecomp from 'poly-decomp';

type Point = { x: number; y: number };

// Faithful port of the original collide.utils.js — same algorithms, same
// signatures. Gameplay (fog visibility, spell hitboxes) depends on these
// exact semantics; do not "improve" them without diffing against main.
const CollideUtils = {
  // using SAT library
  pointPolygon: (x: number, y: number, vertices: Point[]): boolean => {
    return SAT.pointInPolygon(
      new SAT.Vector(x, y),
      new SAT.Polygon(
        new SAT.Vector(0, 0),
        vertices.map(_ => new SAT.Vector(_.x, _.y))
      )
    );
  },

  /**
   * Convex decomposition of a concave polygon, for reuse across many point
   * tests against that same polygon.
   *
   * Split out of `pointPolygonConcave` because the decomposition depends only
   * on the polygon, never on the point — and the one caller that matters tests
   * a whole quadtree page of candidates against a single sight polygon, so
   * folding it into the point test re-ran `makeCCW` + `quickDecomp` (plus two
   * array copies) once per candidate, per observer, per frame. Prepare once,
   * test many.
   */
  prepareConcave: (vertices: Point[]): Point[][] => {
    const _vertices = vertices.map(_ => [_.x, _.y]);
    PolyDecomp.makeCCW(_vertices);
    return PolyDecomp.quickDecomp(_vertices).map((poly: number[][]) =>
      poly.map((_: number[]) => ({ x: _[0], y: _[1] }))
    );
  },

  /** Point-in-concave-polygon against an already `prepareConcave`d polygon. */
  pointPreparedConcave: (x: number, y: number, parts: Point[][]): boolean => {
    for (const part of parts) {
      if (CollideUtils.pointPolygon(x, y, part)) return true;
    }
    return false;
  },

  // using SAT library + decomp library
  pointPolygonConcave: (x: number, y: number, vertices: Point[]): boolean =>
    // Same operations in the same order as before the split, so the semantics
    // this file's header pins down are unchanged for every existing caller.
    CollideUtils.pointPreparedConcave(x, y, CollideUtils.prepareConcave(vertices)),

  // check collision between circle and arc
  circleArc: (
    circle_x: number,
    circle_y: number,
    circle_r: number,
    arc_x: number,
    arc_y: number,
    arc_r: number,
    arc_angle_start: number,
    arc_angle_end: number
  ): boolean => {
    const dx = circle_x - arc_x;
    const dy = circle_y - arc_y;
    if (Math.sqrt(dx * dx + dy * dy) > circle_r + arc_r) return false;
    const angle = Math.atan2(dy, dx);
    if (angle < arc_angle_start || angle > arc_angle_end) return false;
    return true;
  },

  // http://www.jeffreythompson.org/collision-detection/point-point.php
  pointPoint(x1: number, y1: number, x2: number, y2: number, buffer = 0): boolean {
    return (x1 - x2) * (x1 - x2) <= buffer && (y1 - y2) * (y1 - y2) <= buffer;
  },

  // http://www.jeffreythompson.org/collision-detection/point-circle.php
  pointCircle(px: number, py: number, cx: number, cy: number, r: number): boolean {
    const dx = px - cx;
    const dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy) <= r;
  },

  // http://www.jeffreythompson.org/collision-detection/circle-circle.php
  circleCircle(
    c1x: number,
    c1y: number,
    c1r: number,
    c2x: number,
    c2y: number,
    c2r: number
  ): boolean {
    const dx = c1x - c2x;
    const dy = c1y - c2y;
    return Math.sqrt(dx * dx + dy * dy) <= c1r + c2r;
  },

  // http://www.jeffreythompson.org/collision-detection/point-rect.php
  pointRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): boolean {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  },

  // http://www.jeffreythompson.org/collision-detection/rect-rect.php
  rectRect(
    r1x: number,
    r1y: number,
    r1w: number,
    r1h: number,
    r2x: number,
    r2y: number,
    r2w: number,
    r2h: number
  ): boolean {
    return r1x + r1w >= r2x && r1x <= r2x + r2w && r1y + r1h >= r2y && r1y <= r2y + r2h;
  },

  // http://www.jeffreythompson.org/collision-detection/circle-rect.php
  circleRect(
    cx: number,
    cy: number,
    radius: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number
  ): boolean {
    let testX = cx;
    let testY = cy;
    if (cx < rx) testX = rx;
    else if (cx > rx + rw) testX = rx + rw;
    if (cy < ry) testY = ry;
    else if (cy > ry + rh) testY = ry + rh;
    const dx = cx - testX;
    const dy = cy - testY;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  },

  // http://www.jeffreythompson.org/collision-detection/line-point.php
  linePoint(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    px: number,
    py: number,
    buffer = 0.1
  ): boolean {
    const dx1 = px - x1;
    const dy1 = py - y1;
    const dx2 = px - x2;
    const dy2 = py - y2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    return d1 + d2 >= lineLen - buffer && d1 + d2 <= lineLen + buffer;
  },

  // http://www.jeffreythompson.org/collision-detection/line-circle.php
  lineCircle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    cx: number,
    cy: number,
    r: number
  ): boolean {
    if (this.pointCircle(x1, y1, cx, cy, r)) return true;
    if (this.pointCircle(x2, y2, cx, cy, r)) return true;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return false;
    let dot = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
    dot = Math.max(0, Math.min(1, dot));
    const closestX = x1 + dot * dx;
    const closestY = y1 + dot * dy;
    const nearDx = closestX - cx;
    const nearDy = closestY - cy;
    return Math.sqrt(nearDx * nearDx + nearDy * nearDy) <= r;
  },

  // http://www.jeffreythompson.org/collision-detection/line-line.php
  lineLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number
  ): boolean {
    let uA =
      ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) /
      ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
    let uB =
      ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) /
      ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
    return uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1;
  },

  // http://www.jeffreythompson.org/collision-detection/line-rect.php
  lineRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number
  ): boolean {
    return (
      this.lineLine(x1, y1, x2, y2, rx, ry, rx, ry + rh) ||
      this.lineLine(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
      this.lineLine(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
      this.lineLine(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh)
    );
  },

  // http://www.jeffreythompson.org/collision-detection/poly-point.php
  polyPoint(vertices: Point[], px: number, py: number): boolean {
    let collision = false;
    let next = 0;
    for (let current = 0; current < vertices.length; current++) {
      next = current + 1;
      if (next == vertices.length) next = 0;
      let vc = vertices[current];
      let vn = vertices[next];
      if (
        ((vc.y >= py && vn.y < py) || (vc.y < py && vn.y >= py)) &&
        px < ((vn.x - vc.x) * (py - vc.y)) / (vn.y - vc.y) + vc.x
      ) {
        collision = !collision;
      }
    }
    return collision;
  },

  // http://www.jeffreythompson.org/collision-detection/poly-circle.php
  polyCircle(vertices: Point[], cx: number, cy: number, r: number): boolean {
    let next = 0;
    for (let current = 0; current < vertices.length; current++) {
      next = current + 1;
      if (next == vertices.length) next = 0;
      let vc = vertices[current];
      let vn = vertices[next];
      if (this.lineCircle(vc.x, vc.y, vn.x, vn.y, cx, cy, r)) return true;
    }
    return this.polyPoint(vertices, cx, cy);
  },

  // http://www.jeffreythompson.org/collision-detection/poly-rect.php
  polyRect(
    vertices: Point[],
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    isCheckInside = false
  ): boolean {
    let next = 0;
    for (let current = 0; current < vertices.length; current++) {
      next = current + 1;
      if (next == vertices.length) next = 0;
      let vc = vertices[current];
      let vn = vertices[next];
      if (this.lineRect(vc.x, vc.y, vn.x, vn.y, rx, ry, rw, rh)) {
        return isCheckInside ? this.polyPoint(vertices, rx, ry) : true;
      }
    }

    return false;
  },

  // http://www.jeffreythompson.org/collision-detection/poly-line.php
  polyLine(vertices: Point[], x1: number, y1: number, x2: number, y2: number): boolean {
    let next = 0;
    for (let current = 0; current < vertices.length; current++) {
      next = current + 1;
      if (next == vertices.length) next = 0;
      let x3 = vertices[current].x;
      let y3 = vertices[current].y;
      let x4 = vertices[next].x;
      let y4 = vertices[next].y;
      if (this.lineLine(x1, y1, x2, y2, x3, y3, x4, y4)) {
        return true;
      }
    }

    // never got a hit
    return false;
  },

  // http://www.jeffreythompson.org/collision-detection/poly-poly.php
  polyPoly(poly1: Point[], poly2: Point[]): boolean {
    let next = 0;
    for (let current = 0; current < poly1.length; current++) {
      next = current + 1;
      if (next == poly1.length) next = 0;
      let vc = poly1[current];
      let vn = poly1[next];
      if (this.polyLine(poly2, vc.x, vc.y, vn.x, vn.y)) return true;
      if (this.polyPoint(poly1, poly2[0].x, poly2[0].y)) return true;
    }

    return false;
  },

  // http://www.jeffreythompson.org/collision-detection/tri-point.php
  triPoint(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    px: number,
    py: number
  ): boolean {
    const areaOrig = Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1));
    const area1 = Math.abs((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py));
    const area2 = Math.abs((x2 - px) * (y3 - py) - (x3 - px) * (y2 - py));
    const area3 = Math.abs((x3 - px) * (y1 - py) - (x1 - px) * (y3 - py));
    return area1 + area2 + area3 === areaOrig;
  },
};

export default CollideUtils;
