import * as AllSpells from './gameObject/spells/index';
import AssetManager, { type AssetKey } from '../managers/AssetManager';
import TeamId from './enums/TeamId';
import type { MonsterPresetData } from './gameObject/attackableUnits/Monster';
import type { FountainPresetData } from './gameObject/structures/Fountain';
import type { ChampionPresetData } from './gameObject/attackableUnits/Champion';
import type { ChampionLoadout, MatchRules, SlotChoice } from './config/PregameConfig';
import { SLOT_COUNT } from './config/PregameConfig';

// Workaround: AllSpells is a namespace of named Spell class exports.
// Filter out string exports by excluding values whose prototype chain doesn't lead to Spell.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpellClass = Exclude<(typeof AllSpells)[keyof typeof AllSpells], string> | any;

const random = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * Portraits used for a fully random loadout — 'random' champion mode and
 * every free-form custom kit, which has no single champion identity to draw
 * an avatar from. A curated subset (not "every `champ_*` key") because a few
 * champions in the catalogue never got a matching background/portrait pair.
 */
const RANDOM_AVATAR_POOL: AssetKey[] = [
  'champ_yasuo',
  'champ_lux',
  'champ_blitzcrank',
  'champ_ashe',
  'champ_teemo',
  'champ_leblanc',
  'champ_leesin',
  'champ_chogath',
  'champ_ahri',
  'champ_shaco',
  'champ_olaf',
  'champ_graves',
];
const randomAvatar = (): AssetKey => random(RANDOM_AVATAR_POOL);

export const getChampionPresetRandom = (): ChampionPresetData & { avatar: AssetKey } => {
  return {
    name: 'Random',
    avatar: randomAvatar(),
    spells: [
      // Slot 0 is the internal slot and SpellHotKeys[0] is `A`, so whatever
      // sits here is what `A` presses. The basic attack lives there: it is an
      // ability like the rest, and putting it in a slot is what gives the
      // champion's own attack a key, an icon and a timer without inventing a
      // second input path beside the spell one.
      //
      // Heal used to hold this slot and has moved down to `F`, taking Ghost's
      // place: Heal already grants a 50% Speedup for a second, so of the two it
      // is the one that keeps both effects, and Flash + Heal is the pair a
      // player reaches for anyway. Ghost is one click away in the picker, and so
      // is the basic attack itself, so swapping slot 0 out is not a one-way door.
      AllSpells.BasicAttack,
      ...Array.from({ length: 4 })
        .fill(0)
        .map(() => {
          return random(Object.values(AllSpells) as SpellClass[]);
        }),
      AllSpells.Flash,
      AllSpells.Heal,
    ],
  };
};

