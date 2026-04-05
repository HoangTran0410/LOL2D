import SAT from 'sat';
import PolyDecomp from 'poly-decomp';

type Point = { x: number; y: number };

const CollideUtils = {
  pointPolygon(x: number, y: number, vertices: Point[]): boolean {
    return SAT.pointInPolygon(
      new SAT.Vector(x, y),
      new SAT.Polygon(new SAT.Vector(0, 0), vertices.map(_ => new SAT.Vector(_.x, _.y)))
    );
  },

  pointPolygonConcave(x: number, y: number, vertices: Point[]): boolean {
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      const v3 = vertices[(i + 2) % n];
      if (this.triPoint(v1.x, v1.y, v2.x, v2.y, v3.x, v3.y, x, y)) return true;
    }
    return false;
  },

  circleArc(cx: number, cy: number, arcRadius: number, startAngle: number, endAngle: number, targetX: number, targetY: number): boolean {
    let diff = endAngle - startAngle;
    if (diff < 0) diff += Math.PI * 2;
    if (diff > Math.PI * 2) diff = Math.PI * 2;
    let end = endAngle;
    if (end < startAngle) end += Math.PI * 2;
    let targetAngle = Math.atan2(targetY - cy, targetX - cx);
    if (targetAngle < startAngle && end > Math.PI * 2) targetAngle += Math.PI * 2;
    const d = Math.sqrt((targetX - cx) ** 2 + (targetY - cy) ** 2);
    return d <= arcRadius && d >= arcRadius - 20 && targetAngle >= startAngle && targetAngle <= end;
  },

  pointPoint(x1: number, y1: number, x2: number, y2: number): boolean {
    return x1 === x2 && y1 === y2;
  },

  pointCircle(px: number, py: number, cx: number, cy: number, cr: number): boolean {
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= cr * cr;
  },

  circleCircle(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy <= (r1 + r2) * (r1 + r2);
  },

  pointRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): boolean {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  },

  rectRect(x1: number, y1: number, w1: number, h1: number, x2: number, y2: number, w2: number, h2: number): boolean {
    const axes = [
      { x1: x1, y1: y1, x2: x1, y2: y1 + h1 },
      { x1: x2, y1: y2, x2: x2, y2: y2 + h2 },
    ];
    for (const axis of axes) {
      const minA = Math.min(x1, x1 + w1);
      const maxA = Math.max(x1, x1 + w1);
      const minB = Math.min(x2, x2 + w2);
      const maxB = Math.max(x2, x2 + w2);
      if (maxA < minB || minA > maxB) return false;
    }
    return true;
  },

  circleRect(cx: number, cy: number, cr: number, rx: number, ry: number, rw: number, rh: number): boolean {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= cr * cr;
  },

  linePoint(x1: number, y1: number, x2: number, y2: number, px: number, py: number, threshold = 1): boolean {
    const d = this.distToLine(x1, y1, x2, y2, px, py);
    return d <= threshold;
  },

  distToLine(x1: number, y1: number, x2: number, y2: number, px: number, py: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    const nearX = x1 + t * dx;
    const nearY = y1 + t * dy;
    return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
  },

  lineCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, cr: number): boolean {
    return this.distToLine(x1, y1, x2, y2, cx, cy) <= cr;
  },

  lineLine(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
    const uA = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
    const uB = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
    return uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1;
  },

  lineRect(x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rw: number, rh: number): boolean {
    const left = this.lineLine(x1, y1, x2, y2, rx, ry, rx, ry + rh);
    const right = this.lineLine(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh);
    const top = this.lineLine(x1, y1, x2, y2, rx, ry, rx + rw, ry);
    const bottom = this.lineLine(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh);
    return left || right || top || bottom;
  },

  polyPoint(vertices: Point[], px: number, py: number): boolean {
    let collisions = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      if ((v1.y > py) !== (v2.y > py) && px < ((v2.x - v1.x) * (py - v1.y)) / (v2.y - v1.y) + v1.x) {
        collisions++;
      }
    }
    return collisions % 2 === 1;
  },

  polyCircle(vertices: Point[], cx: number, cy: number, cr: number): boolean {
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const t = Math.max(0, Math.min(1, ((cx - v1.x) * dx + (cy - v1.y) * dy) / (dx * dx + dy * dy)));
      const nearX = v1.x + t * dx;
      const nearY = v1.y + t * dy;
      if ((cx - nearX) ** 2 + (cy - nearY) ** 2 <= cr * cr) return true;
    }
    return this.polyPoint(vertices, cx, cy);
  },

  polyRect(vertices: Point[], rx: number, ry: number, rw: number, rh: number): boolean {
    const rectVerts: Point[] = [
      { x: rx, y: ry },
      { x: rx + rw, y: ry },
      { x: rx + rw, y: ry + rh },
      { x: rx, y: ry + rh },
    ];
    return this.polyPoly(vertices, rectVerts);
  },

  polyLine(vertices: Point[], x1: number, y1: number, x2: number, y2: number): boolean {
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      if (this.lineLine(x1, y1, x2, y2, v1.x, v1.y, v2.x, v2.y)) return true;
    }
    return false;
  },

  polyPoly(polyA: Point[], polyB: Point[]): boolean {
    const polygons = [polyA, polyB];
    for (let p = 0; p < polygons.length; p++) {
      const polygon = polygons[p];
      const n = polygon.length;
      for (let i = 0; i < n; i++) {
        const v1 = polygon[i];
        const v2 = polygon[(i + 1) % n];
        const edge = { x: v2.x - v1.x, y: v2.y - v1.y };
        const axis = { x: -edge.y, y: edge.x };
        const len = Math.sqrt(axis.x ** 2 + axis.y ** 2);
        axis.x /= len;
        axis.y /= len;
        let minA = Infinity, maxA = -Infinity;
        let minB = Infinity, maxB = -Infinity;
        for (const v of polyA) {
          const proj = v.x * axis.x + v.y * axis.y;
          minA = Math.min(minA, proj);
          maxA = Math.max(maxA, proj);
        }
        for (const v of polyB) {
          const proj = v.x * axis.x + v.y * axis.y;
          minB = Math.min(minB, proj);
          maxB = Math.max(maxB, proj);
        }
        if (maxA < minB || minA > maxB) return false;
      }
    }
    return true;
  },

  triPoint(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, px: number, py: number): boolean {
    const areaOrig = Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1));
    const area1 = Math.abs((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py));
    const area2 = Math.abs((x2 - px) * (y3 - py) - (x3 - px) * (y2 - py));
    const area3 = Math.abs((x3 - px) * (y1 - py) - (x1 - px) * (y3 - py));
    return Math.abs(area1 + area2 + area3 - areaOrig) < 1;
  },
};

export default CollideUtils;
