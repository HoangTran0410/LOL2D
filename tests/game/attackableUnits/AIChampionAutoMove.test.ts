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

  it('still wanders on all three when movement is on', () => {
    for (const react of [
      (bot: AIChampion) => bot.takeDamage(5),
      (bot: AIChampion) => bot.onCollideWall(),
      (bot: AIChampion) => bot.onCollideMapEdge(),
    ]) {
      const bot = makeBot(true);

      react(bot);

      expect(bot.destination.x).toBe(ROLL);
      expect(bot.destination.y).toBe(ROLL);
    }
  });
});
