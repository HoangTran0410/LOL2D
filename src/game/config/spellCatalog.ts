import AssetManager from '@/managers/AssetManager';
// Relative, not `@/generated/spellCatalog`: batch 4 task 3 moved the 237
// bundled spell ids into `packs/riot/generated/spellCatalog.ts` — core's own
// generated union is now just `'BasicAttack'`. `tests/content/rosterSource.test.ts`
// only bans the `@/generated/...` alias form, so this relative import does
// not need adding to its (now empty) allow-list.
import type { SpellCatalogId as PackSpellCatalogId } from '../../../packs/riot/generated/spellCatalog';
import type { MatchRules } from './PregameConfig';
import { contentCatalog } from '@/content/catalog';
import type { SpellDisplayData } from '@/content/ContentPack';
import { packAsset } from './packAsset';

/**
 * The one file allowed to name the riot pack's generated catalogue
 * directly for its id type — see `tests/content/rosterSource.test.ts`.
 * Re-exported here so a caller that needs only the id type, not a spell's
 * display data, still goes through this module rather than reaching past
 * it.
 *
 * A union with core's own `'BasicAttack'`, not just the pack's 237: slot 0
 * of every kit is `BASIC_ATTACK_ID`, which is core's id, not the riot
 * pack's own.
 */
export type SpellCatalogId = PackSpellCatalogId | 'BasicAttack';

/**
 * The spell catalogue as **data**: names, icons, numbers and which abilities
 * make up which champion — everything the pregame screen renders, and not one
 * line of anything a match executes.
 *
 * ## Why this is not in `preset.ts`
 *
 * It was. `preset.ts` answered "what does this ability look like?" by building
 * a throwaway `new SpellClass({ game: { matchRules } })` and reading seven
 * fields off it, which meant the setup screen's very first import pulled
 * `import * as AllSpells` — all 238 spell modules, ~71% of the 1.1MB game
 * chunk — to put names and icons on a grid. Vite's `manualChunks` sends
 * anything under `src/game/` to the `game` chunk, so there was no arranging
 * around it: touching `preset.ts` *was* loading the game.
 *
 * The instances are still built, once, by `scripts/generate-spell-catalog.mjs`
 * at build time — but this module no longer reads that generated table
 * directly. It is `packs/riot/data.ts`'s data now (batch 4 task 7 — the
 * roster, `CHAMPION_KITS` as it used to be called here, moved into the pack
 * itself, real content rather than a table core kept for an adapter to
 * read), installed into the one `PackRegistry` every pack's data answers
 * through (`contentCatalog()` from `@/content/catalog` — the data-only
 * accessor, not `contentRegistry()`: this module never needs a spell
 * *class*, so it stays off the accessor that builds one), and this module
 * reads *that*: a spell's display data by qualified id, a champion's roster
 * row by pack entry. The qualifying itself is a local `qualifyBundledId`,
 * not the `qualifySpellId` the rest of the engine shares
 * (`@/game/spellRegistry`) — that module sits in the `game` chunk, and
 * reaching into it from here would close a cycle with the registry install
 * path; see `qualifyBundledId`'s own doc comment. `shelfNameById` below is
 * the one place left that walks the whole roster rather than resolving one
 * id at a time.
 *
 * ## The two numbers that move
 *
 * `SpellDisplay` has seven fields and five are constants. The other two —
 * `effectiveCoolDownMs`, `effectiveManaCost` — depend on the match's rules,
 * and both are *pure functions* of the constants: `Spell.reducedCooldown` is
 * `duration * multiplier` and `Spell.effectiveMana` is `manaFree ? 0 : amount`.
 * So the generated file stores the rule-free numbers and `spellDisplayOf`
 * reapplies the rules here, producing the identical object `getSpellDisplay`
 * would have. `tests/game/config/spellCatalog.test.ts` asserts that
 * equivalence against the real classes, spell by spell — which is what keeps
 * this from drifting into a second, quietly-wrong source of truth.
 *
 * `preset.ts` still owns everything that needs a *class*: resolving a stored
 * loadout into castable spells, and `getSpellDisplay` for the in-game HUD,
 * which is already inside the game chunk and has nothing to save.
 */

/** The `AllSpells` barrel key of the basic attack — the A slot's default, and the way back to it. */
export const BASIC_ATTACK_ID = 'BasicAttack';

