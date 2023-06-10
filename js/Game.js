import Camera from './gameObjects/Camera.js';
import Champion from './gameObjects/Champion.js';
import Obstacle from './gameObjects/Obstacle.js';

export default class Game {
  constructor() {
    this.player = new Champion();
    this.camera = new Camera();
    this.obstacles = [];

    for (let i = 0; i < 10; i++) {
      this.obstacles.push(new Obstacle(random(width), random(height)));
    }
    this.camera.target = this.player;
  }

  update() {
    background(30);

    // update
    this.camera.update();
    this.player.update();

    for (let o of this.obstacles) {
      let response = new SAT.Response();
      let collided = SAT.testPolygonCircle(o.toSATPolygon(), this.player.toSATCircle(), response);
      if (collided) {
        let overlap = createVector(response.overlapV.x, response.overlapV.y);
        this.player.position.add(overlap);
      }
    }

    // control player
    if (mouseIsPressed && mouseButton === RIGHT) {
      let worldMouse = this.camera.screenToWorld(mouseX, mouseY);
      this.player.moveTo(worldMouse.x, worldMouse.y);
    }
  }

  draw() {
    this.camera.push();

    this.camera.drawGrid();
    for (let o of this.obstacles) {
      o.draw();
    }
    this.player.draw();

    this.camera.pop();
  }
}
