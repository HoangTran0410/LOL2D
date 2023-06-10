import Game from './Game.js';
import Champion from './gameObjects/Champion.js';

let game;

export function preload() {
  Champion.avatar = loadImage('assets/blitzcrank.png');
}

export function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.elt.oncontextmenu = () => false;

  game = new Game();
}

export function draw() {
  game.update();
  game.draw();
}

export function keyPressed() {
  if (keyCode === 81) {
  }
}

export function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
}
