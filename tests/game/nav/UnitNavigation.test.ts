import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import NavigationSystem from '../../../src/game/nav/NavigationSystem';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

/**
 * A corridor map: one wall band across the middle with a gap at the top, so
 * the only way from the bottom half to the top half is round the left end.
 */
const WALL = [
  { x: 600, y: 900 },
  { x: 2_400, y: 900 },
  { x: 2_400, y: 1_100 },
  { x: 600, y: 1_100 },
];
const MAP = 2_560;

const SOUTH = { x: 1_500, y: 1_800 };
const NORTH = { x: 1_500, y: 300 };

let game: TestGame;

const withNavigation = (): NavigationSystem => {
  const navigation = new NavigationSystem([WALL], MAP);
  game.navigation = navigation;
  return navigation;
};

describe('unit navigation', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame(MAP);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves moveTo exactly as it was, ignoring terrain', () => {
    withNavigation();
    const unit = new AttackableUnit({ game, position: createVector(SOUTH.x, SOUTH.y) });

    unit.moveTo(NORTH.x, NORTH.y);

    expect(unit.destination).toMatchObject(NORTH);
    expect(unit.pathAgent).toBeNull();
  });

  it('routes navigateTo around the wall instead of into it', () => {
    const navigation = withNavigation();
    const unit = new AttackableUnit({ game, position: createVector(SOUTH.x, SOUTH.y) });

    unit.navigateTo(NORTH.x, NORTH.y);
    expect(unit.pathAgent?.state).toBe('PENDING');

    navigation.update();
    expect(unit.pathAgent?.state).toBe('FOLLOWING');
    // the first place it is sent is round the wall, not through it
    expect(unit.destination.y).toBeGreaterThan(900);
    expect(
      navigation.isLineClear(
        SOUTH.x,
        SOUTH.y,
        unit.destination.x,
        unit.destination.y,
        unit.bodyRadius
      )
    ).toBe(true);
  });

  it('takes no search at all when the goal is in plain sight', () => {
    const navigation = withNavigation();
    const unit = new AttackableUnit({ game, position: createVector(SOUTH.x, SOUTH.y) });

    unit.navigateTo(SOUTH.x + 200, SOUTH.y);
    navigation.update();

    expect(unit.pathAgent?.state).toBe('DIRECT');
    expect(navigation.stats.totalSearches).toBe(0);
    expect(unit.destination).toMatchObject({ x: SOUTH.x + 200, y: SOUTH.y });
  });

  it('lets a straight-line order cancel a route that was running', () => {
    const navigation = withNavigation();
    const unit = new AttackableUnit({ game, position: createVector(SOUTH.x, SOUTH.y) });

    unit.navigateTo(NORTH.x, NORTH.y);
    navigation.update();
    expect(unit.pathAgent?.state).toBe('FOLLOWING');

    // a dash, a hook or a spell writing a destination must win outright
    unit.moveTo(SOUTH.x + 50, SOUTH.y);

    expect(unit.pathAgent?.state).toBe('IDLE');
    expect(unit.destination).toMatchObject({ x: SOUTH.x + 50, y: SOUTH.y });
  });

  it('drops a route on stopMovement, death and teleport', () => {
    const navigation = withNavigation();

    for (const kill of [
      (unit: AttackableUnit) => unit.stopMovement(),
      (unit: AttackableUnit) => unit.die({ reviveAfter: 1_000 }),
      (unit: AttackableUnit) => unit.teleportTo(100, 100),
    ]) {
      const unit = new AttackableUnit({ game, position: createVector(SOUTH.x, SOUTH.y) });
      unit.navigateTo(NORTH.x, NORTH.y);
      navigation.update();
      expect(unit.pathAgent?.state).toBe('FOLLOWING');

      kill(unit);
      expect(unit.pathAgent?.state).toBe('IDLE');
    }
  });

  it('bumps the movement revision for the order but not for rounding a corner', () => {
    const navigation = withNavigation();
    const unit = new AttackableUnit({ game, position: createVector(SOUTH.x, SOUTH.y) });
    unit.stats.speed.baseValue = 30;

    const before = unit.movementRevision;
    unit.navigateTo(NORTH.x, NORTH.y);
    expect(unit.movementRevision).toBe(before + 1);
    navigation.update();

    // walking the route changes the destination many times; a channelled spell
    // must not read those as fresh move orders
    const afterOrder = unit.movementRevision;
    for (let frame = 0; frame < 200; frame++) {
      unit.update();
      navigation.update();
    }
    expect(unit.movementRevision).toBe(afterOrder);
  });

  it('walks a champion round the wall to somewhere it could not see', () => {
    const navigation = withNavigation();
    const champion = new Champion({ game, position: createVector(SOUTH.x, SOUTH.y) });
    champion.stats.speed.baseValue = 20;
    game.setPlayer(champion);
    indexObjects(game, [champion]);

    champion.orderMove(NORTH.x, NORTH.y, true);

    let insideWall = false;
    for (let frame = 0; frame < 600; frame++) {
      navigation.update();
      champion.update();
      const { x, y } = champion.position;
      if (x > 600 && x < 2_400 && y > 900 && y < 1_100) insideWall = true;
      if (Math.hypot(x - NORTH.x, y - NORTH.y) < 30) break;
    }

    expect(insideWall).toBe(false);
    expect(Math.hypot(champion.position.x - NORTH.x, champion.position.y - NORTH.y)).toBeLessThan(
      30
    );
  });

  it('degrades a champion move order to a straight line with no navigation present', () => {
    const champion = new Champion({ game, position: createVector(SOUTH.x, SOUTH.y) });
    game.setPlayer(champion);
    indexObjects(game, [champion]);

    champion.orderMove(NORTH.x, NORTH.y);

    expect(champion.pathAgent).toBeNull();
    expect(champion.destination).toMatchObject(NORTH);
  });

  it('stops a bot flinching at walls now that it has a route', () => {
    const navigation = withNavigation();
    const bot = new AIChampion({ game, position: createVector(SOUTH.x, SOUTH.y) });
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    bot.navigateTo(NORTH.x, NORTH.y);
    navigation.update();
    const goal = { x: bot.pathAgent?.goalX, y: bot.pathAgent?.goalY };

    bot.onCollideWall();

    // the old behaviour was to abandon the destination for a fresh random one
    expect(bot.pathAgent?.goalX).toBe(goal.x);
    expect(bot.pathAgent?.goalY).toBe(goal.y);
  });

  it('still re-rolls a bot with no route at all when it hits a wall', () => {
    withNavigation();
    const bot = new AIChampion({ game, position: createVector(SOUTH.x, SOUTH.y) });
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    expect(bot.pathAgent).toBeNull();
    bot.onCollideWall();

    expect(bot.pathAgent).not.toBeNull();
    expect(bot.pathAgent?.state).not.toBe('IDLE');
  });

  it('only ever wanders a bot to ground it can stand on', () => {
    const navigation = withNavigation();
    const bot = new AIChampion({ game, position: createVector(SOUTH.x, SOUTH.y) });
    game.setPlayer(bot);
    indexObjects(game, [bot]);

    let rolled = 0;
    for (let i = 0; i < 200; i++) {
      bot.moveToRandomLocation();
      const agent = bot.pathAgent;
      if (!agent || !agent.isActive) continue;
      rolled++;
      expect(navigation.grid.isWalkable(agent.goalX, agent.goalY, bot.bodyRadius)).toBe(true);
    }
    expect(rolled).toBeGreaterThan(50);
  });

  it('leashes a camp home around terrain rather than into it', () => {
    const navigation = withNavigation();
    const monster = new Monster({
      game,
      preset: {
        name: 'Test',
        avatar: TEST_AVATAR_KEY,
        camp: { x: NORTH.x, y: NORTH.y, r: 900 },
        speed: 12,
        size: 60,
        attackRange: 100,
        reviveTime: 1_000,
        health: 500,
      },
    });
    monster.position.set(SOUTH.x, SOUTH.y);
    game.setPlayer(monster);
    indexObjects(game, [monster]);

    monster.goBackToCamp();
    expect(monster.pathAgent?.state).toBe('PENDING');

    navigation.update();
    expect(monster.pathAgent?.state).toBe('FOLLOWING');
    expect(
      navigation.isLineClear(
        monster.position.x,
        monster.position.y,
        monster.destination.x,
        monster.destination.y,
        monster.bodyRadius
      )
    ).toBe(true);
  });
});
