/*
visibility_polygon.js version 1.9
This code is released into the public domain - attribution is appreciated but not required.
Made by Byron Knoll.
https://github.com/byronknoll/visibility-polygon-js
Demo: http://www.byronknoll.com/visibility.html
This library can be used to construct a visibility polygon for a set of line segments.
The time complexity of this implementation is O(N log N) (where N is the total number of line segments). This is the optimal time complexity for this problem.
The following functions should be useful:
1) VisibilityPolygon.compute(position, segments)
  Computes a visibility polygon. O(N log N) time complexity (where N is the number of line segments).
  Arguments:
    position - The location of the observer. If the observer is not completely surrounded by line segments, an outer bounding-box will be automatically created (so that the visibility polygon does not extend to infinity).
    segments - A list of line segments. Each line segment should be a list of two points. Each point should be a list of two coordinates. Line segments can not intersect each other. Overlapping vertices are OK, but it is not OK if a vertex is touching the middle of a line segment. Use the "breakIntersections" function to fix intersecting line segments.
  Returns: The visibility polygon (in clockwise vertex order).
2) VisibilityPolygon.computeViewport(position, segments, viewportMinCorner, viewportMaxCorner)
  Computes a visibility polygon within the given viewport. This can be faster than the "compute" function if there are many segments outside of the viewport.
  Arguments:
    position - The location of the observer. Must be within the viewport.
    segments - A list of line segments. Line segments can not intersect each other. It is OK if line segments intersect the viewport.
    viewportMinCorner - The minimum X and Y coordinates of the viewport.
    viewportMaxCorner - The maximum X and Y coordinates of the viewport.
  Returns: The visibility polygon within the viewport (in clockwise vertex order).
3) VisibilityPolygon.inPolygon(position, polygon)
  Calculates whether a point is within a polygon. O(N) time complexity (where N is the number of points in the polygon).
  Arguments:
    position - The point to check: a list of two coordinates.
    polygon - The polygon to check: a list of points. The polygon can be specified in either clockwise or counterclockwise vertex order.
  Returns: True if "position" is within the polygon.
4) VisibilityPolygon.convertToSegments(polygons)
  Converts the given polygons to list of line segments. O(N) time complexity (where N is the number of polygons).
  Arguments: a list of polygons (in either clockwise or counterclockwise vertex order). Each polygon should be a list of points. Each point should be a list of two coordinates.
  Returns: a list of line segments.
5) VisibilityPolygon.breakIntersections(segments)
  Breaks apart line segments so that none of them intersect. O(N^2) time complexity (where N is the number of line segments).
  Arguments: a list of line segments. Each line segment should be a list of two points. Each point should be a list of two coordinates.
  Returns: a list of line segments.
Example code:
let polygons = [];
polygons.push([[-1,-1],[501,-1],[501,501],[-1,501]]);
polygons.push([[250,100],[260,140],[240,140]]);
let segments = VisibilityPolygon.convertToSegments(polygons);
segments = VisibilityPolygon.breakIntersections(segments);
let position = [60, 60];
if (VisibilityPolygon.inPolygon(position, polygons[0])) {
  let visibility = VisibilityPolygon.compute(position, segments);
}
let viewportVisibility = VisibilityPolygon.computeViewport(position, segments, [50, 50], [450, 450]);
*/

const VisibilityPolygon = {};

