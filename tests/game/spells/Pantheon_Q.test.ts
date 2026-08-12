import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import Pantheon_Q, { Pantheon_Q_Spear } from '../../../src/game/gameObject/spells/Pantheon_Q';
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

  it('early release creates an instant short beam stab', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.release(context);

    expect(caster.objects[0]).toBeInstanceOf(BeamSpellObject);
    expect(spell.currentCooldown).toBe(3_200);
  });

  it('crossing the hold threshold releases a thrown linear missile', () => {
    const caster = owner();
    const spell = new Pantheon_Q(caster);
    spell.press(context);
    spell.onChargeUpdate(context, 351, 351 / 4_000);
    spell.release(context);

    expect(caster.objects[0]).toBeInstanceOf(Pantheon_Q_Spear);
    const spear = caster.objects[0] as Pantheon_Q_Spear;
    const damages: number[] = [];
    const target = (health: number) => ({
      position: { x: 0, y: 0 }, collisionRadius: 1,
      stats: { health: { value: health }, maxHealth: { value: 100 } },
      takeDamage: (damage: number) => damages.push(damage),
    });
    for (const health of [100, 100, 10]) {
      const enemy = target(health);
      spear.hitTargets.push(enemy);
      spear.onHit(enemy);
    }

    expect(damages).toEqual([20, 10, 20]);
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
