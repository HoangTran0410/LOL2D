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
  TURRET_HOSTILE_MS,
  TURRET_KEEP_OUT_PX,
} from '../../../src/game/ai/BotBrain';
import { driveTicks } from './botTrajectory';
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

describe('a bot held out of an enemy turret’s reach', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  /**
   * A hurt enemy holding the outer edge of its own turret's ring, which is
   * where a player actually stands: deep enough to be covered, near enough that
   * a bot stopped at the keep-out line still has it inside `aggroRange`. The
   * bot starts one walk short of that line, and its wave is a long way behind.
   */
  const standoff = () => {
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 700);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 300);
    // Hurt enough to be worth walking at, too healthy to be worth a dive.
    enemy.stats.health.baseValue = DIVE_LETHAL_HEALTH + 20;
    game.setPlayer(enemy);
    indexObjects(game, [bot, tower, enemy]);

    const board = view({
      enemies: [enemy],
      enemyTurrets: [tower],
      lanes: new Map([
        [
          Lane.MID,
          laneState({
            nextEnemyTurret: tower,
            // Well past `PUSH_TURRET_ESCORT_PX`, so nothing is soaking for it.
            frontier: { x: TOWER.x, y: TOWER.y + 1_100 },
          }),
        ],
      ]),
      laneAssignments: new Map([[bot, Lane.MID]]),
    });
    return { game, bot, tower, enemy, board };
  };

  /** The gun line itself, by hand — not by calling the code under test. */
  const guns = (tower: Turret, bot: Champion) => tower.attackRange + bot.stats.size.value / 2;

  it('never steps into the guns it just walked out of', () => {
    // Reported from a real match: a hurt player standing under their own turret
    // and the enemy bot pacing the edge of its range, in and out, forever —
    // two rules fighting, and legible from across the screen as a machine.
    const { bot, tower, board } = standoff();
    const walk = driveTicks(new BotBrain(bot), bot, board, 40);

    expect(walk.nearestApproachTo(TOWER)).toBeGreaterThanOrEqual(guns(tower, bot));
    // Pacing is crossings, not a single dip: the bug crossed the gun line every
    // other tick for as long as the loop ran.
    expect(walk.crossingsOf(TOWER, guns(tower, bot))).toBe(0);
  });

  it('is never rescued twice by the same disengage', () => {
    // DISENGAGE firing repeatedly is the tell: it only exists to get a bot out
    // of a place nothing should have walked it into.
    const { bot, board } = standoff();
    const walk = driveTicks(new BotBrain(bot), bot, board, 40);

    expect(walk.countOf('DISENGAGE')).toBe(0);
  });

  it('goes back to its wave rather than standing on the line', () => {
    // The other half of the fix, and the half a player reads as a decision:
    // a fight this bot may not walk to is not a fight, so the posture chain
    // falls through to the wave — which is also what eventually earns the dive.
    const { bot, board } = standoff();
    const walk = driveTicks(new BotBrain(bot), bot, board, 40);
    const away = walk.distancesFrom(TOWER);

    expect(walk.postures).toContain('PUSH');
    expect(away[away.length - 1]).toBeGreaterThan(away[0]);
    // And it settles there rather than drifting back and forth over the line.
    expect(walk.from(10).reversalsAround(TOWER)).toBe(0);
  });

  it('holds the ring on a push instead of stepping over it every other tick', () => {
    // No champion anywhere: this is the clamp on its own, and it is the half of
    // the pacing bug the posture gate cannot cover for. `pushTarget` answers
    // with the turret's own coordinates once the lane holds no friendly wave,
    // `safely()` pulls that back to the keep-out ring — and then the clamp used
    // to go quiet, because it treated a body standing on the ring as one
    // already inside it. The bot stepped in, DISENGAGE stepped it out, forever.
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 900);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower]);

    const pushing = view({
      enemyTurrets: [tower],
      lanes: new Map([[Lane.MID, laneState({ nextEnemyTurret: tower })]]),
      laneAssignments: new Map([[bot, Lane.MID]]),
    });
    const walk = driveTicks(new BotBrain(bot), bot, pushing, 40);

    expect(walk.nearestApproachTo(TOWER)).toBeGreaterThanOrEqual(guns(tower, bot));
    expect(walk.countOf('DISENGAGE')).toBe(0);
    // It does arrive — a clamp that simply never lets the bot near the building
    // would pass the two checks above and be a different bug.
    expect(walk.nearestApproachTo(TOWER)).toBeLessThan(
      keepOutRing(tower, bot) + bot.moveSpeed * 15
    );
  });

  it('does not enlist in a fight it may not walk to just because it was poked', () => {
    // The third acquisition path, and the one with no gate until the seeded
    // probe in `drive-bot-discipline.mjs` found it. `AIChampion.takeDamage`
    // hits back at whoever hit it, so a champion under their own turret could
    // hand a bot an attack order it was never allowed to have — and the attack
    // controller, which has never heard of a building, walks it in from there.
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 700);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 300);
    game.setPlayer(enemy);
    indexObjects(game, [bot, tower, enemy]);

    bot.takeDamage(5, enemy);

    expect(bot.basicAttack.target).toBeNull();
  });

  it('still hits back at an enemy standing in the open', () => {
    // The gate must not turn into a bot that never defends itself.
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 700);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 800);
    game.setPlayer(enemy);
    indexObjects(game, [bot, enemy]);

    bot.takeDamage(5, enemy);

    expect(bot.basicAttack.target).toBe(enemy);
  });

  it('does not walk straight back in the moment the turret retargets', () => {
    // The slower half of the same pacing. With a wave escorting, the bot dives,
    // `Turret.findAllyAttacker` switches the building onto it, it leaves — and
    // the instant it is out of range the building drops it, the escort rule
    // says yes again and it walks back in. A turret that has shot at this bot
    // stays hostile for `TURRET_HOSTILE_MS`, which is what a player does after
    // eating a tower shot.
    const game = createGame();
    const bot = underTheTower(game);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    const enemy = spawnEnemy(game, TOWER.x, TOWER.y + 260);
    const wave = spawnMinion(game, BLUE, TOWER.x, TOWER.y + 100);
    game.setPlayer(enemy);
    indexObjects(game, [bot, tower, enemy, wave]);

    const escorted = view({
      enemies: [enemy],
      enemyTurrets: [tower],
      lanes: new Map([
        [
          Lane.MID,
          laneState({ nextEnemyTurret: tower, frontier: { x: TOWER.x, y: TOWER.y + 100 } }),
        ],
      ]),
      laneAssignments: new Map([[bot, Lane.MID]]),
    });

    const brain = new BotBrain(bot);
    tower.target = bot;
    expect(brain.evaluatePosture(escorted, 0)).toBe('DISENGAGE');

    // The building has moved on — it fires at whatever is nearest, and the bot
    // has stepped out of reach. Nothing about the last few seconds has changed.
    tower.target = wave;
    expect(brain.evaluatePosture(escorted, 250)).toBe('DISENGAGE');

    // And not for ever: the escort is real, so the ground opens back up once
    // the bot has actually spent the time out of the guns.
    expect(brain.evaluatePosture(escorted, TURRET_HOSTILE_MS + 500)).toBe('FIGHT');
  });
});

