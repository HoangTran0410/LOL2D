import { describe, expect, it } from 'vitest';
import { referenceMap } from '../../packs/reference/map';
import { data as referenceData } from '../../packs/reference/pack';
import { validatePack } from '../../src/content/validate';
import { PackRegistry } from '../../src/content/PackRegistry';
import NavigationSystem from '../../src/game/nav/NavigationSystem';
import { NAV_CELL_SIZE } from '../../src/game/nav/NavGrid';
import type { MapGeometry, StructureSlot } from '../../src/content/ContentPack';

/**
 * Task 9's fixture map — small, and deliberately hostile in exactly two
 * ways. See `packs/reference/map.ts` and `packs/reference/
 * provingGroundsGeometry.ts` for what it is; this file is what proves it is
 * that, rather than merely looking like it on paper.
 */

/** `referenceMap.geometry` is a loader — resolve it once per test that needs it. */
const geometry = (): Promise<MapGeometry> => {
  const source = referenceMap.geometry;
  if (typeof source !== 'function') return Promise.resolve(source);
  return source();
};

type Point = { x: number; y: number };

/** Even-odd point-in-polygon, the same rule `NavGrid`'s own rasteriser uses. */
const pointInPolygon = (px: number, py: number, polygon: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * `wallGapWidths` does not exist anywhere else — this is the "cheap honest
 * version" the plan asks for, not a general narrowest-corridor solver.
 *
 * Samples the map on the same grid `NavGrid.fromPolygons` rasterises at
 * (`NAV_CELL_SIZE`, one cell-centre sample per cell), marks a cell blocked
 * when its centre falls inside any wall polygon, and reports the run
 * lengths of consecutive free cells along every row and every column, in
 * pixels (`run length * cellSize`). That is what the pathfinder will
 * actually see — a corridor a hair narrower than the grid resolves would
 * report a run of 0 here exactly as it would refuse to route through it —
 * rather than the raw gap between two polygon edges, which is what the
 * `NavGrid` clearance bug this fixture exists to keep catching got wrong
 * (a conservative approximation whose error matched the feature size).
 */
function wallGapWidths(
  walls: readonly (readonly Point[])[],
  size: number,
  cellSize: number = NAV_CELL_SIZE
): number[] {
  const cols = Math.max(1, Math.ceil(size / cellSize));
  const rows = cols;
  const blocked = new Uint8Array(cols * rows);

  for (let cy = 0; cy < rows; cy++) {
    const y = (cy + 0.5) * cellSize;
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * cellSize;
      for (const wall of walls) {
        if (pointInPolygon(x, y, wall)) {
          blocked[cy * cols + cx] = 1;
          break;
        }
      }
    }
  }

  const gaps: number[] = [];

  for (let cy = 0; cy < rows; cy++) {
    let run = 0;
    for (let cx = 0; cx < cols; cx++) {
      if (blocked[cy * cols + cx] === 0) {
        run++;
      } else {
        if (run > 0) gaps.push(run * cellSize);
        run = 0;
      }
    }
    if (run > 0) gaps.push(run * cellSize);
  }

  for (let cx = 0; cx < cols; cx++) {
    let run = 0;
    for (let cy = 0; cy < rows; cy++) {
      if (blocked[cy * cols + cx] === 0) {
        run++;
      } else {
        if (run > 0) gaps.push(run * cellSize);
        run = 0;
      }
    }
    if (run > 0) gaps.push(run * cellSize);
  }

  return gaps;
}

/** Counts `items` by `key`, the same shape `Map<string, number>` a real `countBy` returns. */
function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

const spawnOf = (map: MapGeometry, faction: string): Point => {
  const slot = map.slots.spawn.find(s => s.faction === faction);
  if (!slot) throw new Error(`no spawn slot for faction ${faction}`);
  return { x: slot.x, y: slot.y };
};

