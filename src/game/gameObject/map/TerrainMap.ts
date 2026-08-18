import SAT from '@/libs/SAT';
import { Circle, Quadtree, Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import CollideUtils from '@/utils/collide.utils';
import { hasFlag } from '@/utils/index';
import ActionState from '@/game/enums/ActionState';
import TerrainType from '@/game/enums/TerrainType';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import { PredefinedParticleSystems } from '@/game/gameObject/helpers/ParticleSystem';
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
    const terrains: any = AssetManager.get('json_summoner_map').data;
    // summoner_map.json also carries `turret1`/`turret2`, which are flat [x, y]
    // points rather than polygons. Feeding those through arrayToVertices built 22
    // obstacles with NaN bounds and pushed them into the terrain quadtree; only
    // real terrain layers belong here. Game.ts reads the turret points directly.
    const terrainTypes: string[] = [TerrainType.WALL, TerrainType.BUSH, TerrainType.WATER];
    for (const terrainType of terrainTypes) {
      if (!terrains?.[terrainType]) continue;
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

  /**
   * The wall layer as world-space polygons, for the navigation grid to
   * rasterize. Obstacles are built at the origin with their vertices already in
   * world coordinates, so this is a view of the same objects the wall push-out
   * uses rather than a second parse of the map file — the two can never drift.
   */
  wallPolygons(): { x: number; y: number }[][] {
    const polygons: { x: number; y: number }[][] = [];
    for (const obstacle of this.obstacles) {
      if (obstacle.type !== TerrainType.WALL) continue;
      polygons.push(
        obstacle.vertices.map(vertex => ({
          x: obstacle.position.x + vertex.x,
          y: obstacle.position.y + vertex.y,
        }))
      );
    }
    return polygons;
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
      this.pushOutOfWalls(p);
    }

    // Lane minions get the wall pass too, but nothing else in the champion loop:
    // no bush stealth, no water ripples, no vision. Their waypoints already keep
    // them ~70px clear of every wall, so this only matters when one steps off the
    // lane to reach something it aggroed — without it, that minion embeds itself
    // in a wall and never comes out.
    const minions = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [PredefinedFilters.type(Minion), PredefinedFilters.excludeDead],
    });
    for (const m of minions) this.pushOutOfWalls(m);
  }

  /**
   * Moves `unit` out of any wall it overlaps, by the averaged SAT overlap of
   * every wall it is inside. Shared by champions and minions.
   */
  pushOutOfWalls(unit: AttackableUnit): void {
    if (hasFlag(unit.stats.actionState, ActionState.IS_GHOSTED)) return;

    const nearbyWalls = this.getObstaclesInArea(unit.getCollideBoundingBox(), [TerrainType.WALL]);
    if (nearbyWalls.length === 0) return;

    let collided = false;
    const totalOverlap = createVector(0, 0);
    const overlapsWalls: Obstacle[] = [];
    // hoisted out of the wall loop: one circle per unit, one reused Response
    const pSAT = new SAT.Circle(
      new SAT.Vector(unit.position.x, unit.position.y),
      // `terrainRadius`, not the drawn body: it is capped for a grown unit so a
      // giant keeps fitting through the map's gaps, and it must be the same
      // radius `PathAgent` planned the route with — a route planned at one
      // radius and enforced at a larger one is a unit walking into a wall it
      // was told it could pass. See NAV_MAX_TERRAIN_RADIUS.
      unit.terrainRadius
    );
    const response = new SAT.Response();
    for (const wall of nearbyWalls) {
      response.clear();
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
      unit.position.add(totalOverlap);
      unit.onCollideWall?.();
    }
  }

  /**
   * Reused across frames: the three buckets below are rebuilt every frame at
   * 60fps and their contents never outlive the call.
   */
  private _waters: Obstacle[] = [];
  private _walls: Obstacle[] = [];
  private _bushes: Obstacle[] = [];

  draw(): void {
    push();
    const obstacles = this.getObstaclesInView();

    // One pass into three reused buckets, rather than three `filter` calls
    // walking the whole list and allocating a fresh array each. Order within a
    // bucket is the order they came out of the quadtree, exactly as before.
    const waters = this._waters;
    const walls = this._walls;
    const bushes = this._bushes;
    waters.length = 0;
    walls.length = 0;
    bushes.length = 0;
    for (const o of obstacles) {
      if (o.type === TerrainType.WATER) waters.push(o);
      else if (o.type === TerrainType.WALL) walls.push(o);
      else if (o.type === TerrainType.BUSH) bushes.push(o);
    }

    // The paint order — water, ripples, bushes, walls — is what it always was;
    // only the style setting moved out of the loop. Each group keeps its own
    // push/pop so `rippleEffect.draw()` still runs in the environment it used
    // to, rather than inheriting whatever colour the water left behind.
    this.drawObstacleGroup(waters, TerrainType.WATER);
    this.rippleEffect.draw();

    this.drawObstacleGroup(bushes, TerrainType.BUSH);
    this.drawObstacleGroup(walls, TerrainType.WALL);
    pop();
  }

  private drawObstacleGroup(group: Obstacle[], type: string): void {
    if (group.length === 0) return;
    push();
    Obstacle.applyStyle(type);
    for (const o of group) o.drawShape();
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
