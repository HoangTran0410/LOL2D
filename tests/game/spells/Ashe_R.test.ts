import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetManager from '../../../src/managers/AssetManager';
import Ashe_R, {
  Ashe_R_Object,
  DAMAGE,
  EXPLODE_RADIUS,
  RANGE,
  SIZE,
  SPEED,
  STUN_DURATION_MS,
} from '../../../src/game/gameObject/spells/Ashe_R';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class Vector {
  constructor(public x = 0, public y = 0) {}
  copy(): Vector { return new Vector(this.x, this.y); }
  add(v: Vector): Vector { this.x += v.x; this.y += v.y; return this; }
  mult(s: number): Vector { this.x *= s; this.y *= s; return this; }
  magSq(): number { return this.x * this.x + this.y * this.y; }
  mag(): number { return Math.sqrt(this.magSq()); }
  normalize(): Vector {
    const len = this.mag();
    if (len !== 0) this.mult(1 / len);
    return this;
  }
  heading(): number { return Math.atan2(this.y, this.x); }
  dist(other: Vector): number { return Math.hypot(this.x - other.x, this.y - other.y); }
  static sub(a: Vector, b: Vector): Vector { return new Vector(a.x - b.x, a.y - b.y); }
  // Deterministic stand-in for p5's random heading: only exercised by the
  // zero-vector fallback, so a fixed non-zero direction is enough to prove
  // the arrow picked *something* rather than stalling at (0, 0).
  static random2D(): Vector { return new Vector(1, 0); }
}

const context = (x: number, y: number): CastContext => Object.freeze({
  spellId: 'ashe-r', activationId: `${x}:${y}`, startedAtMs: 0, caster: {},
  origin: Object.freeze({ x: 0, y: 0 }), cursorWorld: Object.freeze({ x, y }),
  direction: Object.freeze({ x, y }),
});

const owner = () => {
  const objects: unknown[] = [];
  return {
    position: new Vector(0, 0), teamId: 'blue', isDead: false, canCast: true,
    stats: { mana: { value: 100 }, health: { value: 100 } },
    game: {
      eventManager: { emit: vi.fn() },
      objectManager: {
        addObject: (object: unknown) => objects.push(object),
        queryObjects: vi.fn(() => []),
      },
    },
    addBuff: vi.fn(),
    objects,
  };
};

const findArrow = (caster: ReturnType<typeof owner>): Ashe_R_Object =>
  caster.objects.find((o): o is Ashe_R_Object => o instanceof Ashe_R_Object)!;

describe('Ashe R', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y));
    vi.stubGlobal('p5', { Vector });
    vi.stubGlobal('deltaTime', 16);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('aims the arrow at the cast cursor', () => {
    const caster = owner();
    const spell = new Ashe_R(caster);

    spell.press(context(100, 0));

    const arrow = findArrow(caster);
    expect(arrow).toBeInstanceOf(Ashe_R_Object);
    expect(arrow.direction).toMatchObject({ x: 1, y: 0 });
    expect(arrow.position).toMatchObject({ x: 0, y: 0 });
  });

  it('still fires when the cursor sits exactly on the caster instead of stalling', () => {
    // Regression for the reported bug: an idle AI's destination equals its own
    // position, and a player who has not moved the mouse can land here too.
    // p5.Vector.normalize() leaves a zero vector unchanged, so without a
    // fallback the arrow spawned with direction (0, 0) and never left the cast
    // point.
    const caster = owner();
    const spell = new Ashe_R(caster);

    spell.press(context(0, 0));

    const arrow = findArrow(caster);
    expect(arrow.direction.magSq()).toBeCloseTo(1, 5);
  });

  it('advances every frame instead of sitting on the spawn point', () => {
    const caster = owner();
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    const arrow = findArrow(caster);
    const start = arrow.position.copy();

    arrow.update();

    expect(arrow.position.dist(start)).toBeCloseTo(SPEED, 5);
    expect(arrow.toRemove).toBe(false);
  });

  it('expires at its tuned range instead of crossing the whole 6400px map', () => {
    const caster = owner();
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    const arrow = findArrow(caster);

    const framesToRange = RANGE / SPEED;
    for (let i = 0; i < framesToRange - 1; i++) {
      arrow.update();
      expect(arrow.toRemove).toBe(false);
    }
    arrow.update();

    expect(arrow.toRemove).toBe(true);
    expect(arrow.exploding).toBe(false);
    expect(arrow.position.dist(new Vector(0, 0))).toBeCloseTo(RANGE, 5);
  });

  it('stuns and damages on the first enemy it touches, using the stun icon rather than its own ability art', () => {
    const caster = owner();
    const enemyBuffs: Array<{ image: unknown; buffAddType?: unknown; activateBuff?: () => void }> = [];
    const enemy = {
      addBuff: (buff: { image: unknown; activateBuff?: () => void }) => {
        enemyBuffs.push(buff);
        buff.activateBuff?.();
      },
      takeDamage: vi.fn(),
    };
    caster.game.objectManager.queryObjects = vi.fn(() => [enemy]);
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    const arrow = findArrow(caster);

    arrow.update();

    expect(arrow.exploding).toBe(true);
    expect(arrow.visionRadius).toBe(EXPLODE_RADIUS);
    expect(enemy.takeDamage).toHaveBeenCalledWith(DAMAGE, caster);
    expect(enemyBuffs).toHaveLength(1);
    // Base Stun already defaults to the CC icon; Ashe R must not overwrite it
    // with its own ability art (spell_ashe_r).
    expect(enemyBuffs[0].image).toBe(AssetManager.get('buff_stun'));
  });

  it('stuns for the tuned duration', () => {
    const caster = owner();
    const enemyBuffs: Array<{ duration: number }> = [];
    const enemy = {
      addBuff: (buff: { duration: number; activateBuff?: () => void }) => {
        enemyBuffs.push(buff);
        buff.activateBuff?.();
      },
      takeDamage: vi.fn(),
    };
    caster.game.objectManager.queryObjects = vi.fn(() => [enemy]);
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    findArrow(caster).update();

    expect(enemyBuffs[0].duration).toBe(STUN_DURATION_MS);
  });
});
