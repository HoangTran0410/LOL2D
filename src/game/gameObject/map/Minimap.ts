/**
 * The minimap: a fog-respecting map of the whole world, drawn on the canvas in
 * screen space beside the touch controls.
 *
 * **A tap on the expanded map teleports the player there.** That makes this a
 * practice tool, not a neutral HUD element — say so plainly, because a reader
 * who assumes "minimap" means "the LoL minimap" will expect a move order. A
 * move order from the minimap is a different gesture on the same surface and
 * can be added later without redesigning anything here.
 *
 * Geometry and hit-testing live at module level, free of p5 globals, so they
 * run in a plain node test with no canvas — the shape `TouchControls` already
 * uses. Only `draw()` and the buffer builder may touch p5.
 */
import { removeGraphics } from '@/utils/graphics.utils';

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
  /** Everything worth a dot this frame, fog already applied. See `MinimapBlip`. */
  blips(): readonly MinimapBlip[];
  /** Where the player is, always drawn — you can always see yourself. */
  playerPosition(): Point;
  /** `Camera.getBoundingBox()`: the one element that answers "where am I looking". */
  cameraBox(): { x: number; y: number; w: number; h: number };
}

/** What a press on the screen means to the minimap. See `Minimap.route`. */
export type MinimapAction = 'expand' | 'collapse' | 'teleport' | 'pass';

/** What a dot is, which decides its shape and size — never its world size. */
export type BlipKind = 'champion' | 'unit' | 'structure';

/**
 * One dot. The host resolves the colour because the host is the one that knows
 * the game's team palette (`teamBodyColor` in `Minion.ts`); the minimap only
 * knows where to put it.
 */
export interface MinimapBlip {
  x: number;
  y: number;
  kind: BlipKind;
  color: readonly number[];
}

/** Ground under the walls, and the walls themselves. */
const GROUND_COLOR = [16, 20, 28, 242] as const;
const WALL_COLOR = [72, 82, 100, 255] as const;
const BORDER_COLOR = [190, 205, 230, 200] as const;
/** The player, in a colour no team can be. */
export const PLAYER_COLOR = [255, 236, 140] as const;
const CAMERA_BOX_COLOR = [235, 240, 250, 190] as const;

/**
 * Dot diameters in minimap pixels at the collapsed size, by kind.
 *
 * Deliberately not derived from `stats.size`: a dot is an icon, not a scale
 * model, and a 165-unit fully-stacked champion must not become a blob covering four other
 * units. The expanded map multiplies these by its rect ratio only so the same
 * icons stay the same *apparent* size — that ratio is a property of the rect,
 * never of the unit.
 */
const BLIP_DIAMETER: Record<BlipKind | 'player', number> = {
  player: 7,
  champion: 6,
  unit: 3.5,
  structure: 5,
};
/** Past this the expanded map's icons would be blobs of their own. */
const BLIP_SCALE_MAX = 2.2;

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

  /**
   * What a press at this screen point means, given the current state. The whole
   * decision, and it needs no canvas — which is what lets the ordering that
   * `Game.syncTouches` depends on be checked in a plain node test.
   *
   * `'collapse'` deliberately does *not* claim the press: a tap outside the
   * expanded map dismisses it **and** still reaches the controls underneath,
   * so an accidental expand costs nothing. `'pass'` is "not mine at all".
   */
  route(point: Point): MinimapAction {
    if (!this.expanded) return hitTest(point, this.rect) ? 'expand' : 'pass';
    return hitTest(point, this.rect) ? 'teleport' : 'collapse';
  }

  /**
   * The world point a press lands on. Read *before* collapsing: the rect is
   * what the transform is parameterised by, and collapsing changes it.
   */
  worldAt(point: Point): Point {
    return minimapToWorld(point, this.rect, this.host.mapSize());
  }

  resize(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    // The expanded buffer is sized off the viewport, so it is now the wrong
    // pixel size. Dropped rather than resized: rebuilding is one trace of a
    // static layer, and it happens on the next frame that needs it.
    removeGraphics(this.expandedBuffer);
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
    this.drawLiveLayer(bounds);
    noFill();
    stroke(BORDER_COLOR[0], BORDER_COLOR[1], BORDER_COLOR[2], BORDER_COLOR[3]);
    strokeWeight(2);
    rect(bounds.x, bounds.y, bounds.size, bounds.size);
    pop();
  }

  /** Everything that moves: the camera's view, the dots, and the player. */
  private drawLiveLayer(bounds: MinimapRect): void {
    const mapSize = this.host.mapSize();
    const dotScale = Math.min(BLIP_SCALE_MAX, bounds.size / MINIMAP_SIZE);

    // The view rectangle first, so no dot is hidden under its outline.
    const box = this.host.cameraBox();
    const topLeft = worldToMinimap({ x: box.x, y: box.y }, bounds, mapSize);
    const span = { w: (box.w / mapSize) * bounds.size, h: (box.h / mapSize) * bounds.size };
    noFill();
    stroke(CAMERA_BOX_COLOR[0], CAMERA_BOX_COLOR[1], CAMERA_BOX_COLOR[2], CAMERA_BOX_COLOR[3]);
    strokeWeight(1);
    rect(topLeft.x, topLeft.y, span.w, span.h);

    noStroke();
    for (const blip of this.host.blips()) {
      const at = worldToMinimap(blip, bounds, mapSize);
      const diameter = BLIP_DIAMETER[blip.kind] * dotScale;
      fill(blip.color[0], blip.color[1], blip.color[2]);
      if (blip.kind === 'structure') {
        rect(at.x - diameter / 2, at.y - diameter / 2, diameter, diameter);
      } else {
        circle(at.x, at.y, diameter);
      }
    }

    // Last, and outlined: the player is the one dot that must never be lost
    // under another, and is drawn whatever the fog says.
    const player = worldToMinimap(this.host.playerPosition(), bounds, mapSize);
    const playerDiameter = BLIP_DIAMETER.player * dotScale;
    stroke(20, 24, 32, 220);
    strokeWeight(1.5);
    fill(PLAYER_COLOR[0], PLAYER_COLOR[1], PLAYER_COLOR[2]);
    circle(player.x, player.y, playerDiameter);
  }

  private bufferFor(size: number): any {
    if (!this.expanded) {
      if (!this.collapsedBuffer) this.collapsedBuffer = this.buildBuffer(MINIMAP_SIZE);
      return this.collapsedBuffer;
    }
    const pixels = Math.max(1, Math.round(size));
    if (!this.expandedBuffer || this.expandedBufferSize !== pixels) {
      removeGraphics(this.expandedBuffer);
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
    removeGraphics(this.collapsedBuffer);
    removeGraphics(this.expandedBuffer);
    this.collapsedBuffer = null;
    this.expandedBuffer = null;
  }
}

export default Minimap;
