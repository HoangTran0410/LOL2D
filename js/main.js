import Stats from 'https://cdnjs.cloudflare.com/ajax/libs/stats.js/r17/Stats.min.js';
import Game from './Game.js';
import Champion from './gameObject/Champion.js';

let game, stats;

export function preload() {
  Champion.avatars = [
    loadImage('assets/blitzcrank.png'),
    loadImage('assets/lux.png'),
    loadImage('assets/jinx.png'),
    loadImage('assets/yasuo.png'),
  ];
}

export function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.elt.oncontextmenu = () => false;

  rectMode(CORNER);
  imageMode(CORNER);

  game = new Game();

  stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);
}

export function draw() {
  stats.begin();

  game.update();
  game.draw();

  stats.end();
}

export function keyPressed() {
  if (keyCode === 81) {
  }
}

export function mouseWheel(event) {
  // game.camera.zoomBy(game.camera.currentZoom * 0.1 * (event.delta > 0 ? -1 : 1));
}

export function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}
