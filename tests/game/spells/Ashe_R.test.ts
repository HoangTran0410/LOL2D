import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetManager from '../../../src/managers/AssetManager';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { buildContentApi } from '../../../src/content/ContentApi';
import { DAMAGE, EXPLODE_RADIUS, FULL_POWER_DISTANCE, MAX_SPEED, MAX_STUN_MS, MAX_TRAVEL, MIN_STUN_MS, SIZE, SPEED } from '../../../packs/riot/spells/Ashe_R';
import makeAshe_R, { makeAshe_R_Object } from '../../../packs/riot/spells/Ashe_R';
const __api = buildContentApi();
const Ashe_R = makeAshe_R(__api);
const Ashe_R_Object = makeAshe_R_Object(__api);

class Vector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy(): Vector {
    return new Vector(this.x, this.y);
  }
  add(v: Vector): Vector {
    this.x += v.x;
    this.y += v.y;
    return this;
  }
  mult(s: number): Vector {
    this.x *= s;
    this.y *= s;
    return this;
  }
  magSq(): number {
    return this.x * this.x + this.y * this.y;
  }
  mag(): number {
    return Math.sqrt(this.magSq());
  }
  normalize(): Vector {
    const len = this.mag();
    if (len !== 0) this.mult(1 / len);
    return this;
  }
  heading(): number {
    return Math.atan2(this.y, this.x);
  }
  dist(other: Vector): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
  static sub(a: Vector, b: Vector): Vector {
    return new Vector(a.x - b.x, a.y - b.y);
  }
  // Deterministic stand-in for p5's random heading: only exercised by the
  // zero-vector fallback, so a fixed non-zero direction is enough to prove
  // the arrow picked *something* rather than stalling at (0, 0).
  static random2D(): Vector {
    return new Vector(1, 0);
  }
}

const context = (x: number, y: number): CastContext =>
  Object.freeze({
    spellId: 'ashe-r',
    activationId: `${x}:${y}`,
    startedAtMs: 0,
    caster: {},
    origin: Object.freeze({ x: 0, y: 0 }),
    cursorWorld: Object.freeze({ x, y }),
    direction: Object.freeze({ x, y }),
  });

const owner = () => {
  const objects: unknown[] = [];
  return {
    position: new Vector(0, 0),
    teamId: 'blue',
    isDead: false,
    canCast: true,
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

  /**
   * `docs/abilities/ashe/r.json` says range **Global**. This used to fizzle at
   * a tuned 2400px, which made the champion's signature shot a long poke
   * instead of the thing you fire from your own jungle at a fight across the
   * map. `MAX_TRAVEL` is not a range — it is a leash so an arrow into empty
   * map is eventually collected.
   */
  it('crosses the map instead of expiring at a tuned range', () => {
    const caster = owner();
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    const arrow = findArrow(caster);

    for (let i = 0; i < 400; i++) arrow.update();

    expect(arrow.toRemove).toBe(false);
    // Well past the 2400px the old version died at, and past the far side of
    // the 6400px map.
    expect(arrow.distanceTravelled).toBeGreaterThan(6_400);
  });

  it('speeds up the longer it is in the air, and is eventually collected', () => {
    const caster = owner();
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    const arrow = findArrow(caster);

    arrow.update();
    const muzzleSpeed = arrow.speed;
    for (let i = 0; i < 300; i++) arrow.update();

    expect(muzzleSpeed).toBeCloseTo(SPEED, 5);
    expect(arrow.speed).toBeCloseTo(MAX_SPEED, 5);

    while (!arrow.toRemove) arrow.update();
    expect(arrow.distanceTravelled).toBeGreaterThanOrEqual(MAX_TRAVEL);
  });

  it('stuns and damages on the first enemy it touches, using the stun icon rather than its own ability art', () => {
    const caster = owner();
    const enemyBuffs: Array<{ image: unknown; buffAddType?: unknown; activateBuff?: () => void }> =
      [];
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

    // Point blank. Not exactly the floor — one frame of flight has already
    // earned a sliver of the ramp — but nowhere near what a real shot pays.
    expect(enemyBuffs[0].duration).toBeGreaterThanOrEqual(MIN_STUN_MS);
    expect(enemyBuffs[0].duration).toBeLessThan(MIN_STUN_MS + 50);
  });

  /**
   * The other half of "global": the stun is what the flight earned. 1s at the
   * muzzle, 3.5s once it has gone the distance — the reason a cross-map arrow
   * is worth the cooldown and a point-blank one is not.
   */
  it('pays a longer stun the further the arrow flew', () => {
    const caster = owner();
    const enemyBuffs: Array<{ duration: number }> = [];
    const enemy = {
      addBuff: (buff: { duration: number; activateBuff?: () => void }) => {
        enemyBuffs.push(buff);
        buff.activateBuff?.();
      },
      takeDamage: vi.fn(),
    };
    const spell = new Ashe_R(caster);
    spell.press(context(100, 0));
    const arrow = findArrow(caster);

    // Fly it the full ramp with nothing in the way, then put a body in front.
    caster.game.objectManager.queryObjects = vi.fn(() => []);
    while (arrow.distanceTravelled < FULL_POWER_DISTANCE) arrow.update();
    caster.game.objectManager.queryObjects = vi.fn(() => [enemy]);
    arrow.update();

    expect(enemyBuffs[0].duration).toBeCloseTo(MAX_STUN_MS, 5);
  });
});