export const SpellGroups: {
  name: string;
  image: AssetKey | null;
  background: AssetKey | null;
  spells: SpellClass[];
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
    background: null,
    spells: [AllSpells.BasicAttack],
  },
  {
    name: 'Yasuo',
    image: 'champ_yasuo',
    background: 'champ_background_yasuo',
    spells: [AllSpells.Yasuo_Q, AllSpells.Yasuo_W, AllSpells.Yasuo_E, AllSpells.Yasuo_R],
  },
  {
    name: 'Shaco',
    image: 'champ_shaco',
    background: 'champ_background_shaco',
    spells: [AllSpells.Shaco_Q, AllSpells.Shaco_W, AllSpells.Shaco_E, AllSpells.Shaco_R],
  },
  {
    name: 'Ahri',
    image: 'champ_ahri',
    background: 'champ_background_ahri',
    spells: [AllSpells.Ahri_Q, AllSpells.Ahri_W, AllSpells.Ahri_E, AllSpells.Ahri_R],
  },
  {
    name: 'Lee Sin',
    image: 'champ_leesin',
    background: 'champ_background_leesin',
    spells: [
      AllSpells.LeeSin_Q,
      AllSpells.LeeSin_W,
      AllSpells.LeeSin_E,
      AllSpells.LeeSin_R,
    ],
  },
  {
    name: 'Blitzcrank',
    image: 'champ_blitzcrank',
    background: 'champ_background_blitzcrank',
    spells: [
      AllSpells.Blitzcrank_Q,
      AllSpells.Blitzcrank_W,
      AllSpells.Blitzcrank_E,
      AllSpells.Blitzcrank_R,
    ],
  },
  {
    name: 'Lux',
    image: 'champ_lux',
    background: 'champ_background_lux',
    spells: [AllSpells.Lux_Q, AllSpells.Lux_W, AllSpells.Lux_E, AllSpells.Lux_R],
  },
  {
    name: 'Ashe',
    image: 'champ_ashe',
    background: 'champ_background_ashe',
    spells: [AllSpells.Ashe_Q, AllSpells.Ashe_W, AllSpells.Ashe_E, AllSpells.Ashe_R],
  },
  {
    name: "Cho'Gath",
    image: 'champ_chogath',
    background: 'champ_background_chogath',
    spells: [
      AllSpells.ChoGath_Q,
      AllSpells.ChoGath_W,
      AllSpells.ChoGath_E,
      AllSpells.ChoGath_R,
    ],
  },
  {
    name: 'Leblanc',
    image: 'champ_leblanc',
    background: 'champ_background_leblanc',
    spells: [
      AllSpells.Leblanc_Q,
      AllSpells.Leblanc_W,
      AllSpells.Leblanc_E,
      AllSpells.Leblanc_R,
    ],
  },
  {
    name: 'Malphite',
    image: 'champ_malphite',
    background: 'champ_background_malphite',
    spells: [AllSpells.Malphite_Q, AllSpells.Malphite_W, AllSpells.Malphite_E, AllSpells.Malphite_R],
  },
  {
    name: 'Olaf',
    image: 'champ_olaf',
    background: 'champ_background_olaf',
    spells: [AllSpells.Olaf_Q],
  },
  {
    name: 'Teemo',
    image: 'champ_teemo',
    background: 'champ_background_teemo',
    spells: [AllSpells.Teemo_Q, AllSpells.Teemo_W, AllSpells.Teemo_E, AllSpells.Teemo_R],
  },
  {
    name: 'Veigar',
    image: 'champ_veigar',
    background: 'champ_background_veigar',
    spells: [AllSpells.Veigar_Q, AllSpells.Veigar_W, AllSpells.Veigar_E, AllSpells.Veigar_R],
  },
  {
    name: 'Zed',
    image: 'champ_zed',
    background: 'champ_background_zed',
    spells: [AllSpells.Zed_Q, AllSpells.Zed_W, AllSpells.Zed_E, AllSpells.Zed_R],
  },
  {
    name: 'Graves',
    image: 'champ_graves',
    background: 'champ_background_graves',
    spells: [AllSpells.Graves_W],
  },
  {
    name: 'Anivia',
    image: 'champ_anivia',
    background: null,
    spells: [AllSpells.Anivia_Q, AllSpells.Anivia_W, AllSpells.Anivia_E, AllSpells.Anivia_R],
  },
  {
    name: 'Varus',
    image: 'champ_varus',
    background: null,
    spells: [AllSpells.Varus_Q],
  },
  {
    name: 'Pantheon',
    image: 'champ_pantheon',
    background: null,
    spells: [AllSpells.Pantheon_Q],
  },
  {
    name: 'Thresh',
    image: 'champ_thresh',
    background: null,
    spells: [AllSpells.Thresh_Q],
  },
  {
    name: 'Rammus',
    image: 'champ_rammus',
    background: null,
    spells: [AllSpells.Rammus_Q],
  },
  {
    name: 'Morgana',
    image: 'champ_morgana',
    background: null,
    spells: [
      AllSpells.Morgana_Q,
      AllSpells.Morgana_W,
      AllSpells.Morgana_E,
      AllSpells.Morgana_R,
    ],
  },
  {
    name: 'Janna',
    image: 'champ_janna',
    background: null,
    spells: [AllSpells.Janna_Q, AllSpells.Janna_W, AllSpells.Janna_E, AllSpells.Janna_R],
  },
  {
    name: 'Alistar',
    image: 'champ_alistar',
    background: null,
    spells: [AllSpells.Alistar_W],
  },
  {
    name: 'Nocturne',
    image: 'champ_nocturne',
    background: null,
    spells: [AllSpells.Nocturne_R],
  },
  {
    name: 'Twitch',
    image: 'champ_twitch',
    background: null,
    spells: [AllSpells.Twitch_Q],
  },
  {
    name: 'Amumu',
    image: 'champ_amumu',
    background: null,
    spells: [AllSpells.Amumu_Q],
  },
  {
    name: 'Warwick',
    image: 'champ_warwick',
    background: null,
    spells: [AllSpells.Warwick_Q],
  },
  {
    name: 'Singed',
    image: 'champ_singed',
    background: null,
    spells: [AllSpells.Singed_W],
  },
  {
    name: 'Cassiopeia',
    image: 'champ_cassiopeia',
    background: null,
    spells: [AllSpells.Cassiopeia_W],
  },
  {
    name: 'Fizz',
    image: 'champ_fizz',
    background: null,
    spells: [AllSpells.Fizz_E],
  },
  {
    name: 'Nasus',
    image: 'champ_nasus',
    background: null,
    spells: [AllSpells.Nasus_Q],
  },
  {
    name: 'Phép Bổ Trợ',
    image: null,
    background: null,
    spells: [
      AllSpells.Flash,
      AllSpells.Ghost,
      AllSpells.Heal,
      AllSpells.Ignite,
      AllSpells.StealthWard,
    ],
  },
];

