import Champion from './Champion.js';
import Camera from './Camera.js';

let player, camera;

export function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.elt.oncontextmenu = () => false;

  player = new Champion();
  camera = new Camera();

  camera.target = player;
}

export function draw() {
  background(30);

  camera.update();
  camera.push();
  camera.drawGrid();

  // draw player
  player.update();
  player.draw();

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
