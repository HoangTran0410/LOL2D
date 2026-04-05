import PolyVisibility from '../../../../libs/poly-visibility';
import TerrainType from '../../enums/TerrainType';
import CollideUtils from '../../../utils/collide.utils';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { Circle } from '../../../../libs/quadtree';

export default class FogOfWar {
  game: any;
  overlay: any;
  outOfViewColor: string;
  colorStops: { stop: number; color: string }[];

  constructor(game: any) {
    this.game = game;
    this.overlay = createGraphics(windowWidth, windowHeight);
    this.outOfViewColor = '#0007';

    this.colorStops = [
      { stop: 0, color: '#fff' },
      { stop: 1, color: '#0000' },
    ];
  }

  draw(): void {
    this.overlay.clear();
    this.overlay.background(this.outOfViewColor);

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

    // reset willDraw for all AttackableUnit
    this.game.objectManager.objects.forEach((o: any) => {
      if (o instanceof AttackableUnit) o.willDraw = false;
    });
    // enable willDraw for all visible players
    visiblePlayers.forEach((p: any) => (p.willDraw = true));

    return allSightPoly;
  }

  calculateSightForObject(obj: any): { sightPoly: { x: number; y: number }[]; playersInSight: any[] } {
    let obstaclesInSight = this.game.terrainMap.getObstaclesInChampionSight(obj, [
      TerrainType.WALL,
      TerrainType.BUSH,
    ]);

    // remove bushes that player is inside => player can see through that bush
    obstaclesInSight = obstaclesInSight.filter(
      (o: any) =>
        !CollideUtils.pointPolygon(obj.position.x, obj.position.y, o.vertices)
    );

    const sightPoly = this.calculateVisibility({
      polygons: obstaclesInSight.map((o: any) => o.vertices),
      sourceOfLight: [obj.position.x, obj.position.y],
      sightBound: {
        x: obj.position.x - obj.visionRadius,
        y: obj.position.y - obj.visionRadius,
        w: obj.visionRadius * 2,
        h: obj.visionRadius * 2,
      },
    });

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

  calculateVisibility({
    sourceOfLight,
    sightBound,
    polygons,
  }: {
    sourceOfLight: [number, number];
    sightBound: { x: number; y: number; w: number; h: number };
    polygons: { x: number; y: number }[][];
  }): { x: number; y: number }[] {
    const _polygons = polygons.map(p => p.map(v => [v.x, v.y]));
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
      this.prepareRadialGradient(object.position.x, object.position.y, object.visionRadius, 50);

      this.overlay.beginShape();
      sightPoly.forEach((v: { x: number; y: number }) => {
        const pos = this.game.camera.worldToScreen(v.x, v.y);
        this.overlay.vertex(pos.x, pos.y);
      });
      this.overlay.endShape(this.overlay.CLOSE);
    });
  }

  drawCircleSight(_x: number, _y: number, _r: number): void {
    const { x, y, r } = this.prepareRadialGradient(_x, _y, _r, 100);
    this.overlay.circle(x, y, r * 2);
  }

  prepareRadialGradient(x: number, y: number, r: number, rRing: number): { x: number; y: number; r: number } {
    const pos = this.game.camera.worldToScreen(x, y);
    const radius = r * this.game.camera.scale;
    const innerR = max(0, radius - rRing * this.game.camera.scale);
    const ColorUtils = (window as any).ColorUtils;
    ColorUtils.createRadialGradient(this.overlay, pos.x, pos.y, innerR, radius, this.colorStops);

    return { x: pos.x, y: pos.y, r: radius };
  }

  resize(w: number, h: number): void {
    this.overlay.resizeCanvas(w, h, true);
  }

  destroy(): void {
    this.overlay.remove();
  }
}
