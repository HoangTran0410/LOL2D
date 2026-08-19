import { Rectangle } from '@/libs/quadtree';

/**
 * The world span every screen must show. A champion's `visionRadius` is 500
 * (`Stats.ts:190`), so what a player is permitted to know is a circle 1000
 * units across; everything past it is fog. Deriving the camera from that
 * rather than from an invented number is what makes "one world unit is one
 * pixel" — a 11x area advantage for a desktop over a phone — go away.
 *
 * A constant, never a live read of the player's current vision: a buff that
 * grants sight must not make the camera lurch.
 */
export const VISION_SPAN = 1000;

/**
 * Bounds on the final scale. The floor is deliberately below a landscape
 * phone's 0.39 — the shipped code clamped at 0.5, which would silently clip
 * the one device this whole feature exists for and leave the bug in a form
 * much harder to see.
 */
export const SCALE_MIN = 0.3;
export const SCALE_MAX = 2.5;

/**
 * The zoom bounds live in `game/config/zoomBounds.ts` — three p5-free values
 * the match-config panel's slider reads from the menu, where this file (and the
 * match with it) must not be loaded. Re-exported so every existing
 * `from '.../Camera'` still resolves.
 */
export { ZOOM_FACTOR_MIN, ZOOM_FACTOR_MAX, clampZoomFactor } from '@/game/config/zoomBounds';
import { clampZoomFactor } from '@/game/config/zoomBounds';

/**
 * The shorter side, so an ultrawide gets more horizontal world rather than a
 * penalty. The consequence is intended: a 2.16-aspect phone ends up seeing
 * more horizontal world than a 1.78-aspect desktop. Aspect ratio decides
 * horizontal extent, and that is not something to normalise away.
 */
export const baseScaleFor = (viewportWidth: number, viewportHeight: number): number =>
  Math.min(viewportWidth, viewportHeight) / VISION_SPAN;

/** The frame length the two smoothing factors below were tuned at. */
export const REFERENCE_FRAME_MS = 1000 / 60;

/** Fraction of the remaining gap the camera closes per 60fps frame. */
export const FOLLOW_PER_FRAME = 0.1;

/** The same, for the zoom settling on a new scale. */
export const ZOOM_PER_FRAME = 0.07;

/**
 * A per-frame smoothing factor converted to the same pull per unit of *time*.
 *
 * `position.lerp(target, 0.1)` closes a tenth of the gap every frame, which
 * makes the camera's speed a function of the frame rate rather than of time.
 * Measured over half a second chasing a target 1000px away: 60fps ends 953px
 * along, 30fps only 794px, 144fps 999px. So the camera sits further behind the
 * champion on a slow device — and, because no two real frames are the same
 * length, its speed jitters with every wobble in frame time even while the
 * champion walks in a straight line. The whole world shakes slightly, which
 * reads as motion sickness rather than as a frame rate problem.
 *
 * Exponential decay is the fix: raising the per-frame retention to the number
 * of reference frames elapsed makes the result depend only on how much time
 * passed. It cannot overshoot — the factor approaches 1 and never exceeds it —
 * so a tab returning from minutes in the background snaps to its target rather
 * than flying past it, which is the behaviour that case wants anyway.
 */
export const smoothingFor = (perFrame: number, deltaMs: number): number =>
  1 - Math.pow(1 - perFrame, Math.max(0, deltaMs) / REFERENCE_FRAME_MS);

export default class Camera {
  position: p5.Vector;
  currentScale: number;
  scale: number;
  target: p5.Vector | null;

  // Scratch objects reused by getBoundingBox/drawGrid so their once-per-frame
  // corner lookups don't allocate a p5.Vector via createVector each call.
  private _scratchTopLeft = { x: 0, y: 0 };
  private _scratchBottomRight = { x: 0, y: 0 };

  constructor() {
    this.position = createVector(0, 0);
    this.currentScale = 0.5;
    this.scale = 1;
    this.target = null;
  }

  /** The balanced scale for this viewport, before the player's preference. */
  baseScale = 1;
  /** The player's multiplier over `baseScale`. Persisted; see `zoomFactorPreference`. */
  zoomFactor = 1;

  /**
   * Recompute for a viewport size. Takes explicit numbers rather than reading
   * the `width`/`height` globals so it is callable from a headless test.
   */
  fitTo(viewportWidth: number, viewportHeight: number): void {
    this.baseScale = baseScaleFor(viewportWidth, viewportHeight);
    this.applyZoom();
  }

  /**
   * A factor over the base, never an absolute scale. That is what lets the two
   * inputs compose: with an absolute scale, resizing the window would discard
   * the player's zoom and choosing a zoom would discard the balance.
   */
  setZoomFactor(factor: number): void {
    this.zoomFactor = clampZoomFactor(factor);
    this.applyZoom();
  }

  zoomBy(delta: number): void {
    this.setZoomFactor(this.zoomFactor + delta);
  }

  /** Drop the opening lerp and start where we mean to be. */
  snapToScale(): void {
    this.currentScale = this.scale;
  }

