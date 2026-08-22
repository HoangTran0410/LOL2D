import {
  BASIC_ATTACK_ID,
  bareCatalogId,
  packSpellCatalogEntry,
  listSelectableChampions,
  listSummonerSpells,
  listSpellCatalog,
  abilitySlotOfId,
  type SelectableChampion,
  type SummonerSpellOption,
  type SpellCatalogEntry,
} from '@/game/config/spellCatalog';
import { contentCatalog } from '@/content/catalog';
import { removeAccents } from '@/utils/index';

/**
 * Folds a name for the picker's search box: case- and accent-insensitive.
 *
 * `removeAccents` rather than a hand-rolled strip — `src/utils/index.ts`
 * already owns that transform and is already on this screen's import path.
 */
const searchKey = (text: string): string => removeAccents(text).toLowerCase().trim();

/**
 * Whether `name` answers `query` — a plain substring test, both sides folded.
 *
 * An empty (or all-space) query matches everything, which is what makes
 * clearing the box restore the list without the caller having to special-case
 * it. Accents are folded on both sides because the player types on a
 * Vietnamese keyboard: Riot's champion names carry none, so that half only
 * pays off on the saved-kit shelf, which the same box filters.
 */
export const matchesQuery = (name: string, query: string): boolean => {
  const needle = searchKey(query);
  return needle === '' || searchKey(name).includes(needle);
};

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
 * A reshaping of `CHAMPION_KITS` — the same shelves the in-game HUD picker
 * renders — reordered for a roster that is now ~50 deep: the two shelves that
 * are not a champion first, then the champions by name. See
 * `LoadoutEditorModal.vue`.
 */
export interface KitShelf {
  name: string;
  /** A pack's own asset key — a plain string; resolve it through `packAsset` from `@/game/config/spellCatalog`. */
  avatar: string | null;
  entries: KitShelfEntry[];
  /** The entries that name a Q/W/E/R slot. Empty for the two shelves that are not a champion (the basic attack, the summoner spells) — which is what leaves those without a whole-kit action. */
  kit: { entry: SpellCatalogEntry; slotIndex: number }[];
  /**
   * A valid `ChampionLoadout.championName` when this shelf is a full,
   * portrait-carrying champion — the same predicate `listSelectableChampions`
   * uses, so the two cannot disagree about what counts. `null` for a partial
   * shelf (a single-ability stub, ...), which no `championName` can name and which
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
  /** `SpellCatalogEntry` keyed by the stored id (an `AllSpells` barrel key) — what a persisted slot choice resolves through, and the only identity this screen uses. */
  catalogById: Map<string, SpellCatalogEntry>;
  /** The picker roster: the two non-champion shelves first, then the champions by name — see the sort in `getPregameCatalog`. */
  kitShelves: KitShelf[];
}

let cached: PregameCatalog | null = null;

/**
 * The catalogue doesn't change at runtime, so this builds it once,
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
    const catalogById = new Map(spellCatalog.map(entry => [entry.id, entry]));
    const summoners = listSummonerSpells();
    // Plain `Set<string>` inference — `summonerIds.has` below is checked
    // against `KitShelfEntry.entry.id`, which is `string` (a pack's own
    // qualified id can live there too, see `SpellCatalogEntry.id`'s doc
    // comment). Until batch 5 task 2 this needed an explicit `Set<string>`
    // annotation to avoid inferring the narrower `Set<SpellCatalogId>` —
    // `SpellCatalogId` was the bundled pack's own 237-literal union then, and
    // `.has()` would have refused a foreign pack's id. `SpellCatalogId` is
    // `string` itself now, so the two infer identically and the annotation
    // no longer changes anything.
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

    /** Registry install order, for the pinned shelves — see the sort below. The riot pack installs first and lists these in `CHAMPION_KITS`'s own order, so this reproduces that ordering without reading `CHAMPION_KITS` directly. */
    const sourceOrder = new Map(
      contentCatalog()
        .champions()
        .map((champion, index) => [champion.name, index])
    );

    const kitShelves: KitShelf[] = contentCatalog()
      .champions()
      .map(champion => {
        // `champion.spells` are registry-qualified (`riot:<Champion>_Q`,
        // `reference:Vera_Q`); `catalogById` keys by the *bundled* pack's own
        // bare id (`spellCatalogIds()`'s population). `bareCatalogId` is the
        // same crossing `spellCatalog.ts` uses internally, and for any other
        // pack's id it answers `null` on purpose — `packSpellCatalogEntry` is
        // its companion, reading the registry directly by the qualified id
        // rather than dropping a champion whose kit lives entirely outside
        // the bundled pack.
        const entries: KitShelfEntry[] = [];
        for (const qualifiedId of champion.spells) {
          const id = bareCatalogId(qualifiedId);
          const entry = id ? catalogById.get(id) : packSpellCatalogEntry(qualifiedId);
          if (entry) entries.push({ entry, slotIndex: abilitySlotOfId(entry.id) });
        }

        const kit: { entry: SpellCatalogEntry; slotIndex: number }[] = [];
        for (const e of entries) {
          if (e.slotIndex !== null) kit.push({ entry: e.entry, slotIndex: e.slotIndex });
        }

        return {
          name: champion.name,
          avatar: champion.image,
          entries,
          kit,
          // `champion.playable` is exactly "portrait plus exactly four
          // abilities" — validated once at pack install
          // (`content/validate.ts`) rather than re-derived here, and it is
          // the same rule `listSelectableChampions` now reads too.
          // `getChampionPresetFromLoadout` resolves a `championName` by the
          // shelf's *position* (spells[0] is Q), so a shelf this calls a
          // champion must be one that function will also accept, whatever the
          // ability names happen to say.
          championName: champion.playable ? champion.name : null,
          nonChampionKind: nonChampionKindOf(entries),
        };
      })
      .filter(shelf => shelf.entries.length > 0)
      /**
       * Champions by name, with the two shelves that are not a champion pinned
       * ahead of them in `CHAMPION_KITS` order.
       *
       * A flat `localeCompare` put the basic attack between two champions
       * alphabetically nowhere near either end, which is where nobody looks for it — and both pinned shelves are
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
      catalogById,
      kitShelves,
    };
  }
  return cached;
};
