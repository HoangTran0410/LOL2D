import AssetManager, { type AssetKey } from '@/managers/AssetManager';
import TeamId from './enums/TeamId';
import type { MonsterPresetData } from './gameObject/attackableUnits/Monster';
import { BARON_ABILITIES } from './gameObject/monsters/Baron';
import type { ChampionAttackTuning } from './gameObject/attackableUnits/Champion';
import type { FountainPresetData } from './gameObject/structures/Fountain';
import type { ChampionPresetData } from './gameObject/attackableUnits/Champion';
import type { ChampionLoadout, MatchRules, SlotChoice } from './config/PregameConfig';
import { SLOT_COUNT } from './config/PregameConfig';
import {
  BASIC_ATTACK_ID,
  CHAMPION_KITS,
  SUMMONER_SPELL_IDS,
  listSelectableChampions,
  type SpellDisplay,
} from './config/spellCatalog';
import type { SpellCatalogId } from '@/generated/spellCatalog';
import {
  allSpellIds,
  isSpellId,
  isSpellLoaded,
  randomLoadedId,
  spellClassOfId,
  type SpellClass,
} from './spellRegistry';
import BasicAttack from './gameObject/spells/BasicAttack';

/**
 * The barrel is gone from this file, and that is the whole of Stage 4.
 *
 * `import * as AllSpells` used to sit on line 1, which meant every build of the
 * game carried all 238 spell modules in one chunk no matter what the match
 * played. Ids now come from `config/spellCatalog.ts` (generated data) and
 * classes from `spellRegistry.ts` (dynamic imports, fetched per champion).
 *
 * `BasicAttack` stays a static import because every kit has it in slot 0 and
 * because it is the last-resort fallback below — a spell the resolver reaches
 * for when it has nothing else must not itself be something that might not have
 * arrived.
 */
export type { SpellClass };

const random = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * A catalogue id resolved to a class, with the fallbacks a lazily-loaded
 * catalogue needs.
 *
 * Two things can make a lookup miss and both are recoverable: a stale
 * `localStorage` slot naming a spell this build removed, and — for a mid-match
 * re-roll — an id whose chunk has not landed yet. Neither is worth a broken
 * match, so this degrades to another loaded spell and finally to the basic
 * attack. Anything a match *plans* for is loaded before it starts; see
 * `planMatchKits`.
 */
const classForId = (id: string): SpellClass => {
  const found = spellClassOfId(id);
  if (found) return found;
  const substitute = randomLoadedId();
  return (substitute && spellClassOfId(substitute)) ?? BasicAttack;
};

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
  'champ_ekko',
  'champ_jarvaniv',
  'champ_camille',
  'champ_katarina',
  'champ_vayne',
  'champ_riven',
  'champ_sett',
  'champ_jhin',
  'champ_nautilus',
  'champ_diana',
  'champ_vi',
  'champ_syndra',
  'champ_ziggs',
  'champ_irelia',
];
const randomAvatar = (): AssetKey => random(RANDOM_AVATAR_POOL);

/**
 * A wholly random champion — the AI's respawn re-roll, and what a loadout on
 * 'random' resolves to.
 *
 * Reads through `planRandomKit` + `presetFromPlan` like everything else, which
 * is what keeps one definition of "what a random kit is". Note the ordering
 * constraint this creates: it can only return spells that are *loaded*, so a
 * re-roll during the first second of a match draws from a smaller pool than the
 * catalogue. `loadRemainingSpells` closes that window long before anything has
 * died; `classForId` is the backstop if it somehow has not.
 */
export const getChampionPresetRandom = (): ChampionPresetData & { avatar: AssetKey } =>
  presetFromPlan({
    ...planRandomKit(),
    // Only ever roll ids that have arrived: planning against the full catalogue
    // is right *before* a match, when the plan is about to be loaded, and wrong
    // during one, when nothing is going to fetch it.
    spellIds: planRandomKit().spellIds.map(id =>
      isSpellLoaded(id) ? id : (randomLoadedId() ?? id)
    ),
  });

/**
 * The kit table, and `ATTACK`, now live in `config/spellCatalog.ts` as ids —
 * re-exported here so every existing `from '@/game/preset'` keeps working.
 *
 * `SpellGroups` is that table with each id mapped back to its class — the one
 * direction that needs the barrel, and the reason this file is in the game
 * chunk and `spellCatalog.ts` is not. Data goes out to the picker as ids;
 * classes come back only for a match that is actually starting.
 */
export { ATTACK } from '@/game/config/spellCatalog';

/**
 * The kit table with each id resolved to its class.
 *
 * A **function**, not the constant it used to be: the classes arrive
 * asynchronously now, so a value computed at module-eval time would be a table
 * of `undefined`. Callers must have loaded what they are about to read —
 * `loadSpells(allSpellIds())` in a test, `planMatchKits` in a match.
 */
