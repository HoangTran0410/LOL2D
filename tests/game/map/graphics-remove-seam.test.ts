import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { removeGraphics } from '../../../src/utils/graphics.utils';

/**
 * ## `p5.Graphics.remove()` throws, and takes the caller's whole teardown with it
 *
 * Measured against the vendored p5 1.11.12, in Chrome. `Graphics.remove()`
 * opens with
 *
 *     if (this._renderer && typeof this._renderer.remove === 'function')
 *       this._renderer.remove();
 *
 * `RendererGL` has a `remove` of its own (it frees shaders and textures), but
 * **`Renderer2D` does not** — it inherits `p5.Element.prototype.remove`, so the
 * `typeof` guard passes and the wrong function runs. `Element.remove` starts
 * with `this._pInst._elements.indexOf(this)`, and a renderer's `_pInst` is the
 * `p5.Graphics` that owns it rather than the sketch. A `Graphics` has no
 * `_elements`, so it is `undefined.indexOf` — a `TypeError` out of the *first*
 * statement of `remove()`, before anything is cleaned up.
 *
 * The throw is what made this a crash rather than a leak. `FogOfWar.destroy()`
 * is the second line of `Game.destroy()`, so leaving the match unwound like
 * this: `Minimap.destroy()` and `InGameHUD.destroy()` never ran, `GameScene.exit()`
 * never hid the canvas, and `SceneManager.showScene` never reached the
 * assignment that switches scene — the player was left inside a torn-down match
 * with no way out. `Minimap.resize()` and `Minimap.bufferFor()` have the same
 * two lines and broke window resizing and the expanded map the same way.
 *
 * `removeGraphics()` is the seam. Both halves are checked here: that it really
 * unregisters the buffer, and that nothing in `src/` goes back to calling
 * `.remove()` on a graphics buffer directly.
 */

/**
 * The failing p5 object graph, built to the shape measured in the browser:
 * a sketch owning `_elements`, a graphics registered in it, and a 2D renderer
 * whose `remove` is the inherited `p5.Element.prototype.remove` and whose
 * `_pInst` points back at the graphics.
 */
function installFakeP5(): { sketch: any; graphics: any } {
  const elementRemove = function (this: any) {
    const index = this._pInst._elements.indexOf(this);
    if (index !== -1) this._pInst._elements.splice(index, 1);
    if (this.elt && this.elt.parentNode) this.elt.parentNode.removeChild(this.elt);
  };

  const sketch: any = { _elements: [] };
  const graphics: any = {
    _pInst: sketch,
    elt: { parentNode: null },
    canvas: {},
    remove() {
      // p5.Graphics.prototype.remove, transcribed.
      if (this._renderer && typeof this._renderer.remove === 'function') this._renderer.remove();
      if (this.elt.parentNode) this.elt.parentNode.removeChild(this.elt);
      const idx = this._pInst._elements.indexOf(this);
      if (idx !== -1) this._pInst._elements.splice(idx, 1);
      this._renderer = undefined;
      this.canvas = undefined;
      this.elt = undefined;
    },
  };
  // Renderer2D: extends p5.Element, adds no remove of its own, and its _pInst
  // is the graphics — which has no `_elements`.
  graphics._renderer = { _pInst: graphics, remove: elementRemove, elt: {} };
  sketch._elements.push(graphics);

  (globalThis as any).p5 = { Element: { prototype: { remove: elementRemove } } };
  return { sketch, graphics };
}

afterEach(() => {
  delete (globalThis as any).p5;
});

describe('removeGraphics survives the p5 1.11 Renderer2D.remove trap', () => {
  it('the trap is real: calling Graphics.remove() directly throws', () => {
    const { graphics } = installFakeP5();
    expect(() => graphics.remove()).toThrow(TypeError);
  });

  it('removes the buffer without throwing', () => {
    const { graphics } = installFakeP5();
    expect(() => removeGraphics(graphics)).not.toThrow();
  });

  it('really unregisters it from the sketch, so it is a free and not a swallow', () => {
    const { sketch, graphics } = installFakeP5();
    removeGraphics(graphics);
    expect(sketch._elements).not.toContain(graphics);
    expect(sketch._elements).toHaveLength(0);
  });

  it('lets a renderer that has real cleanup of its own do it (WEBGL)', () => {
    const { graphics } = installFakeP5();
    let freed = 0;
    // RendererGL.remove: its own function, not the inherited Element one.
    graphics._renderer = { _pInst: graphics, remove: () => freed++ };
    removeGraphics(graphics);
    expect(freed).toBe(1);
  });

  it('tolerates a buffer that was never built', () => {
    installFakeP5();
    expect(() => removeGraphics(null)).not.toThrow();
    expect(() => removeGraphics(undefined)).not.toThrow();
  });
});

/**
 * A source scan for the same reason `dash-onupdate-seam.test.ts` is one: the
 * mistake is a shape, `tsc` cannot see it (`.remove()` is a real method with a
 * real signature), and it only fails in a browser, on the frame that tears the
 * buffer down.
 *
 * Scoped to the files that build graphics buffers. `GameScene`'s
 * `this.canvas.remove()` is deliberately outside it: the main canvas renderer
 * is constructed with `isMainCanvas`, so its `_pInst` really is the sketch and
 * `Element.remove` finds `_elements` where it expects to.
 */
const SRC = join(__dirname, '../../../src');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const GRAPHICS_OWNERS = [
  'game/gameObject/map/FogOfWar.ts',
  'game/gameObject/map/Minimap.ts',
  'managers/AssetManager.ts',
];

describe('nothing tears a graphics buffer down by hand', () => {
  it('every file that calls createGraphics goes through removeGraphics', () => {
    const offenders: string[] = [];

    for (const file of GRAPHICS_OWNERS) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      const matches = source.match(/\.remove\s*\(\s*\)/g);
      if (matches) offenders.push(`${file}: ${matches.length}x .remove()`);
    }

    expect(offenders).toEqual([]);
  });

  it('the scanned list is still the list of files that build buffers', () => {
    for (const file of GRAPHICS_OWNERS) {
      expect(readFileSync(join(SRC, file), 'utf8')).toContain('createGraphics');
    }
  });
});
