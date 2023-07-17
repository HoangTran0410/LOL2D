import Game from '../game/Game.js';
import { Scene } from '../managers/SceneManager.js';
import { preventRightClick } from '../utils/dom.utils.js';
import MenuScene from './MenuScene.js';

let drawStats, updateStats, previousTime;

export default class GameScene extends Scene {
  setup() {
    this.dom = document.querySelector('#game-scene');

    let c = createCanvas(windowWidth, windowHeight).parent('game-scene');
    preventRightClick(c.elt);

    this.game = null;

    this.statsContainer = document.querySelector('#stats');

    drawStats = new Stats();
    drawStats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    drawStats.dom.style.cssText = '';
    this.statsContainer.appendChild(drawStats.dom);

    updateStats = new Stats();
    updateStats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    updateStats.dom.style.cssText = '';
    this.statsContainer.appendChild(updateStats.dom);
  }

  enter() {
    this.dom.style.display = 'block';

    cursor('assets/cursors/normal.cur');
    pixelDensity(1);
    strokeJoin(ROUND);
    strokeCap(ROUND);
    rectMode(CORNER);
    imageMode(CENTER);

    this.game = new Game();
    this.startGame();
  }

  startGame() {
    previousTime = performance.now();
    this.updateLoop();
  }

  updateLoop() {
    let currentTime = performance.now();
    const elapsedTime = currentTime - previousTime;
    const interval = 1000 / this.game.fps;
    if (elapsedTime > interval) {
      updateStats.begin();
      this.game.update();
      previousTime = currentTime - (elapsedTime % interval);
      updateStats.end();
    }

    this.animationFrameId = requestAnimationFrame(this.updateLoop.bind(this));
  }

  draw() {
    drawStats.begin();
    this.game.draw();
    drawStats.end();
  }

  keyPressed() {
    // ESC
    if (keyCode === 27) {
      this.sceneManager.showScene(MenuScene);
    }
    this.game.keyPressed?.();
  }

  exit() {
    cancelAnimationFrame(this.animationFrameId);
    this.dom.style.display = 'none';
    this.game.destroy?.();
  }

  windowResized() {
    this.game.resize?.(windowWidth, windowHeight);
    resizeCanvas(windowWidth, windowHeight, true);
  }
}
