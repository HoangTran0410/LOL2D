const PolygonUtils = {
  getPolygonsContainer(polygons: { x: number; y: number }[][]) {
    const allPoints: { x: number; y: number }[] = [];
    for (const polygon of polygons) {
      for (const point of polygon) {
        allPoints.push(point);
      }
    }
    return this.convexHull(allPoints);
  },
  crossProduct(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) {
    return (p2.y - p1.y) * (p3.x - p2.x) - (p2.x - p1.x) * (p3.y - p2.y);
  },
  convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const n = points.length;
    const hull: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      while (hull.length >= 2 && this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], points[i]) <= 0) {
        hull.pop();
      }
      hull.push(points[i]);
    }
    const upperHullStartIndex = hull.length + 1;
    for (let i = n - 2; i >= 0; i--) {
      while (hull.length >= upperHullStartIndex && this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], points[i]) <= 0) {
        hull.pop();
      }
      hull.push(points[i]);
    }
    hull.pop();
    return hull;
  },
};
export default PolygonUtils;