VisibilityPolygon.compute = function (position, segments) {
  let bounded = [];
  let minX = position[0];
  let minY = position[1];
  let maxX = position[0];
  let maxY = position[1];
  for (let i = 0; i < segments.length; ++i) {
    for (let j = 0; j < 2; ++j) {
      minX = Math.min(minX, segments[i][j][0]);
      minY = Math.min(minY, segments[i][j][1]);
      maxX = Math.max(maxX, segments[i][j][0]);
      maxY = Math.max(maxY, segments[i][j][1]);
    }
    bounded.push([
      [segments[i][0][0], segments[i][0][1]],
      [segments[i][1][0], segments[i][1][1]],
    ]);
  }
  --minX;
  --minY;
  ++maxX;
  ++maxY;
  bounded.push([
    [minX, minY],
    [maxX, minY],
  ]);
  bounded.push([
    [maxX, minY],
    [maxX, maxY],
  ]);
  bounded.push([
    [maxX, maxY],
    [minX, maxY],
  ]);
  bounded.push([
    [minX, maxY],
    [minX, minY],
  ]);
  let polygon = [];
  let sorted = VisibilityPolygon.sortPoints(position, bounded);
  let map = new Array(bounded.length);
  for (let i = 0; i < map.length; ++i) map[i] = -1;
  let heap = [];
  let start = [position[0] + 1, position[1]];
  for (let i = 0; i < bounded.length; ++i) {
    let a1 = VisibilityPolygon.angle(bounded[i][0], position);
    let a2 = VisibilityPolygon.angle(bounded[i][1], position);
    let active = false;
    if (a1 > -180 && a1 <= 0 && a2 <= 180 && a2 >= 0 && a2 - a1 > 180) active = true;
    if (a2 > -180 && a2 <= 0 && a1 <= 180 && a1 >= 0 && a1 - a2 > 180) active = true;
    if (active) {
      VisibilityPolygon.insert(i, heap, position, bounded, start, map);
    }
  }
  for (let i = 0; i < sorted.length; ) {
    let extend = false;
    let shorten = false;
    let orig = i;
    let vertex = bounded[sorted[i][0]][sorted[i][1]];
    let old_segment = heap[0];
    do {
      if (map[sorted[i][0]] != -1) {
        if (sorted[i][0] == old_segment) {
          extend = true;
          vertex = bounded[sorted[i][0]][sorted[i][1]];
        }
        VisibilityPolygon.remove(map[sorted[i][0]], heap, position, bounded, vertex, map);
      } else {
        VisibilityPolygon.insert(sorted[i][0], heap, position, bounded, vertex, map);
        if (heap[0] != old_segment) {
          shorten = true;
        }
      }
      ++i;
      if (i == sorted.length) break;
    } while (sorted[i][2] < sorted[orig][2] + VisibilityPolygon.epsilon());

    if (extend) {
      polygon.push(vertex);
      let cur = VisibilityPolygon.intersectLines(
        bounded[heap[0]][0],
        bounded[heap[0]][1],
        position,
        vertex
      );
      if (!VisibilityPolygon.equal(cur, vertex)) polygon.push(cur);
    } else if (shorten) {
      polygon.push(
        VisibilityPolygon.intersectLines(
          bounded[old_segment][0],
          bounded[old_segment][1],
          position,
          vertex
        )
      );
      polygon.push(
        VisibilityPolygon.intersectLines(bounded[heap[0]][0], bounded[heap[0]][1], position, vertex)
      );
    }
  }
  return polygon;
};

VisibilityPolygon.computeViewport = function (
  position,
  segments,
  viewportMinCorner,
  viewportMaxCorner
) {
  let brokenSegments = [];
  let viewport = [
    [viewportMinCorner[0], viewportMinCorner[1]],
    [viewportMaxCorner[0], viewportMinCorner[1]],
    [viewportMaxCorner[0], viewportMaxCorner[1]],
    [viewportMinCorner[0], viewportMaxCorner[1]],
  ];
  for (let i = 0; i < segments.length; ++i) {
    if (segments[i][0][0] < viewportMinCorner[0] && segments[i][1][0] < viewportMinCorner[0])
      continue;
    if (segments[i][0][1] < viewportMinCorner[1] && segments[i][1][1] < viewportMinCorner[1])
      continue;
    if (segments[i][0][0] > viewportMaxCorner[0] && segments[i][1][0] > viewportMaxCorner[0])
      continue;
    if (segments[i][0][1] > viewportMaxCorner[1] && segments[i][1][1] > viewportMaxCorner[1])
      continue;
    let intersections = [];
    for (let j = 0; j < viewport.length; ++j) {
      let k = j + 1;
      if (k == viewport.length) k = 0;
      if (
        VisibilityPolygon.doLineSegmentsIntersect(
          segments[i][0][0],
          segments[i][0][1],
          segments[i][1][0],
          segments[i][1][1],
          viewport[j][0],
          viewport[j][1],
          viewport[k][0],
          viewport[k][1]
        )
      ) {
        let intersect = VisibilityPolygon.intersectLines(
          segments[i][0],
          segments[i][1],
          viewport[j],
          viewport[k]
        );
        if (intersect.length != 2) continue;
        if (
          VisibilityPolygon.equal(intersect, segments[i][0]) ||
          VisibilityPolygon.equal(intersect, segments[i][1])
        )
          continue;
        intersections.push(intersect);
      }
    }
    let start = [segments[i][0][0], segments[i][0][1]];
    while (intersections.length > 0) {
      let endIndex = 0;
      let endDis = VisibilityPolygon.distance(start, intersections[0]);
      for (let j = 1; j < intersections.length; ++j) {
        let dis = VisibilityPolygon.distance(start, intersections[j]);
        if (dis < endDis) {
          endDis = dis;
          endIndex = j;
        }
      }
      brokenSegments.push([
        [start[0], start[1]],
        [intersections[endIndex][0], intersections[endIndex][1]],
      ]);
      start[0] = intersections[endIndex][0];
      start[1] = intersections[endIndex][1];
      intersections.splice(endIndex, 1);
    }
    brokenSegments.push([start, [segments[i][1][0], segments[i][1][1]]]);
  }

  let viewportSegments = [];
  for (let i = 0; i < brokenSegments.length; ++i) {
    if (
      VisibilityPolygon.inViewport(brokenSegments[i][0], viewportMinCorner, viewportMaxCorner) &&
      VisibilityPolygon.inViewport(brokenSegments[i][1], viewportMinCorner, viewportMaxCorner)
    ) {
      viewportSegments.push([
        [brokenSegments[i][0][0], brokenSegments[i][0][1]],
        [brokenSegments[i][1][0], brokenSegments[i][1][1]],
      ]);
    }
  }
  let eps = VisibilityPolygon.epsilon() * 10;
  viewportSegments.push([
    [viewportMinCorner[0] - eps, viewportMinCorner[1] - eps],
    [viewportMaxCorner[0] + eps, viewportMinCorner[1] - eps],
  ]);
  viewportSegments.push([
    [viewportMaxCorner[0] + eps, viewportMinCorner[1] - eps],
    [viewportMaxCorner[0] + eps, viewportMaxCorner[1] + eps],
  ]);
  viewportSegments.push([
    [viewportMaxCorner[0] + eps, viewportMaxCorner[1] + eps],
    [viewportMinCorner[0] - eps, viewportMaxCorner[1] + eps],
  ]);
  viewportSegments.push([
    [viewportMinCorner[0] - eps, viewportMaxCorner[1] + eps],
    [viewportMinCorner[0] - eps, viewportMinCorner[1] - eps],
  ]);
  return VisibilityPolygon.compute(position, viewportSegments);
};

