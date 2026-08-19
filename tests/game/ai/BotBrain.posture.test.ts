import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain, SEARCH_MAX_LEAD_PX } from '../../../src/game/ai/BotBrain';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';

const spawnBot = (game: TestGame, difficulty: 'easy' | 'normal' | 'hard', x = 0, y = 0) =>
  new AIChampion({ game, position: createVector(x, y), teamId: BLUE, preset: PRESET, difficulty });

const spawnEnemy = (game: TestGame, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId: RED, preset: PRESET });

const view = (over: Partial<TeamView> = {}): TeamView => ({
  allies: [],
  enemies: [],
  focusTarget: null,
  rally: null,
  memory: new Map<Champion, SeenEnemy>(),
  ...over,
});

describe('posture', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('roams when there is nothing to do', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    expect(new BotBrain(bot).evaluatePosture(view(), 0)).toBe('ROAM');
  });

  it('fights an enemy it can perceive', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const enemy = spawnEnemy(game, 200, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);
    expect(new BotBrain(bot).evaluatePosture(view({ enemies: [enemy] }), 0)).toBe('FIGHT');
  });

  it('keeps fighting while an attack order runs, even with nobody in sight', () => {
    // The regression this exists to prevent: `BasicAttackController.canKeep` has
    // no vision check, so the ORDER survives a bush. Without this rule the bot
    // would chase and simultaneously behave as though it were out for a stroll.
    const game = createGame();
    const bot = spawnBot(game, 'easy');
    const enemy = spawnEnemy(game, 200, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);
    bot.basicAttack.order(enemy);

    const brain = new BotBrain(bot);
    brain.sees = () => false; // easy bot, target now behind terrain
    expect(brain.evaluatePosture(view({ enemies: [enemy] }), 0)).toBe('FIGHT');
  });

  it('retreats below the tier health threshold', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal'); // retreats under 0.30
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.25;
    expect(new BotBrain(bot).evaluatePosture(view(), 0)).toBe('RETREAT');
  });

  it('retreats when outnumbered by two even at 55% health', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const mates = [bot];
    const foes = [spawnEnemy(game, 900, 0), spawnEnemy(game, 920, 0), spawnEnemy(game, 940, 0)];
    game.setPlayer(bot);
    indexObjects(game, [bot, ...foes]);
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.55;
    expect(new BotBrain(bot).evaluatePosture(view({ allies: mates, enemies: foes }), 0)).toBe(
      'RETREAT'
    );
  });

  it('holds the retreat until BOTH health and mana are back', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    // Without somewhere to run to, `retreatPoint()` is null, `atRetreatPoint()`
    // is true, and every retreat reads as RECOVER — correct behaviour (a bot
    // with nowhere to go recovers where it stands) but it collapses the two
    // states this test is about. Give it a fountain far away.
    (game as unknown as { fountains: unknown[] }).fountains = [
      { teamId: BLUE, position: createVector(5_000, 5_000) },
    ];
    const brain = new BotBrain(bot);

    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.1;
    expect(brain.evaluatePosture(view(), 0)).toBe('RETREAT');

    // Health back above the retreat threshold but not above the recover one:
    // without the latch this flips straight back to ROAM and the bot yo-yos.
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.35;
    expect(brain.evaluatePosture(view(), 250)).toBe('RETREAT');

    // Health fine, mana empty — still recovering. This is the "cụt tay" half.
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.95;
    bot.stats.mana.baseValue = bot.stats.maxMana.value * 0.1;
    expect(brain.evaluatePosture(view(), 500)).toBe('RETREAT');

    bot.stats.mana.baseValue = bot.stats.maxMana.value * 0.8;
    expect(brain.evaluatePosture(view(), 750)).toBe('ROAM');
  });

  it('recovers in place when there is nowhere to retreat to', () => {
    const game = createGame(); // no fountains, no turrets
    const bot = spawnBot(game, 'normal');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.1;

    const brain = new BotBrain(bot);
    expect(brain.evaluatePosture(view(), 0)).toBe('RETREAT'); // the first tick latches
    expect(brain.evaluatePosture(view(), 250)).toBe('RECOVER'); // already "there"
  });

  it('searches toward a fresh memory when it can see nobody', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const enemy = spawnEnemy(game, 5_000, 0); // far outside aggro range now
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    const memory = new Map<Champion, SeenEnemy>([
      [enemy, { unit: enemy, atMs: 0, pos: { x: 300, y: 0 }, vel: { x: 0, y: 0 } }],
    ]);
    expect(new BotBrain(bot).evaluatePosture(view({ memory }), 1_000)).toBe('SEARCH');
  });

  it('stops searching once the memory is older than the tier remembers', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal'); // memoryTtlMs 2500
    const enemy = spawnEnemy(game, 5_000, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    const memory = new Map<Champion, SeenEnemy>([
      [enemy, { unit: enemy, atMs: 0, pos: { x: 300, y: 0 }, vel: { x: 0, y: 0 } }],
    ]);
    expect(new BotBrain(bot).evaluatePosture(view({ memory }), 2_501)).toBe('ROAM');
  });

  it('engages a focus target an ally is fighting', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal', 0, 0);
    const focused = spawnEnemy(game, 650, 0);
    const ally = new Champion({
      game,
      position: createVector(600, 0),
      teamId: BLUE,
      preset: PRESET,
    });
    game.setPlayer(bot);
    indexObjects(game, [bot, ally, focused]);

    expect(
      new BotBrain(bot).evaluatePosture(
        view({ allies: [bot, ally], enemies: [focused], focusTarget: focused }),
        0
      )
    ).toBe('ENGAGE');
  });
});

describe('search point', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('extrapolates along the heading the enemy was last seen taking', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const enemy = spawnEnemy(game, 0, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    // 500ms at 60fps is exactly 30 frames (500 * 60 / 1000). Velocity is
    // 4px/frame due south, so the lead is 4 * 30 = 120px, by hand.
    const point = new BotBrain(bot).searchPoint(
      { unit: enemy, atMs: 0, pos: { x: 300, y: 0 }, vel: { x: 0, y: 4 } },
      500
    );
    expect(point.x).toBeCloseTo(300, 6);
    expect(point.y).toBeCloseTo(120, 6);
  });

  it('caps the extrapolation so a stale memory does not send it across the map', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const enemy = spawnEnemy(game, 0, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    const point = new BotBrain(bot).searchPoint(
      { unit: enemy, atMs: 0, pos: { x: 300, y: 0 }, vel: { x: 0, y: 4 } },
      100_000
    );
    expect(point.y).toBeCloseTo(SEARCH_MAX_LEAD_PX, 6);
  });
});
