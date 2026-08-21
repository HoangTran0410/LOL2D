import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { LANE_WAYPOINTS, Lane } from '../../../src/game/lanes';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A wave does not start on its lane. It musters between the two turrets nearest
 * its own fountain — a point the active map declares in `slots.minion`
 * (`MinionSpawner.musterPoint`; Task 6 moved this off `MinionSpawner`'s own
 * `musterPointFor`, which recomputed it from the live turrets, onto the map)
 * — and is handed the first waypoint *ahead* of that, which on TOP is a
 * 955px diagonal away — and `updateWalk` goes to a waypoint with `moveTo`, a
 * straight line with no routing. Measured against the wall polygons, that
 * opening leg passes 42px *inside* the base wall on TOP and 19px from a
 * turret centre on BOT, on the old paths as much as the current ones: the
 * lane is walkable end to end, but the join onto it is not part of the lane.
 *
 * So the join, and only the join, is routed. `BLUE_MUSTER` below is that same
 * declared point for blue TOP — see `Lanes.test.ts`'s own muster-point block
 * for the derivation and the wall-clearance proof.
 */

let game: TestGame & { navigation?: unknown };

const BLUE_MUSTER = { x: 849.5, y: 5509 };

const makeMinion = (startWaypointIndex: number) =>
  new Minion({
    game,
    position: createVector(BLUE_MUSTER.x, BLUE_MUSTER.y),
    teamId: TeamId.BLUE,
    lane: Lane.TOP,
    waypoints: LANE_WAYPOINTS[Lane.TOP],
    startWaypointIndex,
  } as ConstructorParameters<typeof Minion>[0]);

describe('joining the lane from the muster point', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('routes to the first waypoint instead of walking blind at it', () => {
    const minion = makeMinion(1);
    const navigateTo = vi.spyOn(minion, 'navigateTo');
    const moveTo = vi.spyOn(minion, 'moveTo');

    minion.updateWalk();

    expect(navigateTo).toHaveBeenCalledWith(
      LANE_WAYPOINTS[Lane.TOP][1].x,
      LANE_WAYPOINTS[Lane.TOP][1].y
    );
    // `navigateTo` degrades to `moveTo` in a context with no navigation, which
    // this one is — so what is asserted is the call that was made, not the
    // absence of the one it degrades into.
    expect(moveTo).toHaveBeenCalledTimes(1);
  });

  it('walks the lane itself straight, once it is on it', () => {
    const minion = makeMinion(1);
    // standing on waypoint 1: this tick registers arrival and aims at 2
    const first = LANE_WAYPOINTS[Lane.TOP][1];
    minion.position.set(first.x, first.y);
    minion.updateWalk();

    const navigateTo = vi.spyOn(minion, 'navigateTo');
    const moveTo = vi.spyOn(minion, 'moveTo');
    minion.updateWalk();

    expect(moveTo).toHaveBeenCalledWith(
      LANE_WAYPOINTS[Lane.TOP][2].x,
      LANE_WAYPOINTS[Lane.TOP][2].y
    );
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('stops routing once it has reached the waypoint it was routing to', () => {
    const minion = makeMinion(1);
    expect(minion.joinedLane).toBe(false);

    const first = LANE_WAYPOINTS[Lane.TOP][1];
    minion.position.set(first.x, first.y);
    minion.updateWalk();

    expect(minion.joinedLane).toBe(true);
  });
});
