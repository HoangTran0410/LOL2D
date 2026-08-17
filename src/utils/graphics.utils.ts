/**
 * The one sanctioned way to free a `createGraphics()` buffer.
 *
 * `p5.Graphics.prototype.remove()` throws on every 2D buffer in p5 1.11.x. It
 * opens with
 *
 *     if (this._renderer && typeof this._renderer.remove === 'function')
 *       this._renderer.remove();
 *
 * meaning to give a WebGL renderer a chance to free its shaders and textures.
 * `RendererGL` does have such a method; **`Renderer2D` does not** — but it
 * extends `p5.Element`, so it inherits `p5.Element.prototype.remove`, the
 * `typeof` guard passes, and that is what runs. `Element.remove`'s first
 * statement is `this._pInst._elements.indexOf(this)`, and a renderer's
 * `_pInst` is the `p5.Graphics` that owns it, not the sketch. A `Graphics` has
 * no `_elements`: `undefined.indexOf` — `TypeError`, out of the first line of
 * `remove()`, with nothing yet torn down.
 *
 * The throw is why this read as a crash and not as a leak. `FogOfWar.destroy()`
 * is the second line of `Game.destroy()`, so leaving a match unwound the rest
 * of the teardown with it — the HUD stayed mounted, `GameScene.exit()` never
 * hid the canvas, and `SceneManager.showScene` never reached the line that
 * switches scene, stranding the player inside a half-destroyed match.
 * `Minimap.resize()` and `Minimap.bufferFor()` broke window resizing and the
 * expanded minimap in the same way.
 *
 * So: drop the renderer first, but only when its `remove` is the inherited
 * `Element` one. A renderer that brings its own cleanup still gets to run it.
 *
 * `tests/game/map/graphics-remove-seam.test.ts` holds the trap and scans for
 * anyone calling `.remove()` on a buffer directly again.
 */
// p5's Graphics type omits most of the surface it actually has, and every
// caller here already holds these as `any` for that reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function removeGraphics(graphics: any): void {
  if (!graphics) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inheritedRemove = (globalThis as any).p5?.Element?.prototype?.remove;
  if (graphics._renderer && inheritedRemove && graphics._renderer.remove === inheritedRemove) {
    graphics._renderer = undefined;
  }

  graphics.remove();
}
