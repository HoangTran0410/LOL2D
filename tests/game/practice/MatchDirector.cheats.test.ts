import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals } from '../fixtures';
import { context } from './helpers';
import MatchDirector from '../../../src/game/MatchDirector';
import { DEFAULT_CHAMPION_LOADOUT } from '../../../src/game/config/PregameConfig';
import Invulnerable from '../../../src/game/gameObject/buffs/Invulnerable';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

/**
 * The cheat surface: a buff that eats damage, and the three one-shot director
 * calls the Gian lận tab drives.
 *
 * `Invulnerable` is asserted on a bare `AttackableUnit` rather than a champion
 * because `Minion`, `Monster` and `Turret` all reach `takeDamage` through
 * `super` — one buff covers every unit type, and the base class is where that
 * is true.
 */
beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

const hurtable = (): AttackableUnit => {
  const game = createGame();
  const unit = new AttackableUnit({ game: game as never, position: createVector(0, 0) } as never);
  game.setPlayer(unit);
  unit.stats.maxHealth.baseValue = 100;
  unit.stats.health.baseValue = 100;
  return unit;
};

describe('Invulnerable', () => {
  // It shipped once wearing `buff_stasis`, the Zhonya's hourglass. `Stasis`
  // exists in this game and means something else entirely — golden, cannot
  // act, cannot be targeted — so the buff bar was naming the wrong mechanic.
  // `hudState.ts:173` skips any buff with no image, which is how this one
  // stays out of the bar; the ring in `draw()` is the indicator instead.
  it('wears no icon, so it cannot be mistaken for another mechanic', () => {
    const unit = hurtable();
    const buff = new Invulnerable(600000, unit, unit);
    expect(buff.image).toBeFalsy();
  });

  it('eats all damage — and the same unit without it does not', () => {
    const control = hurtable();
    control.takeDamage(40);
    expect(control.stats.health.baseValue).toBe(60);

    const immune = hurtable();
    immune.addBuff(new Invulnerable(600000, immune, immune));
    immune.takeDamage(40);
    expect(immune.stats.health.baseValue).toBe(100);
  });

  it('cannot be killed by a hit larger than its health', () => {
    const unit = hurtable();
    unit.addBuff(new Invulnerable(600000, unit, unit));
    unit.takeDamage(99999);
    expect(unit.isDead).toBe(false);
  });

  // Unlike Stasis, which is invulnerability *plus* crowd control. A player who
  // turns this on to practise a combo must still be able to move and cast.
  it('does not stun or untarget, unlike Stasis', () => {
    const unit = hurtable();
    unit.addBuff(new Invulnerable(600000, unit, unit));
    expect(unit.canMove).toBe(true);
    expect(unit.canCast).toBe(true);
  });
});

describe('MatchDirector — cheats', () => {
  it('setInvulnerable toggles both ways, and isInvulnerable follows it', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    expect(director.isInvulnerable(player)).toBe(false);
    director.setInvulnerable(player, true);
    expect(director.isInvulnerable(player)).toBe(true);

    // Twice on is still once: the buff owns the toggle, so a second press must
    // not stack a second copy that a single "off" would leave behind.
    director.setInvulnerable(player, true);
    director.setInvulnerable(player, false);
    expect(director.isInvulnerable(player)).toBe(false);
  });

  /**
   * The panel is always paused, so `AttackableUnit.update()` — which is what
   * actually drops a `toRemove` buff off the list — never runs between two
   * presses of this toggle. Both directions have to answer correctly anyway.
   */
  it('survives being flipped twice inside one paused panel session', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    director.setInvulnerable(player, true);
    director.setInvulnerable(player, false);
    director.setInvulnerable(player, true);

    expect(director.isInvulnerable(player)).toBe(true);
    player.stats.health.baseValue = 100;
    player.takeDamage(40);
    expect(player.stats.health.baseValue).toBe(100);
  });

  it('refill restores health and mana from a damaged, drained unit', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    player.stats.health.baseValue = 1;
    player.stats.mana.baseValue = 0;
    director.refill(player);

    expect(player.stats.health.baseValue).toBe(player.stats.maxHealth.value);
    expect(player.stats.mana.baseValue).toBe(player.stats.maxMana.value);
  });

  it('clearCooldowns zeroes every ability, and leaves the basic attack mid-swing', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    // A real kit, so there are abilities to put on cooldown at all — the bench
    // builds a bare `Champion` with no preset applied.
    director.applyLoadout(player, { ...DEFAULT_CHAMPION_LOADOUT, championName: 'Ahri' });

    for (const spell of player.spells) if (spell) spell.currentCooldown = 3000;
    // `BasicAttack` overrides the setter with an empty one on purpose, so slot
    // 0 never took the 3000 above — which is exactly the point: a cooldown
    // reset must not hand back a swing.
    const attackBefore = player.spells[0].currentCooldown;

    director.clearCooldowns(player);

    expect(player.spells[1].currentCooldown).toBe(0);
    expect(player.spells[0].currentCooldown).toBe(attackBefore);
  });
});

/**
 * The debug hub's state. Plain fields on the director, deliberately: the panel
 * holds the match paused while a tab is open, so `ObjectManager.update()` never
 * runs, and anything a tab reads has to be readable without it.
 */
describe('debug flags', () => {
  it('starts every layer off', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    expect(director.debug).toMatchObject({
      routes: false,
      terrain: false,
      collision: false,
      vision: false,
      quadtree: false,
    });
  });

  it('routes and navigation.debugRoutes are one value, so N and the panel agree', () => {
    const { context: ctx } = context();
    const navigation = { debugRoutes: false };
    (ctx as { navigation?: unknown }).navigation = navigation;
    const director = new MatchDirector(ctx);

    // The N key's side (`Game.keyPressed` flips the navigation field).
    navigation.debugRoutes = true;
    expect(director.debug.routes).toBe(true);

    // The panel's side.
    director.debug.routes = false;
    expect(navigation.debugRoutes).toBe(false);
  });
});
