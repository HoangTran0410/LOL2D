/**
 * The real map's walls really do block sight.
 *
 * Everything in `tests/game/combat/Vision.test.ts` hands `hasLineOfSight` a
 * hand-built obstacle, which proves the geometry and nothing about the 329 wall
 * polygons the game actually loads. The failure this guards against is silent
 * and total: if `summoner_map.json`'s vertices did not arrive where this module
 * expects them — wrong space, wrong nesting, dropped by the quadtree — every
 * sightline in the game would read as clear, the fog would stop meaning
 * anything, and every test in the suite would still be green.
 *
 * So it drives the *real* `TerrainMap` over the *real* asset, and asks the same
 * question of every wall on the map.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/` and
// `assets/json/` and into the pack.
import summonerMap from '../../../packs/riot/maps/summoner_map.json';
import TerrainMap from '../../../src/game/gameObject/map/TerrainMap';
import TerrainType from '../../../src/game/enums/TerrainType';
import { hasLineOfSight } from '../../../src/game/combat/Vision';
import { stubGameGlobals } from '../fixtures';
import { summonersRift } from '../../../packs/riot/maps/summonersRift';

/** How far either side of a wall's edge the two lookers stand. */
const STAND_OFF = 200;

let terrainMap: TerrainMap;
let game: { terrainMap: TerrainMap };

beforeEach(async () => {
  stubGameGlobals();
  // The real assembled map — `summonersRift.geometry` is Task 4's lazy
  // loader, resolved here the same way `GameScene.startGame()` resolves it
  // before building a match, so this drives the exact terrain a real match
  // plays on rather than a second, hand-parsed copy of the JSON.
  const source = summonersRift.geometry;
  const geometry = typeof source === 'function' ? await source() : source;
  terrainMap = new TerrainMap({}, { ...summonersRift, ...geometry });
  game = { terrainMap };
});
afterEach(() => vi.unstubAllGlobals());

describe('the loaded map', () => {
  it('parses the wall layer the file actually ships', () => {
    const walls = terrainMap.obstacles.filter(o => o.type === TerrainType.WALL);
    expect(walls.length).toBe(summonerMap.wall.length);
    expect(walls.length).toBeGreaterThan(300);
  });

  it('blocks a sightline drawn straight through any wall on it', () => {
    const walls = terrainMap.obstacles.filter(o => o.type === TerrainType.WALL);
    const seeThrough: string[] = [];

    for (const wall of walls) {
      const { vertices } = wall;
      // Perpendicular to one edge, through its midpoint: the segment crosses
      // that edge by construction, whatever shape the rest of the polygon is.
      const a = vertices[0];
      const b = vertices[1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const normalX = -dy / length;
      const normalY = dx / length;

      const from = { x: midX - normalX * STAND_OFF, y: midY - normalY * STAND_OFF };
      const to = { x: midX + normalX * STAND_OFF, y: midY + normalY * STAND_OFF };

      if (hasLineOfSight(game, from, to)) {
        seeThrough.push(`(${Math.round(midX)}, ${Math.round(midY)})`);
      }
    }

    expect(seeThrough).toEqual([]);
  });

  it('leaves open ground open, so the answer is not just always "blocked"', () => {
    // A patch of the map with no obstacle bounding box anywhere near it, found
    // rather than guessed — the map is redrawn from time to time.
    const clear = findOpenGround();
    expect(clear).not.toBeNull();
    expect(hasLineOfSight(game, clear!.from, clear!.to)).toBe(true);
  });
});

/** Two points 120px apart with no obstacle within 300px of either. */
function findOpenGround(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const boxes = terrainMap.obstacles.map(o => o.getBoundingBox());
  for (let x = 400; x < 6_000; x += 100) {
    for (let y = 400; y < 6_000; y += 100) {
      const clearOf = (px: number, py: number) =>
        boxes.every(
          box =>
            px < box.x - 300 ||
            px > box.x + box.w + 300 ||
            py < box.y - 300 ||
            py > box.y + box.h + 300
        );
      if (clearOf(x, y) && clearOf(x + 120, y)) {
        return { from: { x, y }, to: { x: x + 120, y } };
      }
    }
  }
  return null;
}
