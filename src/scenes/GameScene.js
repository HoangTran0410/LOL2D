import Game from '../game/Game.js';
import { Scene } from '../managers/SceneManager.js';

let stats;

export default class GameScene extends Scene {
  setup() {
    this.dom = document.querySelector('#game-scene');

    this.canvas = createCanvas(windowWidth, windowHeight).parent('game-scene');
    this.canvas.elt.oncontextmenu = () => false;

    this.game = null;
  }

  enter() {
    this.dom.style.display = 'block';

    cursor('assets/cursors/normal.cur');
    rectMode(CORNER);
    imageMode(CORNER);
    frameRate(60);

    this.game = new Game();

    stats = new Stats();
    stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(stats.dom);
  }

  draw() {
    stats.begin();

    this.game.update();
    this.game.draw();

    stats.end();
  }

  keyPressed() {
    this.game.keyPressed();
  }

  exit() {
    clear(); // clear canvas
    this.dom.style.display = 'none';
    this.game.pause();
  }
}
