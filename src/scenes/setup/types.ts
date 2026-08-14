import type { SpellDisplay } from '../../game/preset';

/**
 * Shared across the pregame setup components. A spell class is one of the ~85
 * named exports of `src/game/gameObject/spells/index.ts` — see the comment on
 * `SpellClass` in `game/preset.ts` for why this stays `any` rather than a
 * proper union: `AllSpells` is a namespace of classes, not a discriminated
 * type, and every consumer here only ever calls `new SpellClass(owner)` or
 * passes the reference back to `getSpellDisplay`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpellClass = any;

/**
 * What `SpellSelectorPane.vue` picks from — structurally satisfied by both
 * `SpellCatalogEntry` (the full catalogue, for a custom kit slot) and
 * `SummonerSpellOption` (the 5-entry summoner list, for a D/F slot), so
 * either can be passed in without reshaping.
 */
export interface SelectorEntry {
  id: string;
  spellClass: SpellClass;
  display: SpellDisplay;
}

/** One heading + its entries in the catalogue pane. `name: null` renders no heading (the flat summoner list). */
export interface SelectorGroup {
  name: string | null;
  entries: SelectorEntry[];
}
