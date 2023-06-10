import Champion from './Champion.js';
import Camera from './Camera.js';
import Obstacle from './Obstacle.js';

let player,
  camera,
  obstacles = [];

export function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.elt.oncontextmenu = () => false;

  for (let i = 0; i < 10; i++) obstacles.push(new Obstacle(random(width), random(height)));

  player = new Champion();
  camera = new Camera();

  camera.target = player;
}

export function draw() {
  background(30);

  camera.push();

  // update
  camera.update();
  player.update();

  let overlaps = [];
  for (let o of obstacles) {
    let response = new SAT.Response();
    let collided = SAT.testPolygonCircle(o.toSATPolygon(), player.toSATCircle(), response);
    if (collided) {
      let overlap = createVector(response.overlapV.x, response.overlapV.y);
      player.position.add(overlap);

      overlaps.push(overlap);
    }
  }

  // draw
  camera.drawGrid();
  for (let o of obstacles) {
    o.draw();
  }
  player.draw();

  // draw overlap
  let overlap = overlaps.reduce((acc, cur) => acc.add(cur), createVector(0, 0));
  push();
  stroke(255, 0, 0);
  strokeWeight(2);
  line(
    player.position.x,
    player.position.y,
    player.position.x + overlap.x,
    player.position.y + overlap.y
  );
  pop();

  // control player
  if (mouseIsPressed && mouseButton === RIGHT) {
    let worldMouse = camera.screenToWorld(mouseX, mouseY);
    player.moveTo(worldMouse.x, worldMouse.y);
  }

  camera.pop();
}

export function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}
