// `?raw` rather than a plain JSON import: `vite.config.ts` sets
// `assetsInclude: ['**/*.json']` so `AssetManager` can hand out every JSON
// file as a fetchable URL at runtime, and that claims the extension ahead of
// Vite's own JSON-module plugin in a production build — a plain import here
// builds fine under Vitest (dev-style transform, unaffected by
// `assetsInclude`) and then fails `vite build` outright, `[plugin vite:json]
// ... Failed to parse JSON file`, because Rollup's asset pipeline gets the
// specifier first. `?raw` sidesteps the ambiguity in both dev and build: it
// always yields the file's raw text, which is parsed explicitly below.
import mapJsonRaw from './summoner_map.json?raw';
import type {
  LaneDefinition,
  MapGeometry,
  MinionSlot,
  NeutralSlot,
  SpawnSlot,
  StructureSlot,
} from '@moba2d/core/content/ContentPack';

/**
 * Summoner's Rift's heavy half — terrain and slots — assembled from data
 * that used to be scattered across core (`assets/json/summoner_map.json`,
 * `src/game/mapPresets.ts`'s `NEUTRAL_SLOTS`, `src/game/lanes.ts`'s
 * `DEFAULT_LANE_WAYPOINTS`) and now lives beside this module, entirely
 * inside the pack: Task 6 of the content-pack extraction moved all three
 * here, because they are this map's own shape, not a mechanism every map
 * shares. `src/game/lanes.ts` keeps only the mechanism — `LANES`,
 * `LANE_WAYPOINTS`, `setActiveLanes`, `getLaneWaypoints`,
 * `nextWaypointIndexFrom` — and now ships with no coordinate of this map's
 * at all (`tests/content/summonersRiftCoordinateBoundary.test.ts` is the
 * scan that holds that).
 *
 * The two spawn platforms are a small literal right here (see `spawnSlots`
 * below) — they used to live in `preset.ts`'s `FountainPreset`, which an
 * earlier task deleted once nothing but this module still read it.
 *
 * **No value import of `@/game/lanes` here, on purpose.** `Lane.TOP`/
 * `Lane.MID`/`Lane.BOT` are plain `'top'`/`'mid'`/`'bot'` strings — this
 * module writes them as literals instead, the same way
 * `packs/reference/provingGroundsGeometry.ts` writes `'mid'` for its own
 * lane. The `pack-core-boundary` seam bans a pack file from reaching
 * core outside the injected `ContentApi`, and `@/game/lanes` is a real
 * engine mechanism, not one of the three type-only exceptions that rule
 * allows.
 *
 * This module is Task 4 (of the earlier batch)'s lazy half of
 * `summonersRift.ts`'s `MapDefinition`: `./summonersRift.ts` exports only
 * the summary (`id`/`name`/`size`/`factions`) eagerly and reaches this file
 * through `() => import('./summonersRiftGeometry')`, so the JSON's raw text
 * — and the lane/jungle data below, neither of which the menu's own chunk
 * has any use for — never rides along with the picker. Rollup gives this
 * module its own chunk because nothing reaches it by a static import;
 * `tests/content/contentApiChunk.test.ts` and `scripts/check-chunks.mjs` are
 * what keep it that way, and `vite.config.ts`'s `map-<id>` `manualChunks`
 * rule matches a `<Name>Geometry.ts` file under any `packs/<name>/` tree
 * (including this one's own `maps/` subdirectory) ahead of the blanket
 * `/packs/riot/` -> chunk rule that would otherwise put it back in
 * `pregame`.
 *
 * The JSON is imported directly (as raw text, then parsed — see the import
 * above) rather than through `AssetManager`: this module is build-time data
 * assembly, and routing it through the asset manager would make the
 * definition depend on a load having already happened. It also does not sit
 * under `packs/riot/assets/` — the tree this pack's own `assets:generate` walks to mint
 * `AssetManager` keys — for the same reason core's own generator used to
 * carry a dedicated exclusion for it: nothing has ever read this file
 * through `AssetManager`, and a second, separate `?url` import of the same
 * bytes would ship the map twice.
 */

interface SummonerMapJson {
  wall: number[][][];
  bush: number[][][];
  water: number[][][];
  turret1: number[][];
  turret2: number[][];
}

