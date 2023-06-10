export default class Champion {
  constructor() {
    this.position = createVector(0, 0);
    this.speed = 5;
    this.size = 50;
    this.destination = createVector(0, 0);

    this.spells = [];
  }

  castSpell(spell) {
    alert(`Cast ${spell}`);
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
    noStroke();
    fill(240);
    circle(this.position.x, this.position.y, this.size);
  }

  toSATCircle() {
    return new SAT.Circle(new SAT.Vector(this.position.x, this.position.y), this.size / 2);
  }
}
