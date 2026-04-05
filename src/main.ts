/**
 * main.ts — LOL2D application entry point
 *
 * IMPORTANT: sketch code is inlined here (not imported) because Rollup/Vite
 * drops pure side-effect imports in the production chunk.
 */
import { every, filter, forEach, map, some } from './utils/optimized.utils';
import { System } from './libs/detect-collisions';
import SceneManager from './managers/SceneManager';
import LoadingScene from './scenes/LoadingScene';

// ── Force p5.js to initialize in global mode ──────────────────────────────────
// p5 is loaded via CDN <script> tag but without setup()/draw() in global scope it
// stays dormant and does NOT copy its functions to window.
// Calling new p5() with empty stubs forces global-mode initialization.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new ((window as any).p5 as any)((p: any) => { p.setup = () => {}; p.draw = () => {}; });
} catch (e) {
  // p5 already initialized or unavailable — ignore
}

// ── Expose detect-collisions System globally ───────────────────────────────────
(window as any).ABC = { System };

// ── Patch Array prototype for performance ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any).map = function <T, U>(this: T[], callback: (value: T, index: number) => U): U[] {
  return map(this, callback as any);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any).forEach = function <T>(this: T[], callback: (value: T, index: number) => void): void {
  forEach(this, callback as any);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any).some = function <T>(this: T[], callback: (value: T, index: number) => boolean): boolean {
  return some(this, callback as any);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any).every = function <T>(this: T[], callback: (value: T, index: number) => boolean): boolean {
  return every(this, callback as any);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any).filter = function <T>(this: T[], callback: (value: T, index: number) => boolean): T[] {
  return filter(this, callback as any);
};

// ── Wire the scene manager and start ─────────────────────────────────────────────
const mgr = new SceneManager();
mgr.wire();
(mgr as any).gameData = {};
mgr.showScene(LoadingScene);
