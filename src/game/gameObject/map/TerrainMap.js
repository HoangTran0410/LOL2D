import { Quadtree, Rectangle } from '../../../../libs/quadtree.js';
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

      const rectangle = new Rectangle({ ...o.getBoundingBox(), data: o });
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
      let area = new Rectangle({
        x: p.position.x,
        y: p.position.y,
        width: p.stats.size.value / 2,
        height: p.stats.size.value / 2,
      });
      let obstacles = this.quadtree.retrieve(area).map(o => o.data);

      let walls = obstacles.filter(o => o.type === TerrainType.WALL);
      let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);

      // Collide with bushes
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
      if (hasFlag(p.status, StatusFlags.Ghosted)) continue;

      let collided = false,
        overlaps = [];
      for (let o of walls) {
        let response = new SAT.Response();
        let collided = SAT.testPolygonCircle(o.toSATPolygon(), p.toSATCircle(), response);
        if (collided) {
          let overlap = createVector(response.overlapV.x, response.overlapV.y);
          overlaps.push({ obstacle: o, overlap });
          collided = true;
        }
      }

      // if overlapped with multiple walls, merge the walls and recalculate the overlap
      // this.collideCheckObstacles = [];
      // if (overlaps.length > 1) {
      //   let polyContainer = PolygonUtils.getPolygonsContainer(
      //     overlaps.map(_ => _.obstacle.vertices)
      //   );
      //   this.collideCheckObstacles = polyContainer;

      //   let SATPoly = new SAT.Polygon(
      //     new SAT.Vector(0, 0),
      //     polyContainer.map(v => new SAT.Vector(v.x, v.y))
      //   );
      //   let response = new SAT.Response();
      //   let collided = SAT.testPolygonCircle(SATPoly, p.toSATCircle(), response);
      //   if (collided) {
      //     console.log('collided');
      //     let overlap = createVector(response.overlapV.x, response.overlapV.y);
      //     overlaps = [{ overlap }];
      //   }
      // }

      if (overlaps.length) {
        let overlap = overlaps.map(_ => _.overlap).reduce((a, b) => a.add(b), createVector(0, 0));
        overlap.div(overlaps.length);
        p.position.add(overlap);
      }

      if (p != this.player && collided) {
        p.moveToRandomLocation();
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
    let obstacles = this.quadtree
      .retrieve(new Rectangle(this.game.camera.getViewBounds()))
      .map(o => o.data);

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
}
