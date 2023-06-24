export function hasFlag(target, flag) {
  return (target & flag) === flag;
}

export const statusFlagsToString = (status, statusFlags) => {
  let result = [];
  for (let key in statusFlags) {
    if (status & statusFlags[key]) {
      result.push(key);
    }
  }
  return result;
};

// RectMode: CORNER
export const rectToVertices = (rx, ry, rw, rh, angle, anchor) => {
  let vertices = [];
  vertices.push({ x: rx, y: ry }); // top left
  vertices.push({ x: rx + rw, y: ry }); // top right
  vertices.push({ x: rx + rw, y: ry + rh }); // bottom right
  vertices.push({ x: rx, y: ry + rh }); // bottom left
  if (angle !== 0) {
    if (!anchor) anchor = { x: rx, y: ry };
    vertices = rotateVerticesWithAnchor(vertices, angle, anchor);
  }
  return vertices;
};

export const rotateVerticesWithAnchor = (vertices, angle, anchor) => {
  let result = [];
  for (let vertex of vertices) {
    let x = vertex.x - anchor.x;
    let y = vertex.y - anchor.y;
    let rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
    let rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
    result.push({ x: rotatedX + anchor.x, y: rotatedY + anchor.y });
  }
  return result;
};

// using SAT.js
export const collidePolygonPoint = (vertices, px, py) => {
  let collision = SAT.pointInPolygon(
    new SAT.Vector(px, py),
    new SAT.Polygon(
      new SAT.Vector(),
      vertices.map(v => new SAT.Vector(v.x, v.y))
    )
  );
  return collision;
};
