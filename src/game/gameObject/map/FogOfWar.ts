import PolyVisibility from '@/libs/poly-visibility';
import TerrainType from '@/game/enums/TerrainType';
import CollideUtils from '@/utils/collide.utils';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import { Circle } from '@/libs/quadtree';
import { removeGraphics } from '@/utils/graphics.utils';

// The fog polygon is recomputed at the unit's live position every frame — no
// throttle, no interpolation — so the gradient (drawn every frame at the
// unit's live screen position, see drawVisions/prepareRadialGradient) and the
// polygon never drift apart. That's affordable because computeSightPoly's
// cost splits cleanly in two:
//   1. which obstacles are in vision range, and the broken (non-intersecting)
//      segment list built from them — this is the O(n^2) part
//      (PolyVisibility.breakIntersections) — only changes when the unit
//      crosses into a new neighbourhood of walls/bushes, so it's cached per
//      unit (see SightCacheEntry.segments/obstacleSignature) and reused
//      across frames until that set turns over;
//   2. the radial sweep against the exact source point
//      (PolyVisibility.computeViewport) depends on the unit's live position
//      and must run every frame for the fog to track it smoothly — it's the
//      O(n) part, and it's what actually runs unconditionally below.
// A unit that hasn't moved at all since last frame (exact position/vision
// radius equality) skips both and returns last frame's polygon outright, so
// a standing unit still costs nothing.
type SightSegment = [number, number][];

interface SightCacheEntry {
  sightPoly: { x: number; y: number }[];
  x: number;
  y: number;
  visionRadius: number;
  // Broken segment list for the obstacles currently in range. Obstacle
  // vertices are static world coordinates, so this depends only on *which*
  // obstacles are selected, never on the unit's exact position — see
  // buildSegments/obstacleSignature.
  segments: SightSegment[];
  // Fingerprint of the obstacle set `segments` was built from: sorted
  // obstacle ids, after the "bush I'm standing in" filter. A bush
  // entering/leaving containment changes which ids survive that filter, so
  // it doesn't need its own field here — it already changes this string.
  obstacleSignature: string;
}

