import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import type { ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame, stubGameGlobals } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};

/** Where every wander roll lands while `random` is pinned, so it is not (0,0). */
const ROLL = 1234;

const makeBot = (autoMove: boolean) => {
  const game = createGame();
  const bot = new AIChampion({ game, position: createVector(0, 0), preset: PRESET, autoMove });
  game.setPlayer(bot);
  // No navigation in the fixture, so `moveToRandomLocation` lands straight in
  // `moveTo` and the wander is visible as `destination` alone.
  return bot;
};

describe('a bot with movement switched off stays put', () => {
  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('random', () => ROLL);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not wander when it is hit', () => {
    const bot = makeBot(false);

    bot.takeDamage(5);

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
  });

  it('does not wander when it walks into a wall', () => {
    const bot = makeBot(false);

    bot.onCollideWall();

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
  });

  it('does not wander when it reaches the map edge', () => {
    const bot = makeBot(false);

    bot.onCollideMapEdge();

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
  });

  it('still wanders on terrain when movement is on', () => {
    for (const react of [
      (bot: AIChampion) => bot.onCollideWall(),
      (bot: AIChampion) => bot.onCollideMapEdge(),
    ]) {
      const bot = makeBot(true);

      react(bot);

      expect(bot.destination.x).toBe(ROLL);
      expect(bot.destination.y).toBe(ROLL);
    }
  });

  it('does not flinch across the map when it is hit, even with movement on', () => {
    // `_autoMoveOnTakeDamage` is the one reflex that ships off. `BotBrain`
    // answers "I am being hurt" with a posture — RETREAT to the nearest
    // friendly turret, DISENGAGE out of a turret's reach — and a random point
    // on the whole map is as likely to be deeper into the danger as out of it.
    const bot = makeBot(true);

    bot.takeDamage(5);

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
  });

  it('flinches again for anyone who switches the reflex back on', () => {
    const bot = makeBot(true);
    bot._autoMoveOnTakeDamage = true;

    bot.takeDamage(5);

    expect(bot.destination.x).toBe(ROLL);
    expect(bot.destination.y).toBe(ROLL);
  });
});
