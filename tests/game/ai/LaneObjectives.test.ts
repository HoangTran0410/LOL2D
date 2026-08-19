import { describe, expect, it } from 'vitest';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, LANES, LANE_WAYPOINTS } from '../../../src/game/lanes';
import {
  assignLanes,
  laneAdvance,
  laneApproach,
  laneNeed,
  laneProgressAt,
  nearestLane,
  LANE_CROWDING_PENALTY,
  LANE_NEED_BASE,
  LANE_NEED_ENEMY_PRESENT,
  LANE_NEED_ENEMY_TURRET_HURT,
  LANE_NEED_MINION_DEFICIT,
  LANE_NEED_OWN_TURRET_HURT,
  LANE_SWITCH_MARGIN,
} from '../../../src/game/ai/LaneObjectives';

describe('lane geometry', () => {
  it('reads 0 at the blue end of every lane and 1 at the red end', () => {
    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      const first = path[0];
      const last = path[path.length - 1];
      expect(laneProgressAt(lane, first.x, first.y)).toBe(0);
      expect(laneProgressAt(lane, last.x, last.y)).toBe(1);
    }
  });

  it('rises strictly as you walk the shipped waypoints, in every lane', () => {
    // The invariant, asserted against the authored path rather than against a
    // second copy of the arc-length arithmetic: a projection onto a polyline
    // that is not monotone along its own vertices is not a progress measure.
    for (const lane of LANES) {
      let previous = -1;
      for (const waypoint of LANE_WAYPOINTS[lane]) {
        const progress = laneProgressAt(lane, waypoint.x, waypoint.y);
        expect(progress).toBeGreaterThan(previous);
        previous = progress;
      }
      expect(previous).toBe(1);
    }
  });

  it('halves at the midpoint of the first segment', () => {
    // The midpoint of segment 0 is, by construction, exactly half the arc length
    // of waypoint 1 — a relation the implementation has to earn and cannot get
    // from agreeing with itself, because the two points are different inputs.
    const path = LANE_WAYPOINTS[Lane.MID];
    const atFirst = laneProgressAt(Lane.MID, path[1].x, path[1].y);
    const middle = laneProgressAt(
      Lane.MID,
      (path[0].x + path[1].x) / 2,
      (path[0].y + path[1].y) / 2
    );
    expect(middle).toBeCloseTo(atFirst / 2, 6);
  });

  it('clamps a point past either end of the lane', () => {
    const path = LANE_WAYPOINTS[Lane.TOP];
    const first = path[0];
    expect(laneProgressAt(Lane.TOP, first.x - 5_000, first.y + 5_000)).toBe(0);
    const last = path[path.length - 1];
    expect(laneProgressAt(Lane.TOP, last.x + 5_000, last.y - 5_000)).toBe(1);
  });

  it('reads 0 for a lane that does not exist', () => {
    expect(laneProgressAt('jungle', 3_000, 3_000)).toBe(0);
  });

  it('names the lane a turret row sits on', () => {
    // Three turret coordinates straight out of summoner_map.json, one per row.
    expect(nearestLane(3_423, 595).lane).toBe(Lane.TOP);
    expect(nearestLane(2_543, 3_687).lane).toBe(Lane.MID);
    expect(nearestLane(2_995, 5_775).lane).toBe(Lane.BOT);
  });

  it('measures how far off the lane a point is', () => {
    // (3608, 456) is a TOP waypoint, so a point on it is on the lane.
    expect(nearestLane(3_608, 456).distance).toBeCloseTo(0, 6);
  });

  it('breaks a tie in LANES order, so assignment never depends on a hash', () => {
    // All three lanes start at the blue fountain, so the fountain is 0px from
    // each of them. TOP is first in LANES.
    expect(nearestLane(400, 6_075).lane).toBe(Lane.TOP);
    expect(nearestLane(400, 6_075).distance).toBeCloseTo(0, 6);
  });

  it('measures advance from the asking team, so both sides push forward', () => {
    expect(laneAdvance(TeamId.BLUE, 0.25)).toBeCloseTo(0.25, 6);
    expect(laneAdvance(TeamId.RED, 0.25)).toBeCloseTo(0.75, 6);
  });

  it('aims a lane approach at the last point before the enemy fountain', () => {
    const path = LANE_WAYPOINTS[Lane.BOT];
    expect(laneApproach(Lane.BOT, TeamId.BLUE)).toEqual({
      x: path[path.length - 2].x,
      y: path[path.length - 2].y,
    });
    // Red walks the same list backwards, so its approach is the far end.
    expect(laneApproach(Lane.BOT, TeamId.RED)).toEqual({ x: path[1].x, y: path[1].y });
  });

  it('has no approach for a lane that does not exist', () => {
    expect(laneApproach('jungle', TeamId.BLUE)).toBeNull();
  });
});