// ---------------------------------------------------------------------------
// Pregame setup screen data
//
// The pregame screen (src/scenes/SetupScene.ts) is a standalone UI built
// directly on this module — it does not reuse or import the in-game
// spell-picker modal (src/game/hud/InGameHUD.ts), which is being rewritten
// separately. `new SpellClass(owner)` for a throwaway display instance below
// is the same technique that modal already uses to read a spell's icon/name
// without a real champion to own it — extended here with a stub `owner.game.
// matchRules` so the same instance can also report its *effective* (CDR/URF
// -adjusted) cooldown and mana cost. Audited (all 85 exports in `AllSpells`,
// see `listSpellCatalog`) with the fallback `catch` disabled: none of them
// throw, and none produce a suspicious (`undefined`/`NaN`/`[object`)
// description, so the `catch` below is defence against a *future* spell
// breaking that contract, not a mask over a live bug.
// ---------------------------------------------------------------------------

/** No cooldown reduction, no URF — what a spell shows outside any pregame context. */
const NO_MATCH_RULES: MatchRules = { cooldownMultiplier: 1, manaFree: false };

export interface SpellDisplay {
  /**
   * A spell's `image` field (unlike `SpellGroups[i].image`, which is a bare
   * `AssetKey`) is already a *resolved* `AssetHandle` — every spell sets it
   * with `image = AssetManager.get('spell_x')` in its own field initializer.
   * This is that handle's `.url`, ready for an `<img src>` with no second
   * `AssetManager.get` lookup (which would fail: an `AssetHandle` object is
   * not a valid manifest key).
   */
  iconUrl: string | null;
  name: string;
  /** Vietnamese HTML — `<span class="damage">`/`.buff`/`.time`/plain `<span>`. */
  description: string;
  /** The spell's own tuning number, unaffected by match rules. */
  coolDownMs: number;
  /** The spell's own tuning number, unaffected by match rules. */
  manaCost: number;
  /** `coolDownMs` after cooldown reduction — equal to it under `NO_MATCH_RULES`. */
  effectiveCoolDownMs: number;
  /** `manaCost`, zeroed under URF — equal to `manaCost` under `NO_MATCH_RULES`. */
  effectiveManaCost: number;
}

/**
 * Builds a throwaway instance to read a spell's display fields — including,
 * given `matchRules`, the same `effectiveCoolDownMs`/`effectiveManaCost`
 * getters `Spell.ts` uses for the real cast path (`reducedCooldown`), so a
 * number shown here is provably the number the engine will actually use.
 */
export const getSpellDisplay = (SpellClass: SpellClass, matchRules: MatchRules = NO_MATCH_RULES): SpellDisplay => {
  try {
    const instance = new SpellClass({ game: { matchRules } });
    const handle = instance.image as { url?: string } | null | undefined;
    return {
      iconUrl: handle?.url ?? null,
      name: instance.name ?? SpellClass.name,
      description: typeof instance.description === 'string' ? instance.description : '',
      coolDownMs: typeof instance.coolDown === 'number' ? instance.coolDown : 0,
      manaCost: typeof instance.manaCost === 'number' ? instance.manaCost : 0,
      effectiveCoolDownMs:
        typeof instance.effectiveCoolDownMs === 'number' ? instance.effectiveCoolDownMs : 0,
      effectiveManaCost: typeof instance.effectiveManaCost === 'number' ? instance.effectiveManaCost : 0,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`preset.ts: a spell failed to construct for display (${SpellClass?.name ?? '?'})`, error);
    return {
      iconUrl: null,
      name: SpellClass?.name ?? '?',
      description: '',
      coolDownMs: 0,
      manaCost: 0,
      effectiveCoolDownMs: 0,
      effectiveManaCost: 0,
    };
  }
};

