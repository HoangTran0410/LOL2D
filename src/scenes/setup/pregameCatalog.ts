import {
  BASIC_ATTACK_ID,
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
 * A reshaping of `SpellGroups` — the same shelves the in-game HUD picker
 * renders — reordered for a roster that is now ~50 deep: the two shelves that
 * are not a champion first, then the champions by name. See
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
  /**
   * What this shelf serves when it is not a champion's row: the basic attack,
   * or the summoner spells. `null` for every champion.
   *
   * The roster's tile grid holds neither of these — a tile opens a champion's
   * kit and neither of these is a champion — but the slot bar can still select
   * A, D or F, and those three slots are filled from exactly these two shelves.
   * This is how the editor knows which one to open for the selected slot; see
   * `LoadoutEditorModal.shelfForSlot`.
   *
   * Derived from the catalogue rather than from the display name: matching
   * `'Phép Bổ Trợ'` as a string would break the moment the label is
   * retranslated, and nothing in this file would notice.
   */
  nonChampionKind: 'basicAttack' | 'summoner' | null;
}

export interface PregameCatalog {
  champions: SelectableChampion[];
  summoners: SummonerSpellOption[];
  spellCatalog: SpellCatalogEntry[];
  /** `SpellCatalogEntry`, keyed by spell class reference — built once alongside `spellCatalog`. */
  catalogByClass: Map<SpellClass, SpellCatalogEntry>;
  /** The same, keyed by the stored id (an `AllSpells` barrel key) — what a persisted slot choice resolves through. */
  catalogById: Map<string, SpellCatalogEntry>;
  /** The picker roster: the two non-champion shelves first, then the champions by name — see the sort in `getPregameCatalog`. */
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
    const summoners = listSummonerSpells();
    const summonerIds = new Set(summoners.map(option => option.id));

    /**
     * Which of the two non-champion shelves this is, if either. Written out
     * rather than inlined as a ternary so the return type is `KitShelf`'s own
     * union — TypeScript widens a nested ternary of string literals to
     * `string`, and the shelf then no longer satisfies `KitShelf`.
     */
    const nonChampionKindOf = (entries: KitShelfEntry[]): KitShelf['nonChampionKind'] => {
      if (entries.some(e => e.entry.id === BASIC_ATTACK_ID)) return 'basicAttack';
      if (entries.length > 0 && entries.every(e => summonerIds.has(e.entry.id))) return 'summoner';
      return null;
    };

    /** `SpellGroups` order, for the pinned shelves — see the sort below. */
    const sourceOrder = new Map(SpellGroups.map((group, index) => [group.name, index]));

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
        nonChampionKind: nonChampionKindOf(entries),
      };
    })
      .filter(shelf => shelf.entries.length > 0)
      /**
       * Champions by name, with the two shelves that are not a champion pinned
       * ahead of them in `SpellGroups` order.
       *
       * A flat `localeCompare` put the basic attack between Cassiopeia and
       * Fizz, which is where nobody looks for it — and both pinned shelves are
       * things you reach for *while* building a kit rather than instead of one.
       *
       * `kit.length === 0` is the pin because it is already the predicate that
       * decides whether a shelf gets a whole-kit button and whether compact
       * mode shows it: one rule, three uses. `championName === null` is a
       * different question and would be the wrong test — a partial shelf has no
       * `championName` and is still a champion's row.
       *
       * The tie-break is explicit rather than leaning on `sort` being stable.
       * It is (V8, and specified since ES2019), and `sort` is not one of the
       * `Array.prototype` methods `main.ts` patches — but a reader should not
       * have to establish both of those to know why Đánh Thường comes first.
       */
      .sort((a, b) => {
        const aPinned = a.kit.length === 0;
        const bPinned = b.kit.length === 0;
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        if (aPinned) return (sourceOrder.get(a.name) ?? 0) - (sourceOrder.get(b.name) ?? 0);
        return a.name.localeCompare(b.name);
      });

    cached = {
      champions: listSelectableChampions(),
      summoners,
      spellCatalog,
      catalogByClass,
      catalogById: new Map(spellCatalog.map(entry => [entry.id, entry])),
      kitShelves,
    };
  }
  return cached;
};
