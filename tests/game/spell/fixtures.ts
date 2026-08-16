import { vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import EventManager from '../../../src/managers/EventManager';
import type { GameObjectRuntimeContext } from '../../../src/game/gameObject/GameObject';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import type Spell from '../../../src/game/gameObject/Spell';

export class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  add(value: TestVector) { this.x += value.x; this.y += value.y; return this; }
  sub(value: TestVector) { this.x -= value.x; this.y -= value.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  magSq() { return this.x * this.x + this.y * this.y; }
  setMag(value: number) {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector) { return Math.hypot(this.x - value.x, this.y - value.y); }
  heading() { return Math.atan2(this.y, this.x); }
  normalize() { return this.setMag(1); }
  lerp(target: TestVector, amount: number) {
    this.x += (target.x - this.x) * amount;
    this.y += (target.y - this.y) * amount;
    return this;
  }
  static add(a: TestVector, b: TestVector) { return a.copy().add(b); }
  static sub(a: TestVector, b: TestVector) { return new TestVector(a.x - b.x, a.y - b.y); }
  static dist(a: TestVector, b: TestVector) { return a.dist(b); }
  static fromAngle(angle: number, length = 1) {
    return new TestVector(Math.cos(angle) * length, Math.sin(angle) * length);
  }
  static random2D() { return new TestVector(1, 0); }
}

export interface TestGame extends GameObjectRuntimeContext {
  setPlayer(player: AttackableUnit): void;
}

export function installSpellObjectGlobals(): void {
  vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
  vi.stubGlobal('p5', { Vector: TestVector });
  vi.stubGlobal('deltaTime', 16);
}

/**
 * The p5 sketch globals a spell object touches while it is being driven — the
 * maths helpers and constants, not the drawing calls. Layer it on top of
 * `installSpellObjectGlobals` when a test runs real spell code rather than a
 * hand-built stub.
 */
export function installSketchMathGlobals(): void {
  vi.stubGlobal('random', (low?: number, high?: number) => {
    if (low === undefined) return 0.5;
    if (high === undefined) return low / 2;
    return (low + high) / 2;
  });
  vi.stubGlobal('lerp', (start: number, stop: number, amount: number) =>
    start + (stop - start) * amount
  );
  vi.stubGlobal('constrain', (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), high)
  );
  vi.stubGlobal('map', (value: number, a: number, b: number, c: number, d: number) =>
    c + ((value - a) / (b - a)) * (d - c)
  );
  vi.stubGlobal('sin', Math.sin);
  vi.stubGlobal('cos', Math.cos);
  vi.stubGlobal('PI', Math.PI);
  vi.stubGlobal('TWO_PI', Math.PI * 2);
  vi.stubGlobal('HALF_PI', Math.PI / 2);
  vi.stubGlobal('frameCount', 0);
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

/**
 * The same spell, with a cast time the test chooses.
 *
 * Several abilities ship with `CAST_TIME_MS = 0` — an instant press is a
 * deliberate feel choice, and retuning it must not mean editing a test. But
 * the runtime rules that only exist *while a cast is in flight* — a UNIT
 * target going invalid mid-cast, a resource committed at release rather than
 * at start — have no window to happen in at zero, so a test that drives them
 * through the shipped number stops covering anything the day someone zeroes
 * it. That is exactly what happened: four suites went red the moment five
 * spells were made instant, and none of them was actually asserting anything
 * about Malphite or Veigar. The rule under test belongs to the runtime.
 *
 *   const spell = new (withCastTime(Malphite_Q, 250))(owner);
 */
export function withCastTime<T extends Spell>(
  SpellClass: new (owner: AttackableUnit) => T,
  castTimeMs: number
): new (owner: AttackableUnit) => T {
  const Base = SpellClass as unknown as new (owner: AttackableUnit) => Spell;
  return class extends Base {
    get castSpec() {
      return { ...super.castSpec, castTimeMs };
    }
  } as unknown as new (owner: AttackableUnit) => T;
}