export interface SelectableChampionSpell {
  spellClass: SpellClass;
  display: SpellDisplay;
}

export interface SelectableChampion {
  /** Matches `ChampionLoadout.championName` and a `SpellGroups[i].name`. */
  name: string;
  avatar: AssetKey;
  background: AssetKey | null;
  /**
   * Carries `spellClass` alongside its `display`, not just the display data:
   * `getSpellDisplay` builds a fresh object on every call, so two calls for
   * the same spell (one here, one in `listSpellCatalog`) never produce
   * `===`-equal `SpellDisplay`s — a consumer that needs to identify *which*
   * spell an icon is (say, to open its detail panel) needs the class
   * reference itself, not a copy of its display fields.
   */
  spells: SelectableChampionSpell[];
}

/**
 * Champions the pregame screen can offer as a coherent kit: a real portrait
 * and all four of Q/W/E/R implemented. `SpellGroups` also carries
 * single-ability stubs (Olaf, Graves, Thresh, ...) used to fill the random
 * pool — picking one of those directly would leave three of its four ability
 * slots empty, so they're left out of *this* picker and stay reachable
 * through "Ngẫu nhiên", and — since the free-form kit builder shipped —
 * through `listSpellCatalog` too, slot by slot.
 */
export const listSelectableChampions = (): SelectableChampion[] => {
  const champions: SelectableChampion[] = [];
  for (const group of SpellGroups) {
    if (!group.image || group.spells.length !== 4) continue;
    champions.push({
      name: group.name,
      avatar: group.image,
      background: group.background,
      spells: (group.spells as SpellClass[]).map(spellClass => ({
        spellClass,
        display: getSpellDisplay(spellClass),
      })),
    });
  }
  return champions;
};

export interface SummonerSpellOption {
  id: string;
  spellClass: SpellClass;
  display: SpellDisplay;
}

/**
 * The `SpellGroups` "Phép Bổ Trợ" shelf, given stable string ids so a choice
 * can round-trip through `localStorage` (a class reference cannot). Written
 * out explicitly rather than derived from the class's own `.name` at
 * runtime — a minified production build does not preserve identifier names
 * on `Function.prototype.name`, so that would silently stop round-tripping
 * the moment `npm run build` minifies the bundle. Kept in the same order as
 * the shelf so the two are easy to eyeball against each other.
 *
 * Ids and classes only — no display data — so this can sit at module scope
 * without instantiating a single spell at import time.
 */
const SUMMONER_SPELLS: { id: string; spellClass: SpellClass }[] = [
  { id: 'Flash', spellClass: AllSpells.Flash },
  { id: 'Ghost', spellClass: AllSpells.Ghost },
  { id: 'Heal', spellClass: AllSpells.Heal },
  { id: 'Ignite', spellClass: AllSpells.Ignite },
  { id: 'StealthWard', spellClass: AllSpells.StealthWard },
];

/**
 * Same list with each spell's icon/name attached. A function, not a
 * constant, for the same reason as `listSelectableChampions`: it calls
 * `new SpellClass(...)` per entry, and that has to wait until whatever
 * imports `preset.ts` is good and ready for it — not fire the moment this
 * module is first evaluated, which for a spell whose display fields turn out
 * to depend on a p5 global could be before p5 has finished booting.
 */
export const listSummonerSpells = (): SummonerSpellOption[] =>
  SUMMONER_SPELLS.map(({ id, spellClass }) => ({ id, spellClass, display: getSpellDisplay(spellClass) }));

const findSummoner = (id: string): SpellClass =>
  SUMMONER_SPELLS.find(option => option.id === id)?.spellClass ?? AllSpells.Flash;

