import Game from '../game/Game.js';
import { Scene } from '../managers/SceneManager.js';
import { preventRightClick } from '../utils/dom.utils.js';
import MenuScene from './MenuScene.js';

let drawAnalys, updateAnalys, realUpdateAnalys, previousTime;

export default class GameScene extends Scene {
  setup() {
    this.dom = document.querySelector('#game-scene');
    this.statsContainer = document.querySelector('#stats');

    drawAnalys = new Stats();
    drawAnalys.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    drawAnalys.dom.style.cssText = '';
    drawAnalys.dom.title = 'Draw time';
    this.statsContainer.appendChild(drawAnalys.dom);

    realUpdateAnalys = new Stats();
    realUpdateAnalys.showPanel(0);
    realUpdateAnalys.dom.style.cssText = '';
    realUpdateAnalys.dom.title = 'Real update time';
    this.statsContainer.appendChild(realUpdateAnalys.dom);

    updateAnalys = new Stats();
    updateAnalys.showPanel(0);
    updateAnalys.dom.style.cssText = '';
    updateAnalys.dom.title = 'Update time';
    this.statsContainer.appendChild(updateAnalys.dom);
  }

  enter() {
    this.dom.style.display = 'block';

    this.canvas = createCanvas(windowWidth, windowHeight).parent('game-scene');
    preventRightClick(this.canvas.elt);

    cursor('assets/cursors/normal.cur');
    pixelDensity(1);
    strokeJoin(ROUND);
    strokeCap(ROUND);
    rectMode(CORNER);
    imageMode(CENTER);

    this.startGame();
  }

  startGame() {
    this.game = new Game();
    previousTime = performance.now();
    requestAnimationFrame(this.updateLoop.bind(this));
  }

  stopGame() {
    cancelAnimationFrame(this.animationFrameId);
    this.game.destroy();
    this.game = null;
  }

  updateLoop() {
    let currentTime = performance.now();
    const elapsedTime = currentTime - previousTime;
    const interval = 1000 / this.game.fps;
    // updateAnalys.begin();
    if (elapsedTime > interval) {
      realUpdateAnalys.begin();
      previousTime = currentTime - (elapsedTime % interval);
      this.game.update();
      realUpdateAnalys.end();
    }
    // updateAnalys.end();

    // if (this.game) {
    //   setTimeout(() => {
    //     this.updateLoop();
    //   }, 1);
    // }

    this.animationFrameId = requestAnimationFrame(this.updateLoop.bind(this));
  }

  draw() {
    drawAnalys.begin();
    this.game.draw();
    drawAnalys.end();
  }

  keyPressed() {
    // ESC
    if (keyCode === 27) {
      this.sceneManager.showScene(MenuScene);
    }
    this.game?.keyPressed?.();
  }

  exit() {
    this.stopGame();
    this.dom.style.display = 'none';
    this.canvas.remove();
  }

  windowResized() {
    this.game.resize(windowWidth, windowHeight);
    resizeCanvas(windowWidth, windowHeight, true);
  }
}
