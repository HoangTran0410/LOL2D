export default class Obstacle {
  static Predefined = [];

  constructor(x, y, vertices) {
    this.position = createVector(x, y);
    this.vertices = vertices || Obstacle.arrayToVertices(random(Obstacle.Predefined));
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
    noStroke();
    fill(100);
    translate(this.position.x, this.position.y);
    beginShape();
    for (let v of this.vertices) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);

    // draw bounding box
    // let bb = this.getBoundingBox();
    // stroke(255, 0, 0);
    // noFill();
    // rect(bb.x, bb.y, bb.width, bb.height);

    pop();
  }

  getBoundingBox(getCached = true) {
    if (this._boundingBox && getCached) return this._boundingBox;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let v of this.vertices) {
      let x = this.position.x + v.x;
      let y = this.position.y + v.y;
      minX = min(minX, x);
      maxX = max(maxX, x);
      minY = min(minY, y);
      maxY = max(maxY, y);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  toSATPolygon(getCached = true) {
    if (this._SATPolygon && getCached) return this._SATPolygon;

    let polygon = new SAT.Polygon(
      new SAT.Vector(this.position.x, this.position.y),
      this.vertices.map(v => new SAT.Vector(v.x, v.y))
    );
    polygon.setAngle(0);
    return polygon;
  }

  // pre-defined vertices
  static rectVertices(w, h, angle = 0) {
    return [
      createVector(-w / 2, -h / 2),
      createVector(w / 2, -h / 2),
      createVector(w / 2, h / 2),
      createVector(-w / 2, h / 2),
    ].map(v => v.rotate(angle));
  }

  static circleVertices(r, numVertices = 10) {
    let vertices = [];
    for (let i = 0; i < numVertices; i++) {
      let angle = map(i, 0, numVertices, 0, TWO_PI);
      let x = r * cos(angle);
      let y = r * sin(angle);
      vertices.push(createVector(x, y));
    }

    return vertices;
  }

  static polygonVertices(numVertices = random(3, 10), minSize = 70, maxSize = 100) {
    let vertices = [];
    for (let i = 0; i < numVertices; i++) {
      let angle = map(i, 0, numVertices, 0, TWO_PI);
      let r = random(minSize, maxSize);
      let x = r * cos(angle);
      let y = r * sin(angle);
      vertices.push(createVector(x, y));
    }

    return vertices;
  }

  static arrayToVertices(arr) {
    return arr.map(v => createVector(v[0], v[1]));
  }
}