// ---------------------------------------------------------------------------
// The full spell catalogue — every export in the `AllSpells` barrel, for the
// free-form kit builder ("Tự Ghép Chiêu"). `SpellGroups` above is curated for
// the champion picker (only full 4-ability kits get a card); this is the
// opposite: everything, including the standalone abilities that curation
// deliberately leaves out, plus the summoner spells and the basic attack —
// because a builder that assembles a kit "slot by slot" needs every slot to
// be able to hold anything.
//
// Ids are the `AllSpells` barrel's own export names (`Object.keys(AllSpells)`
// — e.g. `'Yasuo_Q'`), not `SpellClass.name`. Both are ostensibly the same
// string today, but only the barrel key is guaranteed stable: a bundler's
// minifier can rename the *runtime* `Function.prototype.name` of a class
// declaration, but never the *property key* of a namespace object — every
// other module in this codebase reaches into `AllSpells` by that exact key
// (`AllSpells.Yasuo_Q`), so the bundler cannot rename it without breaking the
// build. This is the same reasoning `SUMMONER_SPELLS` above already used;
// this just generalises it to the other 80 exports instead of hand-listing
// them a second time.
// ---------------------------------------------------------------------------

const SPELL_CLASS_BY_ID = new Map<string, SpellClass>(Object.entries(AllSpells));

/** The reverse of `SPELL_CLASS_BY_ID`. Same key stability argument — see the block comment above. */
const SPELL_ID_BY_CLASS = new Map<SpellClass, string>(
  Object.entries(AllSpells).map(([id, spellClass]) => [spellClass as SpellClass, id])
);

/** The `AllSpells` barrel key of the basic attack — the A slot's default, and the way back to it. */
export const BASIC_ATTACK_ID = 'BasicAttack';

/** A catalogue id's `AllSpells` class, or `null` for an id no build of the barrel has. */
export const spellIdOf = (spellClass: SpellClass): string | null =>
  SPELL_ID_BY_CLASS.get(spellClass) ?? null;

/**
 * Which kit slot a spell's *name* claims: `Yasuo_Q` → 1 (Q), `Zed_R` → 4 (R).
 * Slot order is A(0), Q(1), W(2), E(3), R(4), D(5), F(6) — `SLOT_COUNT` and
 * `SpellHotKeys`.
 *
 * This exists so "apply this champion's whole kit" can put each ability where
 * it belongs even when the champion only has some of them: `SpellGroups`
 * carries single-ability shelves (Graves is `Graves_W` alone, Fizz is
 * `Fizz_E`) and dropping those into Q just because they are first in their
 * shelf would be wrong. Full four-ability shelves are always listed in
 * Q/W/E/R order, so for those this agrees with position — it only ever
 * *disagrees* for the partial shelves, which is the case it is here for.
 *
 * Reads the barrel key, never `SpellClass.name`: a minifier rewrites the
 * latter, which would silently turn every lookup into `null` in a production
 * build. Same reasoning as `SUMMONER_SPELLS` and `listSpellCatalog` above.
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

/** `abilitySlotOfId` for a class reference — what the in-game picker holds. */
export const abilitySlotOfClass = (spellClass: SpellClass): number | null => {
  const id = spellIdOf(spellClass);
  return id === null ? null : abilitySlotOfId(id);
};

/** `SpellGroups[i].name` for the first group a spell class appears in — used as a "thuộc bộ: X" tag in the catalogue picker. Every spell in `AllSpells` appears in some group (see the module's catalogue-completeness audit), so this is `null` only for a spell added to `AllSpells` and never given a `SpellGroups` entry. */
const groupNameByClass = (): Map<SpellClass, string> => {
  const map = new Map<SpellClass, string>();
  for (const group of SpellGroups) {
    for (const spellClass of group.spells as SpellClass[]) {
      if (!map.has(spellClass)) map.set(spellClass, group.name);
    }
  }
  return map;
};

export interface SpellCatalogEntry {
  id: string;
  spellClass: SpellClass;
  display: SpellDisplay;
  groupName: string | null;
}

/** Every spell in `AllSpells`, for the free-form kit builder's per-slot picker. */
export const listSpellCatalog = (): SpellCatalogEntry[] => {
  const groupNames = groupNameByClass();
  return Array.from(SPELL_CLASS_BY_ID.entries()).map(([id, spellClass]) => ({
    id,
    spellClass,
    display: getSpellDisplay(spellClass),
    groupName: groupNames.get(spellClass) ?? null,
  }));
};