VisibilityPolygon.inViewport = function (position, viewportMinCorner, viewportMaxCorner) {
  if (position[0] < viewportMinCorner[0] - VisibilityPolygon.epsilon()) return false;
  if (position[1] < viewportMinCorner[1] - VisibilityPolygon.epsilon()) return false;
  if (position[0] > viewportMaxCorner[0] + VisibilityPolygon.epsilon()) return false;
  if (position[1] > viewportMaxCorner[1] + VisibilityPolygon.epsilon()) return false;
  return true;
};

VisibilityPolygon.inPolygon = function (position, polygon) {
  let val = polygon[0][0];
  for (let i = 0; i < polygon.length; ++i) {
    val = Math.min(polygon[i][0], val);
    val = Math.min(polygon[i][1], val);
  }
  let edge = [val - 1, val - 1];
  let parity = 0;
  for (let i = 0; i < polygon.length; ++i) {
    let j = i + 1;
    if (j == polygon.length) j = 0;
    if (
      VisibilityPolygon.doLineSegmentsIntersect(
        edge[0],
        edge[1],
        position[0],
        position[1],
        polygon[i][0],
        polygon[i][1],
        polygon[j][0],
        polygon[j][1]
      )
    ) {
      let intersect = VisibilityPolygon.intersectLines(edge, position, polygon[i], polygon[j]);
      if (VisibilityPolygon.equal(position, intersect)) return true;
      if (VisibilityPolygon.equal(intersect, polygon[i])) {
        if (VisibilityPolygon.angle2(position, edge, polygon[j]) < 180) ++parity;
      } else if (VisibilityPolygon.equal(intersect, polygon[j])) {
        if (VisibilityPolygon.angle2(position, edge, polygon[i]) < 180) ++parity;
      } else {
        ++parity;
      }
    }
  }
  return parity % 2 != 0;
};

VisibilityPolygon.convertToSegments = function (polygons) {
  let segments = [];
  for (let i = 0; i < polygons.length; ++i) {
    for (let j = 0; j < polygons[i].length; ++j) {
      let k = j + 1;
      if (k == polygons[i].length) k = 0;
      segments.push([
        [polygons[i][j][0], polygons[i][j][1]],
        [polygons[i][k][0], polygons[i][k][1]],
      ]);
    }
  }
  return segments;
};

