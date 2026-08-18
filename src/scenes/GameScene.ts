import { Scene } from '@/managers/SceneManager';
import Game, { renderFpsPreference } from '@/game/Game';
import { planMatchKits, plannedSpellIds, type MatchPlan } from '@/game/preset';
import { loadRemainingSpells, loadSpells } from '@/game/spellRegistry';
import { loadPregameConfig } from '@/game/config/PregameConfig';
import { spellCatalog } from '@/generated/spellCatalog';
import { assetManifest, type AssetKey } from '@/generated/assetManifest';
import MenuScene from './MenuScene';
import DomUtils from '@/utils/dom.utils';
import AssetManager from '@/managers/AssetManager';
import { setZoomFactorPreference } from '@/game/gameObject/map/Camera';

let previousTime: number;

/*
 * There were three Stats.js FPS panels here, gated behind `import.meta.env.DEV`
 * and wrapped around `update` and `draw` with `.begin()`/`.end()`.
 *
 * The whole library is gone, not just the panels. It was a second global that
 * had to be copied out of `node_modules`, served from `public/vendor/`, loaded
 * by a blocking `<script>` on every boot including production, and precached by
 * the service worker — all of it carried so that a developer could read three
 * numbers. `frameRate()` and the browser's own profiler cover the same ground
 * without shipping anything.
 */

/** One wheel notch, as a step on the manual zoom factor. */
const ZOOM_WHEEL_STEP = 0.1;

/**
 * Art that is on screen the moment a match opens, for *this* match.
 *
 * The menu used to preload every `champ_`/`buff_`/`monster_`/`obj_` image before
 * showing Chơi — 88 files, ~2.1MB — because from there it could not know which
 * champions would play, so "what a match needs" meant "all of them". Here the
 * roster is already decided, so it is six portraits and the player's own seven
 * ability icons instead of fifty-eight portraits and nothing else.
 *
 * The universal sets stay whole because they are small and every match uses
 * them: `buff_` is the crowd-control icons a HUD needs the first time anything
 * lands, and `monster_`/`obj_` are the jungle and the map's furniture — 29 files,
 * ~130KB between them.
 *
 * Everything not listed keeps streaming in through `AssetManager.renderable`,
 * which has always swapped art in as it arrives. This is only the subset worth
 * *waiting* for.
 */
const UNIVERSAL_ART_PREFIXES = ['buff_', 'monster_', 'obj_'] as const;

function matchArtKeys(plan: MatchPlan): AssetKey[] {
  const keys = new Set<AssetKey>();

  for (const key of Object.keys(assetManifest) as AssetKey[]) {
    if (assetManifest[key].kind !== 'image') continue;
    if (UNIVERSAL_ART_PREFIXES.some(prefix => key.startsWith(prefix))) keys.add(key);
  }

  // Every unit's portrait — the player's and each bot's.
  for (const kit of [plan.player, ...plan.bots]) keys.add(kit.avatar);

  // And the player's own ability icons, which are in the HUD from frame one.
  // Bot kits are only ever looked at through the practice panel, which opens on
  // a paused match with all the time in the world to fetch one.
  for (const id of plan.player.spellIds) {
    const iconKey = spellCatalog[id as keyof typeof spellCatalog]?.iconKey;
    if (iconKey) keys.add(iconKey);
  }

  return [...keys];
}

export default class GameScene extends Scene {
  dom!: HTMLElement;
  canvas!: any;
  game: Game | null = null;
  private _animationFrameId: number | null = null;
  /** Set by `stopGame`, so a slow kit load that resolves after an exit is dropped. */
  private _exited = false;
  /** How far this match's kits have got, for the screen `draw` paints while waiting. */
  private _kitsLoaded = 0;
  private _kitsTotal = 0;

  private suspendRuntime(): void {
    if (this._animationFrameId !== null) {
      clearTimeout(this._animationFrameId);
      this._animationFrameId = null;
    }
    noLoop();
  }

  private resumeRuntime(): void {
    if (!this.game || document.hidden || this.game.paused || this._animationFrameId !== null)
      return;
    const now = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p5Instance = (window as any).p5?.instance;
    if (p5Instance) {
      p5Instance._lastRealFrameTime = now;
      p5Instance._lastTargetFrameTime = now;
    }
    previousTime = now;
    loop();
    this.updateLoop();
  }

  private _handleGamePause = (paused: boolean): void => {
    this.game?.inGameHUD.setUpdatesPaused(paused);
    if (paused) this.suspendRuntime();
    else this.resumeRuntime();
  };

  // Bound once so addEventListener/removeEventListener target the same
  // reference — otherwise the listener added in enter() could never be
  // removed in exit(), leaking a handler across every scene re-entry.
  private _handleVisibilityChange = (): void => {
    if (document.hidden) this.suspendRuntime();
    else this.resumeRuntime();
  };

  setup() {
    this.dom = document.querySelector('#game-scene') as HTMLElement;

    // No cap anywhere else in the codebase — without one, p5's draw loop
    // runs as fast as the display allows (120Hz+ on many phones/laptops),
    // burning CPU/battery for no visual benefit.
    frameRate(renderFpsPreference());
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

    void this.startGame();
  }

