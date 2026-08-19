import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Minion, { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import Turret from '../../../src/game/gameObject/structures/Turret';
import {
  BotBrain,
  DIVE_LETHAL_HEALTH,
  PUSH_TURRET_ESCORT_PX,
  TURRET_KEEP_OUT_PX,
} from '../../../src/game/ai/BotBrain';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
import { getLaneWaypoints, Lane } from '../../../src/game/lanes';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = TeamId.BLUE;
const RED = TeamId.RED;

/** Open ground well away from every wall and lane, so only the maths is under test. */
const TOWER = { x: 2_200, y: 2_100 };

const spawnBot = (game: TestGame, x: number, y: number) =>
  new AIChampion({ game, position: createVector(x, y), teamId: BLUE, preset: PRESET });

const spawnEnemy = (game: TestGame, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId: RED, preset: PRESET });

const spawnTurret = (game: TestGame, teamId: string, x: number, y: number) =>
  new Turret({ game, position: createVector(x, y), teamId });

const spawnMinion = (game: TestGame, teamId: string, x: number, y: number) =>
  new Minion({
    game,
    position: createVector(x, y),
    teamId,
    lane: Lane.MID,
    waypoints: getLaneWaypoints(Lane.MID, teamId),
    preset: MinionPresets.melee,
  });

const laneState = (over: Partial<LaneState> = {}): LaneState => ({
  lane: Lane.MID,
  alliedMinions: 0,
  enemyMinions: 0,
  frontier: null,
  nextEnemyTurret: null,
  ownTurret: null,
  ownTurretHealthPct: 1,
  enemyTurretHealthPct: 1,
  enemyChampions: 0,
  need: 0,
  ...over,
});

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

/**
 * The ring the bot must not cross, worked out by hand rather than by calling
 * `TurretThreat` — a transform asked to verify itself agrees with itself
 * however wrong it is (CLAUDE.md).
 */
const keepOutRing = (turret: Turret, bot: Champion): number =>
  turret.attackRange + bot.stats.size.value / 2 + TURRET_KEEP_OUT_PX;

const distanceToTower = (unit: Champion) =>
  Math.hypot(unit.destination.x - TOWER.x, unit.destination.y - TOWER.y);

/** A bot standing 300px south of the tower — well inside a 430 reach. */
const underTheTower = (game: TestGame) => spawnBot(game, TOWER.x, TOWER.y + 300);

