// https://prozi.github.io/detect-collisions/modules.html

import detectCollisions from 'https://cdn.jsdelivr.net/npm/detect-collisions@9.1.1/+esm';

console.log(detectCollisions);

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