describe('lane need', () => {
  it('is the base alone for a quiet, healthy, even lane', () => {
    expect(
      laneNeed({
        alliedMinions: 4,
        enemyMinions: 4,
        ownTurretHealthPct: 1,
        enemyTurretHealthPct: 1,
        enemyChampions: 0,
      })
    ).toBe(LANE_NEED_BASE);
  });

  it('rises with the enemy minion surplus and falls with our own', () => {
    const shorthanded = laneNeed({
      alliedMinions: 1,
      enemyMinions: 4,
      ownTurretHealthPct: 1,
      enemyTurretHealthPct: 1,
      enemyChampions: 0,
    });
    expect(shorthanded).toBe(LANE_NEED_BASE + 3 * LANE_NEED_MINION_DEFICIT);

    const winning = laneNeed({
      alliedMinions: 4,
      enemyMinions: 1,
      ownTurretHealthPct: 1,
      enemyTurretHealthPct: 1,
      enemyChampions: 0,
    });
    expect(winning).toBe(LANE_NEED_BASE - 3 * LANE_NEED_MINION_DEFICIT);
  });

  it('rises as our own turret is chewed down and as theirs nears death', () => {
    expect(
      laneNeed({
        alliedMinions: 0,
        enemyMinions: 0,
        ownTurretHealthPct: 0.5,
        enemyTurretHealthPct: 1,
        enemyChampions: 0,
      })
    ).toBeCloseTo(LANE_NEED_BASE + 0.5 * LANE_NEED_OWN_TURRET_HURT, 6);

    expect(
      laneNeed({
        alliedMinions: 0,
        enemyMinions: 0,
        ownTurretHealthPct: 1,
        enemyTurretHealthPct: 0.25,
        enemyChampions: 0,
      })
    ).toBeCloseTo(LANE_NEED_BASE + 0.75 * LANE_NEED_ENEMY_TURRET_HURT, 6);
  });

  it('rises per enemy champion standing in it', () => {
    expect(
      laneNeed({
        alliedMinions: 0,
        enemyMinions: 0,
        ownTurretHealthPct: 1,
        enemyTurretHealthPct: 1,
        enemyChampions: 2,
      })
    ).toBe(LANE_NEED_BASE + 2 * LANE_NEED_ENEMY_PRESENT);
  });
});

describe('lane assignment', () => {
  const needs = (top: number, mid: number, bot: number) =>
    new Map([
      [Lane.TOP, top],
      [Lane.MID, mid],
      [Lane.BOT, bot],
    ]);

  it('sends a lone bot to the neediest lane', () => {
    const assigned = assignLanes(['a'], needs(10, 40, 20), new Map());
    expect(assigned.get('a')).toBe(Lane.MID);
  });

  it('spreads three bots over three lanes, neediest first', () => {
    // Each lane is docked LANE_CROWDING_PENALTY per bot already sent there, so
    // the second bot only doubles up when the gap is worth more than the dock.
    const assigned = assignLanes(['a', 'b', 'c'], needs(30, 25, 20), new Map());
    expect(assigned.get('a')).toBe(Lane.TOP);
    expect(assigned.get('b')).toBe(Lane.MID);
    expect(assigned.get('c')).toBe(Lane.BOT);
  });

  it('doubles up when one lane is needier than the crowding dock', () => {
    const assigned = assignLanes(['a', 'b'], needs(LANE_CROWDING_PENALTY + 50, 20, 10), new Map());
    expect(assigned.get('a')).toBe(Lane.TOP);
    expect(assigned.get('b')).toBe(Lane.TOP);
  });

  it('keeps a bot in its lane while the gap is inside the switch margin', () => {
    // BOT is behind by exactly the margin, which is not *more* than the margin.
    const previous = new Map([['a', Lane.BOT]]);
    const assigned = assignLanes(['a'], needs(20 + LANE_SWITCH_MARGIN, 0, 20), previous);
    expect(assigned.get('a')).toBe(Lane.BOT);
  });

  it('moves it once another lane beats the margin', () => {
    const previous = new Map([['a', Lane.BOT]]);
    const assigned = assignLanes(['a'], needs(20 + LANE_SWITCH_MARGIN + 1, 0, 20), previous);
    expect(assigned.get('a')).toBe(Lane.TOP);
  });

  it('gives the same answer for the same input, every time', () => {
    const first = assignLanes(['a', 'b', 'c', 'd'], needs(30, 30, 30), new Map());
    const second = assignLanes(['a', 'b', 'c', 'd'], needs(30, 30, 30), new Map());
    expect([...second]).toEqual([...first]);
    // Perfectly level lanes: the tie goes to LANES order and the fourth bot
    // doubles back onto the first lane rather than landing anywhere.
    expect([...first.values()]).toEqual([Lane.TOP, Lane.MID, Lane.BOT, Lane.TOP]);
  });

  it('assigns nobody when there are no bots', () => {
    expect(assignLanes([], needs(1, 2, 3), new Map()).size).toBe(0);
  });

  it('ignores a remembered lane that is no longer a lane', () => {
    const previous = new Map([['a', 'jungle']]);
    expect(assignLanes(['a'], needs(10, 40, 20), previous).get('a')).toBe(Lane.MID);
  });
});
