import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Minion, { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import Turret from '../../../src/game/gameObject/structures/Turret';
import { blackboardFor, BLACKBOARD_TTL_MS } from '../../../src/game/ai/TeamBlackboard';
import { LANE_SWITCH_MARGIN } from '../../../src/game/ai/LaneObjectives';
import {
  getLaneWaypoints,
  Lane,
  resetLanesForTests,
  setActiveLanes,
} from '../../../src/game/lanes';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { installSummonersRiftLanesForTests } from '../lanesFixture';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};

const BLUE = TeamId.BLUE;
const RED = TeamId.RED;

/** Nobody sees anybody unless a test says so; keeps the lane maths off the fog. */
const blind = () => false;

const spawn = (game: TestGame, teamId: string, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId, preset: PRESET });

const spawnBot = (game: TestGame, teamId: string, x: number, y: number) =>
  new AIChampion({ game, position: createVector(x, y), teamId, preset: PRESET });

const spawnMinion = (game: TestGame, teamId: string, lane: string, x: number, y: number) =>
  new Minion({
    game,
    position: createVector(x, y),
    teamId,
    lane,
    waypoints: getLaneWaypoints(lane, teamId),
    preset: MinionPresets.melee,
  });

const spawnTurret = (game: TestGame, teamId: string, x: number, y: number) =>
  new Turret({ game, position: createVector(x, y), teamId });

/**
 * Real map coordinates, so the buckets are checked against the geometry the game
 * actually ships rather than a straight line invented for the test.
 *
 * MID's turret rows, out of `summoner_map.json` by way of the note at the top of
 * `lanes.ts`: blue defends 1617,4767 → 2153,4346 → 2543,3687 and red defends
 * 3885,2723 → 4291,2044 → 4790,1617. Blue's *front* turret is therefore the one
 * at 2543,3687 and the next turret blue has to break is the one at 3885,2723.
 */
const MID_BLUE_TURRETS = [
  { x: 1_617, y: 4_767 },
  { x: 2_153, y: 4_346 },
  { x: 2_543, y: 3_687 },
];
const MID_RED_TURRETS = [
  { x: 3_885, y: 2_723 },
  { x: 4_291, y: 2_044 },
  { x: 4_790, y: 1_617 },
];

