// thanks to ChatGPT

const PolygonUtils = {
  // Function to create a container polygon that encompasses a list of polygons
  getPolygonsContainer(polygons) {
    const allPoints = [];

    // Collect all the vertices from the polygons
    for (const polygon of polygons) {
      for (const point of polygon) {
        allPoints.push(point);
      }
    }

    // Compute the convex hull of all the points
    const convexHullPoints = this.convexHull(allPoints);

    // Return the convex hull as the container polygon
    return convexHullPoints;
  },

  crossProduct(p1, p2, p3) {
    return (p2.y - p1.y) * (p3.x - p2.x) - (p2.x - p1.x) * (p3.y - p2.y);
  },

  // Function to compute the convex hull of a set of points using Graham's scan algorithm
  convexHull(points) {
    // Sort points lexicographically (first by x-coordinate, then by y-coordinate)
    points.sort((a, b) => a.x - b.x || a.y - b.y);

    const n = points.length;
    const hull = [];

    // Find the lower hull
    for (let i = 0; i < n; i++) {
      while (
        hull.length >= 2 &&
        this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], points[i]) <= 0
      ) {
        hull.pop();
      }
      hull.push(points[i]);
    }

    // Find the upper hull
    const upperHullStartIndex = hull.length + 1;
    for (let i = n - 2; i >= 0; i--) {
      while (
        hull.length >= upperHullStartIndex &&
        this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], points[i]) <= 0
      ) {
        hull.pop();
      }
      hull.push(points[i]);
    }

    // Remove duplicate points
    hull.pop();

    return hull;
  },
};

export default PolygonUtils;
