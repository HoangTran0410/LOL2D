import CollideUtils from '@/utils/collide.utils';
import TerrainType from '@/game/enums/TerrainType';
import { Rectangle } from '@/libs/quadtree';
import type { Circle } from '@/libs/quadtree';
import type GameObject from '@/game/gameObject/GameObject';

/**
 * Terrain a spell put there.
 *
 * A spell-made ice wall and a spell-made rock wall do not decorate the map — they *are* map, for as long
 * as they last: both shove every unit out of themselves each frame, the same
 * job `TerrainMap.pushOutOfWalls` does for the polygons in
 * `summoner_map.json`. What they were not was *askable*. `TerrainMap` knows
 * only about the parsed map, so every ability that reasons about walls — the
 * ones that hook onto them, stop at them, bounce off them — saw a map with
 * holes in it exactly where another player had just built something.
 *
 * That is the shape of the reported bug: a grapple-hook ability flew straight
 * through an ice wall, and it flew through a spell-made rock wall too. Neither is a
 * bug in the grapple ability; both are the same missing question, and a
 * knockback ultimate's clamp had it
 * as well.
 *
 * So a slab declares `blocksMovement` and `wallVertices()`, and
 * `wallOutlinesInArea` answers "what walls are here" for both kinds at once.
 * A `tests/game/map/DynamicTerrain.test.ts` source scan keeps spells off the
 * half-answer.
 *
 * Deliberately *not* folded into `TerrainMap.getObstaclesInArea`. Two of its
 * consumers must keep seeing only the map: `FogOfWar`, because an ice wall is
 * explicitly not a vision blocker, and `NavigationSystem`, whose grid is
 * rasterized once at match start and is not a per-frame structure.
 */

/** What a spell-made slab has to answer to count as terrain. */
export interface DynamicWall {
  position: { x: number; y: number };

  /**
   * Whether it is terrain *right now*. A delayed-eruption slab is underground until
   * `eruptDelay` and stops blocking the instant a recast collapses it; a hook
   * that caught either would be catching on something not on screen.
   */
  readonly blocksMovement: boolean;

  /** Its outline, in world coordinates. */
  wallVertices(): { x: number; y: number }[];
}

/**
 * The four world-space corners of a slab: a rectangle `length` by `thickness`,
 * centred on `position` and turned by `angle`.
 *
 * Both wall objects build an identical SAT polygon for their own push-out. This
 * is the same rectangle in plain coordinates, so the outline a grapple tests
 * against cannot drift from the shape that does the pushing.
 */
export function slabVertices(
  position: { x: number; y: number },
  angle: number,
  length: number,
  thickness: number
): { x: number; y: number }[] {
  const halfLength = length / 2;
  const halfThickness = thickness / 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const corners: [number, number][] = [
    [-halfLength, -halfThickness],
    [halfLength, -halfThickness],
    [halfLength, halfThickness],
    [-halfLength, halfThickness],
  ];
  return corners.map(([x, y]) => ({
    x: position.x + x * cosA - y * sinA,
    y: position.y + x * sinA + y * cosA,
  }));
}

/** An object that declares itself terrain, whatever else it is. */
export function isDynamicWall(object: unknown): object is GameObject & DynamicWall {
  const candidate = object as Partial<DynamicWall> | null | undefined;
  return typeof candidate?.wallVertices === 'function' && 'blocksMovement' in (candidate as object);
}

export interface TerrainHost {
  objectManager: {
    queryObjects(options: {
      area?: Rectangle | Circle;
      filters?: ((object: any) => boolean)[];
      queryByDisplayBoundingBox?: boolean;
    }): GameObject[];
  };
  terrainMap?: {
    getObstaclesInArea?(
      area: Rectangle | Circle,
      terrainTypes?: string[]
    ): {
      position?: { x: number; y: number };
      vertices: readonly { x: number; y: number }[];
    }[];
  };
}

/**
 * Every wall outline overlapping `area` — the map's own, plus the ones spells
 * are currently holding up. This is the query a terrain-reading ability wants;
 * going to `terrainMap` directly sees half the walls on the map.
 *
 * Queried by display bounding box on purpose: a slab's *collide* box is derived
 * from `SpellObject.size`, which for a 260px ice wall is not the wall.
 */
export function wallOutlinesInArea(
  game: TerrainHost,
  area: Rectangle | Circle
): { x: number; y: number }[][] {
  const outlines: { x: number; y: number }[][] = [];

  for (const obstacle of game.terrainMap?.getObstaclesInArea?.(area, [TerrainType.WALL]) ?? []) {
    // Map obstacles are built at the origin with world-space vertices, so the
    // offset is zero in practice — it is applied anyway because
    // `TerrainMap.wallPolygons` applies it, and the two must not disagree about
    // what a wall's outline is. Optional so a caller can hand over a bare
    // `{ vertices }` the way the rest of the codebase reads obstacles.
    const ox = obstacle.position?.x ?? 0;
    const oy = obstacle.position?.y ?? 0;
    outlines.push(obstacle.vertices.map(vertex => ({ x: ox + vertex.x, y: oy + vertex.y })));
  }

  const dynamic = game.objectManager.queryObjects({
    area,
    queryByDisplayBoundingBox: true,
    filters: [isDynamicWall],
  }) as unknown as DynamicWall[];
  for (const wall of dynamic) {
    if (!wall.blocksMovement) continue;
    outlines.push(wall.wallVertices());
  }

  return outlines;
}

/** Whether `(x, y)` is inside a wall of either kind. `area` narrows the search. */
export function pointInWall(
  game: TerrainHost,
  x: number,
  y: number,
  area?: Rectangle | Circle
): boolean {
  const search = area ?? pointSearchArea(x, y);
  for (const outline of wallOutlinesInArea(game, search)) {
    if (CollideUtils.pointPolygon(x, y, outline)) return true;
  }
  return false;
}

/**
 * A small box around a point, for callers that have no area of their own. Wide
 * enough to catch any slab whose *outline* reaches the point while its centre —
 * which is what the quadtree indexes — sits well away from it.
 */
function pointSearchArea(x: number, y: number): Rectangle {
  const RADIUS = 40;
  return new Rectangle({ x: x - RADIUS, y: y - RADIUS, w: RADIUS * 2, h: RADIUS * 2 });
}