describe('TeamBlackboard lanes', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('counts each side of the wave in the lane the minion says it is in', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const ours = [
      spawnMinion(game, BLUE, Lane.MID, 1_697, 4_767),
      spawnMinion(game, BLUE, Lane.MID, 2_128, 4_422),
    ];
    const theirs = [spawnMinion(game, RED, Lane.MID, 2_623, 3_687)];
    const elsewhere = spawnMinion(game, RED, Lane.TOP, 1_953, 440);
    game.setPlayer(bot);
    indexObjects(game, [bot, ...ours, ...theirs, elsewhere]);

    const mid = blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID);
    expect(mid?.alliedMinions).toBe(2);
    expect(mid?.enemyMinions).toBe(1);

    const top = blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.TOP);
    expect(top?.alliedMinions).toBe(0);
    expect(top?.enemyMinions).toBe(1);
  });

  it('reads the same wave from the other side of it', () => {
    const game = createGame();
    const bot = spawnBot(game, RED, 6_100, 375);
    const blueWave = [
      spawnMinion(game, BLUE, Lane.MID, 1_697, 4_767),
      spawnMinion(game, BLUE, Lane.MID, 2_128, 4_422),
    ];
    game.setPlayer(bot);
    indexObjects(game, [bot, ...blueWave]);

    const mid = blackboardFor(game, 0, blind).viewFor(RED).lanes.get(Lane.MID);
    expect(mid?.alliedMinions).toBe(0);
    expect(mid?.enemyMinions).toBe(2);
  });

  it('puts the frontier on the friendly minion furthest down the lane', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    // 2623,3687 is six waypoints along MID; 1697,4767 is three.
    const behind = spawnMinion(game, BLUE, Lane.MID, 1_697, 4_767);
    const ahead = spawnMinion(game, BLUE, Lane.MID, 2_623, 3_687);
    game.setPlayer(bot);
    indexObjects(game, [bot, behind, ahead]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID)?.frontier).toEqual({
      x: 2_623,
      y: 3_687,
    });
  });

  it('measures red advance from the red base, not from the blue one', () => {
    // The trap the whole `laneAdvance` helper exists for: red walks the shipped
    // path backwards, so its most advanced minion is the one with the *lowest*
    // blue-oriented progress. Reading a raw maximum here would put red's
    // frontier on the minion standing furthest back in its own base.
    const game = createGame();
    const bot = spawnBot(game, RED, 6_100, 375);
    const behind = spawnMinion(game, RED, Lane.MID, 4_855, 1_664);
    const ahead = spawnMinion(game, RED, Lane.MID, 3_860, 2_799);
    game.setPlayer(bot);
    indexObjects(game, [bot, behind, ahead]);

    expect(blackboardFor(game, 0, blind).viewFor(RED).lanes.get(Lane.MID)?.frontier).toEqual({
      x: 3_860,
      y: 2_799,
    });
  });

  it('has no frontier in a lane with no friendly wave in it', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    game.setPlayer(bot);
    indexObjects(game, [bot, spawnMinion(game, RED, Lane.MID, 2_623, 3_687)]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID)?.frontier).toBeNull();
  });

  it('names the next enemy turret and our own front one', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const ours = MID_BLUE_TURRETS.map(at => spawnTurret(game, BLUE, at.x, at.y));
    const theirs = MID_RED_TURRETS.map(at => spawnTurret(game, RED, at.x, at.y));
    game.setPlayer(bot);
    indexObjects(game, [bot, ...ours, ...theirs]);

    const mid = blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID);
    expect(mid?.nextEnemyTurret).toBe(theirs[0]);
    expect(mid?.ownTurret).toBe(ours[2]);
  });

  it('moves on to the next turret once the outer one is down', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const theirs = MID_RED_TURRETS.map(at => spawnTurret(game, RED, at.x, at.y));
    theirs[0].stats.health.baseValue = 0;
    theirs[0].die({ reviveAfter: 30_000 });
    game.setPlayer(bot);
    indexObjects(game, [bot, ...theirs]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID)?.nextEnemyTurret).toBe(
      theirs[1]
    );
  });

  it('reports the health of the two turrets that matter, as fractions', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const ours = MID_BLUE_TURRETS.map(at => spawnTurret(game, BLUE, at.x, at.y));
    const theirs = MID_RED_TURRETS.map(at => spawnTurret(game, RED, at.x, at.y));
    ours[2].stats.health.baseValue = ours[2].stats.maxHealth.value * 0.25;
    theirs[0].stats.health.baseValue = theirs[0].stats.maxHealth.value * 0.5;
    game.setPlayer(bot);
    indexObjects(game, [bot, ...ours, ...theirs]);

    const mid = blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID);
    expect(mid?.ownTurretHealthPct).toBeCloseTo(0.25, 6);
    expect(mid?.enemyTurretHealthPct).toBeCloseTo(0.5, 6);
  });

  it('reads an undefended lane as urgent rather than as quiet', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    const mid = blackboardFor(game, 0, blind).viewFor(BLUE).lanes.get(Lane.MID);
    expect(mid?.ownTurretHealthPct).toBe(0);
    expect(mid?.enemyTurretHealthPct).toBe(0);
  });

  it('counts the enemy champions standing in a lane, and only those', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const inMid = spawn(game, RED, 2_623, 3_687);
    // Deep in the top-side jungle, well past LANE_MEMBERSHIP_PX from any lane.
    const roaming = spawn(game, RED, 2_600, 2_100);
    game.setPlayer(bot);
    indexObjects(game, [bot, inMid, roaming]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);
    expect(view.lanes.get(Lane.MID)?.enemyChampions).toBe(1);
    expect(view.lanes.get(Lane.TOP)?.enemyChampions).toBe(0);
    expect(view.lanes.get(Lane.BOT)?.enemyChampions).toBe(0);
  });

  it('gives every bot a lane and leaves the human out of it', () => {
    const game = createGame();
    const human = spawn(game, BLUE, 400, 6_075);
    const first = spawnBot(game, BLUE, 400, 6_075);
    const second = spawnBot(game, BLUE, 400, 6_075);
    game.setPlayer(human);
    indexObjects(game, [human, first, second]);

    const assignments = blackboardFor(game, 0, blind).viewFor(BLUE).laneAssignments;
    expect(assignments.has(human)).toBe(false);
    expect(assignments.size).toBe(2);
    // Level lanes, so the tie goes to LANES order and roster order decides who
    // takes which — no uuid anywhere in the answer.
    expect(assignments.get(first)).toBe(Lane.TOP);
    expect(assignments.get(second)).toBe(Lane.MID);
  });

  it('keeps a bot in its lane across rebuilds while nothing much changes', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).laneAssignments.get(bot)).toBe(Lane.TOP);

    // One enemy minion appears in MID. Worth less than the switch margin, so the
    // bot stays where it is rather than walking across the map for it.
    indexObjects(game, [bot, spawnMinion(game, RED, Lane.MID, 2_623, 3_687)]);
    expect(
      blackboardFor(game, BLACKBOARD_TTL_MS, blind).viewFor(BLUE).laneAssignments.get(bot)
    ).toBe(Lane.TOP);
  });

  it('moves it once a lane is worth more than the margin', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    expect(blackboardFor(game, 0, blind).viewFor(BLUE).laneAssignments.get(bot)).toBe(Lane.TOP);

    // Two enemy champions in BOT: LANE_NEED_ENEMY_PRESENT is 6 apiece against a
    // switch margin of 8, so twelve points clears it.
    expect(LANE_SWITCH_MARGIN).toBeLessThan(12);
    indexObjects(game, [bot, spawn(game, RED, 3_075, 5_775), spawn(game, RED, 2_030, 5_837)]);
    expect(
      blackboardFor(game, BLACKBOARD_TTL_MS, blind).viewFor(BLUE).laneAssignments.get(bot)
    ).toBe(Lane.BOT);
  });

  it('answers with empty lanes for a team nobody is on', () => {
    const game = createGame();
    indexObjects(game, []);
    const view = blackboardFor(game, 0, blind).viewFor('nobody');
    expect(view.lanes.size).toBe(0);
    expect(view.laneAssignments.size).toBe(0);
  });
});

