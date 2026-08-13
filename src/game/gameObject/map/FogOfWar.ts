import PolyVisibility from '../../../libs/poly-visibility';
import TerrainType from '../../enums/TerrainType';
import CollideUtils from '../../../utils/collide.utils';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { Circle } from '../../../libs/quadtree';

// Recompute a unit's sight polygon at most this often — vision doesn't need
// frame-accurate geometry, and this is what makes the throttle below actually
// cut work instead of just deferring it by one frame.
const SIGHT_RECOMPUTE_INTERVAL_MS = 100;
// Below this many world units of movement, the obstacle set in range and the
// resulting polygon are effectively unchanged (see TerrainMap.getObstaclesInChampionSight).
const SIGHT_POSITION_EPSILON = 4;

interface SightCacheEntry {
  sightPoly: { x: number; y: number }[];
  x: number;
  y: number;
  visionRadius: number;
  nextRecomputeAt: number;
}

export default class FogOfWar {
  game: any;
  overlay: any;
  outOfViewColor: string;
  colorStops: { stop: number; color: string }[];

  // Keyed by the unit object itself (position is mutated in place, never
  // reassigned, so identity is a stable cache key). A WeakMap means dead units
  // that get dereferenced elsewhere (removed from ObjectManager.objects) fall
  // out of this cache for free once GC'd — nothing here can leak.
  sightCache: WeakMap<any, SightCacheEntry>;
  // CanvasGradient objects are reused across units/frames by bucketing on the
  // (innerR, radius) pair that defines their stops; screen position is applied
  // separately via context translate (see prepareRadialGradient).
  gradientCache: Map<string, CanvasGradient>;

  constructor(game: any) {
    this.game = game;
    this.overlay = createGraphics(windowWidth, windowHeight);
    this.outOfViewColor = '#0007';

    this.colorStops = [
      { stop: 0, color: '#fff' },
      { stop: 1, color: '#0000' },
    ];

    this.sightCache = new WeakMap();
    this.gradientCache = new Map();
  }

  draw(): void {
    // clear() (clearRect) followed by background() (a normal-blend fillRect)
    // is two full-canvas passes to reach the same result as one: painting with
    // 'copy' compositing discards the destination outright, same as clearing
    // to transparent first — but in a single fillRect.
    const ctx = this.overlay.drawingContext;
    ctx.save();
    this.overlay.resetMatrix();
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = this.outOfViewColor;
    ctx.fillRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.restore();

    this.overlay.erase();
    this.overlay.noStroke();
    this.drawVisions();
    this.overlay.noErase();

    image(this.overlay, width / 2, height / 2, width, height);
  }