const mapJson: SummonerMapJson = JSON.parse(mapJsonRaw);

const toPolygon = (points: readonly (readonly number[])[]): { x: number; y: number }[] =>
  points.map(([x, y]) => ({ x, y }));

const toPolygons = (
  polygons: readonly (readonly (readonly number[])[])[]
): { x: number; y: number }[][] => polygons.map(toPolygon);

/**
 * `turret1`/`turret2` ship as flat `[x, y]` lists — 11 points per side, all on
 * open ground at lane chokepoints. `turret1` is the bottom-left row (blue's)
 * and `turret2` the top-right one (red's).
 */
const TURRET_ROWS: readonly { key: 'turret1' | 'turret2'; faction: 'blue' | 'red' }[] = [
  { key: 'turret1', faction: 'blue' },
  { key: 'turret2', faction: 'red' },
];

const structureSlots = (): StructureSlot[] => {
  const slots: StructureSlot[] = [];
  for (const { key, faction } of TURRET_ROWS) {
    for (const [x, y] of mapJson[key]) {
      slots.push({ faction, kind: 'turret', x, y });
    }
  }
  return slots;
};

/**
 * The two spawn platforms, in the corners the map's own turret rows point at.
 * Coordinates were picked by scanning the wall polygons in summoner_map.json
 * for the roomiest open spot in each base — both sit ~260px clear of any
 * wall. This used to be `preset.ts`'s `FountainPreset`, a two-element array
 * whose *index* carried the team (`Game.spawnFountains()` read index 0 as
 * blue, 1 as red). A slot carries its own `faction` field instead, so the
 * order these two are listed in is no longer load-bearing — see
 * `preset.ts`'s `fountainsFromSlots`, the reader on the other end.
 */
const spawnSlots = (): SpawnSlot[] => [
  { faction: 'blue', x: 400, y: 6075, r: 190 },
  { faction: 'red', x: 6100, y: 375, r: 190 },
];

/**
 * Summoner's Rift's jungle camp *positions* — where a camp sits, split from
 * what stands in it (a camp is a place, a monster is a thing that fills it).
 *
 * Every camp's tuning (avatar, speed, size, attack range, health and the
 * rest) lives in `bundledPack.ts`'s own `monsters` data — real pack content,
 * matched to a slot here by `role` alone. `role` is a free string core never
 * interprets (`NeutralSlot.role`'s own doc comment); `Game.spawnJungle()`
 * resolves it through `PackRegistry.monstersFilling`.
 *
 * `campId` is gone. It used to tie a pack's bodies together — three entries
 * repeating one position — purely because position and identity were stored
 * in the same table. Splitting them removes the need: a pack of wolves is
 * one neutral slot (`role: 'wolves'`) and one `MonsterDef` with `count: 3`;
 * `Monster.alertCamp` finds packmates by the `camp` object every body spawned
 * into that slot shares, not by a shared id string.
 *
 * These eleven positions and radii are Summoner's Rift's own, unchanged
 * since this table was `src/game/mapPresets.ts`'s `NEUTRAL_SLOTS` — Task 6
 * only relocated the file, never a number in it.
 */
export const NEUTRAL_SLOTS: NeutralSlot[] = [
  { role: 'baron', x: 2147, y: 1876, r: 100 },
  { role: 'blue', x: 1631, y: 2958, r: 300 },
  { role: 'blue', x: 4794, y: 3419, r: 300 },
  { role: 'red', x: 3368, y: 4698, r: 300 },
  { role: 'red', x: 3085, y: 1672, r: 300 },
  { role: 'wolves', x: 1685, y: 3562, r: 300 },
  { role: 'wolves', x: 4728, y: 2835, r: 300 },
  { role: 'gromp', x: 914, y: 2784, r: 300 },
  { role: 'gromp', x: 5540, y: 3599, r: 300 },
  { role: 'raptors', x: 2954, y: 4110, r: 300 },
  { role: 'raptors', x: 3498, y: 2258, r: 300 },
];

/**
 * `NEUTRAL_SLOTS` copied defensively so nothing downstream can mutate the
 * shared source array.
 */
const neutralSlots = (): NeutralSlot[] => [...NEUTRAL_SLOTS];

