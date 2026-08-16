/**
 * The scoreboard the game never kept.
 *
 * Everything a match knew about a participant was one number: `Champion.score`,
 * incremented on a kill and decremented on a death, so 3/3 and 0/0 were the
 * same player. Nothing at all was recorded for minions and camps — they died
 * and no one was credited — which meant "farm" was not a quantity this game
 * had. Damage was not a quantity either, on a codebase whose whole open
 * question is whether a new ability is tuned right.
 *
 * `MatchTally` is those counters, and `score` becomes a view of two of them so
 * the health-bar number keeps meaning what it always meant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Pet from '../../../src/game/gameObject/attackableUnits/Pet';
import Turret from '../../../src/game/gameObject/structures/Turret';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const champion = (teamId: string): Champion => {
  const unit = new Champion({ game, teamId });
  unit.stats.maxHealth.baseValue = 100;
  unit.stats.health.baseValue = 100;
  return unit;
};

describe('kill credit', () => {
  it('a champion kill moves both sides of the ledger', () => {
    const attacker = champion('attacker');
    const victim = champion('victim');
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);

    victim.die({ attacker, reviveAfter: 10 });

    expect(attacker.tally.kills).toBe(1);
    expect(victim.tally.deaths).toBe(1);
    expect(attacker.tally.minionsKilled).toBe(0);
  });

  it('keeps `score` meaning kills minus deaths', () => {
    const attacker = champion('attacker');
    const victim = champion('victim');
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);

    victim.die({ attacker, reviveAfter: 10 });

    expect(attacker.score).toBe(1);
    expect(victim.score).toBe(-1);
  });

  it('a minion and a camp are farm, not kills', () => {
    const farmer = champion('farmer');
    game.setPlayer(farmer);
    const minion = new Minion({ game, teamId: 'blue', waypoints: [{ x: 0, y: 0 }] });
    const monster = new Monster({ game });
    indexObjects(game, [farmer, minion, monster]);

    minion.die({ attacker: farmer, reviveAfter: 0 });
    monster.die({ attacker: farmer, reviveAfter: 0 });

    expect(farmer.tally.minionsKilled).toBe(2);
    expect(farmer.tally.kills).toBe(0);
  });

  it('credits nothing for a pet or a turret', () => {
    const attacker = champion('attacker');
    game.setPlayer(attacker);
    const owner = champion('pet-owner');
    const pet = new Pet({ game, ownerUnit: owner, lifeTimeMs: 10_000, teamId: 'pet-owner' });
    const turret = new Turret({ game, position: createVector(), teamId: 'blue' });
    indexObjects(game, [attacker, owner, pet, turret]);

    pet.die({ attacker, reviveAfter: 0 });
    turret.die({ attacker, reviveAfter: 0 });

    // A summon is not a champion and a building is not a wave. Without the
    // distinction a Pet — which extends Champion — would read as a kill.
    expect(attacker.tally.kills).toBe(0);
    expect(attacker.tally.minionsKilled).toBe(0);
  });

  it('does not credit a unit for killing itself', () => {
    const loner = champion('loner');
    game.setPlayer(loner);
    indexObjects(game, [loner]);

    loner.die({ attacker: loner, reviveAfter: 10 });

    expect(loner.tally.kills).toBe(0);
    expect(loner.tally.deaths).toBe(1);
  });
});

describe('damage tally', () => {
  it('records what landed on both sides of a hit', () => {
    const attacker = champion('attacker');
    const victim = champion('victim');
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);

    victim.takeDamage(30, attacker);

    expect(attacker.tally.damageDealt).toBe(30);
    expect(victim.tally.damageTaken).toBe(30);
  });

  it('counts what got through, not what was swung', () => {
    const attacker = champion('attacker');
    const victim = champion('victim');
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);

    // A 30-point shield in front of a 50-point hit: 20 lands. Recorded on the
    // damage that reached health, the same rule `takeDamage` already applies to
    // omnivamp — a shielded poke must not read as full output.
    const shield = new Shield(10_000, victim, victim);
    shield.amount = 30;
    victim.addBuff(shield);
    victim.takeDamage(50, attacker);

    expect(victim.stats.health.value).toBe(80);
    expect(attacker.tally.damageDealt).toBe(20);
    expect(victim.tally.damageTaken).toBe(20);
  });

  it('accumulates across hits and is not reset by death', () => {
    const attacker = champion('attacker');
    const victim = champion('victim');
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);

    victim.takeDamage(40, attacker);
    victim.takeDamage(70, attacker);

    expect(victim.isDead).toBe(true);
    // 40 + 60: the second hit only had 60 health left to take.
    expect(victim.tally.damageTaken).toBe(100);
    expect(attacker.tally.damageDealt).toBe(100);
  });

  it('ignores self-damage, which is a cost rather than a hit', () => {
    const loner = champion('loner');
    game.setPlayer(loner);
    indexObjects(game, [loner]);

    loner.takeDamage(20, loner);

    expect(loner.tally.damageDealt).toBe(0);
    expect(loner.tally.damageTaken).toBe(20);
  });
});
