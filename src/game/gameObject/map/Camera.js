export default class Camera {
  constructor() {
    this.position = createVector(0, 0);
    this.currentScale = 0.5;
    this.scale = 1;
    this.target = null;
  }

  zoomBy(delta) {
    this.scale += delta;
    this.scale = constrain(this.scale, 0.5, 2);
  }

  zoomTo(zoom) {
    this.scale = zoom;
    this.scale = constrain(this.scale, 0.5, 2);
  }

  update() {
    if (this.target) {
      this.position.lerp(this.target, 0.1);
    }

    this.currentScale = lerp(this.currentScale, this.scale, 0.07);
  }

  drawGrid(gridSize = 400) {
    stroke(100, 70);
    strokeWeight(2);

    // get bounds (included scale)
    let topLeft = this.screenToWorld(0, 0);
    let bottomRight = this.screenToWorld(width, height);

    // get grid start position
    let startX = floor(topLeft.x / gridSize) * gridSize;
    let startY = floor(topLeft.y / gridSize) * gridSize;

    // draw grid
    for (let x = startX; x < bottomRight.x; x += gridSize) {
      line(x, topLeft.y, x, bottomRight.y);
    }
    for (let y = startY; y < bottomRight.y; y += gridSize) {
      line(topLeft.x, y, bottomRight.x, y);
    }
  }

  getViewBounds() {
    let topLeft = this.screenToWorld(0, 0);
    let bottomRight = this.screenToWorld(width, height);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  screenToWorld(x, y) {
    return createVector(
      (x - width / 2) / this.currentScale + this.position.x,
      (y - height / 2) / this.currentScale + this.position.y
    );
  }

  worldToScreen(x, y) {
    return createVector(
      (x - this.position.x) * this.currentScale + width / 2,
      (y - this.position.y) * this.currentScale + height / 2
    );
  }

  makeDraw(drawFunc) {
    this.push();
    drawFunc?.();
    this.pop();
  }

  push() {
    push();
    translate(width / 2, height / 2);
    scale(this.currentScale);
    translate(-this.position.x, -this.position.y);
  }

  pop() {
    pop();
  }
}