VisibilityPolygon.breakIntersections = function (segments) {
  let output = [];
  for (let i = 0; i < segments.length; ++i) {
    let intersections = [];
    for (let j = 0; j < segments.length; ++j) {
      if (i == j) continue;
      if (
        VisibilityPolygon.doLineSegmentsIntersect(
          segments[i][0][0],
          segments[i][0][1],
          segments[i][1][0],
          segments[i][1][1],
          segments[j][0][0],
          segments[j][0][1],
          segments[j][1][0],
          segments[j][1][1]
        )
      ) {
        let intersect = VisibilityPolygon.intersectLines(
          segments[i][0],
          segments[i][1],
          segments[j][0],
          segments[j][1]
        );
        if (intersect.length != 2) continue;
        if (
          VisibilityPolygon.equal(intersect, segments[i][0]) ||
          VisibilityPolygon.equal(intersect, segments[i][1])
        )
          continue;
        intersections.push(intersect);
      }
    }
    let start = [segments[i][0][0], segments[i][0][1]];
    while (intersections.length > 0) {
      let endIndex = 0;
      let endDis = VisibilityPolygon.distance(start, intersections[0]);
      for (let j = 1; j < intersections.length; ++j) {
        let dis = VisibilityPolygon.distance(start, intersections[j]);
        if (dis < endDis) {
          endDis = dis;
          endIndex = j;
        }
      }
      output.push([
        [start[0], start[1]],
        [intersections[endIndex][0], intersections[endIndex][1]],
      ]);
      start[0] = intersections[endIndex][0];
      start[1] = intersections[endIndex][1];
      intersections.splice(endIndex, 1);
    }
    output.push([start, [segments[i][1][0], segments[i][1][1]]]);
  }
  return output;
};

VisibilityPolygon.epsilon = function () {
  return 0.0000001;
};

VisibilityPolygon.equal = function (a, b) {
  if (
    Math.abs(a[0] - b[0]) < VisibilityPolygon.epsilon() &&
    Math.abs(a[1] - b[1]) < VisibilityPolygon.epsilon()
  )
    return true;
  return false;
};

VisibilityPolygon.remove = function (index, heap, position, segments, destination, map) {
  map[heap[index]] = -1;
  if (index == heap.length - 1) {
    heap.pop();
    return;
  }
  heap[index] = heap.pop();
  map[heap[index]] = index;
  let cur = index;
  let parent = VisibilityPolygon.parent(cur);
  if (
    cur != 0 &&
    VisibilityPolygon.lessThan(heap[cur], heap[parent], position, segments, destination)
  ) {
    while (cur > 0) {
      let parent = VisibilityPolygon.parent(cur);
      if (!VisibilityPolygon.lessThan(heap[cur], heap[parent], position, segments, destination)) {
        break;
      }
      map[heap[parent]] = cur;
      map[heap[cur]] = parent;
      let temp = heap[cur];
      heap[cur] = heap[parent];
      heap[parent] = temp;
      cur = parent;
    }
  } else {
    while (true) {
      let left = VisibilityPolygon.child(cur);
      let right = left + 1;
      if (
        left < heap.length &&
        VisibilityPolygon.lessThan(heap[left], heap[cur], position, segments, destination) &&
        (right == heap.length ||
          VisibilityPolygon.lessThan(heap[left], heap[right], position, segments, destination))
      ) {
        map[heap[left]] = cur;
        map[heap[cur]] = left;
        let temp = heap[left];
        heap[left] = heap[cur];
        heap[cur] = temp;
        cur = left;
      } else if (
        right < heap.length &&
        VisibilityPolygon.lessThan(heap[right], heap[cur], position, segments, destination)
      ) {
        map[heap[right]] = cur;
        map[heap[cur]] = right;
        let temp = heap[right];
        heap[right] = heap[cur];
        heap[cur] = temp;
        cur = right;
      } else break;
    }
  }
};

VisibilityPolygon.insert = function (index, heap, position, segments, destination, map) {
  let intersect = VisibilityPolygon.intersectLines(
    segments[index][0],
    segments[index][1],
    position,
    destination
  );
  if (intersect.length == 0) return;
  let cur = heap.length;
  heap.push(index);
  map[index] = cur;
  while (cur > 0) {
    let parent = VisibilityPolygon.parent(cur);
    if (!VisibilityPolygon.lessThan(heap[cur], heap[parent], position, segments, destination)) {
      break;
    }
    map[heap[parent]] = cur;
    map[heap[cur]] = parent;
    let temp = heap[cur];
    heap[cur] = heap[parent];
    heap[parent] = temp;
    cur = parent;
  }
};