/** A slot's stored choice (a catalogue id, or `'random'`) resolved to a spell class, falling back to a random pick from the whole catalogue for `'random'` or a stale/unknown id. */
const resolveSpellChoice = (choice: SlotChoice): SpellClass => {
  if (choice !== 'random') {
    const found = SPELL_CLASS_BY_ID.get(choice);
    if (found) return found;
  }
  return random(Array.from(SPELL_CLASS_BY_ID.values()));
};

/**
 * Turns a `ChampionLoadout` (plain, serializable data — the player's or one
 * AI bot's) into the same shape `getChampionPresetRandom` returns, so
 * `Game.ts` doesn't need to know which of the three paths produced it:
 *
 * - `mode: 'custom'` resolves each of the 7 stored `customSlots` choices
 *   independently through `resolveSpellChoice`.
 * - `mode: 'champion'` with a real `championName` bundles that champion's
 *   real Q/W/E/R plus the chosen summoners, as before.
 * - `mode: 'champion'` with `championName: 'random'`, or a `championName`
 *   that no longer names a full-kit champion — a stale save from before a
 *   champion was removed, or corruption `PregameConfig`'s own sanitizer
 *   can't catch because it doesn't know this catalog — falls back to the
 *   exact existing random-kit behaviour.
 *
 * A custom kit has no single champion identity to draw a portrait from, so
 * it gets the same random-avatar treatment as `getChampionPresetRandom` —
 * consistent with how 'random' champion mode already decouples the avatar
 * from the kit.
 */
export const getChampionPresetFromLoadout = (
  loadout: ChampionLoadout
): ChampionPresetData & { avatar: AssetKey } => {
  if (loadout.mode === 'custom') {
    const slots = Array.from(
      { length: SLOT_COUNT },
      (_, i) => loadout.customSlots[i] ?? 'random'
    );
    return {
      name: 'Tự Ghép Chiêu',
      avatar: randomAvatar(),
      spells: slots.map(resolveSpellChoice),
    };
  }

  const champion =
    loadout.championName === 'random'
      ? undefined
      : listSelectableChampions().find(entry => entry.name === loadout.championName);
  if (!champion) {
    // Random decides the portrait and the four abilities — not D and F. Those
    // two are an explicit choice on every loadout, this one included, and the
    // random preset's own hardcoded Flash/Heal used to silently overwrite them:
    // a player who set Ignite on a random champion got Heal. Harmless while the
    // pregame screen only offered summoner slots inside champion mode with a
    // *named* champion; now that one picker shows all seven slots side by side
    // for every loadout, the D/F pills would have been lying about the match
    // they were about to start.
    const preset = getChampionPresetRandom();
    return {
      ...preset,
      spells: [
        ...(preset.spells ?? []).slice(0, SLOT_COUNT - 2),
        findSummoner(loadout.summonerD),
        findSummoner(loadout.summonerF),
      ],
    };
  }

  const group = SpellGroups.find(g => g.name === champion.name)!;
  return {
    name: champion.name,
    avatar: champion.avatar,
    spells: [
      AllSpells.BasicAttack,
      ...(group.spells as SpellClass[]),
      findSummoner(loadout.summonerD),
      findSummoner(loadout.summonerF),
    ],
  };
};

