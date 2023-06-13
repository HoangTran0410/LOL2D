import Camera from './gameObject/Camera.js';
import Champion from './gameObject/Champion.js';
import Obstacle from './gameObject/Obstacle.js';
import { Quadtree, Rectangle } from './lib/quadtree.js';

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
    this.quadtree = new Quadtree({
      x: -5000,
      y: -5000,
      width: 10000,
      height: 10000,
      maxObjects: 10, // optional, default: 10
      maxLevels: 6, // optional, default:  4
    });

    this.obstacles = [];
    for (let i = 0; i < 1000; i++) {
      let o = new Obstacle(
        random(-5000, 5000),
        random(-5000, 5000)
        // Obstacle.rectVertices(random(100, 200), random(100, 200), random(TWO_PI))
        // Obstacle.circleVertices(random(50, 100), random(10, 20))
        // Obstacle.polygonVertices(random(3, 10), random(70, 100), random(70, 100))
      );

      this.obstacles.push(o);

      const rectangle = new Rectangle({
        ...o.getBoundingBox(),
        data: o,
      });
      this.quadtree.insert(rectangle);
    }
  }

  fixedUpdate() {
    this.camera.update();

    for (let p of this.players) {
      p.update();
    }

    for (let p of this.players) {
      let area = new Rectangle({
        x: p.position.x,
        y: p.position.y,
        width: p.size / 2,
        height: p.size / 2,
      });
      let obstacles = this.quadtree.retrieve(area).map(o => o.data);

      for (let o of obstacles) {
        let response = new SAT.Response();
        let collided = SAT.testPolygonCircle(o.toSATPolygon(), p.toSATCircle(), response);
        if (collided) {
          // let a = 0.01;
          // o.vertices = o.vertices.map(v => v.rotate(a));

          let overlap = createVector(response.overlapV.x, response.overlapV.y);
          p.position.add(overlap);
        }
      }
    }

    // control player
    if (mouseIsPressed && mouseButton === RIGHT) {
      let worldMouse = this.camera.screenToWorld(mouseX, mouseY);
      this.player.moveTo(worldMouse.x, worldMouse.y);
    }
  }

  update() {
    this.quadtree.clear();
    for (let o of this.obstacles) {
      const rectangle = new Rectangle({
        ...o.getBoundingBox(),
        data: o,
      });
      this.quadtree.insert(rectangle);
    }

    // always update at 60 fps, no matter the frame rate
    let _deltaTime = deltaTime;
    while (_deltaTime > 0) {
      this.fixedUpdate();
      _deltaTime -= 1000 / 60;
    }
  }

  draw() {
    background(30);

    this.camera.push();
    this.camera.drawGrid();

    let obstacles = this.quadtree
      .retrieve(new Rectangle(this.camera.getViewBounds()))
      .map(o => o.data);

    for (let o of obstacles) {
      o.draw();
    }

    for (let p of this.players) {
      p.draw();
    }

    this.camera.pop();
  }
}
