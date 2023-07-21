import Game from '../game/Game.js';
import { Scene } from '../managers/SceneManager.js';
import DomUtils from '../utils/dom.utils.js';
import MenuScene from './MenuScene.js';

let drawAnalys, checkUpdateAnalys, realUpdateAnalys, previousTime;

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
    realUpdateAnalys.dom.title = 'Update time';
    this.statsContainer.appendChild(realUpdateAnalys.dom);

    checkUpdateAnalys = new Stats();
    checkUpdateAnalys.showPanel(0);
    checkUpdateAnalys.dom.style.cssText = '';
    checkUpdateAnalys.dom.title = 'Check update time';
    this.statsContainer.appendChild(checkUpdateAnalys.dom);
  }

  enter() {
    this.dom.style.display = 'block';

    this.canvas = createCanvas(windowWidth, windowHeight).parent('game-scene');
    DomUtils.preventRightClick(this.canvas.elt);

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
    if (!this.game) return;

    let currentTime = performance.now();
    const elapsedTime = currentTime - previousTime;
    const interval = 1000 / this.game.fps;
    checkUpdateAnalys.begin();
    if (elapsedTime > interval) {
      previousTime = currentTime - (elapsedTime % interval);

      let _elapsedTime = Math.min(elapsedTime, 100);
      let _updateCount = Math.floor(_elapsedTime / interval);
      // for (let i = 0; i < _updateCount; i++) {
      realUpdateAnalys.begin();
      this.game.update();
      realUpdateAnalys.end();
      // }
    }
    checkUpdateAnalys.end();

    setTimeout(() => {
      this.updateLoop();
    }, interval / 2);

    // this.animationFrameId = requestAnimationFrame(this.updateLoop.bind(this));
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