export const spellGroups = (): {
  name: string;
  image: AssetKey | null;
  spells: SpellClass[];
  /** The champion's basic-attack profile; see `ATTACK`. */
  attack?: ChampionAttackTuning;
}[] =>
  CHAMPION_KITS.map(kit => ({
    name: kit.name,
    image: kit.image,
    spells: kit.spells.map(classForId),
    attack: kit.attack,
  }));

// ---------------------------------------------------------------------------
// Display data, from a class
//
// The pregame screen no longer comes through here: it reads
// `config/spellCatalog.ts`, which is the same seven fields generated at build
// time, so that rendering a roster of 238 abilities does not require loading
// 238 modules. What is left is the *class*-shaped read, for the in-game HUD —
// already inside the game chunk, holding real spell instances, with nothing to
// save by going the long way round through an id.
//
// `new SpellClass(owner)` for a throwaway display instance is the technique the
// in-game spell-picker modal already uses to read a spell's icon/name without a
// real champion to own it, extended with a stub `owner.game.matchRules` so the
// same instance can also report its *effective* (CDR/URF-adjusted) cooldown and
// mana cost.
//
// The `catch` stays: this runs in a browser, where one broken spell must not
// take the picker down with it. `scripts/generate-spell-catalog.mjs` makes the
// opposite choice deliberately — see its header.
// ---------------------------------------------------------------------------

/** No cooldown reduction, no URF — what a spell shows outside any pregame context. */
const NO_MATCH_RULES: MatchRules = { cooldownMultiplier: 1, manaFree: false };

export type { SpellDisplay } from '@/game/config/spellCatalog';

/**
 * Builds a throwaway instance to read a spell's display fields — including,
 * given `matchRules`, the same `effectiveCoolDownMs`/`effectiveManaCost`
 * getters `Spell.ts` uses for the real cast path (`reducedCooldown`), so a
 * number shown here is provably the number the engine will actually use.
 *
 * `config/spellCatalog.ts`'s `spellDisplayOf` is the id-shaped twin of this,
 * and `tests/game/config/spellCatalog.test.ts` asserts the two agree on every
 * spell in the barrel — which is what stops the generated data becoming a
 * second, quietly-wrong source of truth.
 */
export const getSpellDisplay = (
  SpellClass: SpellClass,
  matchRules: MatchRules = NO_MATCH_RULES
): SpellDisplay => {
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
      effectiveManaCost:
        typeof instance.effectiveManaCost === 'number' ? instance.effectiveManaCost : 0,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `preset.ts: a spell failed to construct for display (${SpellClass?.name ?? '?'})`,
      error
    );
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

export {
  BASIC_ATTACK_ID,
  abilitySlotOfId,
  listSelectableChampions,
  listSpellCatalog,
  listSummonerSpells,
  SUMMONER_SPELL_IDS,
  type SelectableChampion,
  type SelectableChampionSpell,
  type SpellCatalogEntry,
  type SummonerSpellOption,
} from '@/game/config/spellCatalog';

// ---------------------------------------------------------------------------
// Planning a match, then building it
//
// These used to be one step: `getChampionPresetFromLoadout` rolled the dice for
// every 'random' slot *and* reached into the barrel for the classes, in a single
// synchronous call from `Game`'s constructor. With the barrel gone that no
// longer works, and the reason is worth stating because it is the whole
// argument for splitting them:
//
//   A default match is six `championName: 'random'` loadouts, and a random kit
//   can name any spell in the catalogue. Deciding what to load by looking at the
//   config would therefore have answered "all 238" — the exact thing this was
//   supposed to avoid.
//
// So the roll happens first, against ids alone (`planMatchKits` — no module has
// to have arrived for it to pick names out of a list), the ~24 ids it produces
// are loaded, and only then are classes read (`presetFromPlan`). One roll, and
// a match that fetches the six kits it is about to play.
//
// Ids are the spell barrel's own export names — e.g. `'Yasuo_Q'` — never
// `SpellClass.name`. Both are ostensibly the same string today, but only the
// key is stable: a minifier renames a class's `Function.prototype.name` and
// cannot rename a key that `spellModules.ts` writes as a literal.
// ---------------------------------------------------------------------------

/** A catalogue id's class, or `null` if its module has not been loaded. */
export { spellClassOfId } from './spellRegistry';

/** One unit's kit, decided before a single spell module has been fetched. */
export interface KitPlan {
  name: string;
  avatar: AssetKey;
  /** Exactly `SLOT_COUNT` ids, in A/Q/W/E/R/D/F order. */
  spellIds: string[];
}

export interface MatchPlan {
  player: KitPlan;
  bots: KitPlan[];
}

const randomSpellId = (): string => random(allSpellIds());

/** A stored summoner choice, or Flash if it no longer names one. */
const summonerIdOr = (choice: string): string =>
  SUMMONER_SPELL_IDS.includes(choice as SpellCatalogId) ? choice : 'Flash';