/**
 * Summoner's Rift's own lane paths, ordered blue base -> red base. Red
 * minions walk the same list backwards (`src/game/lanes.ts`'s
 * `getLaneWaypoints`), so a lane is one piece of data, not two.
 *
 * summoner_map.json ships no lane geometry — only the two turret rows. These
 * paths follow those rows, split by which edge of the map they hug, with the
 * blue fountain (400, 6075) in front and the red one (6100, 375) behind:
 *
 *   turret1 (blue)                       turret2 (red)
 *     TOP  520,4432  604,3557  410,1859    TOP  1873,440  3423,595  4517,518
 *     MID 1617,4767 2153,4346 2543,3687    MID 3885,2723 4291,2044 4790,1617
 *     BOT  963,5626 1950,5837 2995,5775    BOT 5994,4467 5801,2864 5898,1922
 *          4558,5962
 *   base turret 736,5392                   base turrets 5454,779  5646,967
 *
 * The base turrets are not lane waypoints — they sit inside their fountain's
 * open ground rather than on a route out of it.
 *
 * ## A lane runs *past* each turret, and the segments are the lane
 *
 * A minion walks its lane with `moveTo` — a straight line to the next
 * waypoint, no routing (`Minion.updateWalk`). **So the lane is the segments,
 * not the waypoints**, and every guarantee has to hold along the whole of one.
 *
 * These paths used to be the turret coordinates nudged 80-108px to one side.
 * That cleared each *waypoint* of the turret's body — a turret is a 92px
 * immovable in `UnitCollisionSystem` and a minion is 34px across, so a minion
 * centre is held 63px out — and left the straight runs between them going
 * through the buildings: measured against the map, the segments passed turret
 * centres at 4, 5, 8, 14, 19 and 22px on BOT and MID. Every wave therefore
 * drove into the side of a turret, was shoved around it by the collision
 * system, and re-acquired the same line on the far side. That is the reported
 * bug, and the waypoint-only check that was supposed to catch it could not
 * see it at all.
 *
 * The paths below were re-derived from the wall polygons rather than nudged:
 * an A* over a 16px clearance grid in which a cell is blocked unless it is
 * 58px clear of a wall **and 118px from every turret centre**, with a cost
 * that prefers the middle of a corridor and is pulled toward this lane's own
 * turret row, then simplified to the fewest waypoints whose straight runs
 * keep both floors and do not stray more than 110px from the routed line.
 *
 * What that buys, measured over every segment of all three lanes:
 *
 *   - no point on any lane is closer than **118px** to a turret centre, so a
 *     minion body passes with 55px to spare instead of grinding along it
 *   - no point is closer than 58px to a wall (a minion has 17px of body)
 *   - each lane still passes each of its own turrets at 118-256px, well
 *     inside the range it is defended from
 *
 * `tests/packs/riot/maps/Lanes.test.ts` asserts all three, per segment.
 * Anything edited here has to be re-checked against it — the floors are
 * comfortable but the corridors they run down are 300-500px wide, and there
 * is no room to lose.
 */
export const SR_LANE_WAYPOINTS: Record<string, { x: number; y: number }[]> = {
  // up the left edge, then right along the top
  top: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 376, y: 4680 },
    { x: 696, y: 4456 }, // rounds turret 520,4432 on the east, passing at 121px
    { x: 456, y: 3448 }, // back to the middle past turret 604,3557 (119px)
    { x: 744, y: 1288 }, // one straight run up the left edge, 256px off 410,1859
    { x: 1592, y: 664 }, // the top-left turn
    { x: 3608, y: 456 }, // above turrets 1873,440 (194px) and 3423,595 (119px)
    { x: 4328, y: 584 },
    { x: 4792, y: 728 }, // dips under turret 4517,518, passing at 119px
    { x: 6100, y: 375 }, // red fountain
  ],

  // the diagonal
  mid: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 1144, y: 5672 }, // leaves the base right of the lump at (720, 5750)
    { x: 1416, y: 5208 },
    { x: 1784, y: 4760 }, // past turret 1617,4767 at 125px
    { x: 2120, y: 4152 }, // past turret 2153,4346 at 123px
    { x: 2760, y: 3672 }, // past turret 2543,3687 at 118px
    { x: 4200, y: 2232 }, // the long diagonal, 124px off turret 3885,2723
    { x: 4472, y: 2088 }, // past turret 4291,2044 at 124px
    { x: 5976, y: 856 }, // past turret 4790,1617 at 163px, then the red base
    { x: 6100, y: 375 }, // red fountain
  ],

  // right along the bottom, then up the right edge
  bot: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 1512, y: 5608 }, // past turret 963,5626 at 196px
    { x: 3096, y: 5928 }, // past turrets 1950,5837 (138px) and 2995,5775 (130px)
    { x: 5080, y: 5656 }, // one run along the bottom, 232px off 4558,5962
    { x: 5816, y: 4712 }, // the bottom-right turn, 164px off turret 5994,4467
    { x: 5944, y: 2424 }, // straight up the right edge, 118px off 5801,2864
    { x: 5736, y: 1832 }, // steps inside turret 5898,1922, passing at 123px
    { x: 6088, y: 1576 },
    { x: 6100, y: 375 }, // red fountain
  ],
};

