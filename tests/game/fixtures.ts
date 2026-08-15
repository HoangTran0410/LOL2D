import { vi } from 'vitest';
import { Rectangle } from '../../src/libs/quadtree';
import ObjectManager from '../../src/game/managers/ObjectManager';
import EventManager from '../../src/managers/EventManager';
import type AttackableUnit from '../../src/game/gameObject/attackableUnits/AttackableUnit';
import type GameObject from '../../src/game/gameObject/GameObject';
import type { GameObjectRuntimeContext } from '../../src/game/gameObject/GameObject';

/** The subset of p5.Vector the unit classes actually reach for. */
export class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  add(vector: TestVector) { this.x += vector.x; this.y += vector.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  div(value: number) { this.x /= value; this.y /= value; return this; }
  normalize() { return this.setMag(1); }
  magSq() { return this.x * this.x + this.y * this.y; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(value: number) {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > 0) this.mult(value / magnitude);
    return this;
  }
  dist(vector: TestVector) { return Math.hypot(this.x - vector.x, this.y - vector.y); }
  static add(a: TestVector, b: TestVector) { return new TestVector(a.x + b.x, a.y + b.y); }
  static sub(a: TestVector, b: TestVector) { return new TestVector(a.x - b.x, a.y - b.y); }
  static dist(a: TestVector, b: TestVector) { return a.dist(b); }
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
    setPlayer(value: AttackableUnit) { player = value; },
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
  vi.stubGlobal('constrain', (n: number, low: number, high: number) => Math.min(high, Math.max(low, n)));
  vi.stubGlobal('max', Math.max);
  vi.stubGlobal('min', Math.min);
  vi.stubGlobal('cos', Math.cos);
  vi.stubGlobal('sin', Math.sin);
  vi.stubGlobal('TWO_PI', Math.PI * 2);

  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    'push', 'pop', 'translate', 'rotate', 'fill', 'stroke', 'noFill', 'noStroke',
    'strokeWeight', 'rect', 'line', 'circle', 'ellipse', 'arc', 'image', 'tint',
    'text', 'textSize', 'textAlign', 'beginShape', 'vertex', 'endShape',
  ]) {
    spies[name] = vi.fn();
    vi.stubGlobal(name, spies[name]);
  }
  for (const name of ['CENTER', 'CLOSE', 'RIGHT', 'LEFT', 'BOTTOM', 'BASELINE']) {
    vi.stubGlobal(name, name);
  }
  return spies;
}
