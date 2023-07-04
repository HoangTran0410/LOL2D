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

export const shuffleArray = array => {
  let result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export const removeAccents = str => {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
