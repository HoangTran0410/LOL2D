export default class Obstacle {
  constructor(x, y, vertices) {
    this.position = createVector(x, y);
    this.vertices = vertices || Obstacle.randomVertices();
  }

  // generate random vertices
  static randomVertices(numVertices = random(3, 10), minSize = 70, maxSize = 100) {
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

  draw() {
    push();
    stroke(255);
    strokeWeight(2);
    // noStroke();
    fill(100);
    beginShape();
    for (let v of this.vertices) {
      vertex(this.position.x + v.x, this.position.y + v.y);
    }
    endShape(CLOSE);
    pop();
  }

  toSATPolygon() {
    if (this._SATPolygon) return this._SATPolygon; // cached, because object is immutable

    let polygon = new SAT.Polygon(
      new SAT.Vector(this.position.x, this.position.y),
      this.vertices.map(v => new SAT.Vector(v.x, v.y))
    );
    polygon.setAngle(0);
    this._SATPolygon = polygon;
    return polygon;
  }
}
