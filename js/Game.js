import Camera from './gameObject/Camera.js';
import Champion from './gameObject/attackableUnits/Champion.js';
import Obstacle from './gameObject/Obstacle.js';
import { Quadtree, Rectangle } from './lib/quadtree.js';
import HUD from './hud/HUD.js';

export default class Game {
  constructor() {
    this.HUD = new HUD(this);

    this.players = [];
    for (let i = 0; i < 10; i++) {
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
      x: -5000,
      y: -5000,
      width: 10000,
      height: 10000,
      maxObjects: 10, // optional, default: 10
      maxLevels: 6, // optional, default:  4
    });

    this.obstacles = [];
    for (let i = 0; i < 300; i++) {
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

    this.HUD.update();
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

    for (let p of this.players) {
      p.draw();
    }

    this.camera.pop();

    this.HUD.draw();
  }

  keyPressed() {
    // let modifier = new StatsModifier();
    // modifier.speed.percentBaseBonus = 0.3;
    // modifier.size.percentBonus = 0.3;

    // let buff = new ChangeStatsBuff(
    //   3000,
    //   this.player,
    //   this.player,
    //   modifier,
    //   BuffAddType.STACKS_AND_CONTINUE,
    //   3
    // );
    // this.player.addBuff(buff);

    // Q W E R
    let keyCodes = [81, 87, 69, 82];
    let spellIndex = keyCodes.indexOf(keyCode);
    if (spellIndex !== -1) {
      this.player.spells[spellIndex].cast();
    }
  }
}
