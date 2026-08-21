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
import TeamId from '@/game/enums/TeamId';
import { FountainPreset, MonsterPreset } from '@/game/mapPresets';
import { LANE_WAYPOINTS, Lane } from '@/game/lanes';
import type {
  LaneDefinition,
  MapDefinition,
  NeutralSlot,
  SpawnSlot,
  StructureSlot,
} from '../ContentPack';

/**
 * Summoner's Rift, assembled from the four places that used to each hold a
 * slice of it without knowing about the others: `assets/json/summoner_map.json`
 * (terrain and the two turret rows), `preset.ts`'s `FountainPreset`/
 * `MonsterPreset` (fountains and jungle camps, read here via `./mapPresets`
 * — see that module's header for why) and `lanes.ts` (waypoints). **Nothing
 * reads this map yet** — batches 4-8 move the readers over one at a time, so
 * a break is attributable to one change rather than to this assembly.
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
 * and `turret2` the top-right one (red's); this is the same mapping
 * `preset.ts`'s `TURRET_ROW_TEAMS`/`getTurretPositions` use — copied rather
 * than reinvented, per that function's own doc comment.
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

/** `FountainPreset`'s own index-order dependency (see that constant's doc
 * comment) stops mattering once the faction rides on the slot itself. */
const FACTION_OF_TEAM: Record<string, 'blue' | 'red'> = {
  [TeamId.BLUE]: 'blue',
  [TeamId.RED]: 'red',
};

const spawnSlots = (): SpawnSlot[] =>
  FountainPreset.map(fountain => {
    const faction = fountain.teamId === undefined ? undefined : FACTION_OF_TEAM[fountain.teamId];
    if (faction === undefined) {
      throw new Error(`FountainPreset entry "${fountain.name}" has no mapped faction`);
    }
    return { faction, x: fountain.x, y: fountain.y, r: fountain.r };
  });

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

export const summonersRift: MapDefinition = {
  id: 'summoners-rift',
  // The literal `Game.ts:107` and `TerrainMap.ts:25` both carry today; a
  // later batch makes it the map's.
  size: 6400,
  terrain: {
    wall: toPolygons(mapJson.wall),
    bush: toPolygons(mapJson.bush),
    water: toPolygons(mapJson.water),
  },
  factions: [{ id: 'blue' }, { id: 'red' }],
  slots: {
    spawn: spawnSlots(),
    minion: [],
    structure: structureSlots(),
    neutral: neutralSlots(),
  },
  lanes: laneDefinitions(),
};