/** A slot's stored choice with 'random' — and any id this build dropped — rolled out. */
const planSlot = (choice: SlotChoice): string =>
  choice !== 'random' && isSpellId(choice) ? choice : randomSpellId();

/**
 * The random kit: a portrait and four abilities off the whole catalogue.
 *
 * D and F are arguments rather than hardcoded Flash/Heal because random decides
 * the portrait and the four abilities, *not* the summoners — those are an
 * explicit choice on every loadout, and the random preset used to silently
 * overwrite them (a player who set Ignite on a random champion got Heal).
 */
const planRandomKit = (summonerD = 'Flash', summonerF = 'Heal'): KitPlan => ({
  name: 'Random',
  avatar: randomAvatar(),
  spellIds: [
    // Slot 0 is the internal slot and SpellHotKeys[0] is `A`, so whatever sits
    // here is what `A` presses. The basic attack lives there: it is an ability
    // like the rest, and putting it in a slot is what gives the champion's own
    // attack a key, an icon and a timer without inventing a second input path
    // beside the spell one.
    BASIC_ATTACK_ID,
    randomSpellId(),
    randomSpellId(),
    randomSpellId(),
    randomSpellId(),
    summonerIdOr(summonerD),
    summonerIdOr(summonerF),
  ],
});

/**
 * Turns a `ChampionLoadout` (plain, serializable data — the player's or one
 * AI bot's) into the ids that loadout will play:
 *
 * - `mode: 'custom'` rolls each of the 7 stored `customSlots` choices
 *   independently.
 * - `mode: 'champion'` with a real `championName` takes that champion's real
 *   Q/W/E/R plus the chosen summoners.
 * - `mode: 'champion'` with `championName: 'random'`, or a name that no longer
 *   names a full-kit champion — a stale save from before a champion was
 *   removed, or corruption `PregameConfig`'s own sanitizer cannot catch because
 *   it does not know this catalogue — falls through to the random kit.
 *
 * A custom kit has no single champion identity to draw a portrait from, so it
 * gets the same random-avatar treatment, consistent with how 'random' champion
 * mode already decouples the avatar from the kit.
 */
export const planLoadout = (loadout: ChampionLoadout): KitPlan => {
  if (loadout.mode === 'custom') {
    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => loadout.customSlots[i] ?? 'random');
    return {
      name: 'Tự Ghép Chiêu',
      avatar: randomAvatar(),
      spellIds: slots.map(planSlot),
    };
  }

  const kit =
    loadout.championName === 'random'
      ? undefined
      : CHAMPION_KITS.find(
          candidate =>
            candidate.name === loadout.championName &&
            !!candidate.image &&
            candidate.spells.length === 4
        );

  if (!kit || !kit.image) return planRandomKit(loadout.summonerD, loadout.summonerF);

  return {
    name: kit.name,
    avatar: kit.image,
    spellIds: [
      BASIC_ATTACK_ID,
      ...kit.spells,
      summonerIdOr(loadout.summonerD),
      summonerIdOr(loadout.summonerF),
    ],
  };
};

/** Every unit's kit for one match, with all randomness already resolved. */
export const planMatchKits = (config: {
  player: ChampionLoadout;
  ai: { count: number; bots: readonly ChampionLoadout[] };
}): MatchPlan => ({
  player: planLoadout(config.player),
  bots: Array.from({ length: config.ai.count }, (_, i) =>
    planLoadout(config.ai.bots[i] ?? config.player)
  ),
});

/** The flat, deduplicated id list a plan needs loaded — what `GameScene` awaits. */
export const plannedSpellIds = (plan: MatchPlan): string[] => [
  ...new Set([plan.player, ...plan.bots].flatMap(kit => kit.spellIds)),
];

/** A plan with its classes attached. Everything it names must already be loaded. */
export const presetFromPlan = (plan: KitPlan): ChampionPresetData & { avatar: AssetKey } => ({
  name: plan.name,
  avatar: plan.avatar,
  spells: plan.spellIds.map(classForId),
});

/**
 * Plan and build in one step, for the callers that are already inside a running
 * match and can rely on the catalogue being loaded: `MatchDirector` swapping a
 * live champion's kit, and `AIChampion` re-rolling on respawn.
 */
export const getChampionPresetFromLoadout = (
  loadout: ChampionLoadout
): ChampionPresetData & { avatar: AssetKey } => presetFromPlan(planLoadout(loadout));
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
    // Rooted in place with a long reach. The bite is small because it is the
    // one part of the fight nobody can dodge — the damage that makes Baron
    // frightening lives in `BARON_ABILITIES`, and all of it is avoidable.
    damage: 12,
    attackInterval: 2000,
    aggroRange: 480,
    abilities: BARON_ABILITIES,
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
