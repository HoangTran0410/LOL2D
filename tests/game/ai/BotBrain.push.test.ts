import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Minion, { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import Turret from '../../../src/game/gameObject/structures/Turret';
import { BotBrain, PUSH_TURRET_ESCORT_PX } from '../../../src/game/ai/BotBrain';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import { laneApproach, type LaneState } from '../../../src/game/ai/LaneObjectives';
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

/** A MID waypoint about halfway down the lane — see the table in `lanes.ts`. */
const MID_MIDDLE = { x: 2_623, y: 3_687 };

const spawnBot = (game: TestGame, x = MID_MIDDLE.x, y = MID_MIDDLE.y) =>
  new AIChampion({ game, position: createVector(x, y), teamId: BLUE, preset: PRESET });

const spawnEnemy = (game: TestGame, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId: RED, preset: PRESET });

const spawnMinion = (game: TestGame, teamId: string, lane: string, x: number, y: number) =>
  new Minion({
    game,
    position: createVector(x, y),
    teamId,
    lane,
    waypoints: getLaneWaypoints(lane, teamId),
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
  ...over,
});

/** A view whose only content is "you are on MID, and here is what MID looks like". */
const midView = (bot: Champion, state: Partial<LaneState> = {}): TeamView =>
  view({
    lanes: new Map([[Lane.MID, laneState(state)]]),
    laneAssignments: new Map([[bot, Lane.MID]]),
  });

describe('the PUSH posture', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('pushes rather than roams once the bot has a lane', () => {
    const game = createGame();
    const bot = spawnBot(game);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    expect(new BotBrain(bot).evaluatePosture(midView(bot), 0)).toBe('PUSH');
  });

  it('still roams when nothing has given it a lane', () => {
    const game = createGame();
    const bot = spawnBot(game);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    expect(new BotBrain(bot).evaluatePosture(view(), 0)).toBe('ROAM');
  });

  it('fights an enemy champion rather than pushing, with a lane in hand', () => {
    // Decision 2, and the whole reason `findAttackTarget` stays champions-only:
    // a champion in aggro range always beats farming.
    const game = createGame();
    const bot = spawnBot(game);
    const enemy = spawnEnemy(game, MID_MIDDLE.x + 200, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    const pressing = midView(bot);
    expect(new BotBrain(bot).evaluatePosture({ ...pressing, enemies: [enemy] }, 0)).toBe('FIGHT');
  });

  it('searches a fresh sighting rather than pushing', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const seen = spawnEnemy(game, 6_000, 6_000); // far outside aggro range
    game.setPlayer(bot);
    indexObjects(game, [bot, seen]);

    const memory = new Map<Champion, SeenEnemy>([
      [
        seen,
        {
          unit: seen,
          atMs: 900,
          pos: { x: MID_MIDDLE.x + 300, y: MID_MIDDLE.y },
          vel: { x: 0, y: 0 },
        },
      ],
    ]);
    expect(new BotBrain(bot).evaluatePosture({ ...midView(bot), memory }, 1_000)).toBe('SEARCH');
  });

  it('joins an ally fight rather than pushing', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const focused = spawnEnemy(game, MID_MIDDLE.x + 800, MID_MIDDLE.y); // outside aggro 420
    const ally = new Champion({
      game,
      position: createVector(MID_MIDDLE.x + 750, MID_MIDDLE.y),
      teamId: BLUE,
      preset: PRESET,
    });
    game.setPlayer(bot);
    indexObjects(game, [bot, ally, focused]);

    expect(
      new BotBrain(bot).evaluatePosture(
        { ...midView(bot), allies: [bot, ally], enemies: [focused], focusTarget: focused },
        0
      )
    ).toBe('ENGAGE');
  });

  it('keeps pushing while it swings at a minion', () => {
    // A standing order outranks perception — but only a *champion* order. Left
    // as `basicAttack.target` alone, the first swing at a wave flips the bot
    // into FIGHT with no champion to fight, which unlocks the spell-casting
    // branch and dumps the whole kit into a melee minion.
    const game = createGame();
    const bot = spawnBot(game);
    const minion = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 60, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, minion]);
    bot.basicAttack.order(minion);
    expect(bot.basicAttack.target).toBe(minion);

    expect(new BotBrain(bot).evaluatePosture(midView(bot), 0)).toBe('PUSH');
  });
});

