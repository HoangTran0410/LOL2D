import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain, SEARCH_MAX_LEAD_PX } from '../../../src/game/ai/BotBrain';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
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
  lanes: new Map<string, LaneState>(),
  laneAssignments: new Map<Champion, string>(),
  enemyTurrets: [],
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

  it('retreats to the nearest living friendly turret, and recovers at arrival distance rather than moveSpeed', () => {
    // `retreatPoint()` had no coverage at all — `createGame()` supplies neither
    // `turrets` nor `fountains`, so every other retreat test exercises only the
    // "nowhere to go" fallback. This is the branch that actually carried the
    // `RETREAT_ARRIVE_PX` bug: `atRetreatPoint()` used to compare against
    // `moveSpeed * 2` (6px at the default speed of 3), but body separation
    // holds a 55px champion about 74px from a 92px turret's centre
    // (`UnitCollisionSystem` separates by the sum of the radii) — a bot
    // retreating to a turret could never arrive and never left RETREAT.
    const game = createGame();
    const bot = spawnBot(game, 'normal', 0, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    (game as unknown as { turrets: unknown[] }).turrets = [
      { teamId: RED, isDead: false, position: createVector(50, 0) }, // enemy: ignored
      { teamId: BLUE, isDead: true, position: createVector(60, 0) }, // dead ally: ignored
      { teamId: BLUE, isDead: false, position: createVector(74, 0) }, // nearest living ally
      { teamId: BLUE, isDead: false, position: createVector(500, 0) }, // farther living ally
    ];
    const brain = new BotBrain(bot);

    expect(brain.retreatPoint()).toEqual({ x: 74, y: 0 });

    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.1;
    expect(brain.evaluatePosture(view(), 0)).toBe('RETREAT'); // the first tick latches
    expect(brain.evaluatePosture(view(), 250)).toBe('RECOVER'); // 74px out — "arrived"
  });

  it('does not chase a sighting a teammate made across the map', () => {
    // `TeamView.memory` is team-wide — `TeamBlackboard` writes an entry when
    // ANY ally sees the enemy — so without a distance bound `rememberedTarget`
    // would pull this bot toward a sighting made 2000px away by a teammate in
    // a different lane, every tick.
    const game = createGame();
    const bot = spawnBot(game, 'normal', 0, 0);
    const enemy = spawnEnemy(game, 5_000, 0); // far outside aggro range now
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    // 2000px away is well past SEARCH_MAX_DISTANCE_PX (900).
    const memory = new Map<Champion, SeenEnemy>([
      [enemy, { unit: enemy, atMs: 0, pos: { x: 2_000, y: 0 }, vel: { x: 0, y: 0 } }],
    ]);
    expect(new BotBrain(bot).evaluatePosture(view({ memory }), 1_000)).toBe('ROAM');
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

/**
 * The five rules are a priority chain, and every test above isolates one of
 * them against an otherwise-empty view: the retreat tests park their enemies at
 * 900px so no FIGHT is possible, and the FIGHT test passes an empty memory and
 * no focus. Reordering the if/else chain in `decidePosture` left the whole file
 * green. These three pit two conditions against each other, so the ORDER is
 * what is asserted.
 */
describe('posture priority', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('retreats rather than fights when both rules fire at once', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal'); // retreats under 0.30, aggro range 420
    const enemy = spawnEnemy(game, 200, 0); // well inside it: a FIGHT is available
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.25;

    expect(new BotBrain(bot).evaluatePosture(view({ enemies: [enemy] }), 0)).toBe('RETREAT');
  });

  it('keeps a running attack order ahead of a fresh sighting', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    // Outside aggro range, so `pickTarget` finds nothing and the ORDER is the
    // only thing that can produce FIGHT here.
    const chased = spawnEnemy(game, 5_000, 0);
    const seen = spawnEnemy(game, 5_100, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, chased, seen]);
    bot.basicAttack.order(chased);

    const memory = new Map<Champion, SeenEnemy>([
      [seen, { unit: seen, atMs: 900, pos: { x: 300, y: 0 }, vel: { x: 0, y: 0 } }],
    ]);
    expect(new BotBrain(bot).evaluatePosture(view({ memory }), 1_000)).toBe('FIGHT');
  });

  it('investigates a fresh sighting before joining a fight it can only see second-hand', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal', 0, 0);
    const focused = spawnEnemy(game, 800, 0); // outside aggro 420: not a FIGHT
    const ally = new Champion({
      game,
      position: createVector(750, 0),
      teamId: BLUE,
      preset: PRESET,
    });
    const seen = spawnEnemy(game, 5_000, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, ally, focused, seen]);

    const memory = new Map<Champion, SeenEnemy>([
      [seen, { unit: seen, atMs: 900, pos: { x: 300, y: 0 }, vel: { x: 0, y: 0 } }],
    ]);
    expect(
      new BotBrain(bot).evaluatePosture(
        view({ allies: [bot, ally], enemies: [focused], focusTarget: focused, memory }),
        1_000
      )
    ).toBe('SEARCH');
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
