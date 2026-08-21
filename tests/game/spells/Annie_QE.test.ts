/**
 * Annie's two halves that were quietly not doing their job.
 *
 * **Q** is the game's clearest last-hit ability — a kill refunds the mana and
 * halves the cooldown, which is the whole reason Annie farms with it — and it
 * was the one such spell with nothing on screen telling you whether the next
 * cast would actually kill. It stays point-and-click; only the mark is new.
 *
 * **E** is a reflect that almost never reflected. It rode `ON_ATTACK_HIT`,
 * which `combat/BasicAttack.ts` emits for *basic attacks only*, so every spell
 * landed on Annie passed through a "shield that punishes the people hitting
 * it" without being punished. Its own docstring quotes the wiki as *"enemies
 * that deal damage to it"* — the implementation was narrower than the sentence
 * it was written from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { lethalTargets } from '../../../src/game/combat/ExecuteTargeting';
import { TargetResolver } from '../../../src/game/spell/targeting/TargetResolver';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { DAMAGE as Q_DAMAGE } from '../../../packs/riot/spells/Annie_Q';
import makeAnnie_Q from '../../../packs/riot/spells/Annie_Q';
import { RETURN_DAMAGE, SHIELD_AMOUNT } from '../../../packs/riot/spells/Annie_E';
import makeAnnie_E from '../../../packs/riot/spells/Annie_E';
const __api = buildContentApi();
const Annie_Q = makeAnnie_Q(__api);
const Annie_E = makeAnnie_E(__api);

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const annie = (): Champion => {
  const unit = new Champion({ game, teamId: 'annie' });
  unit.position.set(0, 0);
  unit.destination.set(0, 0);
  unit.stats.maxHealth.baseValue = 200;
  unit.stats.health.baseValue = 200;
  unit.stats.mana.baseValue = 500;
  game.setPlayer(unit);
  return unit;
};

const enemy = (x: number, health: number): Champion => {
  const unit = new Champion({ game, teamId: `enemy-${x}` });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  unit.stats.maxHealth.baseValue = 200;
  unit.stats.health.baseValue = health;
  return unit;
};

describe('Annie Q marks what it would finish', () => {
  it('marks the one the fireball kills and not the one it does not', () => {
    const caster = annie();
    const doomed = enemy(200, Q_DAMAGE - 1);
    const healthy = enemy(300, 200);
    indexObjects(game, [caster, doomed, healthy]);

    const spell = new Annie_Q(caster);
    expect(lethalTargets(spell)).toEqual([doomed]);
  });

  it('does not reach past its own range', () => {
    const caster = annie();
    const spell = new Annie_Q(caster);
    const tooFar = enemy(spell.range + 200, 1);
    indexObjects(game, [caster, tooFar]);

    expect(spell.executeCandidates()).toEqual([]);
  });

  it('counts a shield as something the fireball has to get through', () => {
    const caster = annie();
    const shielded = enemy(200, 1);
    indexObjects(game, [caster, shielded]);

    const shield = new Annie_E(shielded);
    shield.onSpellCast();

    expect(lethalTargets(new Annie_Q(caster))).toEqual([]);
  });

  it('quotes the fireball damage, not something it made up', () => {
    const caster = annie();
    const target = enemy(200, 200);
    indexObjects(game, [caster, target]);

    expect(new Annie_Q(caster).executeDamageAgainst(target)).toBe(Q_DAMAGE);
  });
});

/**
 * The other half of the same complaint: the ring said "this one dies" and the
 * press then went somewhere else, because UNIT targeting only ever looked in a
 * circle around the cursor. Driven through `TargetResolver` with the spell's
 * real `targetingRequest`, which is the path a key press actually takes.
 */
