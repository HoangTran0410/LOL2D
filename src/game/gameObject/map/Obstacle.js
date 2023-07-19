import SAT from '../../../../libs/SAT.js';
import { Rectangle } from '../../../../libs/quadtree.js';
import { uuidv4 } from '../../../utils/index.js';
import TerrainType from '../../enums/TerrainType.js';

export default class Obstacle {
  constructor(x, y, vertices, type) {
    this.type = type || TerrainType.WALL;
    this.position = createVector(x, y);
    this.angle = 0;
    this.vertices = vertices || [];
    this.id = uuidv4(); // for quadtree
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
    // fill('#7777');
    // stroke('#999');
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
    // rect(bb.x, bb.y, bb.w, bb.h);
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
    this._boundingBox = new Rectangle({
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      data: this,
    });
    return this._boundingBox;
  }

  toSATPolygon(getCached = true) {
    if (this._SATPolygon && getCached) return this._SATPolygon;

    let polygon = new SAT.Polygon(
      new SAT.Vector(this.position.x, this.position.y),
      this.vertices.map(v => new SAT.Vector(v.x, v.y))
    );
    polygon.setAngle(this.angle);
    this._SATPolygon = polygon;
    return this._SATPolygon;
  }

  static arrayToVertices(arr) {
    return arr.map(v => createVector(v[0], v[1]));
  }
}
