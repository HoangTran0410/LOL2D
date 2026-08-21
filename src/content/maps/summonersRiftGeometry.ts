// `?raw` rather than a plain JSON import: `vite.config.ts` sets
// `assetsInclude: ['**/*.json']` so `AssetManager` can hand out every JSON
// file as a fetchable URL at runtime, and that claims the extension ahead of
// Vite's own JSON-module plugin in a production build — a plain import here
// builds fine under Vitest (dev-style transform, unaffected by
// `assetsInclude`) and then fails `vite build` outright, `[plugin vite:json]
// ... Failed to parse JSON file`, because Rollup's asset pipeline gets the
// specifier first. `?raw` sidesteps the ambiguity in both dev and build: it
// always yields the file's raw text, which is parsed explicitly below.
import mapJsonRaw from '../../../assets/json/summoner_map.json?raw';
import { MonsterPreset } from '@/game/mapPresets';
import { LANE_WAYPOINTS, Lane } from '@/game/lanes';
import type {
  LaneDefinition,
  MapGeometry,
  NeutralSlot,
  SpawnSlot,
  StructureSlot,
} from '../ContentPack';

/**
 * Summoner's Rift's heavy half — terrain and slots — assembled from the
 * places that used to each hold a slice of it without knowing about the
 * others: `assets/json/summoner_map.json` (terrain and the two turret rows),
 * `preset.ts`'s `MonsterPreset` (jungle camps, read here via `./mapPresets`
 * — see that module's header for why) and `lanes.ts` (waypoints). The two
 * spawn platforms are a small literal right here (see `spawnSlots` below) —
 * they used to live in `preset.ts`'s `FountainPreset`, which Task 5 deleted
 * once nothing but this module still read it.
 *
 * This module is Task 4's lazy half of `summonersRift.ts`'s `MapDefinition`:
 * `../maps/summonersRift.ts` exports only the summary
 * (`id`/`name`/`size`/`factions`) eagerly and reaches this file through
 * `() => import('./summonersRiftGeometry')`, so the JSON's raw text — and
 * `MonsterPreset`/`lanes.ts`, neither of which the menu's own chunk has any
 * use for — never rides along with the picker. Rollup gives this module its
 * own chunk because nothing reaches it by a static import;
 * `tests/content/contentApiChunk.test.ts` and `scripts/check-chunks.mjs` are
 * what keep it that way.
 *
 * The JSON is imported directly (as raw text, then parsed — see the import
 * above) rather than through `AssetManager`: this module is build-time data
 * assembly, and routing it through the asset manager would make the
 * definition depend on a load having already happened.
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
 * `MonsterPreset` is 21 entries because a multi-body camp (three wolves, four
 * raptors) lists every body separately, tied together by a shared `campId`.
 * A neutral slot is a *place*, not a body count, so entries collapse — grouped
 * by `campId`, or by the entry's own key when it has none — down to the
 * position of the group's anchor: the one entry whose own key equals the
 * group id (the "big" member of a pack; a solo camp, with no `campId`, is
 * trivially its own anchor). The monsters that will stand here are Task 7's;
 * this only places where.
 */
const neutralSlots = (): NeutralSlot[] => {
  const anchors: NeutralSlot[] = [];
  for (const [key, preset] of Object.entries(MonsterPreset)) {
    const groupId = preset.campId ?? key;
    if (key !== groupId) continue;
    anchors.push({
      role: groupId.replace(/\d+$/, ''),
      x: preset.camp.x,
      y: preset.camp.y,
      r: preset.camp.r,
    });
  }
  return anchors;
};

const laneDefinitions = (): LaneDefinition[] =>
  [Lane.TOP, Lane.MID, Lane.BOT].map(id => ({
    id,
    from: 'blue',
    to: 'red',
    waypoints: LANE_WAYPOINTS[id],
  }));

export const summonersRiftGeometry: MapGeometry = {
  terrain: {
    wall: toPolygons(mapJson.wall),
    bush: toPolygons(mapJson.bush),
    water: toPolygons(mapJson.water),
  },
  slots: {
    spawn: spawnSlots(),
    minion: [],
    structure: structureSlots(),
    neutral: neutralSlots(),
  },
  lanes: laneDefinitions(),
};