/** No cooldown reduction, no URF — what a spell shows outside any pregame context. */
const NO_MATCH_RULES: MatchRules = { cooldownMultiplier: 1, manaFree: false };

export interface SpellDisplay {
  /**
   * The icon, ready for an `<img src>`. Resolved here from the generated
   * `iconKey` rather than stored, because a built URL is a content hash — the
   * generated file would need rewriting every time an image changed.
   */
  iconUrl: string | null;
  name: string;
  /** Vietnamese HTML — `<span class="damage">`/`.buff`/`.time`/plain `<span>`. */
  description: string;
  /** The spell's own tuning number, unaffected by match rules. */
  coolDownMs: number;
  /** The spell's own tuning number, unaffected by match rules. */
  manaCost: number;
  /** `coolDownMs` after cooldown reduction — equal to it under no match rules. */
  effectiveCoolDownMs: number;
  /** `manaCost`, zeroed under URF — equal to `manaCost` under no match rules. */
  effectiveManaCost: number;
}

/**
 * The bundled pack's id, restated as a literal rather than imported —
 * `BUNDLED_PACK_ID` (`@/content/install`) and `qualifySpellId`
 * (`@/game/spellRegistry`, which reads that same constant) both sit in the
 * `game` chunk's own reach.
 * A value import running the other way closes `pregame -> game -> pregame`,
 * a cycle `npm run build` refuses to chunk ("Circular chunk: pregame ->
 * game -> pregame") — confirmed by hitting it before this file settled on
 * the literal. `tests/game/config/spellCatalog.test.ts` pins this string
 * against `BUNDLED_PACK_ID` so a rename cannot drift the two apart in
 * silence.
 */
const BUNDLED_PACK_PREFIX = 'riot:';

/**
 * A bare id, qualified for the bundled pack — the same rule `qualifySpellId`
 * applies, restated locally for the chunk-boundary reason above. An
 * already-qualified id (containing `:`) passes through unchanged.
 */
const qualifyBundledId = (id: string): string =>
  id.includes(':') ? id : `${BUNDLED_PACK_PREFIX}${id}`;

/**
 * A registry-qualified id, stripped back to the bundled pack's own bare form
 * — the id `spellCatalogIds()`/`listSpellCatalog()` and every persisted
 * loadout slot already key by. `null` for an id from a different pack: this
 * module's picker-facing functions are bundled-pack-only for now (a future
 * pack's abilities are reachable through the registry directly, not through
 * this catalogue), so a foreign id has nothing here to resolve to yet.
 *
 * Exported for `pregameCatalog.ts`, which faces the same crossing: a
 * `QualifiedChampion.spells` entry has to key into this catalogue's own
 * bare-id `catalogById` map.
 */
export const bareCatalogId = (qualifiedId: string): SpellCatalogId | null =>
  qualifiedId.startsWith(BUNDLED_PACK_PREFIX)
    ? (qualifiedId.slice(BUNDLED_PACK_PREFIX.length) as SpellCatalogId)
    : null;

/**
 * `bareCatalogId`'s companion for the id it refuses: a `SpellCatalogEntry`
 * built straight off the registry by the *qualified* id, for a caller that
 * still needs something to show a champion whose kit is not the bundled
 * pack's own — `pregameCatalog.ts`'s shelf builder, so a pack champion is
 * not silently dropped from the picker for having no entries.
 *
 * Reads through `contentCatalog().spellDisplay(qualifiedId)` directly
 * rather than through `spellDisplayOf`: that always re-qualifies a bare id
 * as the *bundled* pack's own (`qualifyBundledId`), which would ask the
 * registry for the wrong spell entirely once the id is some other pack's.
 *
 * `id` on the entry returned is the **qualified** id, not the local half —
 * this is the one thing that must survive from here into a persisted slot.
 * Every display-backed population this module offers (`spellCatalogIds`,
 * `isSpellCatalogId`, `spellDisplayOf`) keys by the qualified id, and so does
 * `isSpellId`/`allSpellIds` in `@/game/spellRegistry`, which is what
 * `preset.ts` validates a stored slot against before a match starts. Handing
 * back the local half here used to write e.g. `Vera_Q` into a custom slot —
 * a string that re-qualifies as `riot:Vera_Q` (the *bundled* pack's id,
 * `qualifySpellId`'s bare-id rule) rather than `reference:Vera_Q`, so the
 * slot silently failed every one of those lookups and `preset.ts` rerolled
 * it to a random bundled spell. `SpellCatalogEntry.id` is `string`, not
 * core's generated `SpellCatalogId` union, precisely so a pack's own
 * qualified id can live here without a cast back into that union.
 */
