import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamId from '../../../src/game/enums/TeamId';
import {
  LANES,
  LANE_WAYPOINTS,
  Lane,
  clearActiveLanes,
  getLaneWaypoints,
  nextWaypointIndexFrom,
  resetLanesForTests,
  setActiveLanes,
  type LaneWaypoint,
} from '../../../src/game/lanes';
import MinionSpawner from '../../../src/game/managers/MinionSpawner';
import { createSpawnerContext } from './helpers';
import Game from '../../../src/game/Game';

/**
 * This file tests `lanes.ts`'s own mechanism — the active-lane-set binding,
 * `setActiveLanes`'s one-process-wide ownership guard, and `Game.destroy()`'s
 * cleanup of it — not any particular map's shape. Batch 4 task 6 moved
 * Summoner's Rift's own waypoints (and the wall/turret clearance every
 * segment of them has to hold) out of `src/game/lanes.ts` and into the pack;
 * `tests/packs/riot/maps/Lanes.test.ts` is what checks that data now, against
 * the pack's own module. Two small, synthetic lane sets stand in here —
 * nothing below cares what shape a real lane has, only that the mechanism
 * installs, serves and releases whichever one it is handed.
 */
const TOP_WAYPOINTS: LaneWaypoint[] = [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
  { x: 1_000, y: 0 },
];
const MID_WAYPOINTS: LaneWaypoint[] = [
  { x: 0, y: 1_000 },
  { x: 500, y: 500 },
  { x: 1_000, y: 0 },
];

/**
 * `tests/setup.ts` installs Summoner's Rift's own lanes for every test
 * file's environment by default now (`lanes.ts`'s own default is empty —
 * see that module's doc comment on `LANES`) — every describe below installs
 * its own synthetic set instead, so each releases that guard first.
 */

describe('the active lane set, once a match installs one', () => {
  beforeEach(() => resetLanesForTests());
  afterEach(resetLanesForTests);

  it('starts empty until a match installs a map', () => {
    expect(LANES).toEqual([]);
    expect(LANE_WAYPOINTS).toEqual({});
    expect(getLaneWaypoints(Lane.MID, TeamId.BLUE)).toEqual([]);
  });

  it('walks the lanes the map declares, whatever they are called', () => {
    // Neither id is 'top'/'mid'/'bot' on purpose — the old ids must not leak
    // back in anywhere.
    setActiveLanes([
      { id: 'alpha', from: 'blue', to: 'red', waypoints: TOP_WAYPOINTS },
      { id: 'beta', from: 'blue', to: 'red', waypoints: MID_WAYPOINTS },
    ]);

    expect(LANES).toEqual(['alpha', 'beta']);
    expect(getLaneWaypoints('alpha', TeamId.BLUE)).toBe(TOP_WAYPOINTS);
    expect(getLaneWaypoints('beta', TeamId.RED)).toEqual([...MID_WAYPOINTS].reverse());
    // The retired ids answer as "no such lane" (empty), not as a silent
    // fallback to whatever they used to mean.
    expect(getLaneWaypoints('top', TeamId.BLUE)).toEqual([]);
    expect(nextWaypointIndexFrom('bot', TeamId.BLUE, 3_000, 3_000)).toBe(0);
  });

  it('plays a map with no lanes at all', () => {
    setActiveLanes(undefined);
    expect(LANES).toEqual([]);
    expect(LANE_WAYPOINTS).toEqual({});
    expect(getLaneWaypoints('mid', TeamId.BLUE)).toEqual([]);
    expect(nextWaypointIndexFrom('mid', TeamId.BLUE, 0, 0)).toBe(0);
  });

  it('gives red the same path backwards, without mutating the shared blue one', () => {
    setActiveLanes([{ id: Lane.TOP, from: 'blue', to: 'red', waypoints: TOP_WAYPOINTS }]);

    const blue = getLaneWaypoints(Lane.TOP, TeamId.BLUE);
    const red = getLaneWaypoints(Lane.TOP, TeamId.RED);

    expect(blue).toBe(TOP_WAYPOINTS);
    expect(red).toEqual([...TOP_WAYPOINTS].reverse());
    // handed to every minion in a wave, so it must be the same array each time
    expect(getLaneWaypoints(Lane.TOP, TeamId.RED)).toBe(red);
  });

  it('falls back to mid for a lane it does not know', () => {
    setActiveLanes([{ id: Lane.MID, from: 'blue', to: 'red', waypoints: MID_WAYPOINTS }]);
    expect(getLaneWaypoints('jungle', TeamId.BLUE)).toBe(MID_WAYPOINTS);
  });

  /**
   * Fix round 1: reproduces the hazard a review found by running it, not by
   * reasoning about it — `setActiveLanes(A)`, build something off `LANES`,
   * `setActiveLanes(B)` before A's match ever clears, and A's reader (a
   * `MinionSpawner`, a `TeamBlackboard`) starts reading B's lane ids on its
   * very next ask, silently, because nothing captured A's array — every
   * reader asks the live binding fresh. `LANES` is one process-wide slot
   * (see its own doc comment); this is what stops a second `setActiveLanes`
   * from overwriting it unnoticed.
   */
  it("refuses to overwrite an unstopped match's lanes silently", () => {
    setActiveLanes([{ id: 'alpha', from: 'blue', to: 'red', waypoints: TOP_WAYPOINTS }]);

    expect(() =>
      setActiveLanes([{ id: 'beta', from: 'blue', to: 'red', waypoints: MID_WAYPOINTS }])
    ).toThrow(/setActiveLanes/);

    // The refused call did not partially apply — A's own lanes are untouched,
    // which is the whole point: a caller that ignores the throw still cannot
    // silently inherit B's ids.
    expect(LANES).toEqual(['alpha']);
  });

  it('lets the next match install its own lanes once the old one clears', () => {
    setActiveLanes([{ id: 'alpha', from: 'blue', to: 'red', waypoints: TOP_WAYPOINTS }]);
    clearActiveLanes();
    setActiveLanes([{ id: 'beta', from: 'blue', to: 'red', waypoints: MID_WAYPOINTS }]);

    expect(LANES).toEqual(['beta']);
  });
});

