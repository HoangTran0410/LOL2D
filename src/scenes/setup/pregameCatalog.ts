import {
  listSelectableChampions,
  listSummonerSpells,
  listSpellCatalog,
  type SelectableChampion,
  type SummonerSpellOption,
  type SpellCatalogEntry,
} from '../../game/preset';
import type { SpellClass } from './types';

export interface PregameCatalog {
  champions: SelectableChampion[];
  summoners: SummonerSpellOption[];
  spellCatalog: SpellCatalogEntry[];
  /** `SpellCatalogEntry`, keyed by spell class reference — built once alongside `spellCatalog`. */
  catalogByClass: Map<SpellClass, SpellCatalogEntry>;
}

let cached: PregameCatalog | null = null;

/**
 * `preset.ts`'s catalogue doesn't change at runtime, so this builds it once,
 * lazily, and every caller gets back the same object — the same "build once,
 * not on every render" rule `SetupScene.ts` used to enforce by hand in its
 * `setup()`. Every component that needs champion/summoner/spell data calls
 * this directly instead of receiving it through props, since it is read-only
 * and shared by several unrelated branches of the component tree (the
 * champion grid, the summoner slots, the catalogue picker, the custom-slot
 * buttons).
 */
export const getPregameCatalog = (): PregameCatalog => {
  if (!cached) {
    const spellCatalog = listSpellCatalog();
    cached = {
      champions: listSelectableChampions(),
      summoners: listSummonerSpells(),
      spellCatalog,
      catalogByClass: new Map(spellCatalog.map(entry => [entry.spellClass, entry])),
    };
  }
  return cached;
};
