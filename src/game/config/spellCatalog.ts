import AssetManager, { type AssetKey } from '@/managers/AssetManager';
import type { SpellCatalogId } from '@/generated/spellCatalog';
import type { ChampionAttackTuning } from '@/game/gameObject/attackableUnits/Champion';
import type { MatchRules } from './PregameConfig';
import { contentCatalog } from '@/content/catalog';
import type { SpellDisplayData } from '@/content/ContentPack';
import { packAsset } from './packAsset';

/**
 * The only two files allowed to name `@/generated/spellCatalog` directly —
 * this one and `content/bundledPack.ts` — see `tests/content/rosterSource.test.ts`.
 * Re-exported here so a caller that needs only the id type, not the roster
 * itself, still goes through this adapter rather than reaching past it.
 */
export type { SpellCatalogId };

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
 * at build time — but this module no longer reads that generated table (or
 * `CHAMPION_KITS`) directly. Both are `bundledPack.ts`'s data now, installed
 * into the one `PackRegistry` every pack's data answers through
 * (`contentCatalog()` from `@/content/catalog` — the data-only accessor, not
 * `contentRegistry()`: this module never needs a spell *class*, so it stays
 * off the accessor that builds one), and this module reads *that*: a spell's
 * display data by qualified id, a champion's roster row by pack entry. The
 * qualifying itself is a local `qualifyBundledId`, not the `qualifySpellId`
 * the rest of the engine shares (`@/game/spellRegistry`) — that module sits
 * in the `game` chunk, and reaching into it from here would close a cycle
 * with `bundledPack.ts`, which reads `CHAMPION_KITS` back out of this file;
 * see `qualifyBundledId`'s own doc comment. `CHAMPION_KITS` stays exported
 * here only because `bundledPack.ts` needs it to build the pack — see its
 * own `@internal` doc comment below. Two readers are still on it and both are
 * scheduled: `shelfNameById` below, and `preset.ts`, which Task 8 moves onto
 * the registry. Until then this comment describes where the roster is *read
 * from*, not a boundary that already holds.
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
 * `BUNDLED_PACK_ID` (`@/content/bundledPack`) and `qualifySpellId`
 * (`@/game/spellRegistry`, which reads that same constant) both sit in the
 * `game` chunk's own reach, and `bundledPack.ts` already reads
 * `CHAMPION_KITS` back out of *this* module to build its roster (see
 * `CHAMPION_KITS`'s own `@internal` doc comment below) — `Recall` has been a
 * loader, not an eager class, since `188c372`, so it is no longer a reason
 * either file reaches into the other.
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
 * Basic-attack profiles by role.
 *
 * Every champion in the game shared `DEFAULT_CHAMPION_ATTACK` — the same 16
 * damage at 0.8/s from the same 300 range — so a marksman's autos were a tank's
 * autos, and a kit built to be carried by attack speed had no attack speed to be
 * carried by. Two consequences fall out of fixing that:
 *
 *  - **Melee is finally melee.** `MELEE_RANGE_THRESHOLD` is 140 and everyone sat
 *    at 300, so Garen and Malphite were quietly *shooting bolts*. The melee
 *    profiles drop under the threshold, which is what makes `BasicAttackController`
 *    swing instead, and they are paid for it in damage per hit.
 *  - **Reach costs dps.** The ranged profiles hit softer per swing than the melee
 *    ones; a marksman's payoff is that it never has to close, and that its dps
 *    rises fastest under an attack-speed buff.
 *
 * Numbers are stated as dps against the ~100 champion pool so the trade is
 * checkable at a glance rather than buried in two multiplied fields.
 */
export const ATTACK = {
  /** 16.5 dps at the longest reach in the roster, and the best buff scaling. */
  MARKSMAN: { damage: 10, attacksPerSecond: 1.65, range: 410 },
  /** 12.6 dps. Autos are chip damage between cooldowns, not the plan. */
  MAGE: { damage: 12, attacksPerSecond: 1.05, range: 385 },
  /** 10.0 dps. The lowest in the game on purpose; the kit is the contribution. */
  SUPPORT: { damage: 10, attacksPerSecond: 1.0, range: 385 },
  /** 18.8 dps, melee. Burst kits that still want to finish with their hands. */
  ASSASSIN: { damage: 15, attacksPerSecond: 1.25, range: 130 },
  /** 18.7 dps, melee. The sustained-damage end of the roster. */
  BRUISER: { damage: 17, attacksPerSecond: 1.1, range: 130 },
  /** 14.3 dps, melee. Slowest swing; the body is the point, not the axe. */
  TANK: { damage: 15, attacksPerSecond: 0.95, range: 125 },
} as const;

/**
 * Every shelf the pregame picker offers, as ids.
 *
 * This is `preset.ts`'s old `SpellGroups`, with `AllSpells.Yasuo_Q` replaced by
 * the string `'Yasuo_Q'` — the barrel key, which is the same identifier and the
 * only one that survives minification (a bundler can rename a class's
 * `Function.prototype.name`, never a namespace property key). `preset.ts` maps
 * these back to classes for the match; nothing here can execute a spell.
 *
 * A mistyped id is a **compile error**, not a missing ability: `SpellCatalogId`
 * is `keyof typeof spellCatalog`, generated from the barrel itself.
 *
 * @internal The bundled pack's own source data, wrapped by
 * `src/content/bundledPack.ts` into a `ContentPack` and installed into the
 * registry that the roster is read from.
 *
 * **Not yet the only reader.** `shelfNameById` below still walks it for
 * `listSpellCatalog`'s group tags, and `src/game/preset.ts` reads it for
 * `PLAYABLE_CHAMPION_KITS`, `randomChampionKit` and `planKit` — Task 8 moves
 * that one, and Task 9's scan is what closes the rule afterwards. Batch 4
 * deletes this constant together with the adapter that reads it. Do not add a
 * reader in the meantime; the list above is meant to shrink, not grow.
 */
export const CHAMPION_KITS: {
  name: string;
  image: AssetKey | null;
  spells: SpellCatalogId[];
  /** The champion's basic-attack profile; see `ATTACK` above. */
  attack?: ChampionAttackTuning;
}[] = [
  // First, and a shelf of its own rather than a line on the summoner spell
  // shelf: it belongs to no champion and it is not a summoner spell, it is the
  // attack every champion already has. It is also the way back — a player who
  // swaps slot 0 out for something else and wants `A` to attack again needs to
  // find this, and hunting for it at the bottom of the Phép Bổ Trợ list would
  // make that a one-way door in practice.
  {
    name: 'Đánh Thường',
    image: 'spell_basic_attack',
    spells: ['BasicAttack'],
  },
  {
    name: 'Phép Bổ Trợ',
    image: null,
    spells: ['Flash', 'Ghost', 'Heal', 'Ignite', 'StealthWard'],
  },
  {
    name: 'Yasuo',
    attack: ATTACK.BRUISER,
    image: 'champ_yasuo',

    spells: ['Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R'],
  },
  {
    name: 'Shaco',
    attack: ATTACK.ASSASSIN,
    image: 'champ_shaco',

    spells: ['Shaco_Q', 'Shaco_W', 'Shaco_E', 'Shaco_R'],
  },
  {
    name: 'Ahri',
    attack: ATTACK.MAGE,
    image: 'champ_ahri',

    spells: ['Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R'],
  },
  {
    name: 'Lee Sin',
    attack: ATTACK.BRUISER,
    image: 'champ_leesin',

    spells: ['LeeSin_Q', 'LeeSin_W', 'LeeSin_E', 'LeeSin_R'],
  },
  {
    name: 'Blitzcrank',
    attack: ATTACK.TANK,
    image: 'champ_blitzcrank',

    spells: ['Blitzcrank_Q', 'Blitzcrank_W', 'Blitzcrank_E', 'Blitzcrank_R'],
  },
  {
    name: 'Lux',
    attack: ATTACK.MAGE,
    image: 'champ_lux',

    spells: ['Lux_Q', 'Lux_W', 'Lux_E', 'Lux_R'],
  },
  {
    name: 'Ashe',
    attack: ATTACK.MARKSMAN,
    image: 'champ_ashe',

    spells: ['Ashe_Q', 'Ashe_W', 'Ashe_E', 'Ashe_R'],
  },
  {
    name: "Cho'Gath",
    attack: ATTACK.BRUISER,
    image: 'champ_chogath',

    spells: ['ChoGath_Q', 'ChoGath_W', 'ChoGath_E', 'ChoGath_R'],
  },
  {
    name: 'Leblanc',
    attack: ATTACK.MAGE,
    image: 'champ_leblanc',

    spells: ['Leblanc_Q', 'Leblanc_W', 'Leblanc_E', 'Leblanc_R'],
  },
  {
    name: 'Malphite',
    attack: ATTACK.TANK,
    image: 'champ_malphite',

    spells: ['Malphite_Q', 'Malphite_W', 'Malphite_E', 'Malphite_R'],
  },
  {
    name: 'Olaf',
    attack: ATTACK.BRUISER,
    image: 'champ_olaf',

    spells: ['Olaf_Q', 'Olaf_W', 'Olaf_E', 'Olaf_R'],
  },
  {
    name: 'Teemo',
    attack: ATTACK.MARKSMAN,
    image: 'champ_teemo',

    spells: ['Teemo_Q', 'Teemo_W', 'Teemo_E', 'Teemo_R'],
  },
  {
    name: 'Veigar',
    attack: ATTACK.MAGE,
    image: 'champ_veigar',

    spells: ['Veigar_Q', 'Veigar_W', 'Veigar_E', 'Veigar_R'],
  },
  {
    name: 'Zed',
    attack: ATTACK.ASSASSIN,
    image: 'champ_zed',

    spells: ['Zed_Q', 'Zed_W', 'Zed_E', 'Zed_R'],
  },
  {
    name: 'Graves',
    attack: ATTACK.MARKSMAN,
    image: 'champ_graves',

    spells: ['Graves_Q', 'Graves_W', 'Graves_E', 'Graves_R'],
  },
  {
    name: 'Anivia',
    attack: ATTACK.MAGE,
    image: 'champ_anivia',

    spells: ['Anivia_Q', 'Anivia_W', 'Anivia_E', 'Anivia_R'],
  },
  {
    name: 'Varus',
    attack: ATTACK.MARKSMAN,
    image: 'champ_varus',

    spells: ['Varus_Q', 'Varus_W', 'Varus_E', 'Varus_R'],
  },
  {
    name: 'Pantheon',
    attack: ATTACK.BRUISER,
    image: 'champ_pantheon',

    spells: ['Pantheon_Q', 'Pantheon_W', 'Pantheon_E', 'Pantheon_R'],
  },
  {
    name: 'Thresh',
    attack: ATTACK.SUPPORT,
    image: 'champ_thresh',

    spells: ['Thresh_Q', 'Thresh_W', 'Thresh_E', 'Thresh_R'],
  },
  {
    name: 'Rammus',
    attack: ATTACK.TANK,
    image: 'champ_rammus',

    spells: ['Rammus_Q', 'Rammus_W', 'Rammus_E', 'Rammus_R'],
  },
  {
    name: 'Morgana',
    attack: ATTACK.SUPPORT,
    image: 'champ_morgana',

    spells: ['Morgana_Q', 'Morgana_W', 'Morgana_E', 'Morgana_R'],
  },
  {
    name: 'Janna',
    attack: ATTACK.SUPPORT,
    image: 'champ_janna',

    spells: ['Janna_Q', 'Janna_W', 'Janna_E', 'Janna_R'],
  },
  {
    name: 'Alistar',
    attack: ATTACK.TANK,
    image: 'champ_alistar',

    spells: ['Alistar_Q', 'Alistar_W', 'Alistar_E', 'Alistar_R'],
  },
  {
    name: 'Nocturne',
    attack: ATTACK.ASSASSIN,
    image: 'champ_nocturne',

    spells: ['Nocturne_Q', 'Nocturne_W', 'Nocturne_E', 'Nocturne_R'],
  },
  {
    name: 'Twitch',
    attack: ATTACK.MARKSMAN,
    image: 'champ_twitch',

    spells: ['Twitch_Q', 'Twitch_W', 'Twitch_E', 'Twitch_R'],
  },
  {
    name: 'Amumu',
    attack: ATTACK.TANK,
    image: 'champ_amumu',

    spells: ['Amumu_Q', 'Amumu_W', 'Amumu_E', 'Amumu_R'],
  },
  {
    name: 'Warwick',
    attack: ATTACK.BRUISER,
    image: 'champ_warwick',

    spells: ['Warwick_Q', 'Warwick_W', 'Warwick_E', 'Warwick_R'],
  },
  {
    name: 'Singed',
    attack: ATTACK.BRUISER,
    image: 'champ_singed',

    spells: ['Singed_Q', 'Singed_W', 'Singed_E', 'Singed_R'],
  },
  {
    name: 'Cassiopeia',
    attack: ATTACK.MAGE,
    image: 'champ_cassiopeia',

    spells: ['Cassiopeia_Q', 'Cassiopeia_W', 'Cassiopeia_E', 'Cassiopeia_R'],
  },
  {
    name: 'Fizz',
    attack: ATTACK.ASSASSIN,
    image: 'champ_fizz',

    spells: ['Fizz_Q', 'Fizz_W', 'Fizz_E', 'Fizz_R'],
  },
  {
    name: 'Annie',
    attack: ATTACK.MAGE,
    image: 'champ_annie',

    spells: ['Annie_Q', 'Annie_W', 'Annie_E', 'Annie_R'],
  },
  {
    name: 'Garen',
    attack: ATTACK.BRUISER,
    image: 'champ_garen',

    spells: ['Garen_Q', 'Garen_W', 'Garen_E', 'Garen_R'],
  },
  {
    name: 'Jinx',
    attack: ATTACK.MARKSMAN,
    image: 'champ_jinx',

    spells: ['Jinx_Q', 'Jinx_W', 'Jinx_E', 'Jinx_R'],
  },
  {
    name: 'Nasus',
    attack: ATTACK.BRUISER,
    image: 'champ_nasus',

    spells: ['Nasus_Q', 'Nasus_W', 'Nasus_E', 'Nasus_R'],
  },
  {
    name: 'Ekko',
    attack: ATTACK.ASSASSIN,
    image: 'champ_ekko',

    spells: ['Ekko_Q', 'Ekko_W', 'Ekko_E', 'Ekko_R'],
  },
  {
    name: 'Jarvan IV',
    attack: ATTACK.BRUISER,
    image: 'champ_jarvaniv',

    spells: ['JarvanIV_Q', 'JarvanIV_W', 'JarvanIV_E', 'JarvanIV_R'],
  },
  {
    name: 'Camille',
    attack: ATTACK.ASSASSIN,
    image: 'champ_camille',

    spells: ['Camille_Q', 'Camille_W', 'Camille_E', 'Camille_R'],
  },
  {
    name: 'Darius',
    attack: ATTACK.BRUISER,
    image: 'champ_darius',

    spells: ['Darius_Q', 'Darius_W', 'Darius_E', 'Darius_R'],
  },
  {
    name: 'Renekton',
    attack: ATTACK.BRUISER,
    image: 'champ_renekton',

    spells: ['Renekton_Q', 'Renekton_W', 'Renekton_E', 'Renekton_R'],
  },
  {
    name: 'Xin Zhao',
    attack: ATTACK.BRUISER,
    image: 'champ_xinzhao',

    spells: ['XinZhao_Q', 'XinZhao_W', 'XinZhao_E', 'XinZhao_R'],
  },
  {
    name: 'Tryndamere',
    attack: ATTACK.BRUISER,
    image: 'champ_tryndamere',

    spells: ['Tryndamere_Q', 'Tryndamere_W', 'Tryndamere_E', 'Tryndamere_R'],
  },
  {
    name: 'Master Yi',
    attack: ATTACK.ASSASSIN,
    image: 'champ_masteryi',

    spells: ['MasterYi_Q', 'MasterYi_W', 'MasterYi_E', 'MasterYi_R'],
  },
  {
    name: 'Malzahar',
    attack: ATTACK.MAGE,
    image: 'champ_malzahar',

    spells: ['Malzahar_Q', 'Malzahar_W', 'Malzahar_E', 'Malzahar_R'],
  },
  {
    name: 'Ezreal',
    attack: ATTACK.MARKSMAN,
    image: 'champ_ezreal',

    spells: ['Ezreal_Q', 'Ezreal_W', 'Ezreal_E', 'Ezreal_R'],
  },
  {
    name: 'Caitlyn',
    attack: ATTACK.MARKSMAN,
    image: 'champ_caitlyn',

    spells: ['Caitlyn_Q', 'Caitlyn_W', 'Caitlyn_E', 'Caitlyn_R'],
  },
  {
    name: 'Soraka',
    attack: ATTACK.SUPPORT,
    image: 'champ_soraka',

    spells: ['Soraka_Q', 'Soraka_W', 'Soraka_E', 'Soraka_R'],
  },
  {
    name: 'Brand',
    attack: ATTACK.MAGE,
    image: 'champ_brand',

    spells: ['Brand_Q', 'Brand_W', 'Brand_E', 'Brand_R'],
  },
  {
    name: 'Katarina',
    attack: ATTACK.ASSASSIN,
    image: 'champ_katarina',

    spells: ['Katarina_Q', 'Katarina_W', 'Katarina_E', 'Katarina_R'],
  },
  {
    name: 'Vayne',
    attack: ATTACK.MARKSMAN,
    image: 'champ_vayne',

    spells: ['Vayne_Q', 'Vayne_W', 'Vayne_E', 'Vayne_R'],
  },
  {
    name: 'Riven',
    attack: ATTACK.BRUISER,
    image: 'champ_riven',

    spells: ['Riven_Q', 'Riven_W', 'Riven_E', 'Riven_R'],
  },
  {
    name: 'Sett',
    attack: ATTACK.BRUISER,
    image: 'champ_sett',

    spells: ['Sett_Q', 'Sett_W', 'Sett_E', 'Sett_R'],
  },
  {
    name: 'Jhin',
    attack: ATTACK.MARKSMAN,
    image: 'champ_jhin',

    spells: ['Jhin_Q', 'Jhin_W', 'Jhin_E', 'Jhin_R'],
  },
  {
    name: 'Nautilus',
    attack: ATTACK.TANK,
    image: 'champ_nautilus',

    spells: ['Nautilus_Q', 'Nautilus_W', 'Nautilus_E', 'Nautilus_R'],
  },
  {
    name: 'Diana',
    attack: ATTACK.ASSASSIN,
    image: 'champ_diana',

    spells: ['Diana_Q', 'Diana_W', 'Diana_E', 'Diana_R'],
  },
  {
    name: 'Vi',
    attack: ATTACK.BRUISER,
    image: 'champ_vi',

    spells: ['Vi_Q', 'Vi_W', 'Vi_E', 'Vi_R'],
  },
  {
    name: 'Syndra',
    attack: ATTACK.MAGE,
    image: 'champ_syndra',

    spells: ['Syndra_Q', 'Syndra_W', 'Syndra_E', 'Syndra_R'],
  },
  {
    name: 'Ziggs',
    attack: ATTACK.MAGE,
    image: 'champ_ziggs',

    spells: ['Ziggs_Q', 'Ziggs_W', 'Ziggs_E', 'Ziggs_R'],
  },
  {
    name: 'Irelia',
    attack: ATTACK.BRUISER,
    image: 'champ_irelia',

    spells: ['Irelia_Q', 'Irelia_W', 'Irelia_E', 'Irelia_R'],
  },
];

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
  /** Matches `ChampionLoadout.championName` and a `CHAMPION_KITS[i].name`. */
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
 * two definitions of pickable again). `CHAMPION_KITS` also carries
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
 * shelf's position in `CHAMPION_KITS`, so the D/F slots keep offering the same
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
 * it belongs even when the champion only has some of them: `CHAMPION_KITS`
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

/** `CHAMPION_KITS[i].name` for the first shelf a spell appears on — the "thuộc bộ: X" tag in the catalogue picker. */
const shelfNameById = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const kit of CHAMPION_KITS) {
    for (const id of kit.spells) if (!map.has(id)) map.set(id, kit.name);
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
