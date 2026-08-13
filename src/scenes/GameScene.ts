import { Scene } from '../managers/SceneManager';
import Game from '../game/Game';
import MenuScene from './MenuScene';
import DomUtils from '../utils/dom.utils';
import AssetManager from '../managers/AssetManager';

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

  // Bound once so addEventListener/removeEventListener target the same
  // reference — otherwise the listener added in enter() could never be
  // removed in exit(), leaking a handler across every scene re-entry.
  private _handleVisibilityChange = (): void => {
    if (document.hidden) {
      // Tab backgrounded: the setTimeout-driven update loop isn't throttled
      // by the browser the way requestAnimationFrame is, so it would keep
      // burning CPU/battery in the background (notably on mobile) unless we
      // stop it ourselves. Stop p5's draw loop too.
      if (this._animationFrameId !== null) {
        clearTimeout(this._animationFrameId);
        this._animationFrameId = null;
      }
      noLoop();
    } else {
      if (!this.game) return;
      // p5 computes deltaTime from the wall-clock gap since its last real
      // frame. After sitting paused for a while, simply calling loop() would
      // replay that entire gap as one giant deltaTime on the first resumed
      // frame (breaking cooldowns/buffs/particle lifespans, which all key off
      // the shared `deltaTime` global). Resetting p5's internal frame
      // timestamps makes the resumed frame read as "now" instead of a spike.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p5Instance = (window as any).p5?.instance;
      if (p5Instance) {
        const now = performance.now();
        p5Instance._lastRealFrameTime = now;
        p5Instance._lastTargetFrameTime = now;
      }
      // Same idea for our own update loop's elapsed-time tracking, so it
      // doesn't try to "catch up" the hidden duration in one tick.
      previousTime = performance.now();
      loop();
      this.updateLoop();
    }
  };

  setup() {
    this.dom = document.querySelector('#game-scene') as HTMLElement;
    this.statsContainer = document.querySelector('#stats') as HTMLElement;

    // No cap anywhere else in the codebase — without one, p5's draw loop
    // runs as fast as the display allows (120Hz+ on many phones/laptops),
    // burning CPU/battery for no visual benefit.
    frameRate(60);

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

    cursor(AssetManager.get('cursor_normal').url);
    pixelDensity(1);
    strokeJoin(ROUND);
    strokeCap(ROUND);
    rectMode(CORNER);
    imageMode(CENTER);

    document.addEventListener('visibilitychange', this._handleVisibilityChange);

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

  keyPressed(event?: KeyboardEvent) {
    const pressedKeyCode = event?.keyCode ?? keyCode;
    // ESC
    if (pressedKeyCode === 27) {
      this.sceneManager.showScene(MenuScene);
    }
    this.game?.keyPressed(pressedKeyCode, event?.repeat ?? false);
  }

  keyReleased(event?: KeyboardEvent) {
    this.game?.keyReleased(event?.keyCode ?? keyCode);
  }

  exit() {
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    this.game?.spellInputController.cancelAll('SCENE_EXIT');
    this.stopGame();
    this.dom.style.display = 'none';
    this.canvas.remove();
  }

  windowResized() {
    this.game?.resize(windowWidth, windowHeight);
    resizeCanvas(windowWidth, windowHeight, true);
  }
}
