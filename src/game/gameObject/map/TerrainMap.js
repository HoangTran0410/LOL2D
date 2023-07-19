import SAT from '../../../../libs/SAT.js';
import { Circle, Quadtree, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import CollideUtils from '../../../utils/collide.utils.js';
import { hasFlag } from '../../../utils/index.js';
import ActionState from '../../enums/ActionState.js';
import StatusFlags from '../../enums/StatusFlags.js';
import TerrainType from '../../enums/TerrainType.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Champion from '../attackableUnits/Champion.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';
import Obstacle from './Obstacle.js';

export default class TerrainMap {
  constructor(game, mapSize) {
    this.game = game;

    this.size = mapSize || 6400;
    this.obstacles = [];

    this.rippleEffect = PredefinedParticleSystems.ripple();

    // init quadtree
    this.quadtree = new Quadtree({
      x: 0,
      y: 0,
      w: this.size,
      h: this.size,
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
      this.quadtree.insert(o.getBoundingBox());
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

    this.rippleEffect.update();

    // players collision with obstacles
    let players = this.game.objectManager.queryObjects({
      filters: [PredefinedFilters.type(Champion)],
    });
    for (let p of players) {
      let obstacles = this.getObstaclesCollideChampion(p, [
        TerrainType.WALL,
        TerrainType.BUSH,
        TerrainType.WATER,
      ]);

      // Collide with bushes
      let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);
      let isInsideBush = false;
      for (let b of bushes) {
        let collided = CollideUtils.pointPolygon(p.position.x, p.position.y, b.vertices);
        if (collided) {
          isInsideBush = true;
          break;
        }
      }
      p.isInsideBush = isInsideBush;

      // Collide with waters => add ripple effect
      if (!p.isDead && frameCount % 45 === 0 && p.position.dist(p.destination) > 0) {
        let waters = obstacles.filter(o => o.type === TerrainType.WATER);
        let isInsideWater = false;
        for (let w of waters) {
          let collided = CollideUtils.pointPolygon(p.position.x, p.position.y, w.vertices);
          if (collided) {
            isInsideWater = true;
            break;
          }
        }
        if (isInsideWater) {
          let vel = p.destination.copy().sub(p.position).setMag(0.9);
          this.rippleEffect.addParticle({
            x: p.position.x,
            y: p.position.y,
            vx: vel.x,
            vy: vel.y,
            r: random(5, 10),
            maxr: random(40, 80),
          });
        }
      }

      // Collide with walls
      if (hasFlag(p.stats.actionState, ActionState.IS_GHOSTED)) continue;
      let walls = obstacles.filter(o => o.type === TerrainType.WALL);

      let collided = false;
      let totalOverlap = createVector(0, 0);
      let overlapsWalls = [];
      for (let wall of walls) {
        let response = new SAT.Response();
        let pSAT = new SAT.Circle(
          new SAT.Vector(p.position.x, p.position.y),
          p.stats.size.value / 2
        );
        let _collided = SAT.testPolygonCircle(wall.toSATPolygon(), pSAT, response);
        if (_collided) {
          let overlap = createVector(response.overlapV.x, response.overlapV.y);
          totalOverlap.add(overlap); // Accumulate the overlap vectors
          overlapsWalls.push(wall);
          collided = true;
        }
      }

      if (collided) {
        // push away from the overlapped wall center (middle of all vertices)
        // if (overlapsWalls.length > 1) {
        //   let vertices = overlapsWalls.reduce((acc, curr) => [...acc, ...curr.vertices], []);
        //   let center = vertices
        //     .reduce((acc, curr) => acc.add(curr), createVector(0, 0))
        //     .div(vertices.length);
        //   let toMove = p.position
        //     .copy()
        //     .sub(center)
        //     .setMag(p.stats.size.value / 2);

        //   totalOverlap.add(toMove);
        // }
        totalOverlap.div(overlapsWalls.length); // Calculate the average overlap vector
        p.position.add(totalOverlap); // Apply the resolution vector to the circle's position

        p.onCollideWall?.();
      }
    }

    // collision map edges
    // for (let p of this.game.players) {
    //   let size = p.stats.size.value / 2;

    //   if (
    //     p.position.x < size ||
    //     p.position.x > this.size - size ||
    //     p.position.y < size ||
    //     p.position.y > this.size - size
    //   ) {
    //     p.position.x = constrain(p.position.x, size, this.size - size);
    //     p.position.y = constrain(p.position.y, size, this.size - size);

    //     p.onCollideMapEdge?.();
    //   }
    // }
  }

  draw() {
    push();
    let obstacles = this.getObstaclesInView();

    let waters = obstacles.filter(o => o.type === TerrainType.WATER);
    let walls = obstacles.filter(o => o.type === TerrainType.WALL);
    let bushes = obstacles.filter(o => o.type === TerrainType.BUSH);

    for (let w of waters) w.draw();
    this.rippleEffect.draw();

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
    let area = this.game.camera.getBoundingBox();
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
      r: champion.animatedValues?.visionRadius || champion.visionRadius,
    });
    return this.getObstaclesInArea(area, terrainTypes);
  }
}
