import { Rectangle } from '../../../libs/quadtree';

export default class Camera {
  position: p5.Vector;
  currentScale: number;
  scale: number;
  target: p5.Vector | null;

  // Scratch objects reused by getBoundingBox/drawGrid so their once-per-frame
  // corner lookups don't allocate a p5.Vector via createVector each call.
  private _scratchTopLeft = { x: 0, y: 0 };
  private _scratchBottomRight = { x: 0, y: 0 };

  constructor() {
    this.position = createVector(0, 0);
    this.currentScale = 0.5;
    this.scale = 1;
    this.target = null;
  }

  zoomBy(delta: number): void {
    this.scale += delta;
    this.scale = constrain(this.scale, 0.5, 2);
  }

  zoomTo(zoom: number): void {
    this.scale = zoom;
    this.scale = constrain(this.scale, 0.5, 2);
  }

  update(): void {
    if (this.target) {
      this.position.lerp(this.target, 0.1);
    }
    this.currentScale = lerp(this.currentScale, this.scale, 0.07);
  }

  drawGrid(gridSize = 400): void {
    stroke(100, 70);
    strokeWeight(2);

    const topLeft = this.screenToWorldInto(0, 0, this._scratchTopLeft);
    const bottomRight = this.screenToWorldInto(width, height, this._scratchBottomRight);

    const startX = floor(topLeft.x / gridSize) * gridSize;
    const startY = floor(topLeft.y / gridSize) * gridSize;

    for (let x = startX; x < bottomRight.x; x += gridSize) {
      line(x, topLeft.y, x, bottomRight.y);
    }
    for (let y = startY; y < bottomRight.y; y += gridSize) {
      line(topLeft.x, y, bottomRight.x, y);
    }
  }

  getBoundingBox(): Rectangle {
    const topLeft = this.screenToWorldInto(0, 0, this._scratchTopLeft);
    const bottomRight = this.screenToWorldInto(width, height, this._scratchBottomRight);
    return new Rectangle({
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
    });
  }

  screenToWorld(x: number, y: number): p5.Vector {
    return createVector(
      (x - width / 2) / this.currentScale + this.position.x,
      (y - height / 2) / this.currentScale + this.position.y
    );
  }

  worldToScreen(x: number, y: number): p5.Vector {
    return createVector(
      (x - this.position.x) * this.currentScale + width / 2,
      (y - this.position.y) * this.currentScale + height / 2
    );
  }

  /**
   * Non-allocating variant of screenToWorld: writes into the caller-supplied
   * `target` instead of creating a new p5.Vector. Use in hot paths (e.g. a
   * per-vertex loop) where only the numbers are needed.
   */
  screenToWorldInto(x: number, y: number, target: { x: number; y: number }): { x: number; y: number } {
    target.x = (x - width / 2) / this.currentScale + this.position.x;
    target.y = (y - height / 2) / this.currentScale + this.position.y;
    return target;
  }

  /** Non-allocating variant of worldToScreen — see screenToWorldInto. */
  worldToScreenInto(x: number, y: number, target: { x: number; y: number }): { x: number; y: number } {
    target.x = (x - this.position.x) * this.currentScale + width / 2;
    target.y = (y - this.position.y) * this.currentScale + height / 2;
    return target;
  }

  makeDraw(drawFunc: (() => void) | undefined): void {
    this.push();
    drawFunc?.();
    this.pop();
  }

  push(): void {
    push();
    translate(width / 2, height / 2);
    scale(this.currentScale);
    translate(-this.position.x, -this.position.y);
  }

  pop(): void {
    pop();
  }
}