export const packSpellCatalogEntry = (qualifiedId: string): SpellCatalogEntry | null => {
  const entry = contentCatalog().spellDisplay(qualifiedId);
  if (!entry) return null;
  return {
    id: qualifiedId,
    display: displayFromEntry(entry, NO_MATCH_RULES),
    groupName: null,
  };
};

/** Whether a stored slot choice still names a spell this build has. */
export const isSpellCatalogId = (id: string): id is SpellCatalogId =>
  contentCatalog().hasDisplayFor(qualifyBundledId(id));

/** Every catalogue id the bundled pack has display data for, in registry order. */
export const spellCatalogIds = (): SpellCatalogId[] => {
  const ids: SpellCatalogId[] = [];
  for (const qualifiedId of contentCatalog().spellDisplayIds()) {
    const bare = bareCatalogId(qualifiedId);
    if (bare) ids.push(bare);
  }
  return ids;
};

/** What `spellDisplayOf` returns for an id the registry has no display data for — a stale save naming a removed spell degrades to this rather than throwing. */
const MISSING_SPELL_DISPLAY: SpellDisplay = {
  iconUrl: null,
  name: '?',
  description: '',
  coolDownMs: 0,
  manaCost: 0,
  effectiveCoolDownMs: 0,
  effectiveManaCost: 0,
};

/**
 * A registry `SpellDisplayData` entry, with match rules applied — the shape
 * both `spellDisplayOf` (bundled ids) and `packSpellCatalogEntry` (any other
 * pack's) hand back, so the two never restate this mapping differently.
 *
 * The two rule-sensitive numbers are recomputed rather than stored, by the
 * same two expressions `Spell` uses — see this module's header for why that is
 * exact rather than approximate.
 */
const displayFromEntry = (entry: SpellDisplayData, matchRules: MatchRules): SpellDisplay => ({
  // `?.url` rather than `.url`: a handle is always returned in the real
  // manager, but "no icon" has to stay a missing picture rather than a thrown
  // error — which is exactly what the class-shaped `getSpellDisplay` promised
  // with its own `handle?.url ?? null`. `entry.iconKey` is a pack's own plain
  // string, not core's generated `AssetKey` union — the same boundary
  // `ContentApi.asset` crosses, and the same `as never`.
  iconUrl: entry.iconKey ? (AssetManager.get(entry.iconKey as never)?.url ?? null) : null,
  name: entry.name,
  description: entry.description,
  coolDownMs: entry.coolDownMs,
  manaCost: entry.manaCost,
  effectiveCoolDownMs: entry.specCoolDownMs * matchRules.cooldownMultiplier,
  effectiveManaCost: matchRules.manaFree ? 0 : entry.manaCost,
});

/**
 * One spell's display fields, with match rules applied. `qualifyBundledId`
 * passes an already-qualified id straight through, so this equally answers
 * for a bare bundled-pack id (`'Yasuo_Q'`) and for another pack's own
 * qualified id (`'reference:Vera_Q'`, e.g. from `SelectableChampionSpell.id`
 * or a picker entry's `id`) — only a *bare* id from a pack other than the
 * bundled one has nothing to resolve to here; see `packSpellCatalogEntry` for
 * that case. `id` is `string`, not `SpellCatalogId`, for the same reason:
 * every caller here now hands back whatever the registry actually keys by,
 * bundled or not.
 */
export const spellDisplayOf = (
  id: string,
  matchRules: MatchRules = NO_MATCH_RULES
): SpellDisplay => {
  const entry = contentCatalog().spellDisplay(qualifyBundledId(id));
  if (!entry) return MISSING_SPELL_DISPLAY;
  return displayFromEntry(entry, matchRules);
};

/**
 * A spell's icon key, unresolved — for a caller that needs to
 * `AssetManager.ensure()` the asset itself (a preload) rather than render it.
 * The same registry lookup `spellDisplayOf` makes, minus the `AssetManager.get`
 * step that turns the key into a handle.
 */
export const spellIconKey = (id: string): string | null =>
  contentCatalog().spellDisplay(qualifyBundledId(id))?.iconKey ?? null;

