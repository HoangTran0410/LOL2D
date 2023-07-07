import TerrainType from '../../enums/TerrainType.js';
import ColorUtils from '../../../utils/color.utils.js';
import CollideUtils from '../../../utils/collide.utils.js';
import PolyVisibility from '../../../../libs/poly-visibility.js';

export default class FogOfWar {
  constructor(game) {
    this.game = game;

    this.overlay = createGraphics(windowWidth, windowHeight);
    this.outOfViewColor = '#0008';

    this.colorStops = [
      { stop: 0, color: '#fff' },
      { stop: 1, color: '#0001' },
    ];
  }

  draw() {
    // clear overlay with overlay color
    this.overlay.clear();
    this.overlay.background(this.outOfViewColor);

    // start erase overlay color in sight-area
    this.overlay.erase();
    this.overlay.noStroke();
    this.drawSights();
    this.overlay.noErase();

    // show overlay
    image(this.overlay, 0, 0, width, height);
  }

  calculateSight() {
    let { player, terrainMap } = this.game;

    // get obstacles in sight
    let obstaclesInSight = terrainMap.getObstaclesInView([TerrainType.WALL, TerrainType.BUSH]);

    // remove bushes that player is inside => player can see through that bushes
    obstaclesInSight = obstaclesInSight.filter(
      o =>
        !(
          // o.type === TerrainType.BUSH &&
          CollideUtils.pointPolygon(player.position.x, player.position.y, o.vertices)
        )
    );

    // calculate visibility
    let sightPoly = this.calculateVisibility({
      polygons: obstaclesInSight.map(o => o.vertices),
      sourceOfLight: [player.position.x, player.position.y],
      sightBound: {
        x: player.position.x - player.stats.sightRadius.value,
        y: player.position.y - player.stats.sightRadius.value,
        w: player.stats.sightRadius.value * 2,
        h: player.stats.sightRadius.value * 2,
      },
    });

    // calculate visible players
    let playersInSight = this.game.queryPlayersInRange({
      position: player.position,
      range: player.stats.sightRadius.value,
      includePlayerSize: true,
      includeDead: true,
      excludePlayers: [player],
      customFilter: p => {
        return CollideUtils.pointPolygonConcave(p.position.x, p.position.y, sightPoly);
      },
    });
    player.visiblePlayers = [player, ...playersInSight];

    return sightPoly;
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

  drawSights() {
    // default sight
    let { player, camera } = this.game;
    // this.drawCircleSight(player.position.x, player.position.y, player.stats.sightRadius.value);

    // ===================== visibility ========================
    this.prepareRadialGradient(
      player.position.x,
      player.position.y,
      player.stats.sightRadius.value,
      100
    );

    // draw visibility
    let sightPolygon = this.calculateSight();
    this.overlay.beginShape();
    sightPolygon.forEach(v => {
      let pos = camera.worldToScreen(v.x, v.y);
      this.overlay.vertex(pos.x, pos.y);
    });
    this.overlay.endShape(CLOSE);
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
