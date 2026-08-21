import type { MapDefinition } from '../ContentPack';

/**
 * Summoner's Rift's cheap half — enough for a picker to list, name and
 * describe it. Everything a match actually plays on — 329 wall polygons, 40
 * bush, 26 water, both turret rows, the fountains, the jungle camps, the
 * lanes — lives behind `geometry`'s dynamic import (`./summonersRiftGeometry.ts`)
 * and is fetched only once a match is starting, never when the menu paints.
 *
 * This module deliberately has no *value* imports beyond that dynamic one:
 * `tests/content/contentApiChunk.test.ts` walks `src/content/catalog.ts`'s
 * static closure and fails if it ever statically reaches
 * `summonersRiftGeometry.ts`, and `scripts/check-chunks.mjs` fails the build
 * if the `pregame` chunk grows back to where it sat before this split
 * (231,072 bytes, almost all of it the raw JSON) — see that script's own
 * comment for the exact numbers this was measured against.
 */
export const summonersRift: MapDefinition = {
  id: 'summoners-rift',
  name: "Summoner's Rift",
  // The literal `Game.ts:107` and `TerrainMap.ts:25` both used to carry
  // independently of this map; both now read it from here instead.
  size: 6400,
  factions: [{ id: 'blue' }, { id: 'red' }],
  geometry: () => import('./summonersRiftGeometry').then(module => module.summonersRiftGeometry),
};