export const MonsterPreset: Record<string, MonsterPresetData> = {
  baron: {
    name: 'Baron',
    avatar: 'monster_Baron_Nashor',
    camp: { x: 2147, y: 1876, r: 100 },
    speed: 0,
    size: 100,
    attackRange: 400,
    reviveTime: 3000,
    health: 1000,
    // rooted in place with a long reach, so it hits hard but slowly
    damage: 25,
    attackInterval: 2000,
    aggroRange: 480,
  },
  blue1: {
    name: 'Blue',
    avatar: 'monster_Blue_Sentinel',
    camp: { x: 1631, y: 2958, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  blue2: {
    name: 'Blue',
    avatar: 'monster_Blue_Sentinel',
    camp: { x: 4794, y: 3419, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  red1: {
    name: 'Red',
    avatar: 'monster_Red_Brambleback',
    camp: { x: 3368, y: 4698, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  red2: {
    name: 'Red',
    avatar: 'monster_Red_Brambleback',
    camp: { x: 3085, y: 1672, r: 300 },
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolf1: {
    name: 'Greater Wolf',
    avatar: 'monster_Greater_Murk_Wolf',
    camp: { x: 1685, y: 3562, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolf1_a: {
    name: 'Wolf',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 1602, y: 3511, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  wolf1_b: {
    name: 'Wolf',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 1725, y: 3659, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  wolf2: {
    name: 'Greater Wolf',
    avatar: 'monster_Greater_Murk_Wolf',
    camp: { x: 4728, y: 2835, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolf2_a: {
    name: 'Wolf',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 4709, y: 2743, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  wolf2_b: {
    name: 'Wolf',
    avatar: 'monster_Murk_Wolf',
    camp: { x: 4816, y: 2888, r: 300 },
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
  },
  gomp1: {
    name: 'Gromp',
    avatar: 'monster_Gromp',
    camp: { x: 914, y: 2784, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  gomp2: {
    name: 'Gromp',
    avatar: 'monster_Gromp',
    camp: { x: 5540, y: 3599, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptor1: {
    name: 'Crimson_Raptor',
    avatar: 'monster_Crimson_Raptor',
    camp: { x: 2954, y: 4110, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptor1_a: {
    name: 'Raptor',
    avatar: 'monster_Raptor',
    camp: { x: 3045, y: 4026, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor1_b: {
    name: 'Raptor',
    avatar: 'monster_Raptor',
    camp: { x: 3149, y: 4095, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor1_c: {
    name: 'Raptor',
    avatar: 'monster_Raptor',
    camp: { x: 3060, y: 4169, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor2: {
    name: 'Crimson_Raptor',
    avatar: 'monster_Crimson_Raptor',
    camp: { x: 3498, y: 2258, r: 300 },
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptor2_a: {
    name: 'Raptor',
    avatar: 'monster_Raptor',
    camp: { x: 3432, y: 2356, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor2_b: {
    name: 'Raptor',
    avatar: 'monster_Raptor',
    camp: { x: 3307, y: 2295, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
  raptor2_c: {
    name: 'Raptor',
    avatar: 'monster_Raptor',
    camp: { x: 3378, y: 2183, r: 300 },
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
  },
};

/**
 * The two spawn platforms, in the corners the map's own turret rows point at.
 * Coordinates were picked by scanning the wall polygons in summoner_map.json for
 * the roomiest open spot in each base — both sit ~260px clear of any wall.
 *
 * Order matters: index 0 is the bottom-left base and belongs to TeamId.BLUE,
 * index 1 is the top-right base and belongs to TeamId.RED. Game.spawnFountains()
 * reads the team straight off this index, and the minion spawner reads it back
 * off the fountain.
 */
export const FountainPreset: FountainPresetData[] = [
  { name: 'Bệ Đá Cổ', x: 400, y: 6075, r: 190, teamId: TeamId.BLUE },
  { name: 'Bệ Đá Cổ', x: 6100, y: 375, r: 190, teamId: TeamId.RED },
];

export interface TurretPosition {
  x: number;
  y: number;
  teamId: string;
}

/**
 * summoner_map.json already ships the two turret rows (`turret1`/`turret2`) as
 * flat [x, y] points — 11 per side, all on open ground at lane chokepoints.
 * They were never read by anything; TerrainMap used to try to parse them as
 * polygons and produced NaN obstacles.
 *
 * `turret1` is the bottom-left row and `turret2` the top-right one, so the two
 * keys already encode which base each turret defends. This used to flatten both
 * into one list and throw that away, which was fine while turrets were neutral
 * hazards and is not now that they are team buildings.
 */
const TURRET_ROW_TEAMS: { key: string; teamId: string }[] = [
  { key: 'turret1', teamId: TeamId.BLUE },
  { key: 'turret2', teamId: TeamId.RED },
];

export const getTurretPositions = (): TurretPosition[] => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapData: any = AssetManager.get('json_summoner_map').data;
  const positions: TurretPosition[] = [];

  for (const { key, teamId } of TURRET_ROW_TEAMS) {
    const points = mapData?.[key];
    if (!Array.isArray(points)) continue;
    for (const p of points) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        positions.push({ x: p[0], y: p[1], teamId });
      }
    }
  }

  return positions;
};
