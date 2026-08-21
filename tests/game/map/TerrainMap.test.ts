/**
 * `TerrainMap` takes the world it draws and collides against from the active
 * `MapDefinition`, not from a hard-coded 6400 or a synchronous
 * `AssetManager.get('json_summoner_map')` read.
 *
 * The size assertion below is deliberately against a *derived* value — the
 * quadtree's own bounds, which every terrain query is built on top of — not
 * just `terrainMap.size` itself. A `TerrainMap` that stored the number but
 * kept building a 6400-wide quadtree would still pass a check that only read
 * the field back; see `CLAUDE.md`'s note on `botTrajectory.ts` for the same
 * shape of bug at a different layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubGameGlobals } from '../fixtures';
import TerrainMap from '../../../src/game/gameObject/map/TerrainMap';
import TerrainType from '../../../src/game/enums/TerrainType';
import type { ActiveMap } from '../../../src/content/ContentPack';

const activeMap = (size: number): ActiveMap => ({
  id: 'test-map',
  name: 'Test Map',
  size,
  factions: [{ id: 'blue' }, { id: 'red' }],
  terrain: {
    wall: [
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    ],
    bush: [
      [
        { x: 300, y: 300 },
        { x: 340, y: 300 },
        { x: 340, y: 340 },
        { x: 300, y: 340 },
      ],
    ],
    water: [],
  },
  slots: { spawn: [], minion: [], structure: [], neutral: [] },
});

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('TerrainMap', () => {
  it('takes its size from the map, not from a 6400 default — checked on a derived value', () => {
    const terrainMap = new TerrainMap({}, activeMap(3_200));
    expect(terrainMap.size).toBe(3_200);
    // The quadtree every terrain query is built on top of, not just the field.
    expect(terrainMap.quadtree.bounds).toEqual({ x: 0, y: 0, w: 3_200, h: 3_200 });
  });

  it('parses the wall/bush/water layers straight off the map, no asset manager involved', () => {
    const terrainMap = new TerrainMap({}, activeMap(6_400));
    const walls = terrainMap.obstacles.filter(o => o.type === TerrainType.WALL);
    const bushes = terrainMap.obstacles.filter(o => o.type === TerrainType.BUSH);
    const waters = terrainMap.obstacles.filter(o => o.type === TerrainType.WATER);
    expect(walls).toHaveLength(1);
    expect(bushes).toHaveLength(1);
    expect(waters).toHaveLength(0);
    expect(terrainMap.wallPolygons()).toEqual([
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    ]);
  });

  it('a second map with a different size and terrain builds an independent quadtree', () => {
    // Regression for a `TerrainMap` that quietly kept a module-level default:
    // two instances built back to back must not share state.
    const first = new TerrainMap({}, activeMap(1_600));
    const second = new TerrainMap({}, activeMap(8_000));
    expect(first.quadtree.bounds.w).toBe(1_600);
    expect(second.quadtree.bounds.w).toBe(8_000);
  });
});
