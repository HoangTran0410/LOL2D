/**
 * The bounds on the player's zoom multiplier, as two numbers and a clamp.
 *
 * Split out of `Camera.ts` for the reason `renderPreferences.ts` was split out
 * of `Game.ts`: the match-config panel's zoom slider needs `min` and `max`, and
 * the panel is mounted over the menu as well as over a match. Importing them
 * from `Camera.ts` would pull the camera — and Vite's `manualChunks` sends
 * everything under `src/game/` to the `game` chunk — in front of the logo.
 *
 * `Camera.ts` re-exports all three, so every existing import still resolves.
 */

/** Bounds on the player's manual multiplier over the balanced base. */
export const ZOOM_FACTOR_MIN = 0.6;
export const ZOOM_FACTOR_MAX = 1.6;

/**
 * `Math.min`, not p5's `constrain`: this is called from `zoomFactorPreference`
 * before any p5 global exists, and from Vitest's `environment: 'node'` with
 * nothing stubbed.
 */
export const clampZoomFactor = (factor: number): number =>
  Math.min(ZOOM_FACTOR_MAX, Math.max(ZOOM_FACTOR_MIN, factor));
