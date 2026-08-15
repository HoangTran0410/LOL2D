import { Scene } from '../managers/SceneManager';
import Game from '../game/Game';
import MenuScene from './MenuScene';
import DomUtils from '../utils/dom.utils';
import AssetManager from '../managers/AssetManager';
import { setZoomFactorPreference } from '../game/gameObject/map/Camera';

// Stats.js is loaded via CDN — declare it as a global
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Stats: any;

let drawAnalys: typeof Stats;
let checkUpdateAnalys: typeof Stats;
let realUpdateAnalys: typeof Stats;
let previousTime: number;

/** One wheel notch, as a step on the manual zoom factor. */
const ZOOM_WHEEL_STEP = 0.1;

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
    // The match's own way out, since Escape is no longer one. `Game` holds no
    // reference to the scene manager and must not gain one — see
    // `Game.onExitRequested`.
    this.game.onExitRequested = () => this.sceneManager.showScene(MenuScene);
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
    // ESC. It used to be `showScene(MenuScene)` — one mis-hit ended the match,
    // with no confirmation and nothing built up in it recoverable. It now
    // opens the practice panel (or closes the innermost thing that is open),
    // and the exit lives at the bottom of that panel's Trận đấu tab behind a
    // two-step confirm. `Game.keyPressed` binds only 32 and 78, so nothing
    // else wanted 27 — and it stops here rather than falling through, so a
    // future binding cannot fire underneath the panel it just opened.
    if (pressedKeyCode === 27) {
      this.game?.escape();
      return;
    }
    this.game?.keyPressed(pressedKeyCode, event?.repeat ?? false);
  }

  keyReleased(event?: KeyboardEvent) {
    this.game?.keyReleased(event?.keyCode ?? keyCode);
  }

  /**
   * `SceneManager` has always routed this; nothing ever overrode it, which is
   * why `Camera.zoomBy` sat uncalled. One notch is 10% of the manual range.
   *
   * Adjusts the *factor*, not the scale, so the choice survives a resize —
   * see `Camera.setZoomFactor`.
   */
  mouseWheel(event?: WheelEvent): void {
    const delta = event?.deltaY ?? 0;
    if (!delta || !this.game) return;
    this.game.camera.zoomBy(delta < 0 ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP);
    setZoomFactorPreference(this.game.camera.zoomFactor);
  }

  /**
   * The minimap's half of the click routing; the right-button move order still
   * runs off `mouseIsPressed` inside `Game.fixedUpdate`, which now refuses to
   * fire through the minimap's rect.
   */
  mousePressed(): void {
    this.game?.mousePressed();
  }

  /**
   * All three touch callbacks do the same thing: hand the game the full list of
   * fingers now on the glass.
   *
   * p5 rebuilds `touches` before calling any of them, so a finger that has
   * lifted is already gone from the list by the time touchEnded runs — which
   * makes "reconcile against the list" the whole of the bookkeeping, and means
   * a dropped touchend (a phone call, a notification shade) recovers by itself.
   *
   * `false` is p5's signal to preventDefault, without which a drag across the
   * canvas scrolls the page and a two-thumb gesture pinch-zooms it.
   */
  private syncTouches(event?: TouchEvent): boolean | undefined {
    // p5 wires these callbacks on `window`, so they also receive touches from
    // Vue's settings overlay. Only the game canvas owns/cancels gestures;
    // overlay controls and scroll containers keep the browser's native path.
    if (event?.target !== this.canvas?.elt) return undefined;
    // p5 types `touches` as object[]; its entries carry canvas-relative x/y and
    // the browser's own identifier.
    const points = touches as unknown as Array<{ x: number; y: number; id: number }>;
    this.game?.syncTouches(points.map(point => ({ id: point.id, x: point.x, y: point.y })));
    return false;
  }

  touchStarted(event?: TouchEvent) {
    return this.syncTouches(event);
  }

  touchMoved(event?: TouchEvent) {
    return this.syncTouches(event);
  }

  touchEnded(event?: TouchEvent) {
    return this.syncTouches(event);
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