describe('where a pushing bot walks', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('walks to the front of its own wave first', () => {
    const game = createGame();
    const bot = spawnBot(game);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    const frontier = { x: 3_860, y: 2_799 };
    const turret = new Turret({ game, position: createVector(4_291, 2_044), teamId: RED });
    expect(
      new BotBrain(bot).pushTarget(midView(bot, { frontier, nextEnemyTurret: turret }))
    ).toEqual(frontier);
  });

  it('walks to the next enemy turret when its wave is dead', () => {
    const game = createGame();
    const bot = spawnBot(game);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    const turret = new Turret({ game, position: createVector(3_885, 2_723), teamId: RED });
    expect(new BotBrain(bot).pushTarget(midView(bot, { nextEnemyTurret: turret }))).toEqual({
      x: 3_885,
      y: 2_723,
    });
  });

  it('walks down the lane when there is neither', () => {
    const game = createGame();
    const bot = spawnBot(game);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    expect(new BotBrain(bot).pushTarget(midView(bot))).toEqual(laneApproach(Lane.MID, BLUE));
  });

  it('has nowhere to push without a lane', () => {
    const game = createGame();
    const bot = spawnBot(game);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    expect(new BotBrain(bot).pushTarget(view())).toBeNull();
  });
});

describe('objective targets', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const pushing = (game: TestGame, bot: AIChampion, state: Partial<LaneState> = {}) => {
    const brain = new BotBrain(bot);
    brain.evaluatePosture(midView(bot, state), 0);
    expect(brain.posture).toBe('PUSH');
    return brain;
  };

  it('is never asked for outside PUSH', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const minion = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 100, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, minion]);

    const brain = new BotBrain(bot);
    brain.evaluatePosture(view(), 0);
    expect(brain.posture).toBe('ROAM');
    expect(brain.findObjectiveTarget(midView(bot))).toBeNull();
  });

  it('takes the nearest enemy minion in its own lane', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const near = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 100, MID_MIDDLE.y);
    const far = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 300, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, near, far]);

    expect(pushing(game, bot).findObjectiveTarget(midView(bot))).toBe(near);
  });

  it('leaves an allied minion alone', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const ours = spawnMinion(game, BLUE, Lane.MID, MID_MIDDLE.x + 50, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, ours]);

    expect(pushing(game, bot).findObjectiveTarget(midView(bot))).toBeNull();
  });

  it('leaves a minion from another lane alone', () => {
    const game = createGame();
    const bot = spawnBot(game);
    // Standing right beside the bot, but walking BOT — a leashed straggler this
    // bot has no business chasing off its own lane.
    const stray = spawnMinion(game, RED, Lane.BOT, MID_MIDDLE.x + 100, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, stray]);

    expect(pushing(game, bot).findObjectiveTarget(midView(bot))).toBeNull();
  });

  it('leaves a jungle camp alone', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const camp = spawnEnemy(game, MID_MIDDLE.x + 100, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp]);

    // A champion is not an objective target either: that is `findAttackTarget`.
    expect(pushing(game, bot).findObjectiveTarget(midView(bot))).toBeNull();
  });

  it('hits the turret once the wave has arrived under it', () => {
    const game = createGame();
    const turretAt = { x: MID_MIDDLE.x + 300, y: MID_MIDDLE.y };
    const bot = spawnBot(game);
    const turret = new Turret({
      game,
      position: createVector(turretAt.x, turretAt.y),
      teamId: RED,
    });
    game.setPlayer(bot);
    indexObjects(game, [bot, turret]);

    const escorted = midView(bot, {
      nextEnemyTurret: turret,
      frontier: { x: turretAt.x - PUSH_TURRET_ESCORT_PX + 1, y: turretAt.y },
    });
    expect(pushing(game, bot, escorted.lanes.get(Lane.MID)!).findObjectiveTarget(escorted)).toBe(
      turret
    );
  });

  it('will not dive a turret alone', () => {
    const game = createGame();
    const turretAt = { x: MID_MIDDLE.x + 300, y: MID_MIDDLE.y };
    const bot = spawnBot(game);
    const turret = new Turret({
      game,
      position: createVector(turretAt.x, turretAt.y),
      teamId: RED,
    });
    game.setPlayer(bot);
    indexObjects(game, [bot, turret]);

    // No wave at all.
    expect(pushing(game, bot).findObjectiveTarget(midView(bot, { nextEnemyTurret: turret }))).toBe(
      null
    );

    // A wave, but it is still a screen away from the turret.
    const trailing = midView(bot, {
      nextEnemyTurret: turret,
      frontier: { x: turretAt.x - PUSH_TURRET_ESCORT_PX - 1, y: turretAt.y },
    });
    expect(pushing(game, bot).findObjectiveTarget(trailing)).toBeNull();
  });

  it('will not shoot a turret it has not walked up to yet', () => {
    const game = createGame();
    const bot = spawnBot(game);
    // 2000px down the lane: escorted by a wave, and still far out of reach.
    const turret = new Turret({ game, position: createVector(4_855, 1_664), teamId: RED });
    game.setPlayer(bot);
    indexObjects(game, [bot, turret]);

    const escorted = midView(bot, {
      nextEnemyTurret: turret,
      frontier: { x: 4_855, y: 1_664 },
    });
    expect(pushing(game, bot).findObjectiveTarget(escorted)).toBeNull();
  });

  it('prefers the wave to the turret', () => {
    const game = createGame();
    const turretAt = { x: MID_MIDDLE.x + 300, y: MID_MIDDLE.y };
    const bot = spawnBot(game);
    const turret = new Turret({
      game,
      position: createVector(turretAt.x, turretAt.y),
      teamId: RED,
    });
    const minion = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 120, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, turret, minion]);

    const escorted = midView(bot, {
      nextEnemyTurret: turret,
      frontier: { x: turretAt.x - 10, y: turretAt.y },
    });
    expect(pushing(game, bot).findObjectiveTarget(escorted)).toBe(minion);
  });
});