describe('Annie Q casts at what it marked', () => {
  const resolve = (spell: Annie_Q, caster: Champion, cursor: { x: number; y: number }) =>
    TargetResolver.resolve('UNIT', {
      spellId: spell.id,
      activationId: 'activation',
      startedAtMs: 0,
      caster,
      casterTeamId: caster.teamId,
      origin: caster.position,
      cursorWorld: cursor,
      ...spell.targetingRequest,
    });

  it('fires at an enemy in range even with the cursor pointed the other way', () => {
    const caster = annie();
    const behind = enemy(200, 200);
    indexObjects(game, [caster, behind]);

    // The reported bug: a minion inside the 500px range, cursor aimed the
    // opposite direction, and the key did nothing at all.
    const result = resolve(new Annie_Q(caster), caster, { x: -400, y: 0 });

    expect(result).toMatchObject({ ok: true, context: { target: behind } });
  });

  it('takes the one it would finish when the cursor is on empty ground', () => {
    const caster = annie();
    const healthy = enemy(120, 200);
    const doomed = enemy(320, Q_DAMAGE - 1);
    indexObjects(game, [caster, healthy, doomed]);

    // `doomed` is further from both the caster and the cursor; being killable
    // is what wins it the cast, which is what the ring on screen promised.
    const result = resolve(new Annie_Q(caster), caster, { x: 0, y: -600 });

    expect(result).toMatchObject({ ok: true, context: { target: doomed } });
  });

  it('never steals the cast off a champion the player is pointing at', () => {
    const caster = annie();
    const aimedAt = enemy(120, 200);
    const doomed = enemy(320, Q_DAMAGE - 1);
    indexObjects(game, [caster, aimedAt, doomed]);

    const result = resolve(new Annie_Q(caster), caster, { x: 125, y: 0 });

    expect(result).toMatchObject({ ok: true, context: { target: aimedAt } });
  });

  it('still refuses when there is genuinely nobody in range', () => {
    const caster = annie();
    const spell = new Annie_Q(caster);
    const tooFar = enemy(spell.range + 400, 10);
    indexObjects(game, [caster, tooFar]);

    expect(resolve(spell, caster, { x: 100, y: 0 })).toEqual({
      ok: false,
      reason: 'OUT_OF_RANGE',
    });
  });
});

describe('Annie E burns whoever damages the shield', () => {
  const shielded = () => {
    const caster = annie();
    const attacker = enemy(80, 200);
    indexObjects(game, [caster, attacker]);
    new Annie_E(caster).onSpellCast();
    return { caster, attacker };
  };

  it('burns a spell, not only a basic attack', () => {
    const { caster, attacker } = shielded();

    // This is the case that never fired: the burn used to ride ON_ATTACK_HIT,
    // which no spell emits.
    caster.takeDamage(30, attacker);

    expect(attacker.stats.health.value).toBe(200 - RETURN_DAMAGE);
  });

  it('burns even when the shield swallowed the whole hit', () => {
    const { caster, attacker } = shielded();

    // "Enemies that deal damage to *it*" — the shield taking the hit is the
    // trigger, so a poke smaller than the shield still burns.
    caster.takeDamage(Math.floor(SHIELD_AMOUNT / 2), attacker);

    expect(caster.stats.health.value).toBe(200);
    expect(attacker.stats.health.value).toBe(200 - RETURN_DAMAGE);
  });

  it('burns on every hit, not only the first', () => {
    const { caster, attacker } = shielded();

    caster.takeDamage(10, attacker);
    caster.takeDamage(10, attacker);
    caster.takeDamage(10, attacker);

    expect(attacker.stats.health.value).toBe(200 - RETURN_DAMAGE * 3);
  });

  it('burns everyone who touches it, each on their own', () => {
    const { caster, attacker } = shielded();
    const other = enemy(-80, 200);
    indexObjects(game, [caster, attacker, other]);

    caster.takeDamage(10, attacker);
    caster.takeDamage(10, other);

    expect(attacker.stats.health.value).toBe(200 - RETURN_DAMAGE);
    expect(other.stats.health.value).toBe(200 - RETURN_DAMAGE);
  });

  it('a recast refreshes the burn rather than running two of them', () => {
    // Both casts' shields can be up at once under heavy CDR. Two live
    // `DamageReflect`s would burn twice for one hit, which is the bug the
    // shared `stackId` and REPLACE_EXISTING prevent — and the reason the
    // reaction pass skips buffs already marked `toRemove`.
    const { caster, attacker } = shielded();
    new Annie_E(caster).onSpellCast();

    caster.takeDamage(10, attacker);

    expect(attacker.stats.health.value).toBe(200 - RETURN_DAMAGE);
  });

  it('stops once the shield is gone', () => {
    const { caster, attacker } = shielded();
    for (const buff of [...caster.buffs]) buff.deactivateBuff();
    caster.updateBuffs();

    caster.takeDamage(10, attacker);

    expect(attacker.stats.health.value).toBe(200);
  });
});