type SightResult = { object: any; sightPoly: { x: number; y: number }[] };

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
  lastSightCalculation?: {
    revision: number;
    cameraKey: string;
    result: SightResult[];
  };

  /**
   * Cheap circle revealers — allied minions and turrets — from the last sight
   * pass. Drawn as plain circles rather than wall-aware polygons so an ally
   * swarm costs a fill each, not a raycast each. Held on the instance so a
   * cached sight frame reuses the same circles the polys were paired with.
   */
  circleSights: { x: number; y: number; r: number }[] = [];

  constructor(game: any) {
    this.game = game;
    this.overlay = createGraphics(windowWidth, windowHeight);
    // Pinned, not inherited. The overlay is a full-viewport buffer that is
    // cleared and repainted every frame, so its backing store is the single
    // largest per-frame cost in the fog. p5.Graphics takes its density from the
    // sketch, and the sketch's own `pixelDensity(1)` is set in GameScene.enter
    // — one line away from here, in another file, and nothing fails loudly if
    // it moves. On a 3x phone an inherited density would be a 9x buffer: a
    // 900x400 viewport becomes 2700x1200, ten million pixels cleared and
    // composited per frame for a translucent black shape with soft edges that
    // nobody can see the resolution of.
    // 1 is also the floor, which is not obvious: going *below* screen
    // resolution is slower, not faster. A CPU profile charges 82% of every
    // drawImage in the game to the `image()` call at the end of draw(), so a
    // quarter-area buffer looks like an easy win — but it turns that blit from
    // a 1:1 copy into a scaled resample of every destination pixel, and a
    // 422x195 overlay measured 4.61ms per frame against 2.09ms at 844x390.
    // (Measured under software rasterisation; a GPU-composited canvas may
    // trade differently, so re-measure on a device before revisiting.)
    this.overlay.pixelDensity(1);
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

  calculateSight(): SightResult[] {
    const { x, y, w, h } = this.game.camera.getBoundingBox();
    const revision = this.game.objectManager.revision;
    const cameraKey = `${x}:${y}:${w}:${h}`;
    if (
      typeof revision === 'number' &&
      this.lastSightCalculation?.revision === revision &&
      this.lastSightCalculation.cameraKey === cameraKey
    ) {
      return this.lastSightCalculation.result;
    }

    // Deliberately NOT narrowed to the camera.
    //
    // What the team can see and what is worth painting are two questions, and
    // this pass answers both. The overlay only ever needs revealers near the
    // camera — there is no point erasing fog off screen — but this is also the
    // only writer of `visibleToPlayerTeam`, which `Game.minimapBlips` reads to
    // decide whether a unit gets a dot, and the minimap draws the whole map. So
    // the camera test used to delete allied minions, wards and champions from
    // the minimap the moment the player walked away from them, along with
    // everything they were lighting: the team held the vision and the map would
    // not show it. Turrets and fountains hid the bug, being structures that
    // `minimapBlips` draws without consulting the flag at all.
    //
    // The narrowing moved down to the two paint lists below, where it belongs.
    const allyObjects = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.teamId(this.game.player.teamId),
        (o: any) => {
          if (o === this.game.player) return true;
          if (PredefinedFilters.includeDead(o)) return false;
          // `fogRevealRadius`, not `visionRadius`: minions and turrets carry no
          // combat sight (visionRadius 0) but still light a circle for the team.
          return o.fogRevealRadius > 0;
        },
      ],
    });

    const allSightPoly: SightResult[] = [];
    const visiblePlayers: any[] = [];
    /** Every allied circle on the map — what `visibleToPlayerTeam` is computed from. */
    const revealCircles: { x: number; y: number; r: number }[] = [];
    /** The subset near the camera — what the overlay actually erases fog for. */
    const paintedCircles: { x: number; y: number; r: number }[] = [];
    const nearCamera = (ox: number, oy: number, r: number) =>
      CollideUtils.circleRect(ox, oy, r, x, y, w, h);

    allyObjects.forEach((obj: any) => {
      if (obj.visionRadius > 0) {
        // Player and allied champions: the real, wall-aware sight polygon. Run
        // for all of them rather than the on-camera ones — a team fields at most
        // a handful of champions, and an ally's sight has to keep revealing for
        // the minimap while the player is looking somewhere else.
        const { sightPoly, playersInSight } = this.calculateSightForObject(obj);
        visiblePlayers.push(...playersInSight);
        if (nearCamera(obj.position.x, obj.position.y, obj.fogRevealRadius)) {
          allSightPoly.push({ object: obj, sightPoly });
        }
      } else {
        // A minion or turret: one cheap circle, no raycast, no per-body query.
        // `revealer`, not `circle`: `circle` is a p5 global. See CLAUDE.md.
        const revealer = { x: obj.position.x, y: obj.position.y, r: obj.fogRevealRadius };
        revealCircles.push(revealer);
        if (nearCamera(revealer.x, revealer.y, revealer.r)) paintedCircles.push(revealer);
      }
    });
    this.circleSights = paintedCircles;

    // Reset the player's-eye visibility flag on every AttackableUnit, then
    // re-light the ones in sight. Structures opt out — once built they stay on
    // the map, and the update loop is not in lockstep with draw, so re-enabling
    // them from their own update() would flicker.
    //
    // This flag is the *only* thing the sight pass writes outside itself, and
    // it feeds rendering alone — see `AttackableUnit.visibleToPlayerTeam`. That
    // is what keeps the painting side of the fog separable from the game: what
    // a unit may target is `combat/Vision.ts`'s answer, per observer, never
    // this one.
    this.game.objectManager.objects.forEach((o: any) => {
      if (o instanceof AttackableUnit && !o.alwaysVisible) o.visibleToPlayerTeam = false;
    });
    visiblePlayers.forEach((p: any) => (p.visibleToPlayerTeam = true));

    // Circle revealers light any body standing in them — one distance test per
    // unit, no polygon test and no per-revealer query, so the ally swarm stays
    // cheap. Deliberately wall-blind: a minion's cheap circle is not the
    // player's exact sight, and folding walls back in would mean the raycast
    // this path exists to avoid.
    if (revealCircles.length) {
      this.game.objectManager.objects.forEach((o: any) => {
        if (!(o instanceof AttackableUnit) || o.visibleToPlayerTeam || o.alwaysVisible) return;
        const { x: ox, y: oy } = o.position;
        for (const c of revealCircles) {
          const dx = ox - c.x;
          const dy = oy - c.y;
          if (dx * dx + dy * dy <= c.r * c.r) {
            o.visibleToPlayerTeam = true;
            break;
          }
        }
      });
    }

    if (typeof revision === 'number') {
      this.lastSightCalculation = { revision, cameraKey, result: allSightPoly };
    }
    return allSightPoly;
  }

  calculateSightForObject(obj: any): {
    sightPoly: { x: number; y: number }[];
    playersInSight: any[];
  } {
    // getSightPoly recomputes the polygon at obj's live position every frame
    // (reusing the cached segment list whenever it can — see the file header
    // and computeSightPoly), so it's always frame-accurate. playersInSight is
    // a separate, cheap-enough-to-always-run quadtree lookup that gates
    // visibility (visibleToPlayerTeam); it was already frame-accurate and stays so.
    const sightPoly = this.getSightPoly(obj);

    // Decomposed once for the whole scan rather than inside the predicate: the
    // polygon is the same for every candidate, and `pointPolygonConcave` would
    // otherwise re-run the full convex decomposition per candidate, per
    // observer, per frame.
    const sightParts = CollideUtils.prepareConcave(sightPoly);

    const playersInSight = this.game.objectManager.queryObjects({
      area: new Circle({
        x: obj.position.x,
        y: obj.position.y,
        r: obj.visionRadius,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        (o: any) => CollideUtils.pointPreparedConcave(o.position.x, o.position.y, sightParts),
      ],
    });

    return {
      sightPoly,
      playersInSight,
    };
  }

  // Returns the sight polygon for `obj`, always at its current position. A
  // unit whose position and vision radius are bit-for-bit identical to last
  // frame's (i.e. it hasn't moved) casts the exact same polygon, so this
  // short-circuits straight to the cached result without even querying
  // obstacles. Anything else — the unit moved, its radius changed, or this is
  // the first time we've seen it — goes through computeSightPoly.
  getSightPoly(obj: any): { x: number; y: number }[] {
    const entry = this.sightCache.get(obj);

    if (
      entry &&
      obj.position.x === entry.x &&
      obj.position.y === entry.y &&
      obj.visionRadius === entry.visionRadius
    ) {
      return entry.sightPoly;
    }

    return this.computeSightPoly(obj, entry);
  }

  // The actual visibility-polygon computation, run every frame a unit moves.
  // The obstacle lookup and the "bush I'm standing in" filter are
  // position-dependent and cheap, so they always run; segment breaking (the
  // O(n^2) part) only reruns when the obstacle set they produce differs from
  // what `entry` was built from (see buildObstacleSignature); the viewport
  // sweep always runs against obj's live position/radius so the returned
  // polygon is frame-accurate.
  computeSightPoly(obj: any, entry?: SightCacheEntry): { x: number; y: number }[] {
    let obstaclesInSight = this.game.terrainMap.getObstaclesInChampionSight(obj, [
      TerrainType.WALL,
      TerrainType.BUSH,
    ]);

    // remove bushes that player is inside => player can see through that bush
    obstaclesInSight = obstaclesInSight.filter(
      (o: any) => !CollideUtils.pointPolygon(obj.position.x, obj.position.y, o.vertices)
    );

    const obstacleSignature = this.buildObstacleSignature(obstaclesInSight);
    const segments =
      entry && entry.obstacleSignature === obstacleSignature
        ? entry.segments
        : this.buildSegments(obstaclesInSight);

    const sightPoly = PolyVisibility.computeViewport(
      [obj.position.x, obj.position.y],
      segments,
      [obj.position.x - obj.visionRadius, obj.position.y - obj.visionRadius],
      [obj.position.x + obj.visionRadius, obj.position.y + obj.visionRadius]
    ).map((v: number[]) => ({ x: v[0], y: v[1] }));

    this.sightCache.set(obj, {
      sightPoly,
      x: obj.position.x,
      y: obj.position.y,
      visionRadius: obj.visionRadius,
      segments,
      obstacleSignature,
    });

    return sightPoly;
  }

  // Converts obstacle polygons into a broken (non-self-intersecting) segment
  // list — the O(n^2) step (PolyVisibility.breakIntersections) that
  // computeSightPoly caches by obstacleSignature instead of paying every frame.
  buildSegments(obstacles: { vertices: { x: number; y: number }[] }[]): SightSegment[] {
    const polygons = obstacles.map(o => o.vertices.map(v => [v.x, v.y] as [number, number]));
    const segments = PolyVisibility.convertToSegments(polygons);
    return PolyVisibility.breakIntersections(segments);
  }

  // Cheap fingerprint for "which obstacles are in range right now": sorted
  // obstacle ids. The radius is deliberately absent: the range query already
  // expresses a radius change by returning a different obstacle set, while the
  // same set always produces the same static segments. Obstacle
  // counts in range are small (a handful of walls/bushes at most), so
  // sorting/joining every frame is far cheaper than the segment break it
  // guards, and a plain string compare is enough to detect any change in the
  // obstacle set — new obstacle entering range, one leaving, or a bush
  // flipping in/out of the containment filter.
  buildObstacleSignature(obstacles: { id: string }[]): string {
    const ids = obstacles.map(o => o.id).sort();
    return ids.join(',');
  }

  drawVisions(): void {
    const allSightPoly = this.calculateSight();

    allSightPoly.forEach(
      ({ object, sightPoly }: { object: any; sightPoly: { x: number; y: number }[] }) => {
        const { x, y, gradient } = this.prepareRadialGradient(
          object.position.x,
          object.position.y,
          object.visionRadius,
          50
        );

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
      }
    );

    // Allied minions and turrets: cheap circle holes, drawn after the wall-aware
    // polygons so both stack into the same erased sight mask.
    this.circleSights.forEach(c => this.drawCircleSight(c.x, c.y, c.r));
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
    // `currentScale`, not `scale`: the latter is the target the camera is
    // lerping toward, so reading it makes the fog snap to a new zoom while the
    // world is still sliding into it.
    const radius = r * this.game.camera.currentScale;
    const innerR = max(0, radius - rRing * this.game.camera.currentScale);
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
    // Never `overlay.remove()` — p5 1.11's own Graphics.remove throws on a 2D
    // buffer, and this is the second line of Game.destroy(). See
    // `utils/graphics.utils.ts`.
    removeGraphics(this.overlay);
  }
}
