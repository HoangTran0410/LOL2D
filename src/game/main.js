import Game from './Game.js';
import Obstacle from './gameObject/Obstacle.js';
import { preload as preloadAssets } from '../../assets/index.js';

let game, stats;
let mapData;

export function preload() {
  preloadAssets();
  mapData = loadJSON('assets/map.json');
}

export function setup() {
  const c = createCanvas(windowWidth, windowHeight).parent('game-scene');
  c.elt.oncontextmenu = () => false;

  cursor('assets/cursors/normal.cur');
  rectMode(CORNER);
  imageMode(CORNER);
  frameRate(60);

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
  game.keyPressed();
}

export function mouseWheel(event) {
  // game.camera.zoomBy(game.camera.currentZoom * 0.1 * (event.delta > 0 ? -1 : 1));
}

export function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}