describe('a bot whose lane objective is behind a turret it may not enter', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  /**
   * The other end of the standoff, and the one the player actually reported: no
   * enemy left to fight at all.
   *
   * A bot dives to finish someone, the fight ends — they died, or they got away
   * — and the lane it is assigned holds no friendly wave. `pushTarget` then
   * answers with the enemy turret's own coordinates, the clamp holds the bot at
   * the keep-out line, and from that moment the clamp's answer *is* where the
   * bot already stands. It re-issues a walk to its own feet, four times a
   * second, for as long as anyone watches.
   */
  const strandedAtTheRing = () => {
    const game = createGame();
    const bot = spawnBot(game, TOWER.x, TOWER.y + 1_400);
    const tower = spawnTurret(game, RED, TOWER.x, TOWER.y);
    game.setPlayer(bot);
    indexObjects(game, [bot, tower]);

    const board = view({
      enemyTurrets: [tower],
      // No `frontier`: the wave this bot was pushing with is dead, which is the
      // state that makes `pushTarget` answer with the building itself.
      lanes: new Map([[Lane.MID, laneState({ nextEnemyTurret: tower })]]),
      laneAssignments: new Map([[bot, Lane.MID]]),
      rally: { x: TOWER.x, y: TOWER.y + 2_000 },
    });
    return { game, bot, tower, board };
  };

  /** How far the body actually travelled over the tail of the walk. */
  const travelledOver = (samples: readonly { position: { x: number; y: number } }[]) => {
    let total = 0;
    for (let i = 1; i < samples.length; i += 1) {
      total += Math.hypot(
        samples[i].position.x - samples[i - 1].position.x,
        samples[i].position.y - samples[i - 1].position.y
      );
    }
    return total;
  };

  it('does not park on the keep-out line for ever', () => {
    // Reported from a real match: "bot đi vào rìa rừng rồi đứng đó luôn, không
    // đi đâu nữa một hồi lâu". The fix for a bot *pacing* that line turned the
    // oscillation into a deadlock — the clamp now refuses the inward step by
    // answering with the body's own position, and nothing above it noticed that
    // an objective it can never approach is not an objective.
    const { bot, board } = strandedAtTheRing();
    const brain = new BotBrain(bot);
    brain.rng = () => 0.5;

    const walk = driveTicks(brain, bot, board, 40);

    // The last quarter of the walk: by then it has long since reached the line.
    const settled = walk.samples.slice(30);
    expect(travelledOver(settled)).toBeGreaterThan(bot.moveSpeed * 10);
  });

  it('stops calling it a push once it cannot get any closer', () => {
    // The mechanism behind the symptom above, so a fix that merely jiggles the
    // body without fixing the decision does not pass.
    const { bot, board } = strandedAtTheRing();
    const brain = new BotBrain(bot);
    brain.rng = () => 0.5;

    const walk = driveTicks(brain, bot, board, 40);

    expect(walk.from(30).countOf('PUSH')).toBe(0);
  });

  it('still pushes a lane it can actually walk down', () => {
    // The guard must not turn every push off: with the wave in front of it, the
    // objective is the wave, the clamp never fires, and nothing changes.
    const { bot, tower, board } = strandedAtTheRing();
    const pushable = {
      ...board,
      lanes: new Map([
        [
          Lane.MID,
          laneState({ nextEnemyTurret: tower, frontier: { x: TOWER.x, y: TOWER.y + 900 } }),
        ],
      ]),
    };
    const brain = new BotBrain(bot);
    brain.rng = () => 0.5;

    const walk = driveTicks(brain, bot, pushable, 12);

    expect(walk.countOf('PUSH')).toBeGreaterThan(8);
  });
});
