import { vi } from 'vitest';
import { Rectangle } from '../../src/libs/quadtree';
import ObjectManager from '../../src/game/managers/ObjectManager';
import EventManager from '../../src/managers/EventManager';
import NavGrid from '../../src/game/nav/NavGrid';
import TerrainField from '../../src/game/gameObject/map/TerrainField';
import TerrainType from '../../src/game/enums/TerrainType';
import type AttackableUnit from '../../src/game/gameObject/attackableUnits/AttackableUnit';
import type GameObject from '../../src/game/gameObject/GameObject';
import type { GameObjectRuntimeContext } from '../../src/game/gameObject/GameObject';

/** The subset of p5.Vector the unit classes actually reach for. */
export class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy() {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  add(vector: TestVector) {
    this.x += vector.x;
    this.y += vector.y;
    return this;
  }
  mult(value: number) {
    this.x *= value;
    this.y *= value;
    return this;
  }
  div(value: number) {
    this.x /= value;
    this.y /= value;
    return this;
  }
  normalize() {
    return this.setMag(1);
  }
  magSq() {
    return this.x * this.x + this.y * this.y;
  }
  mag() {
    return Math.hypot(this.x, this.y);
  }
  setMag(value: number) {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > 0) this.mult(value / magnitude);
    return this;
  }
  /** p5's: shorten to `max` if longer, leave a shorter vector alone. In place. */
  limit(max: number) {
    if (this.magSq() > max * max) this.setMag(max);
    return this;
  }
  dist(vector: TestVector) {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
  heading() {
    return Math.atan2(this.y, this.x);
  }
  /** In place, like p5's — `Obstacle.getBoundingBox` rotates and then reads x/y. */
  rotate(angle: number) {
    const { x, y } = this;
    this.x = x * Math.cos(angle) - y * Math.sin(angle);
    this.y = x * Math.sin(angle) + y * Math.cos(angle);
    return this;
  }
  static add(a: TestVector, b: TestVector) {
    return new TestVector(a.x + b.x, a.y + b.y);
  }
  static sub(a: TestVector, b: TestVector) {
    return new TestVector(a.x - b.x, a.y - b.y);
  }
  static dist(a: TestVector, b: TestVector) {
    return a.dist(b);
  }
}

export type TestGame = GameObjectRuntimeContext & { setPlayer(player: AttackableUnit): void };

export function createGame(mapSize = 6_400): TestGame {
  const camera = { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: mapSize, h: mapSize }) };
  const objectManager = new ObjectManager({ mapSize, camera });
  let player: AttackableUnit | undefined;

  return {
    mapSize,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) throw new Error('Player is not available in this test context.');
      return player;
    },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
    setPlayer(value: AttackableUnit) {
      player = value;
    },
  };
}

/**
 * Gives `game` a terrain map with real walls at `polygons`, in world
 * coordinates.
 *
 * A stub that only answered `getObstaclesInArea` used to be enough, because
 * every spell read the polygons directly. They read `TerrainField` now — a
 * signed distance field baked from the wall layer, so that a wall chopped into
 * convex pieces stops having seams anything can fall between — and a field has
 * to be built rather than faked. `getObstaclesInArea` is still answered for the
 * parts of the game that legitimately want polygons: the draw pass, the fog and
 * the bush/water tests.
 *
 * Two ways this is not the real `TerrainMap`, both fine for what tests ask of
 * it and both worth knowing before writing an assertion against them:
 *
 * - **The grid only covers [0, mapSize].** A polygon reaching outside is clipped
 *   to it, so a wall drawn across the axis is only half there. Keep what a test
 *   asserts inside the box.
 * - **`getObstaclesInArea` ignores its `area`** and hands back every polygon.
 *   Wider than the real one, never narrower, which is the safe direction for a
 *   caller that filters afterwards. The `type` is real, so a `TerrainType`
 *   filter works — without it the layer reads as empty to anything that filters,
 *   which is a way to write a test that passes for the wrong reason.
 */
export function withWalls(
  game: GameObjectRuntimeContext,
  polygons: { x: number; y: number }[][],
  mapSize = 1_024
): void {
  const grid = NavGrid.fromPolygons(polygons, { size: mapSize });
  const host = game as unknown as { terrainMap: unknown };
  host.terrainMap = {
    field: new TerrainField(game as never, grid),
    wallPolygons: () => polygons,
    getObstaclesInArea: (_area: unknown, terrainTypes: string[] = []) =>
      terrainTypes.length > 0 && !terrainTypes.includes(TerrainType.WALL)
        ? []
        : polygons.map(vertices => ({
            position: { x: 0, y: 0 },
            vertices,
            type: TerrainType.WALL,
          })),
  };
}

/** Puts objects in the world and rebuilds the quadtree, so queryObjects sees them. */
export function indexObjects(game: GameObjectRuntimeContext, objects: GameObject[]): void {
  game.objectManager.objects = objects;
  game.objectManager._objectsTree.clear();
  for (const object of objects) {
    game.objectManager._objectsTree.insert(object.getDisplayBoundingBox());
  }
}

/**
 * p5 lives on the global object in this project, so every unit method reaches
 * for a bare `fill`/`circle`/`lerp`. Stub the whole surface the unit classes
 * touch; the draw ones are spies so a test can assert what was painted.
 */
export function stubGameGlobals(): Record<string, ReturnType<typeof vi.fn>> {
  vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
  vi.stubGlobal('p5', { Vector: TestVector });
  vi.stubGlobal('deltaTime', 16);
  vi.stubGlobal('random', (min = 1, max?: number) =>
    max === undefined ? Math.random() * min : min + Math.random() * (max - min)
  );
  vi.stubGlobal('lerp', (from: number, to: number, amount: number) => from + (to - from) * amount);
  vi.stubGlobal('constrain', (n: number, low: number, high: number) =>
    Math.min(high, Math.max(low, n))
  );
  vi.stubGlobal('max', Math.max);
  vi.stubGlobal('min', Math.min);
  vi.stubGlobal('cos', Math.cos);
  vi.stubGlobal('sin', Math.sin);
  vi.stubGlobal('TWO_PI', Math.PI * 2);
  // A stand-in canvas size for screen-space HUD drawing (e.g. the FPS
  // overlay), which positions itself off the right/top edge rather than a
  // world coordinate.
  vi.stubGlobal('width', 1280);
  vi.stubGlobal('height', 800);

  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    'push',
    'pop',
    'translate',
    'rotate',
    'fill',
    'stroke',
    'noFill',
    'noStroke',
    'strokeWeight',
    'rect',
    'line',
    'circle',
    'ellipse',
    'arc',
    'image',
    'tint',
    'text',
    'textSize',
    'textAlign',
    'beginShape',
    'vertex',
    'endShape',
  ]) {
    spies[name] = vi.fn();
    vi.stubGlobal(name, spies[name]);
  }
  for (const name of ['CENTER', 'CLOSE', 'RIGHT', 'LEFT', 'BOTTOM', 'BASELINE', 'TOP']) {
    vi.stubGlobal(name, name);
  }
  return spies;
}
