// SAT.js - Separating Axis Theorem collision detection library
// MIT License - https://github.com/jriecken/sat-js

declare class Vector {
  constructor(x?: number, y?: number);
  x: number;
  y: number;
  copy(other: Vector): Vector;
  clone(): Vector;
  perp(): Vector;
  rotate(angle: number): Vector;
  reverse(): Vector;
  normalize(): Vector;
  add(other: Vector): Vector;
  sub(other: Vector): Vector;
  scale(s: number): Vector;
  dot(other: Vector): number;
  cross(other: Vector): number;
  len(): number;
  length(): number;
}

declare class Circle {
  constructor(pos: Vector, r: number);
  pos: Vector;
  r: number;
}

declare class Polygon {
  constructor(pos: Vector, vertices: Vector[]);
  pos: Vector;
  vertices: Vector[];
  angle: number;
  setAngle(angle: number): Polygon;
  setOffset(x: number, y: number): Polygon;
  setOffset(offset: Vector): Polygon;
}

declare class Response {
  constructor();
  a: any;
  b: any;
  overlap: number;
  overlapV: Vector;
  overlapN: Vector;
  clear(): Response;
}

declare namespace SAT {
  class Vector {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    copy(other: Vector): Vector;
    clone(): Vector;
    perp(): Vector;
    rotate(angle: number): Vector;
    reverse(): Vector;
    normalize(): Vector;
    add(other: Vector): Vector;
    sub(other: Vector): Vector;
    scale(s: number): Vector;
    dot(other: Vector): number;
    cross(other: Vector): number;
    len(): number;
    length(): number;
  }
  class Circle {
    constructor(pos: Vector, r: number);
    pos: Vector;
    r: number;
  }
  class Polygon {
    constructor(pos: Vector, vertices: Vector[]);
    pos: Vector;
    vertices: Vector[];
    angle: number;
    setAngle(angle: number): Polygon;
    setOffset(x: number, y: number): Polygon;
    setOffset(offset: Vector): Polygon;
  }
  class Response {
    constructor();
    a: any;
    b: any;
    overlap: number;
    overlapV: Vector;
    overlapN: Vector;
    clear(): Response;
  }

  function testCircleCircle(c1: Circle, c2: Circle, response?: Response): boolean;
  function testPolygonCircle(polygon: Polygon, circle: Circle, response?: Response): boolean;
  function testCirclePolygon(circle: Circle, polygon: Polygon, response?: Response): boolean;
  function testPolygonPolygon(a: Polygon, b: Polygon, response?: Response): boolean;
  function pointInPolygon(point: Vector, polygon: Polygon): boolean;
}

export default SAT;
export { Vector, Circle, Polygon, Response };