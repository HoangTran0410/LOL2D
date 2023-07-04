import { Circle, Quadtree, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import { hasFlag } from '../../../utils/index.js';
import StatusFlags from '../../enums/StatusFlags.js';
import TerrainType from '../../enums/TerrainType.js';
import Obstacle from './Obstacle.js';

export default class TerrainMap {
  constructor(game) {
    this.game = game;

    this.size = 6400;
    this.obstacles = [];

    // init quadtree
    this.quadtree = new Quadtree({
      x: 0,
      y: 0,
      width: this.size,
      height: this.size,
      maxObjects: 10, // optional, default: 10
      maxLevels: 6, // optional, default:  4
    });

    let polygons = [];
    const terrains = AssetManager.getAsset('json_summoner_map')?.data;
    for (let terrainType in terrains) {
      polygons.push(
        ...terrains[terrainType].map(_ => ({
          vertices: _,
          type: terrainType,
        }))
      );
    }

    for (let { vertices, type } of polygons) {
      let o = new Obstacle(0, 0, Obstacle.arrayToVertices(vertices), type);
      this.obstacles.push(o);

      const rectangle = new Rectangle({
        ...o.getBoundingBox(), // quadtree node
        data: o, // obstacle instance
      });
      this.quadtree.insert(rectangle);
    }
  }

  update() {
    // this.quadtree.clear();
    // for (let o of this.obstacles) {
    //   const rectangle = new Rectangle({
    //     ...o.getBoundingBox(),
    //     data: o,
    //   });
    //   this.quadtree.insert(rectangle);
    // }

    // players collision with obstacles
    for (let p of this.game.players) {
      let obstacles = this.getObstaclesCollideChampion(p, [TerrainType.WALL, TerrainType.BUSH]);

      // Collide with bushes
      let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);
      let isInBush = false;
      for (let b of bushes) {
        let response = new SAT.Response();
        let collided = SAT.testPolygonCircle(b.toSATPolygon(), p.toSATCircle(), response);
        if (collided) {
          isInBush = true;
          break;
        }
      }
      p.isInBush = isInBush;

      // Collide with walls
      let walls = obstacles.filter(o => o.type === TerrainType.WALL);
      if (hasFlag(p.status, StatusFlags.Ghosted)) continue;

      let collided = false;
      let overlaps = [];
      for (let o of walls) {
        let response = new SAT.Response();
        let _collided = SAT.testPolygonCircle(o.toSATPolygon(), p.toSATCircle(), response);
        if (_collided) {
          let overlap = createVector(response.overlapV.x, response.overlapV.y);
          overlaps.push({ obstacle: o, overlap });
          collided = true;
        }
      }

      if (overlaps.length) {
        let overlap = overlaps.map(_ => _.overlap).reduce((a, b) => a.add(b), createVector(0, 0));
        overlap.div(overlaps.length);
        p.position.add(overlap);
      }

      if (p != this.game.player && collided) {
        p.moveToRandomLocation?.();
      }
    }

    // collision map edges
    for (let p of this.game.players) {
      let size = p.stats.size.value / 2;
      if (p.position.x < size) p.position.x = size;
      if (p.position.x > this.size - size) p.position.x = this.size - size;
      if (p.position.y < size) p.position.y = size;
      if (p.position.y > this.size - size) p.position.y = this.size - size;

      if (p != this.game.player) {
        if (
          p.position.x < size ||
          p.position.x > this.size - size ||
          p.position.y < size ||
          p.position.y > this.size - size
        ) {
          p.moveToRandomLocation();
        }
      }
    }
  }

  draw() {
    push();
    let obstacles = this.getObstaclesInView();

    let waters = obstacles.filter(o => o.type === TerrainType.WATER);
    let walls = obstacles.filter(o => o.type === TerrainType.WALL);
    let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);

    for (let w of waters) w.draw();
    for (let b of bushes) b.draw();
    for (let w of walls) w.draw();
    pop();
  }

  drawEdges() {
    push();
    stroke('white');
    strokeWeight(3);
    line(0, 0, this.size, 0);
    line(this.size, 0, this.size, this.size);
    line(this.size, this.size, 0, this.size);
    line(0, this.size, 0, 0);
    pop();
  }

  getObstaclesInArea(area, terrainTypes = []) {
    return this.quadtree
      .retrieve(area)
      .map(o => o.data) // get obstacle data from quadtree node
      .filter(o => !terrainTypes.length || terrainTypes.includes(o.type));
  }

  getObstaclesInView(terrainTypes) {
    let area = new Rectangle(this.game.camera.getViewBounds());
    return this.getObstaclesInArea(area, terrainTypes);
  }

  getObstaclesCollideChampion(champion, terrainTypes) {
    let area = new Circle({
      x: champion.position.x,
      y: champion.position.y,
      r: champion.stats.size.value,
    });
    return this.getObstaclesInArea(area, terrainTypes);
  }

  getObstaclesInChampionSight(champion, terrainTypes) {
    let area = new Circle({
      x: champion.position.x,
      y: champion.position.y,
      r: champion.stats.sightRadius.value,
    });
    return this.getObstaclesInArea(area, terrainTypes);
  }
}
