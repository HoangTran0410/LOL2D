import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import Pantheon_Q, { Pantheon_Q_Spear } from '../../../src/game/gameObject/spells/Pantheon_Q';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import ActionState from '../../../src/game/enums/ActionState';
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
  return {
    position: new Vector(), teamId: 'blue', isDead: false, canCast: true,
    stats: { mana: { value: 100 }, health: { value: 100 }, addModifier: vi.fn(), removeModifier: vi.fn() },
    game: { eventManager: { emit: vi.fn() }, objectManager: { addObject: (object: unknown) => objects.push(object) } },
    addBuff: vi.fn(), objects,
  };
};

describe('Pantheon Q', () => {
  beforeEach(() => vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y)));
  afterEach(() => vi.unstubAllGlobals());

  it('snapshots aim and creates the imported -40 to 560 thrust geometry', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.release(releaseContext);

    const beam = caster.objects[0] as BeamSpellObject;
    expect(beam).toBeInstanceOf(BeamSpellObject);
    expect(beam.geometry).toEqual({
      start: { x: -40, y: 0 },
      end: { x: 560, y: 0 },
      width: 120,
    });
    expect(spell.currentCooldown).toBe(3_200);
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
    expect(spear.destination).toMatchObject({ x: 1_200, y: 0 });
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
    expect(spell.currentCooldown).toBe(3_200);
  });
});
