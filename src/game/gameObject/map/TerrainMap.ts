import SAT from '../../../../libs/SAT';
import { Circle, Quadtree, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import CollideUtils from '../../../utils/collide.utils';
import { hasFlag } from '../../../utils/index';
import ActionState from '../../enums/ActionState';
import TerrainType from '../../enums/TerrainType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Champion from '../attackableUnits/Champion';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import Obstacle from './Obstacle';

export default class TerrainMap {
  game: any;
  size: number;
  obstacles: Obstacle[];
  rippleEffect: any;
  quadtree: Quadtree;

  constructor(game: any, mapSize?: number) {
    this.game = game;
    this.size = mapSize || 6400;
    this.obstacles = [];

    this.rippleEffect = PredefinedParticleSystems.ripple();

    this.quadtree = new Quadtree({
      x: 0,
      y: 0,
      w: this.size,
      h: this.size,
      maxObjects: 10,
      maxLevels: 6,
    });

    const polygons: { vertices: number[][]; type: string }[] = [];
    const terrains: any = AssetManager.getAsset('json_summoner_map')?.data;
    for (const terrainType in terrains) {
      polygons.push(
        ...terrains[terrainType].map((_: number[][]) => ({
          vertices: _,
          type: terrainType,
        }))
      );
    }

    for (const { vertices, type } of polygons) {
      const o = new Obstacle(0, 0, Obstacle.arrayToVertices(vertices), type);
      this.obstacles.push(o);
      this.quadtree.insert(o.getBoundingBox());
    }
  }

  update(): void {
    this.rippleEffect.update();

    const players = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [PredefinedFilters.type(Champion)],
    });

    for (const p of players) {
      const obstacles = this.getObstaclesCollideChampion(p, [
        TerrainType.WALL,
        TerrainType.BUSH,
        TerrainType.WATER,
      ]);

      // Collide with bushes
      const bushes = obstacles.filter((o: Obstacle) => o.type === TerrainType.BUSH);
      let isInsideBush = false;
      for (const b of bushes) {
        const collided = CollideUtils.pointPolygon(p.position.x, p.position.y, b.vertices);
        if (collided) {
          isInsideBush = true;
          break;
        }
      }
      p.isInsideBush = isInsideBush;

      // Collide with waters => add ripple effect
      if (!p.isDead && frameCount % 45 === 0 && p.position.dist(p.destination) > 0) {
        const waters = obstacles.filter((o: Obstacle) => o.type === TerrainType.WATER);
        let isInsideWater = false;
        for (const w of waters) {
          const collided = CollideUtils.pointPolygon(p.position.x, p.position.y, w.vertices);
          if (collided) {
            isInsideWater = true;
            break;
          }
        }
        if (isInsideWater) {
          const vel = p.destination.copy().sub(p.position).setMag(0.9);
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

      const nearbyWalls = this.getObstaclesInArea(p.getCollideBoundingBox(), [TerrainType.WALL]);

      let collided = false;
      const totalOverlap = createVector(0, 0);
      const overlapsWalls: Obstacle[] = [];
      for (const wall of nearbyWalls) {
        const response: any = new SAT.Response();
        const pSAT = new SAT.Circle(
          new SAT.Vector(p.position.x, p.position.y),
          p.stats.size.value / 2
        );
        const _collided = SAT.testPolygonCircle(wall.toSATPolygon(), pSAT, response);
        if (_collided) {
          const overlap = createVector(response.overlapV.x, response.overlapV.y);
          totalOverlap.add(overlap);
          overlapsWalls.push(wall);
          collided = true;
        }
      }

      if (collided) {
        totalOverlap.div(overlapsWalls.length);
        p.position.add(totalOverlap);
        p.onCollideWall?.();
      }
    }
  }

  draw(): void {
    push();
    const obstacles = this.getObstaclesInView();

    const waters = obstacles.filter((o: Obstacle) => o.type === TerrainType.WATER);
    const walls = obstacles.filter((o: Obstacle) => o.type === TerrainType.WALL);
    const bushes = obstacles.filter((o: Obstacle) => o.type === TerrainType.BUSH);

    for (const w of waters) w.draw();
    this.rippleEffect.draw();

    for (const b of bushes) b.draw();
    for (const w of walls) w.draw();
    pop();
  }

  drawEdges(): void {
    push();
    stroke('white');
    strokeWeight(3);
    line(0, 0, this.size, 0);
    line(this.size, 0, this.size, this.size);
    line(this.size, this.size, 0, this.size);
    line(0, this.size, 0, 0);
    pop();
  }

  getObstaclesInArea(area: Rectangle | Circle, terrainTypes: string[] = []): Obstacle[] {
    return this.quadtree
      .retrieve(area)
      .map((o: Rectangle) => o.data)
      .filter((o: Obstacle) => !terrainTypes.length || terrainTypes.includes(o.type));
  }

  getObstaclesInView(terrainTypes?: string[]): Obstacle[] {
    const area = this.game.camera.getBoundingBox();
    return this.getObstaclesInArea(area, terrainTypes ?? []);
  }

  getObstaclesCollideChampion(champion: Champion, terrainTypes: string[]): Obstacle[] {
    const area = champion.getCollideBoundingBox();
    return this.getObstaclesInArea(area, terrainTypes);
  }

  getObstaclesInChampionSight(champion: any, terrainTypes?: string[]): Obstacle[] {
    const area = new Circle({
      x: champion.position.x,
      y: champion.position.y,
      r: champion.animatedValues?.visionRadius || champion.visionRadius,
    });
    return this.getObstaclesInArea(area, terrainTypes ?? []);
  }
}
