import type { MapDefinition } from '@moba2d/core/content/ContentPack';

/**
 * The reference pack's own map — Task 9 of the content-pack extraction.
 *
 * Spec §8.2's reasoning, restated because it is the whole design: a second
 * pack that only proves the seam works ("the scan found nothing") does not
 * prove *coverage* — twelve nav/lane/muster tests use Summoner's Rift's own
 * polygon soup as a stress fixture, and the `NavGrid` clearance bug this
 * project shipped once only ever surfaced because SR's jungle has 60-90px
 * gaps. So this map is not decoration; it is a second, independent fixture
 * with the same two hostile properties, on purpose: a corridor in that same
 * 60-90px band (`tests/content/referenceMap.test.ts`'s `wallGapWidths`
 * measures it the way `NavGrid.fromPolygons` would), and a structure row
 * that is not symmetric across factions, so a muster rule that happened to
 * assume symmetry cannot pass by coincidence.
 *
 * It is also deliberately small and legible, and deliberately **not** Riot's
 * — two factions, one lane, a handful of walls, one neutral camp filled by
 * this pack's own monster. Batch 4 moves the Riot map out of core entirely;
 * this is what proves core can already ship a world that is not that one.
 *
 * Split the same way `packs/riot/maps/summonersRift.ts` splits, for the
 * same reason: this module is the cheap summary a picker lists, and the
 * heavy half — walls, slots, the lane — sits behind `geometry`'s dynamic
 * import so it never rides along in the `pregame` chunk the menu loads.
 * `vite.config.ts`'s `map-<id>` `manualChunks` rule matches this file's
 * geometry module by its `<Name>Geometry.ts` basename the same way it
 * matches Summoner's Rift's, extended to also look under any `packs/<name>/` —
 * `npm run chunks:check` and a real `vite build` are what confirm that
 * still holds; a `manualChunks` *path* rule silently defeats a dynamic
 * import if nothing carves out the target ahead of the blanket
 * `/packs/reference/` -> `pregame` rule.
 */
export const referenceMap: MapDefinition = {
  id: 'proving-grounds',
  name: 'Sân Thử Nghiệm',
  size: 2400,
  factions: [{ id: 'amber' }, { id: 'jade' }],
  geometry: () => import('./provingGroundsGeometry').then(module => module.provingGroundsGeometry),
};