describe('the turrets a team has to keep away from', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("lists the other side's buildings and none of its own", () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    // A view exists only for a team that has a champion on it, so the red side
    // needs a body before it has anything to read.
    const foe = spawn(game, RED, 6_100, 375);
    const ours = spawnTurret(game, BLUE, MID_BLUE_TURRETS[2].x, MID_BLUE_TURRETS[2].y);
    const theirs = spawnTurret(game, RED, MID_RED_TURRETS[0].x, MID_RED_TURRETS[0].y);
    game.setPlayer(bot);
    indexObjects(game, [bot, foe, ours, theirs]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);
    expect(view.enemyTurrets).toEqual([theirs]);
    // The same buildings read from the other side, so a list that quietly
    // hard-coded one team would be caught.
    expect(blackboardFor(game, 0, blind).viewFor(RED).enemyTurrets).toEqual([ours]);
  });

  it('carries a turret that stands in no lane at all', () => {
    // `nextEnemyTurret` is bucketed by lane and a building further than
    // LANE_MEMBERSHIP_PX from every waypoint path is dropped from those buckets.
    // The threat list is not the lane economy: a turret nowhere near a lane
    // still shoots, so it has to be here.
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    // 2200,2100 is the point on this map furthest from every lane polyline —
    // 1536px out, comfortably past LANE_MEMBERSHIP_PX.
    const stray = spawnTurret(game, RED, 2_200, 2_100);
    game.setPlayer(bot);
    indexObjects(game, [bot, stray]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);
    expect(view.enemyTurrets).toEqual([stray]);
    for (const state of view.lanes.values()) expect(state.nextEnemyTurret).toBeNull();
  });

  it('drops a turret that has been destroyed', () => {
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const rubble = spawnTurret(game, RED, MID_RED_TURRETS[0].x, MID_RED_TURRETS[0].y);
    // `isDead` is `deathData !== null`, not an empty health pool — zeroing the
    // stat leaves the building standing as far as every reader is concerned.
    rubble.die({ reviveAfter: rubble.reviveTime });
    game.setPlayer(bot);
    indexObjects(game, [bot, rubble]);

    expect(rubble.isDead).toBe(true);
    expect(blackboardFor(game, 0, blind).viewFor(BLUE).enemyTurrets).toEqual([]);
  });
});

