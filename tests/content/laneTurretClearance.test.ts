/**
 * The bug `packs/riot/maps/summonersRiftGeometry.ts`'s own header and
 * `tests/packs/riot/maps/Lanes.test.ts`'s `MIN_SEGMENT_TURRET_CLEARANCE`
 * check exist to prevent — a lane waypoint sitting on (or a lane segment
 * passing through) a turret's own body, so a wave drives into the building,
 * is shoved around it by `UnitCollisionSystem`, and re-acquires the same
 * line on the far side — was, until now, only ever checked against
 * Summoner's Rift's own waypoints. `referenceMap.test.ts` never checked a
 * lane against a turret at all.
 *
 * `packs/reference/provingGroundsGeometry.ts` shipped exactly that bug:
 * its one lane's waypoints included `{700,1700}` and `{1700,700}` — the
 * amber and a jade turret's own centres, verbatim. It was masked by finding
 * 1 (the faction bridge leaving every fountain unaffiliated, so no wave
 * ever spawned to walk the lane and hit it); fixing that exposes it.
 *
 * This file is the generalised guard: one pure clearance check, run against
 * *every* shipped map's own `lanes`/`slots.structure`, so the rule holds for
 * whichever map a player picks rather than only the one it was written
 * against. A rule that only holds for the map it was written against is not
 * a rule.
 */
import { describe, expect, it } from 'vitest';
import type { MapGeometry } from '../../src/content/ContentPack';
// Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/` and
// into the pack.
import { summonersRiftGeometry } from '../../packs/riot/maps/summonersRiftGeometry';
import { provingGroundsGeometry } from '../../packs/reference/provingGroundsGeometry';

type Point = { x: number; y: number };

/**
 * Turret body (`DEFAULT_TURRET_PRESET.size` 92, radius 46) plus the widest
 * minion's (`MinionPresets.cannon.size` 38, radius 19) — the same physical
 * floor `Lanes.test.ts`'s own `TURRET_BLOCKED_RADIUS` derives, restated here
 * so this file does not depend on a `tests/game/minions/` internal.
 */
const TURRET_BLOCKED_RADIUS = 46 + 19;
/** A waypoint any closer than this is a point no minion body can ever stand on. */
const MIN_WAYPOINT_TURRET_CLEARANCE = TURRET_BLOCKED_RADIUS + 5;
/**
 * The same question asked of the walk, not just the waypoints — a lane is a
 * straight-line `moveTo` between them, no routing, so a vertex clearing a
 * turret buys nothing if the run to the next one cuts through it. 100 rather
 * than the blocked radius because this is a lane, not a squeeze; matches
 * `Lanes.test.ts`'s own `MIN_SEGMENT_TURRET_CLEARANCE`.
 */
const MIN_SEGMENT_TURRET_CLEARANCE = 100;

const nearestTurretDistance = (x: number, y: number, turrets: readonly Point[]): number => {
  let best = Infinity;
  for (const turret of turrets) {
    const d = Math.hypot(x - turret.x, y - turret.y);
    if (d < best) best = d;
  }
  return best;
};

/** Worst turret clearance anywhere on the straight line a minion actually walks. */
const segmentTurretClearance = (
  a: Point,
  b: Point,
  turrets: readonly Point[]
): { clearance: number; at: Point } => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(length / 10));
  let worst = Infinity;
  let at = a;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const clearance = nearestTurretDistance(x, y, turrets);
    if (clearance < worst) {
      worst = clearance;
      at = { x: Math.round(x), y: Math.round(y) };
    }
  }
  return { clearance: worst, at };
};

/** Runs both floors against every lane a map declares, against its own turret slots. */
function checkMapLanesClearTurrets(mapName: string, geometry: MapGeometry): void {
  const turrets = geometry.slots.structure.map(slot => ({ x: slot.x, y: slot.y }));
  expect(turrets.length, `${mapName} has no turrets to check against`).toBeGreaterThan(0);

  for (const lane of geometry.lanes ?? []) {
    expect(
      lane.waypoints.length,
      `${mapName} lane ${lane.id} has fewer than two waypoints`
    ).toBeGreaterThanOrEqual(2);

    lane.waypoints.forEach((waypoint, i) => {
      const clearance = nearestTurretDistance(waypoint.x, waypoint.y, turrets);
      expect(
        clearance,
        `${mapName} lane ${lane.id}[${i}] (${waypoint.x},${waypoint.y}) is ` +
          `${Math.round(clearance)}px from a turret centre — a minion body is blocked at ` +
          `${TURRET_BLOCKED_RADIUS}px`
      ).toBeGreaterThanOrEqual(MIN_WAYPOINT_TURRET_CLEARANCE);
    });

    for (let i = 0; i + 1 < lane.waypoints.length; i++) {
      const { clearance, at } = segmentTurretClearance(
        lane.waypoints[i],
        lane.waypoints[i + 1],
        turrets
      );
      expect(
        clearance,
        `${mapName} lane ${lane.id} segment ${i} (${lane.waypoints[i].x},${lane.waypoints[i].y}) ` +
          `-> (${lane.waypoints[i + 1].x},${lane.waypoints[i + 1].y}) passes ` +
          `${Math.round(clearance)}px from a turret centre at (${at.x},${at.y})`
      ).toBeGreaterThanOrEqual(MIN_SEGMENT_TURRET_CLEARANCE);
    }
  }
}

describe('every shipped map keeps its lanes off its own turrets', () => {
  it("Summoner's Rift", () => {
    checkMapLanesClearTurrets("Summoner's Rift", summonersRiftGeometry);
  });

  it('Proving Grounds', () => {
    checkMapLanesClearTurrets('Proving Grounds', provingGroundsGeometry);
  });
});
