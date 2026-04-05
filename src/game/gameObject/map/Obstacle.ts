import SAT from '../../../../libs/SAT';
import { Rectangle } from '../../../../libs/quadtree';
import { uuidv4 } from '../../../utils/index';
import TerrainType from '../../enums/TerrainType';

export default class Obstacle {
  type: string;
  position: p5.Vector;
  angle: number;
  vertices: { x: number; y: number }[];
  id: string;

  private _boundingBox: Rectangle | null = null;
  private _SATPolygon: any = null;

  constructor(
    x: number,
    y: number,
    vertices?: { x: number; y: number }[],
    type?: string
  ) {
    this.type = type || TerrainType.WALL;
    this.position = createVector(x, y);
    this.angle = 0;
    this.vertices = vertices || [];
    this.id = uuidv4();
  }

  draw(): void {
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
    for (const v of this.vertices) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);
    pop();
  }

  getBoundingBox(getCached = true): Rectangle {
    if (this._boundingBox && getCached) return this._boundingBox;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const v of this.vertices) {
      const _v = createVector(v.x, v.y).rotate(this.angle);
      const x = this.position.x + _v.x;
      const y = this.position.y + _v.y;

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

  toSATPolygon(getCached = true): SAT.Polygon {
    if (this._SATPolygon && getCached) return this._SATPolygon;

    const polygon = new SAT.Polygon(
      new SAT.Vector(this.position.x, this.position.y),
      this.vertices.map(v => new SAT.Vector(v.x, v.y))
    );
    polygon.setAngle(this.angle);
    this._SATPolygon = polygon;
    return this._SATPolygon;
  }

  static arrayToVertices(arr: number[][]): { x: number; y: number }[] {
    return arr.map(v => ({ x: v[0], y: v[1] }));
  }
}
