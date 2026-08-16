import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { landBasicAttack } from '../../../src/game/combat/BasicAttack';
import EventType from '../../../src/game/enums/EventType';
import type { BasicAttackHit } from '../../../src/game/combat/BasicAttack';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const pair = () => {
  const game = createGame();
  const attacker = createUnit(game, 0, 'blue');
  const victim = createUnit(game, 50, 'red');
  for (const unit of [attacker, victim]) {
    unit.stats.maxHealth.baseValue = 200;
    unit.stats.health.baseValue = 200;
  }
  return { game, attacker, victim };
};

/**
 * Four stats exist so a swing is a build rather than the thing you do between
 * cooldowns. Each is read in exactly one place, and this suite is that place's
 * contract — including the part that matters most: a unit nobody has buffed
 * swings for exactly what it always did.
 */
describe('basic attack stats', () => {
  it('changes nothing for a unit that was granted none of them', () => {
    const { attacker, victim } = pair();

    expect(landBasicAttack(attacker, victim, 20, false)).toBe(true);

    expect(victim.stats.health.value).toBe(180);
    expect(attacker.stats.health.value).toBe(200); // no vamp, no heal
  });

  it('adds on-hit damage to the swing', () => {
    const { attacker, victim } = pair();
    attacker.stats.onHitDamage.baseValue = 7;

    landBasicAttack(attacker, victim, 20, false);

    expect(victim.stats.health.value).toBe(200 - 27);
  });

  it('multiplies the whole swing on a crit, on-hit included', () => {
    const { attacker, victim } = pair();
    attacker.stats.onHitDamage.baseValue = 10;
    attacker.stats.critChance.baseValue = 1; // always
    attacker.stats.critDamage.baseValue = 2;

    landBasicAttack(attacker, victim, 20, false);

    expect(victim.stats.health.value).toBe(200 - 60);
  });

  it('reports the damage it actually dealt, and whether it crit', () => {
    const { game, attacker, victim } = pair();
    const hits: BasicAttackHit[] = [];
    game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => hits.push(hit));

    attacker.stats.onHitDamage.baseValue = 5;
    landBasicAttack(attacker, victim, 20, true);

    expect(hits).toHaveLength(1);
    expect(hits[0].damage).toBe(25); // not the 20 that was requested
    expect(hits[0].crit).toBe(false);
    expect(hits[0].ranged).toBe(true);
  });
});

describe('omnivamp', () => {
  it('heals the attacker off any damage, not just a swing', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.omnivamp.baseValue = 0.5;

    // A spell, a poison tick, anything: `takeDamage` is the only funnel.
    victim.takeDamage(40, attacker);

    expect(victim.stats.health.value).toBe(160);
    expect(attacker.stats.health.value).toBe(120);
  });

  it('pays on the damage that survived the shield, not the damage requested', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.omnivamp.baseValue = 1;
    // The real thing rather than a stub of it: a hand-rolled object with only
    // `modifyIncomingDamage` on it stops being a `Buff` the moment the base
    // class grows a hook, which is exactly what happened when reflection moved
    // onto `onDamageTaken`.
    const shield = new Shield(10_000, victim, victim);
    shield.amount = 30;
    victim.addBuff(shield);

    victim.takeDamage(50, attacker);

    expect(attacker.stats.health.value).toBe(120); // 20, not 50
  });

  it('never refunds a self-inflicted cost', () => {
    const { attacker } = pair();
    attacker.stats.omnivamp.baseValue = 1;

    attacker.takeDamage(30, attacker); // Olaf E pays health for its damage

    expect(attacker.stats.health.value).toBe(170);
  });

  it('cannot exceed the pool it heals into', () => {
    const { attacker, victim } = pair();
    attacker.stats.omnivamp.baseValue = 1;

    victim.takeDamage(80, attacker);

    expect(attacker.stats.health.value).toBe(200);
  });
});
