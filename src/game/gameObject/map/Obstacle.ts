import SAT from '@/libs/SAT';
import { Rectangle } from '@/libs/quadtree';
import { uuidv4 } from '@/utils/index';
import TerrainType from '@/game/enums/TerrainType';

export default class Obstacle {
  type: string;
  position: p5.Vector;
  angle: number;
  vertices: { x: number; y: number }[];
  id: string;

  private _boundingBox: Rectangle | null = null;
  private _SATPolygon: any = null;

  constructor(x: number, y: number, vertices?: { x: number; y: number }[], type?: string) {
    this.type = type || TerrainType.WALL;
    this.position = createVector(x, y);
    this.angle = 0;
    this.vertices = vertices || [];
    this.id = uuidv4();
  }

  /**
   * The style for a whole terrain type, set once for a run of obstacles.
   *
   * Split out of `draw` because `TerrainMap.draw` already walks the obstacles
   * in type order, so every obstacle in a run was re-setting a colour the
   * previous one had just set. p5's `fill('#777')` is not a cheap assignment:
   * it builds a `p5.Color` (parsing the CSS string, allocating the level
   * arrays) and serialises it back to `rgba(...)` on every call. A CPU profile
   * of a worst-case mobile frame put p5's colour path at ~3% of the whole
   * frame and named this function as the largest single caller of the canvas
   * `fill()` underneath it.
   *
   * There are exactly three terrain colours in the game and they never change,
   * so the per-obstacle work was entirely redundant.
   */
  static applyStyle(type: string): void {
    strokeWeight(7);
    if (type === TerrainType.WALL) {
      stroke('#777');
      fill('#777');
    } else if (type === TerrainType.WATER) {
      stroke('#082740');
      fill('#082740');
    } else if (type === TerrainType.BUSH) {
      stroke('#107d49');
      fill('#10613aee');
    }
  }

  /**
   * The polygon alone, in whatever style is already current.
   *
   * Map polygons are built with `angle = 0` and nothing ever rotates them, so
   * the common path folds the origin into each vertex and skips the
   * `push()`/`translate()`/`pop()` that only existed to scope the transform —
   * two canvas save/restore calls per obstacle per frame. The rotated path is
   * kept intact for anything that does set an angle.
   */
  drawShape(): void {
    if (this.angle === 0) {
      const originX = this.position.x;
      const originY = this.position.y;
      beginShape();
      for (const v of this.vertices) {
        vertex(originX + v.x, originY + v.y);
      }
      endShape(CLOSE);
      return;
    }

    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);
    beginShape();
    for (const v of this.vertices) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);
    pop();
  }

  /** One obstacle, styled and drawn on its own. */
  draw(): void {
    push();
    Obstacle.applyStyle(this.type);
    this.drawShape();
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