/**
 * Task 8: `LANES` is the active match's own lane set now (`lanes.ts`'s
 * `setActiveLanes`, installed by `Game`'s constructor from `map.lanes`), and
 * `TeamBlackboard.buildLanes` needed no code change to respect it — it
 * already looped the live `LANES` binding rather than a value captured at
 * import time. These tests are what proves that, end to end through a real
 * blackboard rebuild; `'the AI layer walks the whole object list exactly
 * once'` below (unmodified by this task) is what proves it did not cost a
 * second walk to get there.
 */
describe('a laneless map', () => {
  // `tests/setup.ts` installs Summoner's Rift's own lanes for every test
  // file by default now — release that guard before each test's own
  // `setActiveLanes` call below, or it throws. The `afterEach` restores
  // that same ambient install rather than leaving it empty, or any describe
  // below this one in the file silently sees a laneless match too
  // (`lanesFixture.ts`'s own doc comment explains why).
  beforeEach(() => resetLanesForTests());
  afterEach(() => {
    resetLanesForTests();
    installSummonersRiftLanesForTests();
    vi.unstubAllGlobals();
  });

  it('publishes no lane states and assigns no bot a lane', () => {
    setActiveLanes(undefined);
    stubGameGlobals();
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const minion = spawnMinion(game, RED, Lane.MID, 2_623, 3_687);
    const turret = spawnTurret(game, RED, 3_885, 2_723);
    game.setPlayer(bot);
    indexObjects(game, [bot, minion, turret]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);
    expect(view.lanes.size).toBe(0);
    expect(view.laneAssignments.size).toBe(0);
    // Nothing bucketed by lane still reaches the parts of the view that do
    // not depend on one — a turret is still a turret to keep away from.
    expect(view.enemyTurrets).toEqual([turret]);
  });

  it('buckets by whatever lane ids a different map declares, not by top/mid/bot', () => {
    setActiveLanes([
      { id: 'alpha', from: 'blue', to: 'red', waypoints: getLaneWaypoints(Lane.MID, BLUE) },
    ]);
    stubGameGlobals();
    const game = createGame();
    const bot = spawnBot(game, BLUE, 400, 6_075);
    const minion = spawnMinion(game, BLUE, 'alpha', 1_697, 4_767);
    game.setPlayer(bot);
    indexObjects(game, [bot, minion]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);
    expect([...view.lanes.keys()]).toEqual(['alpha']);
    expect(view.lanes.get('alpha')?.alliedMinions).toBe(1);
  });
});

describe('the AI layer walks the whole object list exactly once', () => {
  // The performance rule this layer was built under: the blackboard's one pass
  // is where a bot may learn about the map, and every reader of it goes through
  // the snapshot. A second `for (… of objectManager.objects)` anywhere in
  // `src/game/ai/` is five bots each walking a few thousand objects.
  //
  // `queryObjects` is not caught by this and is not meant to be — it is a
  // quadtree lookup on a bounded radius, which is what a scan is supposed to
  // become. `.queryObjects` does not contain the substring `.objects`.
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const AI_DIRECTORY = resolve(__dirname, '../../../src/game/ai');

  it('reads the full list in one file, on one line', () => {
    const modules = readdirSync(AI_DIRECTORY).filter(entry => entry.endsWith('.ts'));
    expect(modules.length).toBeGreaterThan(0);

    const readers: string[] = [];
    let total = 0;
    for (const entry of modules) {
      const source = stripComments(readFileSync(join(AI_DIRECTORY, entry), 'utf8'));
      const hits = source.match(/\.objects\b/g)?.length ?? 0;
      total += hits;
      if (hits > 0) readers.push(entry);
    }

    expect(readers).toEqual(['TeamBlackboard.ts']);
    expect(total).toBe(1);
  });
});
