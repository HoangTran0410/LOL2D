export default class Champion {
  static avatars = [];

  constructor(game, x, y) {
    this.game = game;
    this.position = createVector(x, y);
    this.destination = createVector(x, y);
    this.isAllied = true;
    this.avatar = random(Champion.avatars);

    this.spells = [];
    this.buffs = [];

    this.speed = 5;
    this.size = 50;
    this.maxHealth = 100;
    this.health = random(this.maxHealth);
  }

  castSpell(spell) {
    alert(`Cast ${spell}`);
  }

  moveTo(x, y) {
    this.destination = createVector(x, y);
  }

  move() {
    const direction = p5.Vector.sub(this.destination, this.position);
    const distance = direction.mag();
    const delta = Math.min(distance, this.speed);

    this.position.add(direction.setMag(delta));
  }

  update() {
    this.move();
  }

  draw() {
    push();
    // draw circle around champion based on allies
    fill(this.isAllied ? 'green' : 'red');
    circle(this.position.x, this.position.y, this.size + 5);

    noStroke();
    fill(240);
    // circle(this.position.x, this.position.y, this.size);
    imageMode(CENTER);
    image(this.avatar, this.position.x, this.position.y, this.size, this.size);

    // draw direction to mouse
    let mousePos = this.game.camera.screenToWorld(mouseX, mouseY);
    let mouseDir = p5.Vector.sub(mousePos, this.position).setMag(this.size / 1.75);
    stroke(255);
    strokeWeight(3);
    line(
      this.position.x,
      this.position.y,
      this.position.x + mouseDir.x,
      this.position.y + mouseDir.y
    );

    // draw health bar
    let x = this.position.x,
      y = this.position.y + this.size / 2 + 15,
      w = 100,
      h = 13;

    noStroke();
    fill(70, 100);
    rect(x - w / 2, y - h / 2, w, h); // background
    if (this.isAllied) fill(0, 150, 0, 180);
    else fill(150, 0, 0, 180);
    rect(x - w / 2, y - h / 2, w * (this.health / this.maxHealth), h); // health

    fill(190, 200);
    textAlign(CENTER, CENTER);
    textSize(13);
    text(Math.ceil(this.health), x, y);
    pop();
  }

  toSATCircle() {
    return new SAT.Circle(new SAT.Vector(this.position.x, this.position.y), this.size / 2);
  }
}
