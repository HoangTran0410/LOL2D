import Game from '../game/Game.js';
import { Scene } from '../managers/SceneManager.js';
import { preventRightClick } from '../utils/dom.utils.js';
import MenuScene from './MenuScene.js';

let drawStats, updateStats;

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
    frameRate(60);

    this.game = new Game();
    this.update();
  }

  update() {
    updateStats.begin();

    let startTime = performance.now();
    this.game.update();
    let endTime = performance.now();

    let _deltaTime = endTime - startTime;
    let _waitTime =
      // 1000 / (this.game.fps || 60)
      Math.max(1000 / (this.game.fps || 60) - _deltaTime, 0);

    setTimeout(() => {
      updateStats.end();
      this.update();
    }, _waitTime);
  }

  draw() {
    drawStats.begin();

    // this.game.update();
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
    this.dom.style.display = 'none';
    this.game.destroy?.();
  }

  windowResized() {
    this.game.resize?.(windowWidth, windowHeight);
    resizeCanvas(windowWidth, windowHeight, true);
  }
}