// A champion's body radius (`AttackableUnit.bodyRadius` defaults to half a
// 55px size), the same figure `tests/game/nav/NavigationSystem.test.ts`
// uses for the same reason: the fixture's corridor is only hostile if the
// body trying to cross it is a real one.
const CHAMPION_RADIUS = 27.5;

describe('Proving Grounds, the reference pack’s own map', () => {
  it('has a corridor between 60 and 90 px, which is what exercises NavGrid clearance', async () => {
    const { terrain } = await geometry();
    const gaps = wallGapWidths(terrain.wall, referenceMap.size);
    expect(gaps.some(g => g >= 60 && g <= 90)).toBe(true);
  });

  it('has an asymmetric structure row, which is what the muster rule assumes', async () => {
    const { slots } = await geometry();
    expect(slots.structure.length).toBeGreaterThan(0);
    const perFaction = countBy(slots.structure, (s: StructureSlot) => s.faction);
    expect(new Set(perFaction.values()).size).toBeGreaterThan(1);
  });

  it('is navigable end to end despite that', async () => {
    const map = await geometry();
    const nav = new NavigationSystem(map.terrain.wall, referenceMap.size);
    const from = spawnOf(map, 'amber');
    const to = spawnOf(map, 'jade');
    const result = nav.runSearch(from.x, from.y, to.x, to.y, CHAMPION_RADIUS);
    expect(result.ok).toBe(true);
    expect(result.waypoints.length).toBeGreaterThan(0);
  });

  it('is a summary only — no terrain or slots on the object itself', () => {
    expect(referenceMap).not.toHaveProperty('terrain');
    expect(referenceMap).not.toHaveProperty('slots');
    expect(referenceMap).not.toHaveProperty('lanes');
    expect(typeof referenceMap.geometry).toBe('function');
  });

  it('declares two factions with an unequal number of structures each', async () => {
    const { slots } = await geometry();
    const amber = slots.structure.filter(s => s.faction === 'amber').length;
    const jade = slots.structure.filter(s => s.faction === 'jade').length;
    expect(amber).toBeGreaterThan(0);
    expect(jade).toBeGreaterThan(0);
    expect(amber).not.toBe(jade);
  });

  it('gives every lane a muster point for both of its factions', async () => {
    const { lanes, slots } = await geometry();
    expect(lanes?.length ?? 0).toBeGreaterThan(0);
    for (const lane of lanes ?? []) {
      for (const end of [lane.from, lane.to]) {
        const musters = slots.minion.some(slot => slot.faction === end && slot.lane === lane.id);
        expect(musters).toBe(true);
      }
    }
  });

  it('fills its one neutral slot with the reference pack’s own monster, not the bundled pack’s', async () => {
    const { slots } = await geometry();
    expect(slots.neutral).toHaveLength(1);
    const role = slots.neutral[0].role;
    const monsters = referenceData.monsters ?? {};
    const filler = Object.values(monsters).find(monster => monster.fills.includes(role));
    expect(filler).toBeDefined();
    expect(filler?.members.length).toBeGreaterThan(0);
  });

  it('passes validation as part of a pack, geometry included', async () => {
    const result = validatePack({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      maps: [referenceMap],
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) expect(result.errors).toEqual([]);

    // `referenceMap.geometry` is a loader too — see `summonersRift.test.ts`'s
    // matching test for why `validatePack` above cannot see past its summary,
    // and why `PackRegistry.loadMapGeometry` (which validates the resolved
    // geometry) is what actually has to run for this to mean anything.
    const registry = new PackRegistry();
    registry.installData({
      manifest: { id: 'p', version: '1.0.0', coreRange: '^1' },
      maps: [referenceMap],
    });
    await expect(registry.loadMapGeometry('p:proving-grounds')).resolves.toBeTruthy();
  });

  it('is carried in the reference pack’s own data', () => {
    expect(referenceData.maps).toContain(referenceMap);
  });
});