describe('a bot inside an enemy turret’s reach', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('disengages instead of fighting', () => {
    // The bug this whole layer exists for: the bot has a perfectly good enemy
    // to fight and is standing in the guns, and used to just stand there.
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 200);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, enemy]);

    const board = view({ enemies: [enemy], enemyTurrets: [tower] });
    expect(new BotBrain(bot).evaluatePosture(board, 0)).toBe('DISENGAGE');
  });

  it('fights on when its own wave is under the turret soaking the shots', () => {
    // A turret shoots minions before champions (`Turret.findTarget`), so a wave
    // standing under it is what makes the ground safe enough to hold.
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 200);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, enemy]);

    const escorted = view({
      enemies: [enemy],
      enemyTurrets: [tower],
      lanes: new Map([
        [
          Lane.MID,
          laneState({
            nextEnemyTurret: tower,
            frontier: { x: TOWER.x, y: TOWER.y + PUSH_TURRET_ESCORT_PX - 10 },
          }),
        ],
      ]),
    });
    expect(new BotBrain(bot).evaluatePosture(escorted, 0)).toBe('FIGHT');
  });

  it('leaves anyway once the turret has switched onto it', () => {
    // An escort is only worth anything while the building is busy with it.
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 200);
    const wave = spawnMinion(game, BLUE, TOWER.x, TOWER.y + 100);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, enemy, wave]);
    tower.target = bot;

    const escorted = view({
      enemies: [enemy],
      enemyTurrets: [tower],
      lanes: new Map([
        [
          Lane.MID,
          laneState({ nextEnemyTurret: tower, frontier: { x: TOWER.x, y: TOWER.y + 60 } }),
        ],
      ]),
    });
    expect(new BotBrain(bot).evaluatePosture(escorted, 0)).toBe('DISENGAGE');
  });

  it('dives for a kill that is actually there', () => {
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 200);
    enemy.stats.health.baseValue = DIVE_LETHAL_HEALTH - 1;
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, enemy]);

    const board = view({ enemies: [enemy], enemyTurrets: [tower] });
    expect(new BotBrain(bot).evaluatePosture(board, 0)).toBe('FIGHT');
  });

  it('will not dive on a sliver of health of its own', () => {
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 200);
    enemy.stats.health.baseValue = DIVE_LETHAL_HEALTH - 1;
    // Above `normal`'s 0.30 retreat threshold, so RETREAT is not what answers
    // here — this is the dive rule refusing on its own terms.
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.4;
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, enemy]);

    const board = view({ enemies: [enemy], enemyTurrets: [tower] });
    expect(new BotBrain(bot).evaluatePosture(board, 0)).toBe('DISENGAGE');
  });

  it('gets out of the guns before it heads home, even at 10% health', () => {
    // This rule sat below the health retreat first, which reads sensibly and is
    // wrong: RETREAT walks a straight line to the nearest friendly turret and
    // is deliberately not clamped, so a bot the turret had shot below its
    // threshold stopped disengaging and walked home *through* the ring.
    // `drive-bot-discipline.mjs` planted a full-health bot 150px inside one and
    // watched it end up 228px inside one, dead. Leaving is the first leg of
    // going home, not an alternative to it.
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.1;
    game.setPlayer(bot);
    indexObjects(game, [bot, tower]);

    expect(new BotBrain(bot).evaluatePosture(view({ enemyTurrets: [tower] }), 0)).toBe('DISENGAGE');
  });

  it('resumes the way home once it is clear of the ring', () => {
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 1_500);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const home = spawnTurret(game, BLUE, TOWER.x, TOWER.y + 3_000);
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.1;
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, home]);
    (game as unknown as { turrets: Turret[] }).turrets = [home, tower];

    expect(new BotBrain(bot).evaluatePosture(view({ enemyTurrets: [tower] }), 0)).toBe('RETREAT');
  });

  it('walks out past the ring when it disengages', () => {
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower]);

    const board = view({ enemyTurrets: [tower] });
    new BotBrain(bot).drive('DISENGAGE', board, null, 0);

    expect(distanceToTower(bot)).toBeGreaterThanOrEqual(keepOutRing(tower, bot) - 0.01);
  });
});

describe('a bot walking toward an enemy turret', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('stops at the ring instead of pushing onto the building', () => {
    // Exactly the shipped bug: an empty lane makes `pushTarget` answer with the
    // turret's own coordinates, and `drive` used to walk straight to them —
    // while `findObjectiveTarget`, which has an escort rule, gave the bot
    // nothing to shoot. It stood in the guns doing nothing.
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 1_500);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower]);

    const pushing = view({
      enemyTurrets: [tower],
      lanes: new Map([[Lane.MID, laneState({ nextEnemyTurret: tower })]]),
      laneAssignments: new Map([[bot, Lane.MID]]),
    });
    new BotBrain(bot).drive('PUSH', pushing, null, 0);

    expect(distanceToTower(bot)).toBeGreaterThanOrEqual(keepOutRing(tower, bot) - 0.01);
  });

  it('will not chase a champion under the turret past the ring', () => {
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 1_500);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 50);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, enemy]);

    new BotBrain(bot).drive('FIGHT', view({ enemyTurrets: [tower] }), enemy, 0);

    expect(distanceToTower(bot)).toBeGreaterThanOrEqual(keepOutRing(tower, bot) - 0.01);
  });

  it('chases normally when no turret is in the way', () => {
    // The clamp must not become a bot that never commits to anything.
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 1_500);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 1_300);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    new BotBrain(bot).drive('FIGHT', view(), enemy, 0);

    expect(bot.destination.x).toBe(enemy.position.x);
    expect(bot.destination.y).toBe(enemy.position.y);
  });

  it('is not held back by the ring on the way home', () => {
    // A retreat walks away from danger by construction, and clamping it would
    // strand a bot that has to cross a ring to reach its own turret.
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y - 200);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const home = spawnTurret(game, BLUE, TOWER.x, TOWER.y + 2_000);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower, home]);
    (game as unknown as { turrets: Turret[] }).turrets = [home, tower];

    new BotBrain(bot).drive('RETREAT', view({ enemyTurrets: [tower] }), null, 0);

    expect(bot.destination.x).toBe(home.position.x);
    expect(bot.destination.y).toBe(home.position.y);
  });
});
