import TerrainType from '../../enums/TerrainType.js';
import ColorUtils from '../../../utils/color.utils.js';
import CollideUtils from '../../../utils/collide.utils.js';
import PolyVisibility from '../../../../libs/poly-visibility.js';
import AttackableUnit from '../attackableUnits/AttackableUnit.js';
import Champion from '../attackableUnits/Champion.js';

export default class FogOfWar {
  constructor(game) {
    this.game = game;

    this.overlay = createGraphics(windowWidth, windowHeight);
    this.outOfViewColor = '#0007';

    this.colorStops = [
      { stop: 0, color: '#fff' },
      { stop: 1, color: '#0000' },
    ];
  }

  draw() {
    // clear overlay with overlay color
    this.overlay.clear();
    this.overlay.background(this.outOfViewColor);

    // start erase overlay color in sight-area
    this.overlay.erase();
    this.overlay.noStroke();
    this.drawVisions();
    this.overlay.noErase();

    // show overlay
    image(this.overlay, width / 2, height / 2, width, height);
  }

  calculateSight() {
    // get objects of player team
    let allyObjects = this.game
      .queryObjects({
        teamId: this.game.player.teamId,
      })
      .filter(o => {
        if (o === this.game.player) return true;
        if (o instanceof AttackableUnit) return !o.isDead;
        if (o.visionRadius > 0) {
          // check in camera view
          let { x, y, w, h } = this.game.camera.getViewBounds();
          let { x: ox, y: oy } = o.position;
          return CollideUtils.circleRect(ox, oy, o.visionRadius, x, y, w, h);
        }
        return false;
      });

    let allSightPoly = [],
      visiblePlayers = [];

    allyObjects.forEach(obj => {
      let { sightPoly, playersInSight } = this.calculateSightForObject(obj);
      visiblePlayers.push(obj);
      visiblePlayers.push(...playersInSight);
      allSightPoly.push({
        object: obj,
        sightPoly,
      });
    });

    // reset willDraw for all AttackableUnit
    this.game.objectManager.objects.forEach(o => {
      if (o instanceof AttackableUnit) o.willDraw = false;
    });
    // enable willDraw for all visible players
    visiblePlayers.forEach(p => (p.willDraw = true));

    return allSightPoly;
  }

  calculateSightForObject(obj) {
    // get obstacles in sight
    let obstaclesInSight = this.game.terrainMap.getObstaclesInChampionSight(obj, [
      TerrainType.WALL,
      TerrainType.BUSH,
    ]);

    // remove bushes that player is inside => player can see through that bushes
    obstaclesInSight = obstaclesInSight.filter(
      o =>
        !(
          // o.type === TerrainType.BUSH &&
          CollideUtils.pointPolygon(obj.position.x, obj.position.y, o.vertices)
        )
    );

    // calculate visibility
    let sightPoly = this.calculateVisibility({
      polygons: obstaclesInSight.map(o => o.vertices),
      sourceOfLight: [obj.position.x, obj.position.y],
      sightBound: {
        x: obj.position.x - obj.visionRadius,
        y: obj.position.y - obj.visionRadius,
        w: obj.visionRadius * 2,
        h: obj.visionRadius * 2,
      },
    });

    // calculate visible players
    let playersInSight = this.game.queryPlayersInRange({
      position: obj.position,
      range: obj.visionRadius,
      includePlayerSize: true,
      includeDead: true,
      customFilter: p => {
        return CollideUtils.pointPolygonConcave(p.position.x, p.position.y, sightPoly);
      },
    });

    return {
      sightPoly,
      playersInSight,
    };
  }

  calculateVisibility({ sourceOfLight, sightBound, polygons }) {
    let _polygons = polygons.map(p => p.map(v => [v.x, v.y]));
    let segments = PolyVisibility.convertToSegments(_polygons);
    segments = PolyVisibility.breakIntersections(segments);
    return PolyVisibility.computeViewport(
      sourceOfLight,
      segments,
      [sightBound.x, sightBound.y],
      [sightBound.x + sightBound.w, sightBound.y + sightBound.h]
    ).map(v => ({ x: v[0], y: v[1] }));
  }

  drawVisions() {
    let allSightPoly = this.calculateSight();

    allSightPoly.forEach(({ object, sightPoly }) => {
      this.prepareRadialGradient(object.position.x, object.position.y, object.visionRadius, 50);

      this.overlay.beginShape();
      sightPoly.forEach(v => {
        let pos = this.game.camera.worldToScreen(v.x, v.y);
        this.overlay.vertex(pos.x, pos.y);
      });
      this.overlay.endShape(CLOSE);
    });
  }

  drawCircleSight(_x, _y, _r) {
    const { x, y, r } = this.prepareRadialGradient(_x, _y, _r, 100);
    this.overlay.circle(x, y, r * 2);
  }

  prepareRadialGradient(x, y, r, rRing) {
    let pos = this.game.camera.worldToScreen(x, y);
    let radius = r * this.game.camera.scale;
    let innerR = max(0, radius - rRing * this.game.camera.scale);
    ColorUtils.createRadialGradient(this.overlay, pos.x, pos.y, innerR, radius, this.colorStops);

    // return to reuse
    return { x: pos.x, y: pos.y, r: radius };
  }

  resize(w, h) {
    this.overlay.resizeCanvas(w, h, true);
  }
}
