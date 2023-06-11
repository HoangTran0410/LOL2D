import Camera from './gameObject/Camera.js';
import Champion from './gameObject/Champion.js';
import Obstacle from './gameObject/Obstacle.js';

export default class Game {
  constructor() {
    this.players = [];
    for (let i = 0; i < 10; i++) {
      let champ = new Champion(random(width), random(height));
      champ.isAllied = false;
      this.players.push(champ);
    }

    this.player = this.players[0];
    this.player.isAllied = true;

    this.camera = new Camera();
    this.camera.target = this.player;

    // quadtree obstacle
    this.quadtree = new Quadtree(
      {
        x: 0,
        y: 0,
        width: width,
        height: height,
      },
      10,
      4
    );

    for (let i = 0; i < 1000; i++) {
      let o = new Obstacle(
        random(-5000, 5000),
        random(-5000, 5000),
        // Obstacle.rectVertices(random(100, 200), random(100, 200), random(TWO_PI))
        // Obstacle.circleVertices(random(50, 100), random(10, 20))
        Obstacle.polygonVertices(random(3, 10), random(70, 100), random(70, 100))
      );

      this.quadtree.insert({
        ...o.getBoundingBox(),
        object: o,
      });
    }
  }

  update() {
    background(30);

    // update
    this.camera.update();

    for (let p of this.players) {
      p.update();
    }

    let obstacles = this.quadtree
      .retrieve({
        x: this.player.position.x,
        y: this.player.position.y,
        width: this.player.size / 2,
        height: this.player.size / 2,
      })
      .map(o => o.object);

    for (let o of obstacles) {
      let response = new SAT.Response();
      let collided = SAT.testPolygonCircle(o.toSATPolygon(), this.player.toSATCircle(), response);
      if (collided) {
        let a = 0.01;
        o.vertices = o.vertices.map(v => v.rotate(a));

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

    let obstacles = this.quadtree.retrieve(this.camera.getViewBounds()).map(o => o.object);
    for (let o of obstacles) {
      o.draw();
    }

    for (let p of this.players) {
      p.draw();
    }

    this.camera.pop();
  }
}
