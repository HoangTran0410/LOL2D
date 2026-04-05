/**
 * sketch.ts — p5.js global-mode initialization + Array prototype monkey-patching
 *
 * p5 is loaded via CDN <script> tag, but without setup()/draw() in global scope it
 * stays dormant and does NOT copy its functions to window.
 * Calling new p5() with empty stubs forces global-mode initialization — this makes
 * all functions (loadImage, createVector, background, etc.) available as window globals.
 *
 * This file also patches Array prototype for performance.
 */
import { every, filter, forEach, map, some } from './utils/optimized.utils';
import { System } from './libs/detect-collisions';

// Force p5.js to initialize in global mode so it copies all functions to window.
// Without this, p5's CDN bundle stays dormant (no window.loadImage etc.).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).p5 = (window as any).p5 || undefined;
try {
  new ((window as any).p5 as any)((p: any) => { p.setup = () => {}; p.draw = () => {}; });
} catch (e) {
  // p5 already initialized or unavailable — ignore
}

// Expose detect-collisions System globally for code that accesses window.ABC
(window as any).ABC = { System };

// Patch Array prototype for performance (mirrors original sketch.js behaviour)
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
