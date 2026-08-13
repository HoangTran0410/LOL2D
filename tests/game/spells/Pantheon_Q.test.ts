import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import Pantheon_Q, { Pantheon_Q_Spear } from '../../../src/game/gameObject/spells/Pantheon_Q';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import ActionState from '../../../src/game/enums/ActionState';
import Stats from '../../../src/game/gameObject/Stats';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class Vector {
  constructor(public x = 0, public y = 0) {}
  copy(): Vector { return new Vector(this.x, this.y); }
  dist(other: Vector): number { return Math.hypot(this.x - other.x, this.y - other.y); }
}

const context: CastContext = Object.freeze({
  spellId: 'pantheon-q', activationId: 'activation', startedAtMs: 0, caster: {},
  origin: Object.freeze({ x: 0, y: 0 }), cursorWorld: Object.freeze({ x: 1, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

const releaseContext: CastContext = Object.freeze({
  ...context,
  cursorWorld: Object.freeze({ x: 0, y: 1 }),
  direction: Object.freeze({ x: 0, y: 1 }),
});

const target = (
  teamId: string,
  health = 100,
  prototype: object = AttackableUnit.prototype,
  unitType?: 'minion'
) => Object.assign(Object.create(prototype) as AttackableUnit, {
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
    get value() { return this.baseValue; },
    set value(value: number) { this.baseValue = value; },
  };
  return {
    position: new Vector(), teamId: 'blue', isDead: false, canCast: true,
    stats: { mana, health: { value: 100 }, addModifier: vi.fn(), removeModifier: vi.fn() },
    game: { eventManager: { emit: vi.fn() }, objectManager: { addObject: (object: unknown) => objects.push(object) } },
    addBuff: vi.fn(), objects,
  };
};

describe('Pantheon Q', () => {
  beforeEach(() => vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y)));
  afterEach(() => vi.unstubAllGlobals());

  it('uses fresh key-up aim for the -40 to 560 thrust geometry', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.release(releaseContext);

    const beam = caster.objects[0] as BeamSpellObject;
    expect(beam).toBeInstanceOf(BeamSpellObject);
    expect(beam.geometry).toEqual({
      start: { x: 0, y: -40 },
      end: { x: 0, y: 560 },
      width: 120,
    });
    expect(spell.currentCooldown).toBe(1_600);
    expect(spell.coolDown).toBe(4_000);
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
      caster, ally, enemy, untargetable, monster, minion, scenery,
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
    expect(spear.destination.y).toBeCloseTo(740.4);
    expect(spear.speed).toBe(2_700 / 60);
    expect(spear.size).toBe(32);
    expect(spear).toMatchObject({ visualWidth: 84, visualHeight: 30 });
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
    ['death', (caster: ReturnType<typeof owner>) => { caster.isDead = true; }],
    ['cast-inhibiting status', (caster: ReturnType<typeof owner>) => { caster.canCast = false; }],
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

  it('tracks live aim and grows held throw range from 600 to 1200', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.onChargeUpdate(context, 750, 0.5);
    const middle = spell.currentRange;
    spell.hold(releaseContext);
    spell.onChargeUpdate(releaseContext, 1_500, 1);
    spell.release(releaseContext);

    const spear = caster.objects[0] as Pantheon_Q_Spear;
    expect(middle).toBe(900);
    expect(spell.currentRange).toBe(1_200);
    expect(spear.destination).toMatchObject({ x: 0, y: 1_200 });
  });

  it('uses fresh key-up aim for a charged throw without a final hold event', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.onChargeUpdate(context, 1_500, 1);

    spell.release(releaseContext);

    expect((caster.objects[0] as Pantheon_Q_Spear).destination).toMatchObject({ x: 0, y: 1_200 });
  });
});
