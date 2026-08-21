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
import { NEUTRAL_SLOTS } from '@/game/mapPresets';
import { DEFAULT_LANE_WAYPOINTS, Lane } from '@/game/lanes';
import type {
  LaneDefinition,
  MapGeometry,
  MinionSlot,
  NeutralSlot,
  SpawnSlot,
  StructureSlot,
} from '../ContentPack';

/**
 * Summoner's Rift's heavy half — terrain and slots — assembled from the
 * places that used to each hold a slice of it without knowing about the
 * others: `assets/json/summoner_map.json` (terrain and the two turret rows),
 * `mapPresets.ts`'s `NEUTRAL_SLOTS` (jungle camp *positions* — see that
 * module's header for why the identities that fill them live in
 * `bundledPack.ts` instead) and `lanes.ts`'s `DEFAULT_LANE_WAYPOINTS` — this
 * map's own waypoint data, imported here rather than the other way round, so
 * that once a match installs it (`Game`'s constructor,
 * `setActiveLanes(map.lanes)`) `lanes.ts` is reading the map's lanes rather
 * than the map reading back whatever `lanes.ts` currently has active. The two
 * spawn platforms are a small literal right here (see `spawnSlots` below) — they
 * used to live in `preset.ts`'s `FountainPreset`, which Task 5 deleted once
 * nothing but this module still read it.
 *
 * This module is Task 4's lazy half of `summonersRift.ts`'s `MapDefinition`:
 * `../maps/summonersRift.ts` exports only the summary
 * (`id`/`name`/`size`/`factions`) eagerly and reaches this file through
 * `() => import('./summonersRiftGeometry')`, so the JSON's raw text — and
 * `NEUTRAL_SLOTS`/`lanes.ts`, neither of which the menu's own chunk has any
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
 * `NEUTRAL_SLOTS` is `mapPresets.ts`'s own table (position and `role` only —
 * no monster identity, no `campId`; see that module's header). Copied
 * defensively so nothing downstream can mutate the shared source array.
 */
const neutralSlots = (): NeutralSlot[] => [...NEUTRAL_SLOTS];

const laneDefinitions = (): LaneDefinition[] =>
  [Lane.TOP, Lane.MID, Lane.BOT].map(id => ({
    id,
    from: 'blue',
    to: 'red',
    waypoints: DEFAULT_LANE_WAYPOINTS[id],
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
 * Used to be recomputed at spawn time, per wave, from the live `Turret`
 * objects (`MinionSpawner.musterPointFor`, deleted in Task 6) — and it
 * returned `null` for a team with fewer than two turrets, silently dropping
 * every wave into the fountain until someone noticed. This is that same
 * geometry, computed once here from the map's own structure slots and baked
 * into `slots.minion`, so a lane with no muster point is a validation error
 * at install (`validate.ts`) rather than a `null` discovered mid-match.
 *
 * Exported so `Lanes.test.ts` can exercise the "fewer than two turrets" case
 * directly, without constructing a `Game` — a synthetic, truncated turret
 * list in, a definite point out. Never returns null: two turrets gives a
 * midpoint, one gives that turret's own position, and zero gives the
 * fountain itself — always somewhere a minion can be told to stand.
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
    for (const lane of [Lane.TOP, Lane.MID, Lane.BOT]) {
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
