export default class Camera {
  constructor() {
    this.position = createVector(0, 0);
    this.zoom = 1;
    this.target = null;
  }

  update() {
    if (this.target) {
      this.position.lerp(this.target.position, 0.1);
    }
  }

  drawGrid(gridSize = 350) {
    stroke(255, 255, 255, 50);
    strokeWeight(1);
    let leftBound = Math.floor((this.position.x - width / 2) / gridSize) * gridSize;
    let rightBound = Math.ceil((this.position.x + width / 2) / gridSize) * gridSize;
    let topBound = Math.floor((this.position.y - height / 2) / gridSize) * gridSize;
    let bottomBound = Math.ceil((this.position.y + height / 2) / gridSize) * gridSize;

    for (let x = leftBound; x <= rightBound; x += gridSize) {
      line(x, topBound, x, bottomBound);
    }
    for (let y = topBound; y <= bottomBound; y += gridSize) {
      line(leftBound, y, rightBound, y);
    }
  }

  screenToWorld(x, y) {
    return createVector(
      (x - width / 2) / this.zoom + this.position.x,
      (y - height / 2) / this.zoom + this.position.y
    );
  }

  worldToScreen(x, y) {
    return createVector(
      (x - this.position.x) * this.zoom + width / 2,
      (y - this.position.y) * this.zoom + height / 2
    );
  }

  push() {
    push();
    translate(width / 2, height / 2);
    translate(-this.position.x, -this.position.y);
    scale(this.zoom);
  }

  pop() {
    pop();
  }
}