/**
 * Basic-attack role profiles (marksman, mage, bruiser, ...) moved out of
 * here and into `packs/riot/data.ts`'s own `ATTACK` (a fix-round finding:
 * this file's copy had no consumer left in `src/`, so it was a dead,
 * unguarded duplicate of the numbers a match actually ships — the roster's
 * vocabulary belongs to the roster, not the engine). `DEFAULT_CHAMPION_ATTACK`
 * (`@/game/gameObject/attackableUnits/Champion`) is the mechanism that
 * survives here: the fallback for a champion with no profile at all.
 */

/**
 * The roster itself — every champion this pack ships, what used to be
 * `CHAMPION_KITS` here — moved into `packs/riot/data.ts` (batch 4 task 7).
 * `shelfNameById` below is the one remaining reader in this file, and it
 * reads the roster back out of the registry (`contentCatalog().champions()`)
 * rather than a module-scope constant, the same way `listSelectableChampions`
 * above already does.
 */

// ---------------------------------------------------------------------------
// The pregame screen's three lists.
//
// Same shapes `preset.ts` used to return, with `spellClass` replaced by `id`
// everywhere. That substitution is the whole migration: every consumer only
// ever used the class as an *identity token* — to key a Map, to compare two
// icons, to hand back to `getSpellDisplay` — and an id does all three, with
// the bonus that it round-trips through `localStorage`, which a class
// reference never could.
// ---------------------------------------------------------------------------

export interface SelectableChampionSpell {
  /**
   * The bundled pack's own bare id (`'Yasuo_Q'`) for a bundled champion, or
   * another pack's registry-qualified id (`'reference:Vera_Q'`) for one of
   * its champions — never that pack's *bare* local id. `string`, not
   * `SpellCatalogId`: that generated union is the bundled pack's own bare ids
   * only, and a pack's qualified id is not a member of it. This is the id a
   * persisted slot ends up storing (`LoadoutEditorModal.pickSpell`), so it
   * has to be whatever `isSpellId`/`spellDisplayOf` can resolve back.
   */
  id: string;
  display: SpellDisplay;
}

export interface SelectableChampion {
  /** Matches `ChampionLoadout.championName` and a roster row's own `name`. */
  name: string;
  /**
   * A pack's own asset key — a plain string, not core's generated `AssetKey`
   * union, because a pack's art is its own to type-check, not core's. See
   * `packAsset` for the resolving side of this boundary.
   */
  avatar: string;
  spells: SelectableChampionSpell[];
}

/**
 * A pack's own asset key, resolved to a handle — the same boundary
 * `ContentApi.asset` crosses (`key as never`), for the same reason: a pack's
 * icon/portrait key is a plain string, not core's generated `AssetKey`
 * union. The pregame roster's own art (`SelectableChampion.avatar`,
 * `KitShelf.avatar`) is bundled-pack-only today, so this always resolves —
 * the cast is about the *type* boundary between a pack and core, not about
 * degrading a lookup that might miss.
 *
 * Re-exported from `./packAsset`, the crossing's one home — see that
 * module's header for why it has to be a leaf with no imports of its own.
 */
export { packAsset };

/**
 * Champions the pregame screen can offer as a coherent kit: a real portrait
 * and all four of Q/W/E/R implemented — `playable` in the registry, which is
 * exactly that rule, validated once at pack install rather than re-checked
 * here (Task 3 moved it into pack validation; re-applying it here would mean
 * two definitions of pickable again). The roster also carries
 * single-ability stubs (Olaf, Graves, Thresh, ...) used to fill the random
 * pool — picking one of those directly would leave three of its four ability
 * slots empty, so they're left out of *this* picker and stay reachable
 * through "Ngẫu nhiên", and through `listSpellCatalog` slot by slot.
 */