  calculateSight(): { object: any; sightPoly: { x: number; y: number }[] }[] {
    const { x, y, w, h } = this.game.camera.getBoundingBox();
    const allyObjects = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.teamId(this.game.player.teamId),
        (o: any) => {
          if (o === this.game.player) return true;
          if (PredefinedFilters.includeDead(o)) return false;
          if (o.visionRadius > 0) {
            const { x: ox, y: oy } = o.position;
            return CollideUtils.circleRect(ox, oy, o.visionRadius, x, y, w, h);
          }
          return false;
        },
      ],
    });

    const allSightPoly: { object: any; sightPoly: { x: number; y: number }[] }[] = [];
    const visiblePlayers: any[] = [];

    allyObjects.forEach((obj: any) => {
      const { sightPoly, playersInSight } = this.calculateSightForObject(obj);
      visiblePlayers.push(...playersInSight);
      allSightPoly.push({
        object: obj,
        sightPoly,
      });
    });

    // reset willDraw for all AttackableUnit (structures opt out — once built they
    // stay on the map, and the update loop is not in lockstep with draw, so
    // re-enabling them from their own update() would flicker)
    this.game.objectManager.objects.forEach((o: any) => {
      if (o instanceof AttackableUnit && !o.alwaysVisible) o.willDraw = false;
    });
    // enable willDraw for all visible players
    visiblePlayers.forEach((p: any) => (p.willDraw = true));

    return allSightPoly;
  }

  calculateSightForObject(obj: any): { sightPoly: { x: number; y: number }[]; playersInSight: any[] } {
    // The segment/viewport math is the expensive part (see computeSightPoly);
    // reuse it across frames whenever the unit hasn't moved enough to matter.
    // playersInSight stays a full per-frame query — it's a cheap quadtree
    // lookup and gates visibility (willDraw), so it must stay frame-accurate
    // even while the polygon itself is stale by up to SIGHT_RECOMPUTE_INTERVAL_MS.
    const sightPoly = this.getSightPoly(obj);

    const playersInSight = this.game.objectManager.queryObjects({
      area: new Circle({
        x: obj.position.x,
        y: obj.position.y,
        r: obj.visionRadius,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        (o: any) => CollideUtils.pointPolygonConcave(o.position.x, o.position.y, sightPoly),
      ],
    });

    if (keyIsDown(13)) console.log(playersInSight);

    return {
      sightPoly,
      playersInSight,
    };
  }

  // Returns the cached sight polygon for `obj`, recomputing it only when the
  // throttle window has elapsed AND its position/vision radius actually
  // changed beyond epsilon. The window start is jittered per-unit on first
  // sight so many units created in the same frame don't all fall due together.
  getSightPoly(obj: any): { x: number; y: number }[] {
    const now = performance.now();
    const entry = this.sightCache.get(obj);

    if (!entry) {
      const sightPoly = this.computeSightPoly(obj);
      this.sightCache.set(obj, {
        sightPoly,
        x: obj.position.x,
        y: obj.position.y,
        visionRadius: obj.visionRadius,
        nextRecomputeAt: now + random(SIGHT_RECOMPUTE_INTERVAL_MS),
      });
      return sightPoly;
    }

    if (now >= entry.nextRecomputeAt) {
      entry.nextRecomputeAt = now + SIGHT_RECOMPUTE_INTERVAL_MS;

      const dx = obj.position.x - entry.x;
      const dy = obj.position.y - entry.y;
      const moved = dx * dx + dy * dy > SIGHT_POSITION_EPSILON * SIGHT_POSITION_EPSILON;
      const radiusChanged = obj.visionRadius !== entry.visionRadius;

      if (moved || radiusChanged) {
        entry.sightPoly = this.computeSightPoly(obj);
        entry.x = obj.position.x;
        entry.y = obj.position.y;
        entry.visionRadius = obj.visionRadius;
      }
    }

    return entry.sightPoly;
  }

  // The actual visibility-polygon computation: obstacle lookup + segment
  // breaking + viewport sweep. This is what getSightPoly caches.
  computeSightPoly(obj: any): { x: number; y: number }[] {
    let obstaclesInSight = this.game.terrainMap.getObstaclesInChampionSight(obj, [
      TerrainType.WALL,
      TerrainType.BUSH,
    ]);

    // remove bushes that player is inside => player can see through that bush
    obstaclesInSight = obstaclesInSight.filter(
      (o: any) =>
        !CollideUtils.pointPolygon(obj.position.x, obj.position.y, o.vertices)
    );

    return this.calculateVisibility({
      polygons: obstaclesInSight.map((o: any) => o.vertices),
      sourceOfLight: [obj.position.x, obj.position.y],
      sightBound: {
        x: obj.position.x - obj.visionRadius,
        y: obj.position.y - obj.visionRadius,
        w: obj.visionRadius * 2,
        h: obj.visionRadius * 2,
      },
    });
  }

  calculateVisibility({
    sourceOfLight,
    sightBound,
    polygons,
  }: {
    sourceOfLight: [number, number];
    sightBound: { x: number; y: number; w: number; h: number };
    polygons: { x: number; y: number }[][];
  }): { x: number; y: number }[] {
    const _polygons = polygons.map(p => p.map(v => [v.x, v.y] as [number, number]));
    let segments = PolyVisibility.convertToSegments(_polygons);
    segments = PolyVisibility.breakIntersections(segments);
    return PolyVisibility.computeViewport(
      sourceOfLight,
      segments,
      [sightBound.x, sightBound.y],
      [sightBound.x + sightBound.w, sightBound.y + sightBound.h]
    ).map((v: number[]) => ({ x: v[0], y: v[1] }));
  }

  drawVisions(): void {
    const allSightPoly = this.calculateSight();

    allSightPoly.forEach(({ object, sightPoly }: { object: any; sightPoly: { x: number; y: number }[] }) => {
      const { x, y, gradient } = this.prepareRadialGradient(object.position.x, object.position.y, object.visionRadius, 50);

      // The gradient is defined around the origin (see prepareRadialGradient) so it
      // can be shared across units/frames; translate the canvas to the unit's screen
      // position and draw the polygon relative to that origin to line the two up.
      // Canvas gradients paint using the CTM at fill time, not at creation time, so
      // this reproduces exactly what passing absolute coordinates would have drawn.
      this.overlay.push();
      this.overlay.translate(x, y);
      this.overlay.drawingContext.fillStyle = gradient;
      this.overlay.beginShape();
      sightPoly.forEach((v: { x: number; y: number }) => {
        const pos = this.game.camera.worldToScreen(v.x, v.y);
        this.overlay.vertex(pos.x - x, pos.y - y);
      });
      this.overlay.endShape(this.overlay.CLOSE);
      this.overlay.pop();
    });
  }

  drawCircleSight(_x: number, _y: number, _r: number): void {
    const { x, y, r, gradient } = this.prepareRadialGradient(_x, _y, _r, 100);

    this.overlay.push();
    this.overlay.translate(x, y);
    this.overlay.drawingContext.fillStyle = gradient;
    this.overlay.circle(0, 0, r * 2);
    this.overlay.pop();
  }

  prepareRadialGradient(
    x: number,
    y: number,
    r: number,
    rRing: number
  ): { x: number; y: number; r: number; gradient: CanvasGradient } {
    const pos = this.game.camera.worldToScreen(x, y);
    const radius = r * this.game.camera.scale;
    const innerR = max(0, radius - rRing * this.game.camera.scale);
    const gradient = this.getRadialGradient(innerR, radius);

    return { x: pos.x, y: pos.y, r: radius, gradient };
  }

  // createRadialGradient() is a relatively costly context call and was being made
  // once per visible ally per frame; a gradient only depends on its stop radii, so
  // bucket-cache by (innerR, radius) — rounded to the pixel, since sub-pixel radius
  // differences are visually meaningless — and reuse across units and frames.
  getRadialGradient(innerR: number, radius: number): CanvasGradient {
    const key = `${Math.round(innerR)}:${Math.round(radius)}`;
    let gradient = this.gradientCache.get(key);
    if (!gradient) {
      gradient = this.overlay.drawingContext.createRadialGradient(0, 0, innerR, 0, 0, radius);
      this.colorStops.forEach(cs => gradient!.addColorStop(cs.stop, cs.color));
      this.gradientCache.set(key, gradient!);
    }
    return gradient!;
  }

  resize(w: number, h: number): void {
    this.overlay.resizeCanvas(w, h, true);
  }

  destroy(): void {
    this.overlay.remove();
  }
}
