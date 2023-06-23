import Camera from './gameObject/Camera.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import Obstacle from './gameObject/Obstacle.js';
import { Quadtree, Rectangle } from './lib/quadtree.js';
import { SpellHotKeys } from './constants.js';
import InGameHUD from './hud/InGameHUD.js';

export default class Game {
  constructor() {
    this.InGameHUD = new InGameHUD(this);

    this.objects = [];

    this.players = [];
    for (let i = 0; i < 3; i++) {
      let champ = new Champion(this, random(width), random(height));
      champ.isAllied = false;
      this.players.push(champ);
    }

    this.player = this.players[0];
    this.player.isAllied = true;

    this.camera = new Camera();
    this.camera.target = this.player;

    // quadtree obstacle
    this.quadtree = new Quadtree({
      x: -3000,
      y: -3000,
      width: 6000,
      height: 6000,
      maxObjects: 10, // optional, default: 10
      maxLevels: 6, // optional, default:  4
    });

    this.obstacles = [];
    for (let i = 0; i < 200; i++) {
      let o = new Obstacle(
        random(-3000, 3000),
        random(-3000, 3000)
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

    this.clickedPoint = {
      x: 0,
      y: 0,
      size: 0,
    };
  }

  fixedUpdate() {
    this.camera.update();

    this.objects = this.objects.filter(o => !o.toRemove);
    for (let o of this.objects) o.update();

    for (let p of this.players) p.update();

    for (let p of this.players) {
      let area = new Rectangle({
        x: p.position.x,
        y: p.position.y,
        width: p.stats.size.value / 2,
        height: p.stats.size.value / 2,
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

          if (p != this.player) {
            let x = random(-3000, 3000);
            let y = random(-3000, 3000);
            p.moveTo(x, y);
          }
        }
      }
    }

    // control player
    if (mouseIsPressed && mouseButton === RIGHT) {
      let worldMouse = this.camera.screenToWorld(mouseX, mouseY);
      this.player.moveTo(worldMouse.x, worldMouse.y);

      this.clickedPoint = {
        x: worldMouse.x,
        y: worldMouse.y,
        size: 40,
      };
    }

    this.clickedPoint.size *= 0.9;

    // fake ai
    for (let p of this.players) {
      if (p !== this.player) {
        let distToDest = p.position.dist(p.destination);
        if (distToDest < 10) {
          let x = random(-3000, 3000);
          let y = random(-3000, 3000);
          p.moveTo(x, y);
        }

        // random spell cast
        if (random() < 0.1) {
          let spellIndex = floor(random(p.spells.length));
          p.spells[spellIndex].cast();
        }
      }
    }
  }

  update() {
    // this.quadtree.clear();
    // for (let o of this.obstacles) {
    //   const rectangle = new Rectangle({
    //     ...o.getBoundingBox(),
    //     data: o,
    //   });
    //   this.quadtree.insert(rectangle);
    // }

    // always update at 60 fps, no matter the frame rate
    let _deltaTime = Math.min(deltaTime, 1000);
    while (_deltaTime > 0) {
      this.fixedUpdate();
      _deltaTime -= 1000 / 60;
    }

    this.InGameHUD.update();
  }

  draw() {
    background(20);

    this.camera.push();
    this.camera.drawGrid();

    let obstacles = this.quadtree
      .retrieve(new Rectangle(this.camera.getViewBounds()))
      .map(o => o.data);

    for (let o of obstacles) {
      o.draw();
    }

    for (let o of this.objects) {
      o.draw();
    }

    for (let p of this.players) {
      p.draw();
    }

    // draw clicked point
    if (this.clickedPoint.size > 0) {
      push();
      fill('green');
      ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
      pop();
    }

    this.camera.pop();
  }

  keyPressed() {
    let spellIndex = SpellHotKeys.indexOf(keyCode);
    if (spellIndex !== -1) {
      this.player.spells[spellIndex].cast();
    }
  }
}
