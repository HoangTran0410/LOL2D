import { describe, expect, it } from 'vitest';
import NavGrid from '../../../src/game/nav/NavGrid';
import NavigationSystem, {
  NAV_MAX_NODES_PER_FRAME,
  NAV_MAX_SEARCHES_PER_FRAME,
} from '../../../src/game/nav/NavigationSystem';
import PathAgent, {
  NAV_GOAL_TOLERANCE,
  NAV_REPLAN_INTERVAL_MS,
  type PathAgentHost,
} from '../../../src/game/nav/PathAgent';
import { wallPolygons } from './geometry';

const MAP_SIZE = 6_400;
const CHAMPION_RADIUS = 27.5;
const REAL_WALLS = wallPolygons.map(polygon => polygon.map(([x, y]) => ({ x, y })));

const createNavigation = () => new NavigationSystem(REAL_WALLS, MAP_SIZE);

/** One sealed box: the inside is perfectly standable and perfectly unreachable. */
const sealedRoomWalls = [
  [
    { x: 900, y: 900 },
    { x: 1_500, y: 900 },
    { x: 1_500, y: 940 },
    { x: 900, y: 940 },
  ],
  [
    { x: 900, y: 900 },
    { x: 940, y: 900 },
    { x: 940, y: 1_500 },
    { x: 900, y: 1_500 },
  ],
  [
    { x: 900, y: 1_460 },
    { x: 1_500, y: 1_460 },
    { x: 1_500, y: 1_500 },
    { x: 900, y: 1_500 },
  ],
  [
    { x: 1_460, y: 900 },
    { x: 1_500, y: 900 },
    { x: 1_500, y: 1_500 },
    { x: 1_460, y: 1_500 },
  ],
];

class TestHost implements PathAgentHost {
  position: { x: number; y: number };
  destination: { x: number; y: number; set(x: number, y: number): unknown };
  // A champion is under NAV_MAX_TERRAIN_RADIUS, so for this host the capped
  // terrain radius and the real body radius are the same number — see
  // AttackableUnit.terrainRadius for the two that differ.
  terrainRadius = CHAMPION_RADIUS;
  moveSpeed = 3;

  constructor(x: number, y: number) {
    this.position = { x, y };
    this.destination = {
      x,
      y,
      set(nx: number, ny: number) {
        this.x = nx;
        this.y = ny;
        return this;
      },
    };
  }

  /** Walks one step towards the destination, the way AttackableUnit.move does. */
  step(times = 1): void {
    for (let i = 0; i < times; i++) {
      const dx = this.destination.x - this.position.x;
      const dy = this.destination.y - this.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= this.moveSpeed) {
        this.position.x = this.destination.x;
        this.position.y = this.destination.y;
        continue;
      }
      this.position.x += (dx / distance) * this.moveSpeed;
      this.position.y += (dy / distance) * this.moveSpeed;
    }
  }
}

