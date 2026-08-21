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
import AssetManager from './managers/AssetManager';
import { contentRegistry } from './content/registry';

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
  // Warm the content registry now, during the loading screen, rather than on
  // the pregame screen's first read. Installing 60+ champions is free here;
  // it is not free on the pregame screen's first paint. `contentRegistry()`
  // touches no p5 global, but it still belongs inside setup() rather than at
  // module eval time — see the header comment above.
  contentRegistry();

  const mgr = new SceneManager() as any;
  mgr.wire();

  // holding global data
  mgr.gameData = {};

  // Dev-only handle so end-to-end tests can reach the live scene and game.
  // Stripped from production builds by Vite's import.meta.env.DEV constant.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lol2d = mgr;

  // open loading scene
  mgr.showScene(LoadingScene);

  // Coming back from the background is where every image in the game can be
  // gone. See the note on the probe in `AssetManager`: p5 keeps each one as an
  // off-DOM canvas, and that is the memory a phone reclaims first while the app
  // is not on screen. The probe is armed here, once, and read on every return.
  AssetManager.armBackingStoreProbe();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      void AssetManager.recoverIfLost();
    });
  }

  // Last, and fire-and-forget: caching the app must never be on the path
  // between the player and a running game. See src/pwa/updates.ts.
  registerServiceWorker();
};
