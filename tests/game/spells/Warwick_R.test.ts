/**
 * Infinite Duress picks with the cursor, not with a tape measure.
 *
 * Range is measured from Warwick — that is what the ultimate can physically
 * reach — but *which* of the enemies inside it he takes is measured from the
 * cursor. Nearest-to-caster chose for the player, and in the only fight that
 * matters it chose wrong every time: the minion at your feet instead of the
 * champion two steps behind it, which is a 1.5s suppress spent on a creep.
 *
 * Same rule Zed R, Yasuo E/R, Ekko E and Lee Sin R already play by.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Warwick_R, { RANGE } from '../../../src/game/gameObject/spells/Warwick_R';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => vi.unstubAllGlobals());

const unit = (teamId: string, x: number, y = 0): Champion => {
  const champion = new Champion({ game, teamId });
  champion.position.set(x, y);
  champion.destination.set(x, y);
  return champion;
};

/** Warwick with the ultimate in hand and the cursor somewhere. */
const warwick = (cursorX: number, cursorY = 0) => {
  const owner = unit('warwick', 0);
  owner.stats.mana.baseValue = 500;
  game.setPlayer(owner);
  (game as unknown as { worldMouse: unknown }).worldMouse = { x: cursorX, y: cursorY };
  const spell = new Warwick_R(owner);
  owner.spells = [spell];
  return { owner, spell };
};

describe('Warwick R target pick', () => {
  it('takes the enemy nearest the cursor, not the one nearest Warwick', () => {
    const { owner, spell } = warwick(400);
    const underfoot = unit('creep', 60);
    const aimedAt = unit('champion', 380);
    indexObjects(game, [owner, underfoot, aimedAt]);

    expect(spell._findTarget()).toBe(aimedAt);
  });

  it('swaps as the cursor swaps, with both enemies standing still', () => {
    const { owner, spell } = warwick(60);
    const near = unit('creep', 60);
    const far = unit('champion', 380);
    indexObjects(game, [owner, near, far]);

    expect(spell._findTarget()).toBe(near);

    (game as unknown as { worldMouse: unknown }).worldMouse = { x: 380, y: 0 };
    expect(spell._findTarget()).toBe(far);
  });

  it('still only reaches enemies inside its own range, wherever the cursor is', () => {
    // The cursor chooses among what the leap can reach; it does not extend it.
    const { owner, spell } = warwick(RANGE + 400);
    const outOfRange = unit('champion', RANGE + 400);
    indexObjects(game, [owner, outOfRange]);

    expect(spell._findTarget()).toBeNull();
    expect(spell.checkCastCondition()).toBe(false);
  });

  it('takes the only enemy in range even with the cursor pointed away', () => {
    const { owner, spell } = warwick(-900);
    const only = unit('champion', 300);
    indexObjects(game, [owner, only]);

    expect(spell._findTarget()).toBe(only);
  });
});