const laneDefinitions = (): LaneDefinition[] =>
  ['top', 'mid', 'bot'].map(id => ({
    id,
    from: 'blue',
    to: 'red',
    waypoints: SR_LANE_WAYPOINTS[id],
  }));

/**
 * How far a released minion may be scattered around its muster point.
 *
 * Small: the whole reason a wave is not stacked on one coordinate is that
 * `UnitCollisionSystem` would then spend the first second of every wave
 * shoving six bodies apart. Sized under the gap between this map's own two
 * base turrets, so the scatter cannot put a body inside one — a fact about
 * Summoner's Rift's own geometry, which is why it lives here rather than as
 * a constant `MinionSpawner` (or any other map) would have to share.
 */
const MUSTER_SCATTER_PX = 55;

/**
 * Where a faction's wave forms up: the midpoint of the two turrets standing
 * nearest its own fountain — the pair that guards the base.
 *
 * This geometry is computed once here from the map's own structure slots and
 * baked into `slots.minion`, so a lane with no muster point is a validation
 * error at install (`validate.ts`) rather than a `null` discovered
 * mid-match.
 *
 * Exported so `tests/packs/riot/maps/Lanes.test.ts` can exercise the "fewer
 * than two turrets" case directly, without constructing a `Game` — a
 * synthetic, truncated turret list in, a definite point out. Never returns
 * null: two turrets gives a midpoint, one gives that turret's own position,
 * and zero gives the fountain itself — always somewhere a minion can be told
 * to stand.
 */
export const minionMusterPoint = (
  faction: string,
  fountain: { x: number; y: number },
  structures: readonly Pick<StructureSlot, 'faction' | 'x' | 'y'>[]
): { x: number; y: number } => {
  const own = structures
    .filter(s => s.faction === faction)
    .map(s => ({ x: s.x, y: s.y, away: Math.hypot(s.x - fountain.x, s.y - fountain.y) }))
    .sort((a, b) => a.away - b.away);

  if (own.length >= 2) return { x: (own[0].x + own[1].x) / 2, y: (own[0].y + own[1].y) / 2 };
  if (own.length === 1) return { x: own[0].x, y: own[0].y };
  return { x: fountain.x, y: fountain.y };
};

/**
 * One muster point per (faction, lane) — every lane a wave from that base
 * queues for musters in the same place today, since nothing yet varies the
 * point by lane (a lane-specific muster is future work, not this map
 * declaring one). `MinionSpawner.musterPoint(teamId, lane)` is the reader.
 */
const minionSlots = (structures: StructureSlot[], spawns: SpawnSlot[]): MinionSlot[] => {
  const slots: MinionSlot[] = [];
  for (const spawn of spawns) {
    const { x, y } = minionMusterPoint(spawn.faction, spawn, structures);
    for (const lane of ['top', 'mid', 'bot']) {
      slots.push({ faction: spawn.faction, lane, x, y, scatter: MUSTER_SCATTER_PX });
    }
  }
  return slots;
};

const structures = structureSlots();
const spawns = spawnSlots();

export const summonersRiftGeometry: MapGeometry = {
  terrain: {
    wall: toPolygons(mapJson.wall),
    bush: toPolygons(mapJson.bush),
    water: toPolygons(mapJson.water),
  },
  slots: {
    spawn: spawns,
    minion: minionSlots(structures, spawns),
    structure: structures,
    neutral: neutralSlots(),
  },
  lanes: laneDefinitions(),
};
