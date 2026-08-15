import {
  listSelectableChampions,
  listSummonerSpells,
  listSpellCatalog,
  abilitySlotOfId,
  SpellGroups,
  type SelectableChampion,
  type SummonerSpellOption,
  type SpellCatalogEntry,
} from '../../game/preset';
import type { AssetKey } from '../../managers/AssetManager';
import type { SpellClass } from './types';

/** One catalogue entry on a shelf, with the kit slot its name claims (`abilitySlotOfId`) or `null`. */
export interface KitShelfEntry {
  entry: SpellCatalogEntry;
  slotIndex: number | null;
}

/**
 * One champion's row in the loadout picker's roster: the shelf header
 * (portrait + name, and the "dùng cả bộ" action when there is a kit to
 * apply) and the ability icons under it.
 *
 * A straight reshaping of `SpellGroups` — the same shelves the in-game HUD
 * picker renders, in the same order — so the two pickers browse an identical
 * roster and a player who learned one already knows the other. See
 * `LoadoutEditorModal.vue`.
 */
export interface KitShelf {
  name: string;
  avatar: AssetKey | null;
  entries: KitShelfEntry[];
  /** The entries that name a Q/W/E/R slot. Empty for the two shelves that are not a champion (the basic attack, the summoner spells) — which is what leaves those without a whole-kit action. */
  kit: { entry: SpellCatalogEntry; slotIndex: number }[];
  /**
   * A valid `ChampionLoadout.championName` when this shelf is a full,
   * portrait-carrying champion — the same predicate `listSelectableChampions`
   * uses, so the two cannot disagree about what counts. `null` for a partial
   * shelf (Graves, Olaf, ...), which no `championName` can name and which
   * therefore has to land in the custom kit slot by slot.
   */
  championName: string | null;
}

export interface PregameCatalog {
  champions: SelectableChampion[];
  summoners: SummonerSpellOption[];
  spellCatalog: SpellCatalogEntry[];
  /** `SpellCatalogEntry`, keyed by spell class reference — built once alongside `spellCatalog`. */
  catalogByClass: Map<SpellClass, SpellCatalogEntry>;
  /** The same, keyed by the stored id (an `AllSpells` barrel key) — what a persisted slot choice resolves through. */
  catalogById: Map<string, SpellCatalogEntry>;
  /** The picker roster, in `SpellGroups` order. */
  kitShelves: KitShelf[];
}

let cached: PregameCatalog | null = null;

/**
 * `preset.ts`'s catalogue doesn't change at runtime, so this builds it once,
 * lazily, and every caller gets back the same object — the same "build once,
 * not on every render" rule `SetupScene.ts` used to enforce by hand in its
 * `setup()`. Every component that needs champion/summoner/spell data calls
 * this directly instead of receiving it through props, since it is read-only
 * and shared by several unrelated branches of the component tree (the
 * participant list's kit icons, the loadout picker's slot row and roster).
 */
export const getPregameCatalog = (): PregameCatalog => {
  if (!cached) {
    const spellCatalog = listSpellCatalog();
    const catalogByClass = new Map(spellCatalog.map(entry => [entry.spellClass, entry]));

    const kitShelves: KitShelf[] = SpellGroups.map(group => {
      const entries: KitShelfEntry[] = (group.spells as SpellClass[])
        .map(spellClass => catalogByClass.get(spellClass))
        .filter((entry): entry is SpellCatalogEntry => !!entry)
        .map(entry => ({ entry, slotIndex: abilitySlotOfId(entry.id) }));

      return {
        name: group.name,
        avatar: group.image,
        entries,
        kit: entries
          .filter((e): e is { entry: SpellCatalogEntry; slotIndex: number } => e.slotIndex !== null)
          .map(e => ({ entry: e.entry, slotIndex: e.slotIndex })),
        // Deliberately the same test as `listSelectableChampions` — portrait
        // plus exactly four abilities — and not "the kit covers all of
        // Q/W/E/R". `getChampionPresetFromLoadout` resolves a `championName`
        // by the shelf's *position* (spells[0] is Q), so a shelf this calls a
        // champion must be one that function will also accept, whatever the
        // ability names happen to say.
        championName: group.image && group.spells.length === 4 ? group.name : null,
      };
    }).filter(shelf => shelf.entries.length > 0);

    cached = {
      champions: listSelectableChampions(),
      summoners: listSummonerSpells(),
      spellCatalog,
      catalogByClass,
      catalogById: new Map(spellCatalog.map(entry => [entry.id, entry])),
      kitShelves,
    };
  }
  return cached;
};
