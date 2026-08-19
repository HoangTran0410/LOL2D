import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain, KITE_COMMIT_MS, KITE_STEP_PX } from '../../../src/game/ai/BotBrain';
import { MELEE_RANGE_THRESHOLD } from '../../../src/game/combat/BasicAttack';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const BLUE = 'team-blue';
const RED = 'team-red';

/** Comfortably over `MELEE_RANGE_THRESHOLD`, which is what makes a unit ranged. */
const RANGED_REACH = 500;

const preset = (range: number): ChampionPresetData => ({
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range },
});

const spawnBot = (game: TestGame, range: number) =>
  new AIChampion({ game, position: createVector(0, 0), teamId: BLUE, preset: preset(range) });

const spawnEnemy = (game: TestGame, x: number) =>
  new Champion({ game, position: createVector(x, 0), teamId: RED, preset: preset(100) });

const view = (over: Partial<TeamView> = {}): TeamView => ({
  allies: [],
  enemies: [],
  focusTarget: null,
  rally: null,
  memory: new Map<Champion, SeenEnemy>(),
  lanes: new Map<string, LaneState>(),
  laneAssignments: new Map<Champion, string>(),
  enemyTurrets: [],
  ...over,
});

/** A bot with a live attack order on an enemy 100px to its right. */
const trading = (range: number, cooldownMs: number) => {
  const game = createGame();
  const bot = spawnBot(game, range);
  const enemy = spawnEnemy(game, 100);
  game.setPlayer(bot);
  indexObjects(game, [bot, enemy]);
  bot.basicAttack.order(enemy);
  bot.basicAttack.cooldownMs = cooldownMs;
  return { game, bot, enemy, brain: new BotBrain(bot) };
};

describe('kiting', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('steps a ranged bot back through the gap between its own swings', () => {
    const { bot, enemy, brain } = trading(RANGED_REACH, 500);
    expect(RANGED_REACH).toBeGreaterThan(MELEE_RANGE_THRESHOLD);

    brain.drive('FIGHT', view(), enemy, 0);

    // Directly away from the enemy, one full step: the enemy is at +100 on x,
    // so the bot at the origin walks to -KITE_STEP_PX. Written out rather than
    // recomputed from the helper it is checking.
    expect(bot.destination.x).toBeCloseTo(-KITE_STEP_PX, 6);
    expect(bot.destination.y).toBeCloseTo(0, 6);
  });

  it('opens the window the attack controller needs to let it happen', () => {
    // Without this the controller calls `stopMovement()` on the very next frame
    // — it plants any unit already within reach — and the step never happens.
    const { bot, enemy, brain } = trading(RANGED_REACH, 500);

    brain.drive('FIGHT', view(), enemy, 0);

    expect(bot.basicAttack.repositionMs).toBeGreaterThan(0);
  });

  it('plants instead of stepping when the swing is about to land', () => {
    const { bot, enemy, brain } = trading(RANGED_REACH, KITE_COMMIT_MS - 1);

    brain.drive('FIGHT', view(), enemy, 0);

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
    expect(bot.basicAttack.repositionMs).toBe(0);
  });

  it('never backs a melee bot out of its own reach', () => {
    // Melee damage is standing next to somebody. A melee champion that kited
    // would simply never land a hit.
    const { bot, enemy, brain } = trading(100, 500);
    expect(100).toBeLessThanOrEqual(MELEE_RANGE_THRESHOLD);

    brain.drive('FIGHT', view(), enemy, 0);

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
  });

  it('stops stepping once it has reached its spacing', () => {
    // At 460 of a 555 reach the hold line (85%, 471.75) is one short step away,
    // so the step is trimmed rather than taken whole — and past the line there
    // is no step at all, because the controller chases anything further out.
    const game = createGame();
    const bot = spawnBot(game, RANGED_REACH);
    const enemy = spawnEnemy(game, 540);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);
    bot.basicAttack.order(enemy);
    bot.basicAttack.cooldownMs = 500;

    new BotBrain(bot).drive('FIGHT', view(), enemy, 0);

    expect(bot.destination.x).toBe(0);
    expect(bot.destination.y).toBe(0);
  });
});

describe('the attack controller during a reposition', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the step alone while the swing is still on cooldown', () => {
    const { bot } = trading(RANGED_REACH, 500);
    bot.basicAttack.repositionMs = 300;
    bot.navigateTo(-KITE_STEP_PX, 0);

    bot.basicAttack.update();

    expect(bot.destination.x).toBe(-KITE_STEP_PX);
  });

  it('plants and fires the moment the swing comes ready, window or not', () => {
    // The window must never turn a kiting bot into one that runs instead of
    // shooting: the swing wins, and closes the window with it.
    const { bot } = trading(RANGED_REACH, 0);
    bot.basicAttack.repositionMs = 300;
    bot.navigateTo(-KITE_STEP_PX, 0);

    bot.basicAttack.update();

    expect(bot.destination.x).toBe(bot.position.x);
    expect(bot.basicAttack.repositionMs).toBe(0);
    expect(bot.basicAttack.cooldownMs).toBeGreaterThan(0);
  });
});
