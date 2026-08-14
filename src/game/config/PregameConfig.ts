/**
 * The pregame setup screen's settings: player loadout, AI bot behaviour, and
 * match-wide rules (cooldown reduction, URF). Pure data — no p5 globals, no
 * knowledge of `SpellGroups`/spell classes — so it is safe to import from
 * anywhere (including `MenuScene.setup()`) and to unit test in plain node.
 *
 * `Game` reads this once, at construction (see `Game.ts`), and turns it into
 * the concrete objects (a `ChampionPresetData`, an `AIChampion` behaviour, a
 * `MatchRules`) other code actually consumes — nothing downstream reaches
 * back into this module or into `localStorage` on its own.
 */

/** A `SpellGroups` champion name (see `preset.ts`), or the random-kit default. */
export type ChampionChoice = string | 'random';

export interface PlayerLoadout {
  /** Which `SpellGroups` entry supplies the avatar and Q/W/E/R kit. */
  championName: ChampionChoice;
  /** `SummonerSpellCatalog` id (see `preset.ts`) for the `D` slot. */
  summonerD: string;
  /** `SummonerSpellCatalog` id for the `F` slot. */
  summonerF: string;
}

export interface AIConfig {
  /** How many AI champions spawn alongside the player. */
  count: number;
  /** Whether an idle bot wanders on its own. Off by default, same as today. */
  autoMove: boolean;
  /** Whether a bot picks fights on its own. */
  autoAttack: boolean;
  /** Whether a bot casts its own spells on its own. */
  autoCast: boolean;
}

export interface MatchRulesConfig {
  /** 0-90. 0 reproduces today's cooldowns exactly. */
  cooldownReductionPercent: number;
  /** URF: every ability costs no mana. Off reproduces today's costs exactly. */
  manaFree: boolean;
}

export interface PregameConfig {
  player: PlayerLoadout;
  ai: AIConfig;
  rules: MatchRulesConfig;
}

/**
 * Reproduces the game's behaviour before this config existed: a fully random
 * champion and kit, 5 AI champions that fight back but neither wander nor
 * cast on their own... wait — AIChampion's own defaults are autoAttack=true,
 * autoCast=true, autoMove=false, and that's exactly what's mirrored below.
 */
export const DEFAULT_PREGAME_CONFIG: Readonly<PregameConfig> = Object.freeze({
  player: Object.freeze({
    championName: 'random',
    summonerD: 'Flash',
    summonerF: 'Heal',
  }),
  ai: Object.freeze({
    count: 5,
    autoMove: false,
    autoAttack: true,
    autoCast: true,
  }),
  rules: Object.freeze({
    cooldownReductionPercent: 0,
    manaFree: false,
  }),
});

export const AI_COUNT_MIN = 0;
export const AI_COUNT_MAX = 10;
export const CDR_PERCENT_MIN = 0;
export const CDR_PERCENT_MAX = 90;

const STORAGE_KEY = 'lol2d:pregameConfig:v1';

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asNonEmptyString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

/**
 * Turns whatever came back from `JSON.parse` (or nothing at all) into a
 * config that is safe to hand to `Game`. Every field is validated
 * independently and falls back to its own default, so a config that is
 * missing a section, has a field of the wrong type, or was saved by an older
 * version of this screen still produces a playable result instead of
 * throwing during boot.
 *
 * `championName`/`summonerD`/`summonerF` are only checked for "is this a
 * non-empty string" here — whether they still name a real champion or
 * summoner spell is `preset.ts`'s job (the catalog they refer to lives
 * there, and this module deliberately knows nothing about it), with the same
 * safe-fallback-to-random policy applied at resolution time.
 */
export const sanitizePregameConfig = (raw: unknown): PregameConfig => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<PregameConfig>;
  const player = (source.player && typeof source.player === 'object'
    ? source.player
    : {}) as Partial<PlayerLoadout>;
  const ai = (source.ai && typeof source.ai === 'object' ? source.ai : {}) as Partial<AIConfig>;
  const rules = (source.rules && typeof source.rules === 'object'
    ? source.rules
    : {}) as Partial<MatchRulesConfig>;

  return {
    player: {
      championName: asNonEmptyString(
        player.championName,
        DEFAULT_PREGAME_CONFIG.player.championName
      ),
      summonerD: asNonEmptyString(player.summonerD, DEFAULT_PREGAME_CONFIG.player.summonerD),
      summonerF: asNonEmptyString(player.summonerF, DEFAULT_PREGAME_CONFIG.player.summonerF),
    },
    ai: {
      count: clampInt(ai.count, AI_COUNT_MIN, AI_COUNT_MAX, DEFAULT_PREGAME_CONFIG.ai.count),
      autoMove: asBoolean(ai.autoMove, DEFAULT_PREGAME_CONFIG.ai.autoMove),
      autoAttack: asBoolean(ai.autoAttack, DEFAULT_PREGAME_CONFIG.ai.autoAttack),
      autoCast: asBoolean(ai.autoCast, DEFAULT_PREGAME_CONFIG.ai.autoCast),
    },
    rules: {
      cooldownReductionPercent: clampInt(
        rules.cooldownReductionPercent,
        CDR_PERCENT_MIN,
        CDR_PERCENT_MAX,
        DEFAULT_PREGAME_CONFIG.rules.cooldownReductionPercent
      ),
      manaFree: asBoolean(rules.manaFree, DEFAULT_PREGAME_CONFIG.rules.manaFree),
    },
  };
};

/**
 * Reads the persisted config, validating on the way out. Any failure —
 * `localStorage` unavailable, a corrupt blob, JSON that isn't even an
 * object — falls back to `DEFAULT_PREGAME_CONFIG` rather than throwing,
 * because a broken stored config bricking the menu is worse than losing it.
 */
export const loadPregameConfig = (): PregameConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
    return sanitizePregameConfig(JSON.parse(raw));
  } catch {
    return sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
  }
};

/** Persists a config, sanitizing first so a bad in-memory value can't be saved. */
export const savePregameConfig = (config: PregameConfig): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePregameConfig(config)));
  } catch {
    // Private-mode Safari, a full quota, `localStorage` disabled entirely —
    // none of that is worth crashing the pregame screen over. The config
    // just won't survive a reload this time.
  }
};

/** The derived numbers `Spell.ts` actually consumes — see `Game.matchRules`. */
export interface MatchRules {
  cooldownMultiplier: number;
  manaFree: boolean;
}

export const toMatchRules = (rules: MatchRulesConfig): MatchRules => ({
  cooldownMultiplier: 1 - clampInt(rules.cooldownReductionPercent, CDR_PERCENT_MIN, CDR_PERCENT_MAX, 0) / 100,
  manaFree: rules.manaFree,
});