  /**
   * Fetch the kits this match will play, then start it.
   *
   * Async because the spell catalogue is loaded per champion now (see
   * `game/spellRegistry.ts`). The order is load-bearing in both directions:
   *
   *  - **Plan, then load, then construct.** A default match is six 'random'
   *    loadouts, so "what does this match need?" can only be answered by rolling
   *    the dice first — which is why `Game` is handed the plan rather than
   *    rolling its own, and why the same plan must be the one it builds from.
   *  - **Load the rest afterwards.** A bot re-rolls its kit on respawn, and that
   *    happens inside `update()` with no chance to await anything. The
   *    background load closes that gap within a second, long before anything has
   *    died; `preset.classForId` is the backstop if it has not.
   *
   * The scene may have been left before the load resolves — a player pressing
   * back out of a slow connection — so `exited` is checked before touching
   * anything.
   */
  async startGame() {
    this._exited = false;

    const plan = planMatchKits(loadPregameConfig());
    const kitIds = plannedSpellIds(plan);
    const artKeys = matchArtKeys(plan);

    this._kitsLoaded = 0;
    this._kitsTotal = kitIds.length + artKeys.length;
    const step = () => {
      this._kitsLoaded += 1;
    };

    await Promise.all([
      loadSpells(kitIds, step),
      // `.catch` per image, not for the batch: a missing portrait is a
      // placeholder square, not a reason to refuse the match.
      ...artKeys.map(key =>
        AssetManager.ensure(key)
          .catch(() => undefined)
          .then(step)
      ),
    ]);
    if (this._exited) return;

    this.game = new Game(plan);
    this.warmRemainingSpells();
    // The match's own way out, since Escape is no longer one. `Game` holds no
    // reference to the scene manager and must not gain one — see
    // `Game.onExitRequested`.
    this.game.onExitRequested = () => this.sceneManager.showScene(MenuScene);
    this.game.onPauseChanged = this._handleGamePause;
    previousTime = performance.now();
    this.updateLoop();
  }

  /**
   * Pull the rest of the catalogue in once the match has settled.
   *
   * Deferred to idle rather than fired beside `new Game`: it is 30-60 chunk
   * requests, and the frames right after a match opens are the ones that decide
   * whether it feels smooth. The 2s timeout is the floor, not the target — a bot
   * cannot respawn before then, which is the only thing that needs these.
   *
   * Fire-and-forget on purpose: nothing in a match may block on it, and a
   * chunk that fails to arrive is handled by `preset.classForId`.
   */
  private warmRemainingSpells(): void {
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void;
      }
    ).requestIdleCallback;
    if (idle) idle(() => void loadRemainingSpells(), { timeout: 2000 });
    else window.setTimeout(() => void loadRemainingSpells(), 2000);
  }

  stopGame() {
    this._exited = true;
    const resumeP5ForNextScene = !!this.game?.paused && !document.hidden;
    if (this._animationFrameId !== null) {
      clearTimeout(this._animationFrameId);
      this._animationFrameId = null;
    }
    if (this.game) this.game.onPauseChanged = null;
    this.game?.destroy();
    this.game = null;
    if (resumeP5ForNextScene) loop();
  }

  updateLoop() {
    if (!this.game) return;

    const currentTime = performance.now();
    const elapsedTime = currentTime - previousTime;
    const interval = 1000 / this.game.fps;
    if (elapsedTime > interval) {
      previousTime = currentTime - (elapsedTime % interval);
      this.game.update();
    }

    this._animationFrameId = window.setTimeout(() => {
      this.updateLoop();
    }, interval / 2);
  }

  draw() {
    if (this.game) {
      this.game.draw();
      return;
    }
    // No match yet: either the kits are still arriving, or `stopGame` has run
    // and the scene manager is a frame away from swapping us out. Only the
    // first deserves a screen — painting one on the way out would flash.
    if (!this._exited) this.drawKitLoading();
  }

  /**
   * What the player looks at between pressing Chơi and the first frame.
   *
   * `startGame` awaits the match's spell chunks, and until that resolves
   * `this.game` is null and `draw` had nothing to paint — so the canvas sat
   * black for as long as the network took. On a warm cache that is a flicker;
   * on a phone on mobile data it is a blank screen with no way to tell a slow
   * match from a broken one.
   *
   * Drawn on the p5 canvas rather than as a DOM overlay because the canvas is
   * already up (`enter` creates it before `startGame` runs) and this has to
   * disappear the instant the match paints over it — one fewer thing to tear
   * down on a boundary that already has `_exited` to think about.
   */
  private drawKitLoading(): void {
    const span = this._kitsTotal > 0 ? Math.min(1, this._kitsLoaded / this._kitsTotal) : 0;
    const barWidth = Math.min(360, width * 0.6);
    const barLeft = (width - barWidth) / 2;
    const barTop = height / 2;

    push();
    background(10, 20, 40);

    noStroke();
    fill(214, 202, 154);
    textAlign(CENTER, BOTTOM);
    textSize(18);
    text('Đang vào trận…', width / 2, barTop - 18);

    // The track, then the fill. A hairline of fill at zero so the bar reads as
    // a bar rather than as an empty box while the first chunk is in flight.
    fill(28, 45, 72);
    rectMode(CORNER);
    rect(barLeft, barTop, barWidth, 6, 3);
    fill(200, 170, 90);
    rect(barLeft, barTop, Math.max(4, barWidth * span), 6, 3);

    fill(140, 160, 190);
    textAlign(CENTER, TOP);
    textSize(12);
    text(`Đang tải bộ chiêu… ${Math.round(span * 100)}%`, width / 2, barTop + 16);
    pop();
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
