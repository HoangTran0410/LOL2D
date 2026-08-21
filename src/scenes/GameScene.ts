import { Scene } from '@/managers/SceneManager';
import Game, { renderFpsPreference } from '@/game/Game';
import { planMatchKits, plannedSpellIds, type MatchPlan } from '@/game/preset';
import { loadRemainingSpells, loadSpells } from '@/game/spellRegistry';
import { loadPregameConfig } from '@/game/config/PregameConfig';
import { spellIconKey } from '@/game/config/spellCatalog';
import { assetManifest, type AssetKey } from '@/generated/assetManifest';
import MenuScene from './MenuScene';
import DomUtils from '@/utils/dom.utils';
import AssetManager from '@/managers/AssetManager';
import { ensurePackAsset } from '@/game/config/packAsset';
import { setZoomFactorPreference } from '@/game/gameObject/map/Camera';
import { renderAlpha } from '@/game/render/Interpolation';
import { contentCatalog } from '@/content/catalog';

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

function matchArtKeys(plan: MatchPlan): string[] {
  const keys = new Set<string>();

  for (const key of Object.keys(assetManifest) as AssetKey[]) {
    if (assetManifest[key].kind !== 'image') continue;
    if (UNIVERSAL_ART_PREFIXES.some(prefix => key.startsWith(prefix))) keys.add(key);
  }

  // Every unit's portrait — the player's and each bot's. `kit.avatar` is a
  // plain string (`preset.ts`'s `PlayableChampionKit` — a pack's own asset
  // key, not necessarily a member of core's generated `AssetKey` union now
  // that a pack champion can be `playable: true`), so this function returns
  // plain strings too rather than casting one back to `AssetKey`. Resolved
  // through `ensurePackAsset`, below, at the one call site that loads them.
  for (const kit of [plan.player, ...plan.bots]) keys.add(kit.avatar);

  // And the player's own ability icons, which are in the HUD from frame one.
  // Bot kits are only ever looked at through the practice panel, which opens on
  // a paused match with all the time in the world to fetch one. `spellIconKey`
  // is a pack's own plain string too — same reasoning as `kit.avatar` above.
  for (const id of plan.player.spellIds) {
    const iconKey = spellIconKey(id);
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

  /**
   * The player left the page, by whichever of the two signals noticed.
   *
   * Stopping the runtime is not enough on its own: it freezes the frame but
   * leaves `Game.paused` false, so nothing on screen says the match is held
   * and the first thing that resumes the loop resumes the fight. `pauseForAway`
   * is the half that makes it an explicit, visible paused state — see its
   * comment for why it opens the panel instead of calling `pause()`.
   *
   * Both, and in this order, because `pauseForAway` is a no-op on a match that
   * is already paused (and on a scene with no match at all) while the runtime
   * still has to stop either way.
   */
  private _leavePage(): void {
    this.suspendRuntime();
    this.game?.pauseForAway();
  }

  // Bound once so addEventListener/removeEventListener target the same
  // reference — otherwise the listener added in enter() could never be
  // removed in exit(), leaking a handler across every scene re-entry.
  private _handleVisibilityChange = (): void => {
    if (document.hidden) this._leavePage();
    else this.resumeRuntime();
  };

  /**
   * The desktop case `visibilitychange` never reports: another window took
   * focus while this one stayed perfectly visible.
   *
   * It also fires for things that are *not* the player leaving — clicking into
   * devtools, an `<iframe>`, a native permission prompt — which is survivable
   * only because the return is deliberately not symmetric in the obvious way.
   * Nothing auto-resumes: coming back leaves the match paused with the panel
   * up, and the player presses the close button. So the worst a spurious blur
   * can do is open a panel the player closes again, never lose a frame of a
   * match they were watching.
   *
   * `blur` does not bubble, so a text field inside the config panel losing
   * focus cannot reach this listener on `window`.
   */
  private _handleWindowBlur = (): void => {
    this._leavePage();
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
    window.addEventListener('blur', this._handleWindowBlur);

    void this.startGame();
  }

  /**
   * Fetch the kits this match will play, then start it.
   *
   * Async because the spell catalogue is loaded per champion now (see
   * `game/spellRegistry.ts`), and, since Task 4, because the active map's
   * geometry is loaded per match too. The order is load-bearing in both
   * directions:
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
   * The map load is the same shape as the spell/art loads it runs beside: a
   * `MapDefinition`'s geometry may be a `() => Promise<MapGeometry>` (see
   * `packs/riot/maps/summonersRift.ts`), and `Game`'s constructor reads
   * `ActiveMap` synchronously — there is no `await` inside it, deliberately
   * (`AIChampion` rebuilds mid-`update()`, and the engine's read side stays
   * synchronous by design). This `await`, immediately before `new Game(...)`,
   * is what makes "the geometry is loaded" true rather than merely usual —
   * the old code relied on `LoadingScene` happening to run first and nothing
   * racing it; once geometry is behind a promise that stops being guaranteed
   * on its own.
   *
   * The scene may have been left before the load resolves — a player pressing
   * back out of a slow connection — so `exited` is checked before touching
   * anything.
   */
  async startGame() {
    this._exited = false;

    const config = loadPregameConfig();
    const plan = planMatchKits(config);
    const kitIds = plannedSpellIds(plan);
    const artKeys = matchArtKeys(plan);

    this._kitsLoaded = 0;
    this._kitsTotal = kitIds.length + artKeys.length;
    const step = () => {
      this._kitsLoaded += 1;
    };

    // Task 10: the config's own choice, by its qualified id
    // (`PregameConfig.mapId` — see that field's own doc comment for why it is
    // validated only as "a non-empty string" on the way in). A missing or
    // stale id — a map an uninstalled pack used to provide — falls back to
    // whatever installs first rather than throwing: a config that named a map
    // that no longer exists must not brick the menu.
    const maps = contentCatalog().maps();
    const mapSummary = maps.find(map => map.id === config.mapId) ?? maps[0];
    if (!mapSummary) throw new Error('GameScene.startGame: no map installed');

    const [, geometry] = await Promise.all([
      Promise.all([
        loadSpells(kitIds, step),
        // `.catch` per image, not for the batch: a missing portrait is a
        // placeholder square, not a reason to refuse the match. `artKeys` is a
        // plain-string list now — core keys and a pack's own mixed together —
        // so it loads through `ensurePackAsset`, not `AssetManager.ensure`
        // directly, which stays typed against core's own `AssetKey` union.
        ...artKeys.map(key =>
          ensurePackAsset(key)
            .catch(() => undefined)
            .then(step)
        ),
      ]),
      contentCatalog().loadMapGeometry(mapSummary.id),
    ]);
    if (this._exited) return;
    if (!geometry) {
      throw new Error(`GameScene.startGame: map ${mapSummary.id} has no geometry`);
    }

    const activeMap = { ...mapSummary, ...geometry };
    this.game = new Game(activeMap, plan);
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
      // The phase the render loop has reached inside the current simulation
      // step. `previousTime` is the notional time of the last tick and
      // `interval` its length — the two clocks this scene deliberately keeps
      // apart (see `updateLoop`). `renderAlpha` clamps to `[0, 1]`, so a late
      // loop draws the newest tick rather than extrapolating past it.
      const interval = 1000 / this.game.fps;
      const alpha = renderAlpha(performance.now() - previousTime, interval);
      this.game.draw(alpha);
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
    window.removeEventListener('blur', this._handleWindowBlur);
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
