/**
 * The three "finish them" abilities, and the rule they all now share.
 *
 * Nasus Q and Cho'Gath R used to pay a stack for *landing*, not for killing —
 * so a permanent, uncapped power stat was farmed by holding the key down next
 * to anything at all. The wiki version of both is a last hit, and this is that
 * rule: the stack is the corpse, not the hit.
 *
 * Which made last-hitting matter, and last-hitting is the part a 2D game with
 * no unit-targeted click is worst at. So the targeting changed with it: all
 * three route through `pickExecuteTarget`, which takes the enemy the cast would
 * *kill* over the enemy that merely happens to be nearest. Garen R already
 * picked the weakest champion and now picks a lethal one ahead of that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeChoGath_R, { makeChoGath_R_Growth } from '../../../packs/riot/spells/ChoGath_R';
import { BASE_DAMAGE } from '../../../packs/riot/spells/Nasus_Q';
import makeNasus_Q from '../../../packs/riot/spells/Nasus_Q';
import { BASE_DAMAGE as GAREN_BASE } from '../../../packs/riot/spells/Garen_R';
import makeGaren_R from '../../../packs/riot/spells/Garen_R';
const __api = buildContentApi();
const ChoGath_R = makeChoGath_R(__api);
const ChoGath_R_Growth = makeChoGath_R_Growth(__api);
const Nasus_Q = makeNasus_Q(__api);
const Garen_R = makeGaren_R(__api);

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => vi.unstubAllGlobals());

/** A champion at `x`, on its own team, with the health pool a test asks for. */
const enemy = (x: number, health: number, maxHealth = 100): Champion => {
  const unit = new Champion({ game, teamId: `enemy-${x}` });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  unit.stats.maxHealth.baseValue = maxHealth;
  unit.stats.health.baseValue = health;
  return unit;
};

const caster = (): Champion => {
  const unit = new Champion({ game, teamId: 'caster' });
  unit.position.set(0, 0);
  unit.destination.set(0, 0);
  // `isAllied` — which every display bounding box reaches for — reads
  // `game.player`, and the fixture throws until something sets it.
  game.setPlayer(unit);
  return unit;
};

/** `amount` mana-free absorption on `unit`, applied and live. */
const shieldFor = (unit: Champion, amount: number): void => {
  const shield = new Shield(10_000, unit, unit);
  shield.amount = amount;
  unit.addBuff(shield);
};

const growthStacks = (unit: Champion): number =>
  unit.buffs.filter(buff => buff instanceof ChoGath_R_Growth && !buff.toRemove).length;

describe('Nasus Q stacks on the kill, not on the hit', () => {
  it('leaves the count alone when the strike does not kill', () => {
    const nasus = caster();
    const victim = enemy(60, 100);
    indexObjects(game, [nasus, victim]);

    const spell = new Nasus_Q(nasus);
    spell.onSpellCast();

    // it still hurt — this is not "the spell stopped working"
    expect(victim.stats.health.value).toBe(100 - BASE_DAMAGE);
    expect(spell.stackCount).toBe(0);
  });

  it('takes a stack when the strike kills', () => {
    const nasus = caster();
    const victim = enemy(60, 10);
    indexObjects(game, [nasus, victim]);

    const spell = new Nasus_Q(nasus);
    spell.onSpellCast();

    expect(victim.isDead).toBe(true);
    expect(spell.stackCount).toBe(1);
  });

  it('never pays twice for one corpse', () => {
    const nasus = caster();
    const victim = enemy(60, 10);
    indexObjects(game, [nasus, victim]);

    const spell = new Nasus_Q(nasus);
    spell.onSpellCast();
    // A corpse is not a candidate any more, so the second cast finds nothing;
    // the guard that matters is that it cannot bank a stack off one either.
    spell.onSpellCast();

    expect(spell.stackCount).toBe(1);
  });

  it('strikes the killable enemy over the nearer healthy one', () => {
    const nasus = caster();
    const healthy = enemy(40, 100);
    const nearlyDead = enemy(120, 8);
    indexObjects(game, [nasus, healthy, nearlyDead]);

    new Nasus_Q(nasus).onSpellCast();

    expect(nearlyDead.isDead).toBe(true);
    expect(healthy.stats.health.value).toBe(100);
  });

  it('falls back to the nearest enemy when nothing in range would die', () => {
    const nasus = caster();
    const near = enemy(40, 100);
    const far = enemy(120, 60);
    indexObjects(game, [nasus, near, far]);

    new Nasus_Q(nasus).onSpellCast();

    expect(near.stats.health.value).toBe(100 - BASE_DAMAGE);
    expect(far.stats.health.value).toBe(60);
  });

  it('counts a shield as health it has to chew through', () => {
    const nasus = caster();
    const shielded = enemy(60, 10);
    shieldFor(shielded, 100);
    indexObjects(game, [nasus, shielded]);

    const spell = new Nasus_Q(nasus);
    spell.onSpellCast();

    expect(shielded.isDead).toBe(false);
    expect(spell.stackCount).toBe(0);
  });
});

describe('Cho’Gath R feeds on kills only', () => {
  it('bites without growing when the target survives', () => {
    const chogath = caster();
    const victim = enemy(80, 100);
    indexObjects(game, [chogath, victim]);

    const spell = new ChoGath_R(chogath);
    const maxHealthBefore = chogath.stats.maxHealth.value;
    spell.onSpellCast();

    expect(victim.stats.health.value).toBe(100 - spell.damage);
    expect(growthStacks(chogath)).toBe(0);
    expect(chogath.stats.maxHealth.value).toBe(maxHealthBefore);
  });

  it('grows when the bite kills', () => {
    const chogath = caster();
    const victim = enemy(80, 12);
    indexObjects(game, [chogath, victim]);

    const spell = new ChoGath_R(chogath);
    spell.onSpellCast();

    expect(victim.isDead).toBe(true);
    expect(growthStacks(chogath)).toBe(1);
  });

  it('bites the enemy it can finish rather than the closest one', () => {
    const chogath = caster();
    const healthy = enemy(50, 100);
    const nearlyDead = enemy(150, 15);
    indexObjects(game, [chogath, healthy, nearlyDead]);

    new ChoGath_R(chogath).onSpellCast();

    expect(nearlyDead.isDead).toBe(true);
    expect(healthy.stats.health.value).toBe(100);
  });
});

describe('Garen R prefers a kill to the lowest bar', () => {
  it('passes over the weakest champion when a shield puts them out of reach', () => {
    const garen = caster();
    // 5 health but 300 shield: the lowest bar on the map and completely safe.
    const shielded = enemy(60, 5);
    shieldFor(shielded, 300);
    // 20 health, 100 max: 80 missing, so the strike lands for well over 20.
    const killable = enemy(150, 20);
    indexObjects(game, [garen, shielded, killable]);

    const spell = new Garen_R(garen);
    expect(GAREN_BASE).toBeGreaterThan(0);
    expect(spell.findVictim()).toBe(killable);
  });

  it('still takes the weakest when nothing in range can be finished', () => {
    const garen = caster();
    const hurt = enemy(60, 90);
    const healthier = enemy(150, 100);
    indexObjects(game, [garen, hurt, healthier]);

    expect(new Garen_R(garen).findVictim()).toBe(hurt);
  });
});
