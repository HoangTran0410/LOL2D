export default class Champion {
  constructor() {
    this.position = createVector(0, 0);
    this.speed = 5;
    this.size = 50;

    this.destination = createVector(0, 0);
  }

  moveTo(x, y) {
    this.destination = createVector(x, y);
  }

  update() {
    const direction = p5.Vector.sub(this.destination, this.position);
    const distance = direction.mag();
    const delta = Math.min(distance, this.speed);

    this.position.add(direction.setMag(delta));
  }

  draw() {
    circle(this.position.x, this.position.y, this.size);
  }
}
