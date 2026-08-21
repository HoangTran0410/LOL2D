import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import ActionState from '../../../src/game/enums/ActionState';
import Stats from '../../../src/game/gameObject/Stats';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { buildContentApi } from '../../../src/content/ContentApi';
import { THRUST_BACKSWING, THRUST_REACH, THRUST_WIDTH } from '../../../packs/riot/spells/Pantheon_Q';
import makePantheon_Q, { makePantheon_Q_Spear, makePantheon_Q_Thrust } from '../../../packs/riot/spells/Pantheon_Q';
const __api = buildContentApi();
const Pantheon_Q = makePantheon_Q(__api);
const Pantheon_Q_Spear = makePantheon_Q_Spear(__api);
const Pantheon_Q_Thrust = makePantheon_Q_Thrust(__api);

class Vector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy(): Vector {
    return new Vector(this.x, this.y);
  }
  dist(other: Vector): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}

const context: CastContext = Object.freeze({
  spellId: 'pantheon-q',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 1, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

const releaseContext: CastContext = Object.freeze({
  ...context,
  cursorWorld: Object.freeze({ x: 0, y: 1 }),
  direction: Object.freeze({ x: 0, y: 1 }),
});

/** An aim that landed exactly on Pantheon: no distance, so no direction. */
const degenerateContext: CastContext = Object.freeze({
  ...context,
  cursorWorld: Object.freeze({ x: 0, y: 0 }),
  direction: Object.freeze({ x: 0, y: 0 }),
});

const target = (
  teamId: string,
  health = 100,
  prototype: object = AttackableUnit.prototype,
  unitType?: 'minion'
) =>
  Object.assign(Object.create(prototype) as AttackableUnit, {
    position: { x: 100, y: 0 },
    collisionRadius: 10,
    teamId,
    stats: {
      health: { value: health },
      maxHealth: { value: 100 },
      actionState: ActionState.TARGETABLE,
    },
    takeDamage: vi.fn(),
    unitType,
    deathData: null,
  });

const owner = () => {
  const objects: unknown[] = [];
  const mana = {
    baseValue: 100,
    get value() {
      return this.baseValue;
    },
    set value(value: number) {
      this.baseValue = value;
    },
  };
  return {
    position: new Vector(),
    destination: new Vector(),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    stats: { mana, health: { value: 100 }, addModifier: vi.fn(), removeModifier: vi.fn() },
    game: {
      eventManager: { emit: vi.fn() },
      objectManager: { addObject: (object: unknown) => objects.push(object) },
    },
    addBuff: vi.fn(),
    objects,
  };
};

const stubDrawGlobals = () => {
  const spies = {
    image: vi.fn(),
    line: vi.fn(),
    ellipse: vi.fn(),
    quad: vi.fn(),
    beginShape: vi.fn(),
    bezierVertex: vi.fn(),
    vertex: vi.fn(),
    endShape: vi.fn(),
  };
  for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
  for (const name of [
    'push',
    'pop',
    'translate',
    'rotate',
    'blendMode',
    'fill',
    'stroke',
    'noFill',
    'noStroke',
    'strokeWeight',
    'strokeCap',
  ]) {
    vi.stubGlobal(name, vi.fn());
  }
  for (const name of ['ADD', 'BLEND', 'CLOSE', 'SQUARE', 'ROUND']) vi.stubGlobal(name, name);
  return spies;
};

describe('Pantheon Q', () => {
  beforeEach(() => vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y)));
  afterEach(() => vi.unstubAllGlobals());

  it('draws a procedural spear rather than blitting the ability icon', () => {
    const draw = stubDrawGlobals();
    const spear = new Pantheon_Q_Spear(owner() as never);
    spear.destination = new Vector(100, 0) as never;

    spear.draw();

    expect(draw.image).not.toHaveBeenCalled();
    expect(spear.image).toBeUndefined();
    // haft, counterweight, bezier leaf blade and socket collar
    expect(draw.ellipse).toHaveBeenCalledTimes(1);
    expect(draw.bezierVertex).toHaveBeenCalledTimes(2);
    expect(draw.quad).toHaveBeenCalledTimes(1);
  });

  it('still thrusts down a real lane when the aim landed on Pantheon', () => {
    const thrustFrom = (destination: Vector) => {
      const caster = owner();
      caster.destination = destination;
      const spell = new Pantheon_Q(caster);
      spell.press(degenerateContext);
      spell.release(degenerateContext);
      return (caster.objects[0] as BeamSpellObject).geometry;
    };

    // Walking south, so the spear goes south: `Game.facing()` already states
    // the rule this follows — a direction is never (0,0).
    expect(thrustFrom(new Vector(0, 200))).toEqual({
      start: { x: 0, y: -THRUST_BACKSWING },
      end: { x: 0, y: THRUST_REACH },
      width: THRUST_WIDTH,
    });
    // Standing still with nothing left to point at. It still has to be a lane:
    // a start equal to its end hits nothing and draws nothing.
    expect(thrustFrom(new Vector(0, 0))).toEqual({
      start: { x: -THRUST_BACKSWING, y: 0 },
      end: { x: THRUST_REACH, y: 0 },
      width: THRUST_WIDTH,
    });
  });

  it('builds the thrust geometry from the tuning constants and fresh key-up aim', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.release(releaseContext);

    const beam = caster.objects[0] as BeamSpellObject;
    expect(beam).toBeInstanceOf(BeamSpellObject);
    expect(beam.geometry).toEqual({
      start: { x: 0, y: -THRUST_BACKSWING },
      end: { x: 0, y: THRUST_REACH },
      width: THRUST_WIDTH,
    });
    expect(spell.currentCooldown).toBe(1_600);
    expect(spell.coolDown).toBe(4_000);
  });

  it('gives the tap-cast a visual, since the beam is hit detection only', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.release(releaseContext);

    const thrust = caster.objects.find(o => o instanceof Pantheon_Q_Thrust) as Pantheon_Q_Thrust;
    expect(thrust).toBeInstanceOf(Pantheon_Q_Thrust);
    // matches the lane the BeamSpellObject actually hit
    expect(thrust.reach).toBe(THRUST_REACH);
    expect(thrust.laneWidth).toBe(THRUST_WIDTH);
    expect(thrust.aimDirection).toEqual({ x: 0, y: 1 });

    // and it must expire on its own rather than linger for the whole game
    vi.stubGlobal('deltaTime', thrust.lifeTime + 1);
    thrust.update();
    expect(thrust.toRemove).toBe(true);
  });

  it('thrust hits only enemy damageable units and applies unit multipliers before execute', () => {
    const caster = owner();
    const ally = target('blue');
    const enemy = target('red');
    const untargetable = target('red');
    untargetable.stats.actionState = 0;
    const monster = target('red', 10, Monster.prototype);
    const minion = target('red', 100, AttackableUnit.prototype, 'minion');
    const scenery = { position: { x: 100, y: 0 }, collisionRadius: 10 };
    caster.game.objectManager.queryObjects = vi.fn(() => [
      caster,
      ally,
      enemy,
      untargetable,
      monster,
      minion,
      scenery,
    ]);
    const spell = new Pantheon_Q(caster);

    spell.press(context);
    spell.release(context);
    const beam = caster.objects[0] as BeamSpellObject;
    expect(() => beam.update()).not.toThrow();

    expect(ally.takeDamage).not.toHaveBeenCalled();
    expect(untargetable.takeDamage).not.toHaveBeenCalled();
    expect(enemy.takeDamage).toHaveBeenCalledWith(20, caster);
    expect(monster.takeDamage).toHaveBeenCalledWith(32, caster);
    expect(minion.takeDamage).toHaveBeenCalledWith(14, caster);
  });

  it('crossing the hold threshold releases a thrown linear missile', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.onChargeUpdate(context, 351, 351 / 4_000);
    spell.release(releaseContext);

    expect(caster.objects[0]).toBeInstanceOf(Pantheon_Q_Spear);
    const spear = caster.objects[0] as Pantheon_Q_Spear;
    expect(spear.destination.x).toBe(0);
    expect(spear.destination.y).toBeCloseTo(240.4);
    expect(spear.speed).toBe(1_400 / 60);
    expect(spear.size).toBe(32);
    expect(spear).toMatchObject({ visualWidth: 126, visualHeight: 42 });
    const damages: number[] = [];
    const targets = [
      target('red'),
      target('red', 100, Monster.prototype),
      target('red', 10, AttackableUnit.prototype, 'minion'),
    ];
    for (const enemy of targets) {
      enemy.takeDamage = vi.fn((damage: number) => damages.push(damage));
      spear.hitTargets.push(enemy);
      spear.onHit(enemy);
    }

    expect(damages).toEqual([20, 8, 14]);
  });

  it('commits resource and cooldown once across both forms', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.release(context);
    spell.release(context);

    expect(caster.stats.mana.value).toBe(75);
    expect(spell.currentCooldown).toBe(1_600);
  });

  it.each([
    [
      'death',
      (caster: ReturnType<typeof owner>) => {
        caster.isDead = true;
      },
    ],
    [
      'cast-inhibiting status',
      (caster: ReturnType<typeof owner>) => {
        caster.canCast = false;
      },
    ],
  ])('cancels charging on %s and keeps the imported half-mana refund', (_name, interrupt) => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    interrupt(caster);
    vi.stubGlobal('deltaTime', 16);

    spell.update();

    expect(spell.state).toBe('COOLDOWN');
    expect(caster.stats.mana.value).toBe(87.5);
  });

  it('applies its direct half-cost adjustment to a real Stat base value', () => {
    const caster = owner();
    const stats = new Stats();
    stats.mana.baseValue = 100;
    caster.stats = stats as typeof caster.stats;

    new Pantheon_Q(caster).onCancel(context, 'MAX_DURATION');

    expect(stats.mana.baseValue).toBe(87.5);
  });

  it('tracks live aim and grows held throw range from 100 to 700', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.onChargeUpdate(context, 750, 0.5);
    const middle = spell.currentRange;
    spell.hold(releaseContext);
    spell.onChargeUpdate(releaseContext, 1_500, 1);
    spell.release(releaseContext);

    const spear = caster.objects[0] as Pantheon_Q_Spear;
    expect(middle).toBe(400);
    expect(spell.currentRange).toBe(700);
    expect(spear.destination).toMatchObject({ x: 0, y: 700 });
  });

  it('uses fresh key-up aim for a charged throw without a final hold event', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.onChargeUpdate(context, 1_500, 1);

    spell.release(releaseContext);

    expect((caster.objects[0] as Pantheon_Q_Spear).destination).toMatchObject({ x: 0, y: 700 });
  });
});