describe('a map with no lanes, end to end through the spawner', () => {
  beforeEach(() => resetLanesForTests());
  afterEach(() => {
    resetLanesForTests();
    vi.unstubAllGlobals();
  });

  it('never queues, never spawns, however long the clock runs', () => {
    setActiveLanes(undefined);
    const game = createSpawnerContext();
    const spawner = new MinionSpawner(game);

    spawner.queueWave();
    expect(spawner._queue).toHaveLength(0);

    // Several wave intervals' worth of frames — not one tick, which could
    // only ever prove the queue starts empty, not that it stays that way.
    for (let elapsed = 0; elapsed < 5 * 30_000; elapsed += 16) {
      spawner.update();
    }

    expect(spawner.liveCount).toBe(0);
    expect(game.objectManager._objectToBeAdd).toHaveLength(0);
  });
});

/**
 * Fix round 1: the doc comments on `setActiveLanes`/`clearActiveLanes` claim
 * `Game.destroy()` is the seam that keeps a real match sequence from ever
 * tripping the "already installed" throw above. This is what proves that
 * claim against the actual method rather than trusting the comment — called
 * on `Game.prototype` directly with a stub `this`, so it does not pay for a
 * full `Game` construction (canvas, camera, terrain rasterization) just to
 * reach three destroy calls and a lane clear.
 */
describe('Game.destroy() clears the active lanes', () => {
  beforeEach(() => resetLanesForTests());
  afterEach(resetLanesForTests);

  it('releases the setActiveLanes guard so the next match can install its own', () => {
    setActiveLanes([{ id: 'alpha', from: 'blue', to: 'red', waypoints: TOP_WAYPOINTS }]);
    expect(LANES).toEqual(['alpha']);

    const stubGame = {
      fogOfWar: { destroy: () => {} },
      minimap: { destroy: () => {} },
      inGameHUD: { destroy: () => {} },
    };
    Game.prototype.destroy.call(stubGame);

    expect(LANES).toEqual([]);
    // And the guard is released, not just the value reset — a second match's
    // own setActiveLanes must not throw after this.
    expect(() =>
      setActiveLanes([{ id: 'beta', from: 'blue', to: 'red', waypoints: MID_WAYPOINTS }])
    ).not.toThrow();
    expect(LANES).toEqual(['beta']);
  });
});