export const listSelectableChampions = (): SelectableChampion[] => {
  const champions: SelectableChampion[] = [];
  for (const champion of contentCatalog().champions()) {
    // `playable` is the whole rule. The `image` half is not a second rule —
    // `validate.ts` already refuses to install a `playable` champion without a
    // portrait — it is how `string | null` gets narrowed to the `string` that
    // `avatar` wants, in a loop, because this project's `filter` polyfill
    // cannot narrow a type.
    if (!champion.playable || !champion.image) continue;
    const spells: SelectableChampionSpell[] = [];
    for (const qualifiedId of champion.spells) {
      const id = bareCatalogId(qualifiedId);
      if (id) {
        spells.push({ id, display: spellDisplayOf(id) });
        continue;
      }
      // A playable champion from a pack other than the bundled one —
      // `bareCatalogId` refuses its qualified spell ids on purpose (see its
      // own doc comment); `packSpellCatalogEntry` is the companion that still
      // resolves one, the same crossing `pregameCatalog.ts`'s shelf builder
      // uses for the same reason.
      const entry = packSpellCatalogEntry(qualifiedId);
      if (entry) spells.push({ id: entry.id, display: entry.display });
    }
    champions.push({ name: champion.name, avatar: champion.image, spells });
  }
  return champions;
};

export interface SummonerSpellOption {
  id: SpellCatalogId;
  display: SpellDisplay;
}

/**
 * The "Phép Bổ Trợ" shelf. Written out explicitly rather than derived from the
 * shelf's position in the roster, so the D/F slots keep offering the same
 * five things if the shelf ever moves.
 */
export const SUMMONER_SPELL_IDS: SpellCatalogId[] = [
  'Flash',
  'Ghost',
  'Heal',
  'Ignite',
  'StealthWard',
];

export const listSummonerSpells = (): SummonerSpellOption[] =>
  SUMMONER_SPELL_IDS.map(id => ({ id, display: spellDisplayOf(id) }));

/**
 * Which kit slot a spell's *name* claims: `Yasuo_Q` → 1 (Q), `Zed_R` → 4 (R).
 * Slot order is A(0), Q(1), W(2), E(3), R(4), D(5), F(6) — `SLOT_COUNT` and
 * `SpellHotKeys`.
 *
 * This exists so "apply this champion's whole kit" can put each ability where
 * it belongs even when the champion only has some of them: the roster
 * carries single-ability shelves (Graves is `Graves_W` alone, Fizz is
 * `Fizz_E`) and dropping those into Q just because they are first in their
 * shelf would be wrong. Full four-ability shelves are always listed in
 * Q/W/E/R order, so for those this agrees with position — it only ever
 * *disagrees* for the partial shelves, which is the case it is here for.
 *
 * `null` for anything without one of those four suffixes — `BasicAttack`,
 * `Flash`, `StealthWard` — which is also how the basic-attack and summoner
 * shelves end up with no "apply the kit" action at all.
 */
const ABILITY_SLOT_BY_SUFFIX: Record<string, number> = { Q: 1, W: 2, E: 3, R: 4 };

export const abilitySlotOfId = (id: string): number | null => {
  const underscore = id.lastIndexOf('_');
  if (underscore < 0) return null;
  return ABILITY_SLOT_BY_SUFFIX[id.slice(underscore + 1)] ?? null;
};

/**
 * A champion's name, for the first shelf a spell appears on — the "thuộc bộ:
 * X" tag in the catalogue picker. Reads the whole registry rather than a
 * module-scope roster (the old `CHAMPION_KITS` shape) — the same
 * `contentCatalog().champions()` loop `listSelectableChampions` above
 * already runs, `bareCatalogId` narrowing each qualified spell id back to
 * this pack's own bare form so the map's keys agree with `spellCatalogIds()`,
 * which is bundled-pack-only (see that function's own doc comment).
 */
const shelfNameById = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const champion of contentCatalog().champions()) {
    for (const qualifiedId of champion.spells) {
      const id = bareCatalogId(qualifiedId);
      if (id && !map.has(id)) map.set(id, champion.name);
    }
  }
  return map;
};

export interface SpellCatalogEntry {
  /**
   * `string`, not `SpellCatalogId` — see `SelectableChampionSpell.id`'s doc
   * comment. `listSpellCatalog` still only ever populates this with a bundled
   * bare id, but `packSpellCatalogEntry` (read by `pregameCatalog.ts`'s shelf
   * builder for a pack champion) hands back a qualified one, and the two have
   * to share one type for the picker to treat them alike.
   */
  id: string;
  display: SpellDisplay;
  groupName: string | null;
}

/** Every spell in the catalogue, for the free-form kit builder's per-slot picker. */
export const listSpellCatalog = (): SpellCatalogEntry[] => {
  const shelves = shelfNameById();
  return spellCatalogIds().map(id => ({
    id,
    display: spellDisplayOf(id),
    groupName: shelves.get(id) ?? null,
  }));
};
