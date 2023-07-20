import detectCollisions from 'https://cdn.jsdelivr.net/npm/detect-collisions@9.1.1/+esm';

const { System, getBounceDirection, deg2rad, Box, Circle, Ellipse, Line, Point, Polygon } =
  detectCollisions;

let test, context, stats;
window.setup = () => {
  let canvas = createCanvas(windowWidth, windowHeight);
  context = canvas.drawingContext;
  canvas.elt.style = 'position: absolute; top: 0; left: 0;';

  stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);

  test = new Stress(2000);
  test.start();
};

window.draw = () => {
  stats.begin();
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);

  // Render the bodies
  context.strokeStyle = '#FFFFFF';
  context.beginPath();
  test.physics.draw(context);
  context.stroke();

  // Render the BVH
  if (false) {
    context.strokeStyle = '#00FF00';
    context.beginPath();
    test.physics.drawBVH(context);
    context.stroke();
  }
  stats.end();
};

function makeLoop(callback) {
  setInterval(callback, 1);
}

class Stress {
  constructor(count = 2000) {
    const size = Math.sqrt((width * height) / (count * 10));

    this.physics = new System(5);
    this.bodies = [];
    this.polygons = 0;
    this.boxes = 0;
    this.circles = 0;
    this.ellipses = 0;
    this.lines = 0;
    this.lastVariant = 0;
    this.count = count;

    // World bounds
    this.bounds = [
      this.physics.createBox({ x: 0, y: 0 }, width, 10, {
        isStatic: true,
      }),
      this.physics.createBox({ x: width - 10, y: 0 }, 10, height, {
        isStatic: true,
      }),
      this.physics.createBox({ x: 0, y: height - 10 }, width, 10, {
        isStatic: true,
      }),
      this.physics.createBox({ x: 0, y: 0 }, 10, height, {
        isStatic: true,
      }),
    ];

    for (let i = 0; i < count; ++i) {
      this.createShape(!random(0, 20), size);
    }

    this.lastTime = Date.now();
    this.updateBody = this.updateBody.bind(this);
    this.checkBounce = this.checkBounce.bind(this);

    this.start = () => {
      makeLoop(this.update.bind(this));
    };

    this.legendDom = document.querySelector('#legend');
    this.legendDom.innerHTML = `<div><b>Total:</b> ${this.count}</div>
    <div><b>Polygons:</b> ${this.polygons}</div>
    <div><b>Boxes:</b> ${this.boxes}</div>
    <div><b>Circles:</b> ${this.circles}</div>
    <div><b>Ellipses:</b> ${this.ellipses}</div>
    <div><b>Lines:</b> ${this.lines}</div>`;
  }

  update() {
    const now = Date.now();
    this.timeScale = Math.min(1000, now - this.lastTime) / 60;
    this.lastTime = now;
    this.bodies.forEach(this.updateBody);
  }

  updateBody(body) {
    body.setAngle(body.angle + body.rotationSpeed * this.timeScale, false);

    if (random() < 0.05 * this.timeScale) {
      body.targetScale.x = 0.5 + random();
    }

    if (random() < 0.05 * this.timeScale) {
      body.targetScale.y = 0.5 + random();
    }

    if (Math.abs(body.targetScale.x - body.scaleX) > 0.01) {
      const scaleX =
        body.scaleX + Math.sign(body.targetScale.x - body.scaleX) * 0.02 * this.timeScale;
      const scaleY =
        body.scaleY + Math.sign(body.targetScale.y - body.scaleY) * 0.02 * this.timeScale;

      body.setScale(scaleX, scaleY, false);
    }

    // as last step update position, and bounding box
    body.setPosition(
      body.x + body.directionX * this.timeScale,
      body.y + body.directionY * this.timeScale
    );

    this.physics.checkOne(body, this.checkBounce);
  }

  checkBounce({ a, b, overlapV }) {
    this.bounce(a, b, overlapV);
    a.rotationSpeed = (random() - random()) * 0.1;
    a.setPosition(a.x - overlapV.x, a.y - overlapV.y);
  }

  bounce(a, b, overlapV) {
    if (b.isStatic) {
      // flip on wall
      if (Math.abs(overlapV.x) > Math.abs(overlapV.y)) {
        a.directionX *= -1;
      } else {
        a.directionY *= -1;
      }

      return;
    }

    const bounce = getBounceDirection(a, b);
    bounce.scale(b.size * 0.5 * (b.scaleX + b.scaleY)).add({
      x: a.directionX * a.size,
      y: a.directionY * a.size * 0.5 * (a.scaleX + a.scaleY),
    });
    const { x, y } = bounce.normalize();

    a.directionX = x;
    a.directionY = y;
  }

  createShape(large, size) {
    const minSize = size * 1.0 * (large ? random() + 1 : 1);
    const maxSize = size * 1.25 * (large ? random() * 2 + 1 : 1);
    const x = random(0, width);
    const y = random(0, height);
    const direction = (random(0, 360) * Math.PI) / 180;
    const options = {
      isCentered: true,
      padding: (minSize + maxSize) * 0.2,
    };

    let body;
    let variant = this.lastVariant++ % 5;

    switch (variant) {
      case 0:
        body = this.physics.createCircle({ x, y }, random(minSize, maxSize) / 2, options);

        ++this.circles;
        break;

      case 1:
        const width = random(minSize, maxSize);
        const height = random(minSize, maxSize);
        body = this.physics.createEllipse({ x, y }, width, height, 2, options);

        ++this.ellipses;
        break;

      case 2:
        body = this.physics.createBox(
          { x, y },
          random(minSize, maxSize),
          random(minSize, maxSize),
          options
        );

        ++this.boxes;
        break;

      case 3:
        body = this.physics.createLine(
          { x, y },
          {
            x: x + random(minSize, maxSize),
            y: y + random(minSize, maxSize),
          },
          options
        );

        ++this.lines;
        break;

      default:
        body = this.physics.createPolygon(
          { x, y },
          [
            { x: -random(minSize, maxSize), y: random(minSize, maxSize) },
            { x: random(minSize, maxSize), y: random(minSize, maxSize) },
            { x: random(minSize, maxSize), y: -random(minSize, maxSize) },
            { x: -random(minSize, maxSize), y: -random(minSize, maxSize) },
          ],
          options
        );

        ++this.polygons;
        break;
    }

    // set initial rotation angle direction
    body.rotationSpeed = (random() - random()) * 0.1;
    body.setAngle((random(0, 360) * Math.PI) / 180);

    body.targetScale = { x: 1, y: 1 };
    body.size = (minSize + maxSize) / 2;

    body.directionX = Math.cos(direction);
    body.directionY = Math.sin(direction);

    this.bodies.push(body);
  }
}
