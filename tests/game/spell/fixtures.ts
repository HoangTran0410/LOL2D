import { vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import EventManager from '../../../src/managers/EventManager';
import type { GameObjectRuntimeContext } from '../../../src/game/gameObject/GameObject';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import ObjectManager from '../../../src/game/managers/ObjectManager';

export class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  add(value: TestVector) { this.x += value.x; this.y += value.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(value: number) {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector) { return Math.hypot(this.x - value.x, this.y - value.y); }
  static add(a: TestVector, b: TestVector) { return a.copy().add(b); }
  static sub(a: TestVector, b: TestVector) { return new TestVector(a.x - b.x, a.y - b.y); }
  static dist(a: TestVector, b: TestVector) { return a.dist(b); }
}

export interface TestGame extends GameObjectRuntimeContext {
  setPlayer(player: AttackableUnit): void;
}

export function installSpellObjectGlobals(): void {
  vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
  vi.stubGlobal('p5', { Vector: TestVector });
  vi.stubGlobal('deltaTime', 16);
}

export function createGame(): TestGame {
  const camera = { getBoundingBox: () => new Rectangle({ x: -100, y: -100, w: 200, h: 200 }) };
  const objectManager = new ObjectManager({ mapSize: 1_000, camera });
  let player: AttackableUnit | undefined;
  return {
    mapSize: 1_000,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) throw new Error('Player is not available in this test context.');
      return player;
    },
    setPlayer(value) { player = value; },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
  };
}

export function createUnit(game: TestGame, x = 0, teamId = 'blue'): AttackableUnit {
  return new AttackableUnit({ game, position: createVector(x, 0), teamId });
}
