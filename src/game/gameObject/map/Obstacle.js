import SAT from '../../../../libs/SAT.js';
import { Rectangle } from '../../../../libs/quadtree.js';
import TerrainType from '../../enums/TerrainType.js';

export default class Obstacle {
  constructor(x, y, vertices, type) {
    this.type = type || TerrainType.WALL;
    this.position = createVector(x, y);
    this.angle = 0;
    this.vertices = vertices || [];
  }

  get vertices() {
    return this._vertices;
  }

  set vertices(vertices) {
    this._vertices = vertices;
    this._SATPolygon = this.toSATPolygon(false);
    this._boundingBox = this.getBoundingBox(false);
  }

  draw() {
    push();

    strokeWeight(7);
    if (this.type === TerrainType.WALL) {
      stroke('#777');
      fill('#777');
    } else if (this.type === TerrainType.WATER) {
      stroke('#082740');
      fill('#082740');
    } else if (this.type === TerrainType.BUSH) {
      stroke('#107d49');
      fill('#10613aee');
    }
    translate(this.position.x, this.position.y);
    rotate(this.angle);
    beginShape();
    for (let v of this.vertices) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);
    pop();

    // draw bounding box
    // push();
    // let bb = this.getBoundingBox();
    // stroke(255, 0, 0);
    // noFill();
    // rect(bb.x, bb.y, bb.width, bb.height);
    // pop();
  }

  getBoundingBox(getCached = true) {
    if (this._boundingBox && getCached) return this._boundingBox;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let v of this.vertices) {
      // get rotated vertices
      let _v = v.copy().rotate(this.angle);
      let x = this.position.x + _v.x;
      let y = this.position.y + _v.y;

      minX = min(minX, x);
      maxX = max(maxX, x);
      minY = min(minY, y);
      maxY = max(maxY, y);
    }

    return new Rectangle({
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      data: this,
    });
  }

  toSATPolygon(getCached = true) {
    if (this._SATPolygon && getCached) return this._SATPolygon;

    let polygon = new SAT.Polygon(
      new SAT.Vector(this.position.x, this.position.y),
      this.vertices.map(v => new SAT.Vector(v.x, v.y))
    );
    polygon.setAngle(this.angle);
    return polygon;
  }

  static arrayToVertices(arr) {
    return arr.map(v => createVector(v[0], v[1]));
  }
}
