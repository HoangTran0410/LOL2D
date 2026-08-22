import type { MapDefinition } from '@moba2d/core/content/ContentPack';

/**
 * Summoner's Rift's cheap half — enough for a picker to list, name and
 * describe it. Everything a match actually plays on — 329 wall polygons, 40
 * bush, 26 water, both turret rows, the fountains, the jungle camps, the
 * lanes — lives behind `geometry`'s dynamic import (`./summonersRiftGeometry.ts`)
 * and is fetched only once a match is starting, never when the menu paints.
 *
 * Task 6 of the content-pack extraction moved this whole module (and its
 * geometry sibling) out of `src/content/maps/` and into the pack: Summoner's
 * Rift is Riot's own map, not a mechanism core has to carry. `import type`
 * only, matching the pack boundary every other file under `packs/` holds to
 * (the `pack-core-boundary` seam) — this module has no *value* import
 * beyond the dynamic one, same as before the move.
 *
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