  private applyZoom(): void {
    this.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, this.baseScale * this.zoomFactor));
  }

  /**
   * The world size a `px`-sized thing must be drawn at to occupy `px` on
   * screen. Information overlays — health bars, damage numbers, stack tallies —
   * are a HUD that happens to be positioned in world coordinates, so they use
   * this; a champion sprite is the world, and does not.
   */
  constantSize(px: number): number {
    return this.currentScale > 0 ? px / this.currentScale : px;
  }

  update(): void {
    // `elapsed`, not `delta`: a local named for the p5 global it reads would be
    // one keystroke from shadowing it. See CLAUDE.md.
    const elapsed = typeof deltaTime === 'number' ? deltaTime : REFERENCE_FRAME_MS;
    if (this.target) {
      this.position.lerp(this.target, smoothingFor(FOLLOW_PER_FRAME, elapsed));
    }
    this.currentScale = lerp(this.currentScale, this.scale, smoothingFor(ZOOM_PER_FRAME, elapsed));
  }

  drawGrid(gridSize = 400): void {
    stroke(100, 70);
    strokeWeight(2);

    const topLeft = this.screenToWorldInto(0, 0, this._scratchTopLeft);
    const bottomRight = this.screenToWorldInto(width, height, this._scratchBottomRight);

    const startX = floor(topLeft.x / gridSize) * gridSize;
    const startY = floor(topLeft.y / gridSize) * gridSize;

    for (let x = startX; x < bottomRight.x; x += gridSize) {
      line(x, topLeft.y, x, bottomRight.y);
    }
    for (let y = startY; y < bottomRight.y; y += gridSize) {
      line(topLeft.x, y, bottomRight.x, y);
    }
  }

  getBoundingBox(): Rectangle {
    const topLeft = this.screenToWorldInto(0, 0, this._scratchTopLeft);
    const bottomRight = this.screenToWorldInto(width, height, this._scratchBottomRight);
    return new Rectangle({
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
    });
  }

  screenToWorld(x: number, y: number): p5.Vector {
    return createVector(
      (x - width / 2) / this.currentScale + this.position.x,
      (y - height / 2) / this.currentScale + this.position.y
    );
  }

  worldToScreen(x: number, y: number): p5.Vector {
    return createVector(
      (x - this.position.x) * this.currentScale + width / 2,
      (y - this.position.y) * this.currentScale + height / 2
    );
  }

  /**
   * Non-allocating variant of screenToWorld: writes into the caller-supplied
   * `target` instead of creating a new p5.Vector. Use in hot paths (e.g. a
   * per-vertex loop) where only the numbers are needed.
   */
  screenToWorldInto(
    x: number,
    y: number,
    target: { x: number; y: number }
  ): { x: number; y: number } {
    target.x = (x - width / 2) / this.currentScale + this.position.x;
    target.y = (y - height / 2) / this.currentScale + this.position.y;
    return target;
  }

  /** Non-allocating variant of worldToScreen — see screenToWorldInto. */
  worldToScreenInto(
    x: number,
    y: number,
    target: { x: number; y: number }
  ): { x: number; y: number } {
    target.x = (x - this.position.x) * this.currentScale + width / 2;
    target.y = (y - this.position.y) * this.currentScale + height / 2;
    return target;
  }

  makeDraw(drawFunc: (() => void) | undefined): void {
    this.push();
    drawFunc?.();
    this.pop();
  }

  push(): void {
    push();
    translate(width / 2, height / 2);
    scale(this.currentScale);
    translate(-this.position.x, -this.position.y);
  }

  pop(): void {
    pop();
  }
}

/** Mirrors `TouchControls.ts:160`'s `'lol2d.touchControls'`. */
const POINTER_ZOOM_STORAGE_KEY = 'lol2d.zoomFactor';
const TOUCH_ZOOM_STORAGE_KEY = 'lol2d.zoomFactor.touch';

const zoomStorageKey = (touchUi: boolean): string =>
  touchUi ? TOUCH_ZOOM_STORAGE_KEY : POINTER_ZOOM_STORAGE_KEY;

const finiteAbove = (value: number, floor: number): boolean =>
  Number.isFinite(value) && value > floor;

/**
 * The player's zoom multiplier. Three sources, most explicit first — the same
 * shape as `touchControlsPreference` (`TouchControls.ts:220`), and for the
 * same reason: the query parameter is what makes this verifiable from a
 * Playwright run, independent of whatever the developer has stored.
 */
export function zoomFactorPreference(touchUi = false): number {
  try {
    const query = new URLSearchParams(window.location.search).get('zoom');
    if (query !== null) {
      const parsed = Number(query);
      if (finiteAbove(parsed, 0)) return clampZoomFactor(parsed);
    }
  } catch {
    /* no location: fall through to the stored preference */
  }
  try {
    const stored = Number(window.localStorage.getItem(zoomStorageKey(touchUi)));
    if (finiteAbove(stored, 0)) return clampZoomFactor(stored);
  } catch {
    /* storage blocked: fall through to the default */
  }
  return 1;
}

export function setZoomFactorPreference(factor: number, touchUi = false): void {
  try {
    window.localStorage.setItem(zoomStorageKey(touchUi), String(clampZoomFactor(factor)));
  } catch {
    /* storage blocked: the setting still works for this session */
  }
}
