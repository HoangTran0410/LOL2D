import {
  Box,
  Circle,
  Ellipse,
  Line,
  Point,
  Polygon,
  System,
  drawBody,
} from '../../../libs/detect-collisions.js';
import ObjectManager from '../managers/ObjectManager.js';

let bodies = [];

export default class Game {
  constructor() {
    // this.objectManager = new ObjectManager(this);

    this.system = new System();

    for (let i = 0; i < 1000; i++) {
      let pos = { x: random(width), y: random(height) };
      bodies.push(
        random([
          new Polygon(pos, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 50, y: 100 },
            { x: 50, y: 80 },
            { x: 0, y: 80 },
          ]),
          new Circle(pos, random(10, 50)),
          new Line(pos, { x: random(width), y: random(height) }),
          new Point(pos),
          new Ellipse(pos, random(10, 50), random(10, 50)),
        ])
      );
    }

    bodies.forEach(body => this.system.insert(body));

    console.log(bodies);
  }

  pause() {}

  unpause() {}

  update() {
    // this.objectManager.update();
  }

  draw() {
    background(30);
    stroke(255);
    fill(255, 100);

    line(0, height / 2, width, height / 2);
    line(width / 2, 0, width / 2, height);

    // this.objectManager.draw();
    // bodies.forEach(body => drawBody(body));
    bodies[0].setPosition(mouseX, mouseY);

    let count = 0;
    this.system.checkOne(bodies[0], response => {
      let { a, b } = response;

      //   fill('red');
      drawBody(a);
      drawBody(b);
      return count > 100;
    });

    // this.system.checkAll(response => {
    //   let { a, b } = response;

    //   //   fill('red');
    //   //   drawBody(a);
    //   //   drawBody(b);
    // });
  }

  destroy() {}

  resize() {}

  keyPressed() {}
}
