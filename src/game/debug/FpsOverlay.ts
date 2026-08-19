/**
 * The lightweight FPS readout. Stats.js used to live here for exactly this —
 * three always-redrawing debug canvases so a developer could read three
 * numbers — and it is gone (see `scripts/copy-vendor.mjs`'s own comment):
 * every player paid to fetch, parse and precache a blocking script for a HUD
 * nobody but a developer reads. This replaces the one number a player might
 * actually want (frame rate, to tell "my phone is struggling" from "the game
 * is buggy") with a single `text()` call instead of a library.
 *
 * Two pieces, split the way `NavDebugOverlay`/`DebugOverlay` split theirs:
 * `FpsMeter` is pure arithmetic — no p5 global, testable in plain node — and
 * `drawFpsOverlay` is the one function that touches the canvas, called only
 * from inside `Game.draw()`.
 *
 * The toggle itself is the sixth entry in `DebugFlags`/`DebugLayerConfig`
 * (`fps`), stored, drawn and reset exactly like `terrain`/`collision`/
 * `vision`/`quadtree` — a plain boolean, not aliased onto anything live the
 * way `routes` is. It persists through `PregameConfig.cheats.debug`, the
 * same seam as every other debug layer, so the panel's existing generic grid
 * (`DEBUG_LAYER_KEYS` in `SettingsTab.vue`) picks it up for free.
 */

/** Weight given to each new instantaneous sample in the running average. Low on purpose — a
 *  raw per-frame fps is unreadable (it swings with every GC pause and script tick), and this
 *  is the whole reason to smooth it rather than print `1000 / deltaTime` directly. */
export const FPS_SMOOTHING_ALPHA = 0.1;

/** Floor on the delta a single sample can represent, so a divide never blows up to `Infinity`
 *  (or `NaN` at exactly 0ms) off one freak frame with no measurable time between draws. */
export const MIN_FRAME_MS = 1000 / 240;

/** Ceiling on the delta a single sample can represent, so the tab regaining focus after being
 *  backgrounded for seconds — a real `deltaTime` in the thousands — reads as "very low" rather
 *  than briefly reporting something close to 0 fps and needing many frames to recover from it. */
export const MAX_FRAME_MS = 250;

/**
 * A rolling average over per-frame deltas. Allocation-free per sample — one
 * numeric field, updated in place — so leaving it running costs nothing
 * worth measuring even every frame.
 */
export class FpsMeter {
  private smoothed: number | null = null;

  /**
   * Feed one frame's delta (`deltaTime`, in ms) in, get the current smoothed
   * fps back. The very first sample seeds the average directly rather than
   * blending from a starting value of 0 — otherwise the readout would spend
   * its first several frames climbing from near-zero instead of showing a
   * true number immediately.
   */
  sample(deltaMs: number): number {
    const clamped = Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, deltaMs));
    const instant = 1000 / clamped;
    this.smoothed =
      this.smoothed === null
        ? instant
        : this.smoothed + (instant - this.smoothed) * FPS_SMOOTHING_ALPHA;
    return this.smoothed;
  }
}

/** The slice of `Game` this overlay needs. Keeps it off the `Game` type, same as its neighbours. */
export interface FpsOverlayHost {
  director: { debug: { fps: boolean } };
}

const MARGIN = 10;
/** Below the corner button (`.corner-btn` in `styles/hud.css`), which owns the top-right first. */
const TOP_OFFSET = 54;
const TEXT_SIZE = 14;

/**
 * Screen-space, top-right, drawn outside `camera.makeDraw` so panning or
 * zooming never moves it. The flag is checked first — same rule every layer
 * in `DebugOverlay.ts` follows — so sampling and drawing both cost nothing
 * while this is off.
 */
export function drawFpsOverlay(host: FpsOverlayHost, meter: FpsMeter): void {
  if (!host.director.debug.fps) return;
  const fps = meter.sample(deltaTime);

  push();
  noStroke();
  fill(255, 255, 255, 220);
  textAlign(RIGHT, TOP);
  textSize(TEXT_SIZE);
  text(`${Math.round(fps)} FPS`, width - MARGIN, TOP_OFFSET);
  pop();
}
