export default class Camera {
  constructor() {
    this.position = createVector(0, 0);
    this.currentZoom = 0.01;
    this.zoom = 1;
    this.target = null;
  }

  zoomBy(delta) {
    this.zoom += delta;
    this.zoom = constrain(this.zoom, 0.5, 2);
  }

  zoomTo(zoom) {
    this.zoom = zoom;
    this.zoom = constrain(this.zoom, 0.5, 2);
  }

  update() {
    if (this.target) {
      this.position.lerp(this.target.position, 0.1);
    }

    this.currentZoom = lerp(this.currentZoom, this.zoom, 0.07);
  }

  drawGrid(gridSize = 300) {
    stroke(100, 70);
    strokeWeight(2);

    // get bounds (included zoom)
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

  drawGrid_(gridSize = 300) {
    stroke(100, 70);
    strokeWeight(2);
    let delta = 1;

    let { x: left, y: top } = this.screenToWorld(0, 0);
    let { x: right, y: bottom } = this.screenToWorld(width, height);

    for (let x = left; x < right; x += delta) {
      if (floor(x) % gridSize == 0) {
        /* while you find 1 x%gridSize==0 
                => delta will equal gridSize => shorter loop */
        delta = gridSize;
        line(x, top, x, bottom);
      }
    }

    // do the same thing to y axis
    delta = 1;
    for (let y = top; y < bottom; y += delta) {
      if (floor(y) % gridSize == 0) {
        delta = gridSize;
        line(left, y, right, y);
      }
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
      (x - width / 2) / this.currentZoom + this.position.x,
      (y - height / 2) / this.currentZoom + this.position.y
    );
  }

  worldToScreen(x, y) {
    return createVector(
      (x - this.position.x) * this.currentZoom + width / 2,
      (y - this.position.y) * this.currentZoom + height / 2
    );
  }

  push() {
    push();
    translate(width / 2, height / 2);
    scale(this.currentZoom);
    translate(-this.position.x, -this.position.y);
  }

  pop() {
    pop();
  }
}