describe('NavigationSystem', () => {
  it('builds the static structure once, cheaply, and holds it in kilobytes', () => {
    const navigation = createNavigation();
    expect(navigation.stats.cols).toBe(navigation.grid.cols);
    expect(navigation.stats.buildMs).toBeGreaterThanOrEqual(0);
    // grid plus the reusable search buffers, for the whole game
    expect(navigation.stats.memoryBytes).toBeLessThan(4 * 1024 * 1024);
  });

  it('answers a clear line without running a search at all', () => {
    const navigation = createNavigation();
    // open ground near the blue base, with nothing in between
    const host = new TestHost(1_617, 4_767);
    const agent = new PathAgent(host, navigation);
    expect(navigation.isLineClear(1_617, 4_767, 2_153, 4_346, CHAMPION_RADIUS)).toBe(true);

    agent.order(2_153, 4_346);
    navigation.update();

    expect(agent.state).toBe('DIRECT');
    expect(navigation.stats.totalSearches).toBe(0);
    expect(navigation.stats.directOrders).toBe(1);
    expect(host.destination).toMatchObject({ x: 2_153, y: 4_346 });
  });

  it('runs one search for an order the straight line cannot serve', () => {
    const navigation = createNavigation();
    const host = new TestHost(400, 6_075);
    const agent = new PathAgent(host, navigation);

    agent.order(6_100, 375);
    expect(agent.state).toBe('PENDING');
    expect(navigation.stats.totalSearches).toBe(0);

    navigation.update();

    expect(agent.state).toBe('FOLLOWING');
    expect(navigation.stats.totalSearches).toBe(1);
    expect(navigation.stats.searchedOrders).toBe(1);
    expect(agent.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it('holds the per-frame search budget when everything asks at once', () => {
    const navigation = createNavigation();
    const agents: PathAgent[] = [];
    for (let i = 0; i < 40; i++) {
      const host = new TestHost(400, 6_075);
      const agent = new PathAgent(host, navigation);
      // spread the goals so no two orders are deduplicated into one
      agent.order(6_100 - i * NAV_GOAL_TOLERANCE * 2, 375);
      agents.push(agent);
    }

    let frames = 0;
    let served = 0;
    while (served < 40 && frames < 200) {
      navigation.update();
      expect(navigation.stats.searchesLastFrame).toBeLessThanOrEqual(NAV_MAX_SEARCHES_PER_FRAME);
      expect(navigation.stats.nodesLastFrame).toBeLessThanOrEqual(NAV_MAX_NODES_PER_FRAME);
      served += navigation.stats.searchesLastFrame;
      frames++;
    }

    // everything was served, and it took more than one frame to do it — the
    // budget actually deferred work rather than being wide enough to ignore
    expect(navigation.stats.totalSearches).toBe(40);
    expect(frames).toBeGreaterThan(1);
    expect(navigation.stats.queueLength).toBe(0);
    for (const agent of agents) expect(agent.state).not.toBe('PENDING');
  });

  it('serves the player ahead of the queue it is standing behind', () => {
    const navigation = createNavigation();
    for (let i = 0; i < 12; i++) {
      const bot = new PathAgent(new TestHost(400, 6_075), navigation);
      bot.order(6_100 - i * NAV_GOAL_TOLERANCE * 2, 375);
    }

    const player = new PathAgent(new TestHost(400, 6_075), navigation);
    player.order(2_147, 1_876, true);

    navigation.update();
    expect(player.state).toBe('FOLLOWING');
  });

  it('collapses a chase into one plan instead of a search a frame', () => {
    const navigation = createNavigation();
    const host = new TestHost(400, 6_075);
    const agent = new PathAgent(host, navigation);

    // a target on the far side of the map, drifting a few pixels a frame
    for (let frame = 0; frame < 120; frame++) {
      agent.order(6_100 + Math.sin(frame / 7) * 30, 375 + Math.cos(frame / 5) * 30);
      navigation.update();
      agent.update(16);
      host.step();
    }

    // 120 frames of chase orders, and the goal never moved past the tolerance
    expect(navigation.stats.totalSearches).toBe(1);
  });

  it('re-plans a chase whose target genuinely left, but no faster than the throttle', () => {
    const navigation = createNavigation();
    const host = new TestHost(400, 6_075);
    const agent = new PathAgent(host, navigation);

    // the target teleports right across the map every frame
    for (let frame = 0; frame < 60; frame++) {
      agent.order(frame % 2 === 0 ? 6_100 : 2_147, frame % 2 === 0 ? 375 : 1_876);
      navigation.update();
      agent.update(16);
    }

    // 60 frames at 16ms is 960ms; the 250ms throttle caps this at a handful
    const framesOfWork = Math.ceil((60 * 16) / NAV_REPLAN_INTERVAL_MS) + 2;
    expect(navigation.stats.totalSearches).toBeLessThanOrEqual(framesOfWork);
    expect(navigation.stats.totalSearches).toBeGreaterThan(0);
  });

  it('deduplicates two requests from the same agent into one search', () => {
    const navigation = createNavigation();
    const agent = new PathAgent(new TestHost(400, 6_075), navigation);

    agent.order(6_100, 375);
    agent.order(2_147, 1_876);
    navigation.update();

    expect(navigation.stats.totalSearches).toBe(1);
    expect(agent.goalX).toBe(2_147);
  });

  it('walks a full route around a wall and arrives', () => {
    const navigation = createNavigation();
    const host = new TestHost(400, 6_075);
    const agent = new PathAgent(host, navigation);
    host.moveSpeed = 12;

    agent.order(2_147, 1_876);

    let frames = 0;
    while (frames < 4_000 && Math.hypot(host.position.x - 2_147, host.position.y - 1_876) > 40) {
      navigation.update();
      agent.update(16);
      host.step();
      // the walk never puts the body inside a wall
      expect(navigation.grid.clearanceAt(host.position.x, host.position.y)).toBeGreaterThan(0);
      frames++;
    }

    expect(Math.hypot(host.position.x - 2_147, host.position.y - 1_876)).toBeLessThanOrEqual(40);
  });

  it('walks as close as it can to a sealed room and stops outside it', () => {
    // a map that is one sealed box: the inside is perfectly standable and
    // perfectly unreachable, which is the case A* can only settle by
    // exhausting the outside
    const navigation = new NavigationSystem(sealedRoomWalls, 2_048);

    // the room's inside is standable, which is what makes it a fair test of
    // "unreachable" rather than of "unwalkable"
    expect(navigation.grid.isWalkable(1_200, 1_200, CHAMPION_RADIUS)).toBe(true);

    const host = new TestHost(400, 1_200);
    const agent = new PathAgent(host, navigation);
    agent.order(1_200, 1_200);

    let insideTheRoom = false;
    for (let frame = 0; frame < 600; frame++) {
      navigation.update();
      agent.update(16);
      host.step();
      const { x, y } = host.position;
      if (x > 940 && x < 1_460 && y > 940 && y < 1_460) insideTheRoom = true;
    }

    // it gave up rather than throwing, and never walked through the wall
    expect(agent.state).toBe('BLOCKED');
    expect(insideTheRoom).toBe(false);
    expect(navigation.grid.isWalkable(host.position.x, host.position.y, CHAMPION_RADIUS)).toBe(
      true
    );
    // and it did close the distance rather than standing still
    expect(Math.hypot(host.position.x - 1_200, host.position.y - 1_200)).toBeLessThan(800);
    expect(navigation.stats.failedSearches).toBeGreaterThan(0);
  });

  it('keeps closing on a goal whose search keeps running out of expansions', () => {
    // Starve every search of expansions, so each one can only return the
    // closest node it happened to reach. The unit must not treat that as "no
    // route": it walks what it was given and asks again from nearer. This is
    // what makes the shipped node cap safe to set from measurement rather than
    // from the worst case imaginable.
    const navigation = createNavigation();
    const full = navigation.runSearch.bind(navigation);
    navigation.runSearch = (fromX, fromY, toX, toY, radius) =>
      full(fromX, fromY, toX, toY, radius, 250);

    const host = new TestHost(400, 6_075);
    host.moveSpeed = 20;
    const agent = new PathAgent(host, navigation);
    const startDistance = Math.hypot(400 - 2_147, 6_075 - 1_876);
    agent.order(2_147, 1_876);

    let frames = 0;
    let closest = startDistance;
    while (frames < 6_000) {
      navigation.update();
      agent.update(16);
      host.step();
      closest = Math.min(closest, Math.hypot(host.position.x - 2_147, host.position.y - 1_876));
      if (agent.state === 'BLOCKED' || closest < 60) break;
      frames++;
    }

    // it re-planned rather than parking on the first truncated route, and got
    // most of the way there on a budget a twentieth of the shipped one
    expect(navigation.stats.totalSearches).toBeGreaterThan(1);
    expect(closest).toBeLessThan(startDistance * 0.3);
  });

  /**
   * A blocked agent has parked the unit and will never move again on its own,
   * so `order` must not swallow a repeated order the way it does for a unit
   * already following a route. `Monster.updateBackToCamp` re-issues the same
   * goal every frame; with the order swallowed, a camp dragged off its pit was
   * observed 1695px from home, phase BACK_TO_CAMP, agent BLOCKED, goal set
   * correctly and motionless for the rest of the match.
   */
  it('keeps retrying a repeated order while blocked, instead of freezing on it', () => {
    const navigation = new NavigationSystem(sealedRoomWalls, 2_048);
    const host = new TestHost(400, 1_200);
    const agent = new PathAgent(host, navigation);

    agent.order(1_200, 1_200);
    for (let frame = 0; frame < 600 && agent.state !== 'BLOCKED'; frame++) {
      navigation.update();
      agent.update(16);
      host.step();
    }
    expect(agent.state).toBe('BLOCKED');

    // exactly what a caller like Monster.updateBackToCamp does: same goal,
    // every frame, forever
    const searchesWhenBlocked = navigation.stats.totalSearches;
    for (let frame = 0; frame < 120; frame++) {
      agent.order(1_200, 1_200);
      navigation.update();
      agent.update(16);
      host.step();
    }

    expect(navigation.stats.totalSearches).toBeGreaterThan(searchesWhenBlocked);
    // ...but throttled, not one per frame: 120 frames x 16ms is under 8 windows
    const windows = Math.ceil((120 * 16) / NAV_REPLAN_INTERVAL_MS);
    expect(navigation.stats.totalSearches - searchesWhenBlocked).toBeLessThanOrEqual(windows + 1);
  });

  it('degrades to a straight line when navigation is switched off', () => {
    const navigation = createNavigation();
    navigation.enabled = false;

    const host = new TestHost(400, 6_075);
    const agent = new PathAgent(host, navigation);
    agent.order(6_100, 375);
    navigation.update();

    expect(agent.state).toBe('DIRECT');
    expect(navigation.stats.totalSearches).toBe(0);
    expect(host.destination).toMatchObject({ x: 6_100, y: 375 });
  });
});
