// https://prozi.github.io/detect-collisions/index.html

import detectCollisions from 'https://cdn.jsdelivr.net/npm/detect-collisions@9.1.1/+esm';

export const {
  // Enumerations
  BodyType,

  // Classes
  Box,
  Circle,
  Ellipse,
  Line,
  Point,
  Polygon,
  System,

  // Interfaces
  BodyOptions,
  BodyProps,
  ChildrenData,
  Data,
  GetAABBAsBox,
  PotentialVector,
  RaycastHit,
  Vector,

  // Type aliases
  Body,
  CheckCollisionCallback,
  DecompPoint,
  DecompPolygon,
  Leaf,
  SATTest,

  // Variables
  DEG2RAD,
  RAD2DEG,

  // Functions
  bodyMoved,
  checkAInB,
  circleInCircle,
  circleInPolygon,
  circleOutsidePolygon,
  clockwise,
  clonePointsArray,
  createBox,
  createEllipse,
  dashLineTo,
  deg2rad,
  distance,
  drawBVH,
  drawPolygon,
  ensureConvex,
  ensurePolygonPoints,
  ensureVectorPoint,
  extendBody,
  getBounceDirection,
  getSATTest,
  intersectAABB,
  intersectLineCircle,
  intersectLineLine,
  intersectLineLineFast,
  intersectLinePolygon,
  isSimple,
  mapArrayToVector,
  mapVectorToArray,
  notIntersectAABB,
  pointInPolygon,
  pointOnCircle,
  polygonInCircle,
  polygonInPolygon,
  rad2deg,
} = detectCollisions;

// use p5.js to draw
export const drawBody = body => {
  switch (body.type) {
    case BodyType.Point:
      point(body.pos.x, body.pos.y);
      break;
    case BodyType.Line:
    case BodyType.Polygon:
    case BodyType.Ellipse:
    case BodyType.Box:
      beginShape();
      body.calcPoints.forEach(p => vertex(p.x + body.pos.x, p.y + body.pos.y));
      endShape(CLOSE);
      break;
    case BodyType.Circle:
      circle(body.pos.x + body.offset.x, body.pos.y + body.offset.y, body.r * 2);
      break;
  }
};
