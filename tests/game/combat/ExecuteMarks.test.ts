/**
 * The promise the mark makes.
 *
 * `drawExecuteMarks` paints a ring on every enemy the player's ready execute
 * spells would kill. The whole value of that is that it is *true* — a mark on
 * someone who survives the cast is worse than no mark, because it is the thing
 * the player last-hits by. So the set it paints is the set `pickExecuteTarget`
 * would choose from, computed by the same two methods, and it goes empty the
 * moment the spell cannot actually be cast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import ChoGath_R from '../../../src/game/gameObject/spells/ChoGath_R';
import Nasus_Q from '../../../src/game/gameObject/spells/Nasus_Q';
import Flash from '../../../src/game/gameObject/spells/Flash';
import SpellState from '../../../src/game/enums/SpellState';
import { executeMarks, executeMarkTargets } from '../../../src/game/combat/ExecuteMarks';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const caster = (): Champion => {
  const unit = new Champion({ game, teamId: 'caster' });
  unit.position.set(0, 0);
  unit.destination.set(0, 0);
  unit.stats.mana.baseValue = 500;
  unit.stats.maxMana.baseValue = 500;
  game.setPlayer(unit);
  return unit;
};

const enemy = (x: number, health: number): Champion => {
  const unit = new Champion({ game, teamId: `enemy-${x}` });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  unit.stats.maxHealth.baseValue = 100;
  unit.stats.health.baseValue = health;
  return unit;
};

describe('executeMarkTargets', () => {
  it('marks the enemy a ready execute spell would finish', () => {
    const nasus = caster();
    const doomed = enemy(60, 8);
    nasus.spells = [new Nasus_Q(nasus)];
    indexObjects(game, [nasus, doomed]);

    expect(executeMarkTargets(nasus)).toEqual([doomed]);
  });

  it('marks nobody who survives the cast', () => {
    const nasus = caster();
    const healthy = enemy(60, 100);
    nasus.spells = [new Nasus_Q(nasus)];
    indexObjects(game, [nasus, healthy]);

    expect(executeMarkTargets(nasus)).toEqual([]);
  });

  it('stays on through the cooldown, and says the key is not live', () => {
    // Measured, not argued: gating the mark on `isCastableNow` left it visible
    // for 7 frames out of 481 while Q was being spammed, every blank frame down
    // to `state === COOLDOWN`. "Who can I finish next" is the question you are
    // asking *while* the ability is down.
    const nasus = caster();
    const doomed = enemy(60, 8);
    const spell = new Nasus_Q(nasus);
    nasus.spells = [spell];
    indexObjects(game, [nasus, doomed]);

    expect(executeMarks(nasus)).toEqual([{ unit: doomed, ready: true }]);

    spell.state = SpellState.COOLDOWN;
    expect(executeMarks(nasus)).toEqual([{ unit: doomed, ready: false }]);
  });

  it('does the same when the pool cannot pay for the cast', () => {
    const chogath = caster();
    const doomed = enemy(80, 8);
    const spell = new ChoGath_R(chogath);
    chogath.spells = [spell];
    indexObjects(game, [chogath, doomed]);

    expect(executeMarks(chogath)).toEqual([{ unit: doomed, ready: true }]);
    chogath.stats.mana.baseValue = spell.manaCost - 1;
    expect(executeMarks(chogath)).toEqual([{ unit: doomed, ready: false }]);
  });

  it('drops a spell the match has switched off entirely', () => {
    const nasus = caster();
    const doomed = enemy(60, 8);
    const spell = new Nasus_Q(nasus);
    spell.disabled = true;
    nasus.spells = [spell];
    indexObjects(game, [nasus, doomed]);

    expect(executeMarks(nasus)).toEqual([]);
  });

  it('reports one mark as live when either spell that finds it is up', () => {
    const hybrid = caster();
    const doomed = enemy(70, 8);
    const down = new Nasus_Q(hybrid);
    down.state = SpellState.COOLDOWN;
    hybrid.spells = [down, new ChoGath_R(hybrid)];
    indexObjects(game, [hybrid, doomed]);

    expect(executeMarks(hybrid)).toEqual([{ unit: doomed, ready: true }]);
  });

  it('marks a unit once even when two spells could finish it', () => {
    const hybrid = caster();
    const doomed = enemy(70, 8);
    hybrid.spells = [new Nasus_Q(hybrid), new ChoGath_R(hybrid)];
    indexObjects(game, [hybrid, doomed]);

    expect(executeMarkTargets(hybrid)).toEqual([doomed]);
  });

  it('ignores spells that are not execute spells at all', () => {
    const blinker = caster();
    const doomed = enemy(60, 8);
    blinker.spells = [new Flash(blinker)];
    indexObjects(game, [blinker, doomed]);

    expect(executeMarkTargets(blinker)).toEqual([]);
  });

  it('goes quiet while the caster is dead', () => {
    const nasus = caster();
    const doomed = enemy(60, 8);
    nasus.spells = [new Nasus_Q(nasus)];
    indexObjects(game, [nasus, doomed]);

    nasus.die({ attacker: undefined, reviveAfter: 5_000 });
    expect(executeMarkTargets(nasus)).toEqual([]);
  });
});
