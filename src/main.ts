/**
 * main.ts — LOL2D application entry point
 *
 * p5 is loaded via CDN <script> tag in global mode. p5 waits for the window
 * `load` event, and only boots (binding loadImage, createVector, background,
 * etc. onto window) if a global setup()/draw() exists at that point.
 *
 * This module runs before `load` fires (module scripts are deferred), so
 * assigning window.setup here is what activates p5. All game code that uses
 * p5 globals must therefore run inside setup() — NOT at module eval time.
 */
import { every, fastHypot, filter, forEach, map, some } from './utils/optimized.utils';
import SceneManager from './managers/SceneManager';
import LoadingScene from './scenes/LoadingScene';
import { registerServiceWorker } from './pwa/updates';

/*
 * No `import { System } from './libs/detect-collisions'` here.
 *
 * This file used to hang it on `window.ABC` "for code that accesses
 * window.ABC". Nothing did — not src, not tests, not the e2e scripts — but the
 * import was real, so the entry chunk depended on detect-collisions, sat and
 * poly-decomp, and Vite emitted a `<link rel="modulepreload">` that fetched all
 * 44KB of them before the menu could draw. `ObjectManager` imports `System`
 * itself, which is what actually needs it, and that lands in the game chunk
 * where it belongs. `tests/scenes/menuBootPath.test.ts` holds the line.
 */

// Patch Math.hypot with fast 2D scalar implementation
Math.hypot = fastHypot;

// Patch Array prototype for performance (mirrors original app.js behaviour)
/* eslint-disable @typescript-eslint/no-explicit-any */
(Array.prototype as any).map = function (callback: any) {
  return map(this, callback);
};
(Array.prototype as any).forEach = function (callback: any) {
  forEach(this, callback);
};
(Array.prototype as any).some = function (callback: any) {
  return some(this, callback);
};
(Array.prototype as any).every = function (callback: any) {
  return every(this, callback);
};
(Array.prototype as any).filter = function (callback: any) {
  return filter(this, callback);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

(window as any).setup = function setup() {
  const mgr = new SceneManager() as any;
  mgr.wire();

  // holding global data
  mgr.gameData = {};

  // Dev-only handle so end-to-end tests can reach the live scene and game.
  // Stripped from production builds by Vite's import.meta.env.DEV constant.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lol2d = mgr;

  // open loading scene
  mgr.showScene(LoadingScene);

  // Last, and fire-and-forget: caching the app must never be on the path
  // between the player and a running game. See src/pwa/updates.ts.
  registerServiceWorker();
};
