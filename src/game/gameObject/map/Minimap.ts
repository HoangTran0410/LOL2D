/**
 * The minimap: a fog-respecting map of the whole world, drawn on the canvas in
 * screen space beside the touch controls.
 *
 * Geometry and hit-testing live at module level, free of p5 globals, so they
 * run in a plain node test with no canvas — the shape `TouchControls` already
 * uses. Only `draw()` and the buffer builder may touch p5.
 */

export interface MinimapRect {
  x: number;
  y: number;
  size: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Collapsed edge length in screen pixels, and its inset from the corner. */
export const MINIMAP_SIZE = 150;
export const MINIMAP_MARGIN = 12;
/** Expanded edge length, as a fraction of the viewport's shorter side. */
export const EXPANDED_FRACTION = 0.8;

/**
 * One transform, parameterised by the rect: the expanded and collapsed maps
 * differ only in that rect, so the teleport tap and the dot placement cannot
 * disagree with each other.
 */
export const worldToMinimap = (world: Point, rect: MinimapRect, mapSize: number): Point => ({
  x: rect.x + (world.x / mapSize) * rect.size,
  y: rect.y + (world.y / mapSize) * rect.size,
});

export const minimapToWorld = (screen: Point, rect: MinimapRect, mapSize: number): Point => ({
  x: ((screen.x - rect.x) / rect.size) * mapSize,
  y: ((screen.y - rect.y) / rect.size) * mapSize,
});

export const hitTest = (point: Point, rect: MinimapRect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.size &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.size;

/**
 * Where the map sits for a given state and viewport. Collapsed it is pinned to
 * the top-left corner — both bottom corners are where two thumbs sit for the
 * whole match. Expanded it is centred, at a fraction of the shorter side, so a
 * tall phone and a wide desktop both get a square that fits.
 */
export const minimapRect = (expanded: boolean, viewport: MinimapViewport): MinimapRect => {
  if (!expanded) return { x: MINIMAP_MARGIN, y: MINIMAP_MARGIN, size: MINIMAP_SIZE };
  const size = Math.min(viewport.width, viewport.height) * EXPANDED_FRACTION;
  return { x: (viewport.width - size) / 2, y: (viewport.height - size) / 2, size };
};

export interface MinimapViewport {
  width: number;
  height: number;
}

/**
 * Everything the minimap reads from the match. An interface rather than a
 * `Game` reference for the same reason `TouchControlsHost` is one: it is the
 * whole coupling, and a plain object satisfies it in a node test.
 */
export interface MinimapHost {
  viewport(): MinimapViewport;
  mapSize(): number;
  /** World-space wall polygons; read once per buffer build, never per frame. */
  wallPolygons(): Point[][];
}

/** Ground under the walls, and the walls themselves. */
const GROUND_COLOR = [16, 20, 28, 242] as const;
const WALL_COLOR = [72, 82, 100, 255] as const;
const BORDER_COLOR = [190, 205, 230, 200] as const;

export class Minimap {
  /** Collapsed until tapped. */
  expanded = false;

  private viewportWidth: number;
  private viewportHeight: number;

  /**
   * The wall layer, pre-rendered once per size. Two buffers rather than one
   * scaled to the other: scaling a 150px trace up to 600px is what makes a
   * minimap look muddy.
   *
   * Built lazily, on the first `draw()`, so that constructing a `Minimap` — and
   * with it every geometry method below — needs no canvas.
   */
  private collapsedBuffer: any = null;
  private expandedBuffer: any = null;
  private expandedBufferSize = 0;

  constructor(private readonly host: MinimapHost) {
    const viewport = host.viewport();
    this.viewportWidth = viewport.width;
    this.viewportHeight = viewport.height;
  }

  /** Pure: the current rect for the current state. No p5, no canvas. */
  get rect(): MinimapRect {
    return minimapRect(this.expanded, {
      width: this.viewportWidth,
      height: this.viewportHeight,
    });
  }

  resize(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    // The expanded buffer is sized off the viewport, so it is now the wrong
    // pixel size. Dropped rather than resized: rebuilding is one trace of a
    // static layer, and it happens on the next frame that needs it.
    this.expandedBuffer?.remove();
    this.expandedBuffer = null;
  }

  // -------------------------------------------------------------------- draw

  /**
   * Screen space. Called from `Game.draw()` after `fogOfWar.draw()` and outside
   * `camera.makeDraw` — an overlay you cannot see is not an overlay.
   */
  draw(): void {
    const bounds = this.rect;
    const buffer = this.bufferFor(bounds.size);

    push();
    imageMode(CORNER);
    rectMode(CORNER);
    image(buffer, bounds.x, bounds.y, bounds.size, bounds.size);
    noFill();
    stroke(BORDER_COLOR[0], BORDER_COLOR[1], BORDER_COLOR[2], BORDER_COLOR[3]);
    strokeWeight(2);
    rect(bounds.x, bounds.y, bounds.size, bounds.size);
    pop();
  }

  private bufferFor(size: number): any {
    if (!this.expanded) {
      if (!this.collapsedBuffer) this.collapsedBuffer = this.buildBuffer(MINIMAP_SIZE);
      return this.collapsedBuffer;
    }
    const pixels = Math.max(1, Math.round(size));
    if (!this.expandedBuffer || this.expandedBufferSize !== pixels) {
      this.expandedBuffer?.remove();
      this.expandedBuffer = this.buildBuffer(pixels);
      this.expandedBufferSize = pixels;
    }
    return this.expandedBuffer;
  }

  /** The one place besides `draw()` that may touch p5. */
  private buildBuffer(size: number): any {
    // `any`, as FogOfWar's overlay is: p5's Graphics type omits most of the
    // drawing surface it actually has.
    const graphics: any = createGraphics(size, size);
    // Pinned for the same reason FogOfWar pins its overlay: p5.Graphics
    // inherits the sketch's density, and a 3x buffer of a static layer is
    // nine times the memory for a picture nobody can see the resolution of.
    graphics.pixelDensity(1);
    graphics.clear();
    graphics.noStroke();
    graphics.fill(GROUND_COLOR[0], GROUND_COLOR[1], GROUND_COLOR[2], GROUND_COLOR[3]);
    graphics.rect(0, 0, size, size);

    const mapSize = this.host.mapSize();
    const scale = size / mapSize;
    graphics.fill(WALL_COLOR[0], WALL_COLOR[1], WALL_COLOR[2], WALL_COLOR[3]);
    for (const polygon of this.host.wallPolygons()) {
      graphics.beginShape();
      for (const vertex of polygon) graphics.vertex(vertex.x * scale, vertex.y * scale);
      graphics.endShape(graphics.CLOSE);
    }
    return graphics;
  }

  destroy(): void {
    this.collapsedBuffer?.remove();
    this.expandedBuffer?.remove();
    this.collapsedBuffer = null;
    this.expandedBuffer = null;
  }
}

export default Minimap;