describe('a bot in a running match', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('takes a lane, walks it, and swings at the wave it meets', () => {
    // End to end over the real blackboard: no hand-built TeamView anywhere.
    const game = createGame();
    const bot = spawnBot(game);
    const near = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 120, MID_MIDDLE.y);
    const deeper = spawnMinion(game, RED, Lane.MID, 3_860, 2_799);
    game.setPlayer(bot);
    indexObjects(game, [bot, near, deeper]);
    game.matchTimeMs = 60_000;
    // The scan interval is jittered per bot on construction, so without this
    // the single `update()` below lands inside the jitter about half the time.
    bot._attackScanCooldown = 0;

    bot.update();

    expect(bot.brain.posture).toBe('PUSH');
    expect(bot.basicAttack.target).toBe(near);
  });

  it('never orders an attack on a minion when it is not pushing', () => {
    const game = createGame();
    const bot = spawnBot(game);
    const minion = spawnMinion(game, RED, Lane.MID, MID_MIDDLE.x + 120, MID_MIDDLE.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, minion]);
    game.matchTimeMs = 60_000;
    // Movement off is not the point; a bot the panel has parked still scans.
    bot.brain.posture = 'ROAM';
    bot._autoMove = false;
    bot._autoCast = false;

    expect(bot.findAttackTarget()).toBeNull();
  });
});