VisibilityPolygon.lessThan = function (index1, index2, position, segments, destination) {
  let inter1 = VisibilityPolygon.intersectLines(
    segments[index1][0],
    segments[index1][1],
    position,
    destination
  );
  let inter2 = VisibilityPolygon.intersectLines(
    segments[index2][0],
    segments[index2][1],
    position,
    destination
  );
  if (!VisibilityPolygon.equal(inter1, inter2)) {
    let d1 = VisibilityPolygon.distance(inter1, position);
    let d2 = VisibilityPolygon.distance(inter2, position);
    return d1 < d2;
  }
  let end1 = 0;
  if (VisibilityPolygon.equal(inter1, segments[index1][0])) end1 = 1;
  let end2 = 0;
  if (VisibilityPolygon.equal(inter2, segments[index2][0])) end2 = 1;
  let a1 = VisibilityPolygon.angle2(segments[index1][end1], inter1, position);
  let a2 = VisibilityPolygon.angle2(segments[index2][end2], inter2, position);
  if (a1 < 180) {
    if (a2 > 180) return true;
    return a2 < a1;
  }
  return a1 < a2;
};

VisibilityPolygon.parent = function (index) {
  return Math.floor((index - 1) / 2);
};

VisibilityPolygon.child = function (index) {
  return 2 * index + 1;
};

VisibilityPolygon.angle2 = function (a, b, c) {
  let a1 = VisibilityPolygon.angle(a, b);
  let a2 = VisibilityPolygon.angle(b, c);
  let a3 = a1 - a2;
  if (a3 < 0) a3 += 360;
  if (a3 > 360) a3 -= 360;
  return a3;
};

VisibilityPolygon.sortPoints = function (position, segments) {
  let points = new Array(segments.length * 2);
  for (let i = 0; i < segments.length; ++i) {
    for (let j = 0; j < 2; ++j) {
      let a = VisibilityPolygon.angle(segments[i][j], position);
      points[2 * i + j] = [i, j, a];
    }
  }
  points.sort(function (a, b) {
    return a[2] - b[2];
  });
  return points;
};

VisibilityPolygon.angle = function (a, b) {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
};

VisibilityPolygon.intersectLines = function (a1, a2, b1, b2) {
  let dbx = b2[0] - b1[0];
  let dby = b2[1] - b1[1];
  let dax = a2[0] - a1[0];
  let day = a2[1] - a1[1];

  let u_b = dby * dax - dbx * day;
  if (u_b != 0) {
    let ua = (dbx * (a1[1] - b1[1]) - dby * (a1[0] - b1[0])) / u_b;
    return [a1[0] - ua * -dax, a1[1] - ua * -day];
  }
  return [];
};

VisibilityPolygon.distance = function (a, b) {
  let dx = a[0] - b[0];
  let dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

VisibilityPolygon.isOnSegment = function (xi, yi, xj, yj, xk, yk) {
  return (
    (xi <= xk || xj <= xk) &&
    (xk <= xi || xk <= xj) &&
    (yi <= yk || yj <= yk) &&
    (yk <= yi || yk <= yj)
  );
};

VisibilityPolygon.computeDirection = function (xi, yi, xj, yj, xk, yk) {
  let a = (xk - xi) * (yj - yi);
  let b = (xj - xi) * (yk - yi);
  return a < b ? -1 : a > b ? 1 : 0;
};

VisibilityPolygon.doLineSegmentsIntersect = function (x1, y1, x2, y2, x3, y3, x4, y4) {
  let d1 = VisibilityPolygon.computeDirection(x3, y3, x4, y4, x1, y1);
  let d2 = VisibilityPolygon.computeDirection(x3, y3, x4, y4, x2, y2);
  let d3 = VisibilityPolygon.computeDirection(x1, y1, x2, y2, x3, y3);
  let d4 = VisibilityPolygon.computeDirection(x1, y1, x2, y2, x4, y4);
  return (
    (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) ||
    (d1 == 0 && VisibilityPolygon.isOnSegment(x3, y3, x4, y4, x1, y1)) ||
    (d2 == 0 && VisibilityPolygon.isOnSegment(x3, y3, x4, y4, x2, y2)) ||
    (d3 == 0 && VisibilityPolygon.isOnSegment(x1, y1, x2, y2, x3, y3)) ||
    (d4 == 0 && VisibilityPolygon.isOnSegment(x1, y1, x2, y2, x4, y4))
  );
};

export default VisibilityPolygon;
