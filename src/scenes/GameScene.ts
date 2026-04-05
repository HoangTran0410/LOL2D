import { Scene } from '../managers/SceneManager';
import Game from '../game/Game';
import MenuScene from './MenuScene';
import DomUtils from '../utils/dom.utils';

// Stats.js is loaded via CDN — declare it as a global
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Stats: any;

let drawAnalys: typeof Stats;
let checkUpdateAnalys: typeof Stats;
let realUpdateAnalys: typeof Stats;
let previousTime: number;

export default class GameScene extends Scene {
  dom!: HTMLElement;
  statsContainer!: HTMLElement;
  canvas!: any;
  game: Game | null = null;
  private _animationFrameId: number | null = null;

  setup() {
    this.dom = document.querySelector('#game-scene') as HTMLElement;
    this.statsContainer = document.querySelector('#stats') as HTMLElement;

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.canvas = (createCanvas(windowWidth, windowHeight) as any).parent('game-scene');
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
    this.updateLoop();
  }

  stopGame() {
    if (this._animationFrameId !== null) {
      clearTimeout(this._animationFrameId);
      this._animationFrameId = null;
    }
    this.game?.destroy();
    this.game = null;
  }

  updateLoop() {
    if (!this.game) return;

    const currentTime = performance.now();
    const elapsedTime = currentTime - previousTime;
    const interval = 1000 / this.game.fps;
    checkUpdateAnalys.begin();
    if (elapsedTime > interval) {
      previousTime = currentTime - (elapsedTime % interval);

      realUpdateAnalys.begin();
      this.game.update();
      realUpdateAnalys.end();
    }
    checkUpdateAnalys.end();

    this._animationFrameId = window.setTimeout(() => {
      this.updateLoop();
    }, interval / 2);
  }

  draw() {
    drawAnalys.begin();
    this.game?.draw();
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
    this.game?.resize(windowWidth, windowHeight);
    resizeCanvas(windowWidth, windowHeight, true);
  }
}
