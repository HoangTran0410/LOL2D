/**
 * The pregame setup screen's settings: player loadout, per-bot AI loadouts,
 * AI behaviour, and match-wide rules (cooldown reduction, URF). Pure data —
 * no p5 globals, no knowledge of `SpellGroups`/spell classes — so it is safe
 * to import from anywhere (including `MenuScene.setup()`) and to unit test
 * in plain node.
 *
 * `Game` reads this once, at construction (see `Game.ts`), and turns it into
 * the concrete objects (a `ChampionPresetData`, an `AIChampion` behaviour, a
 * `MatchRules`) other code actually consumes — nothing downstream reaches
 * back into this module or into `localStorage` on its own.
 *
 * ## Schema versioning
 *
 * The storage key stays `lol2d:pregameConfig:v1` even though this revision
 * adds fields (`player.mode`, `player.customSlots`, `ai.bots`) that v1 never
 * wrote. Bumping the key was the other option and was rejected: a player who
 * configured a match yesterday would load under a fresh key with nothing
 * there, silently losing their champion pick, AI count, CDR and URF — a
 * worse outcome than what this does instead, which is extend the *validator*.
 * `sanitizePregameConfig` already treats every field as independently
 * optional and falls back per-field (that was the design from the start, for
 * exactly this reason: schemas grow). An old blob missing `player.mode` gets
 * `mode: 'champion'` — its old meaning, since v1 only ever had champion mode
 * — and missing `ai.bots` gets a full array of default (random) bot
 * loadouts, i.e. today's actual behaviour for every bot. Both are lossless
 * reads of what an old config meant, not resets.
 */

/** A `SpellGroups` champion name (see `preset.ts`), or the random-kit default. */
export type ChampionChoice = string | 'random';

/** A `preset.ts` spell catalogue id (an `AllSpells` barrel key), or 'random'. */
export type SlotChoice = string | 'random';

/**
 * `'champion'`: avatar + Q/W/E/R come from one `SpellGroups` entry (or a
 * fully random mix, when `championName` is `'random'`) — the original,
 * simpler path, unchanged in behaviour.
 *
 * `'custom'`: all 7 slots (A, Q, W, E, R, D, F — see `SLOT_COUNT`) are picked
 * independently from the whole spell catalogue via `customSlots`.
 */
export type PlayerKitMode = 'champion' | 'custom';

/** Slot order: A (basic attack), Q, W, E, R, D (summoner), F (summoner). */
export const SLOT_COUNT = 7;

export interface ChampionLoadout {
  mode: PlayerKitMode;
  /** Which `SpellGroups` entry supplies the avatar and Q/W/E/R kit. `mode: 'champion'` only. */
  championName: ChampionChoice;
  /** `preset.ts` summoner catalogue id for the `D` slot. `mode: 'champion'` only. */
  summonerD: string;
  /** Summoner catalogue id for the `F` slot. `mode: 'champion'` only. */
  summonerF: string;
  /** One choice per slot (length `SLOT_COUNT`). `mode: 'custom'` only. */
  customSlots: readonly SlotChoice[];
}

/** @deprecated Renamed to `ChampionLoadout` — a bot uses the same shape. Kept as an alias so older call sites still type-check. */
export type PlayerLoadout = ChampionLoadout;

export interface AIConfig {
  /** How many AI champions spawn alongside the player. */
  count: number;
  /** Whether an idle bot wanders on its own. Off by default, same as today. */
  autoMove: boolean;
  /** Whether a bot picks fights on its own. */
  autoAttack: boolean;
  /** Whether a bot casts its own spells on its own. */
  autoCast: boolean;
  /**
   * One loadout per bot *slot* (always `AI_COUNT_MAX` entries, regardless of
   * `count`), indexed 0-based. Only the first `count` are actually spawned —
   * the rest stay in storage so lowering `count` and raising it back later
   * doesn't lose a bot's customisation. Every entry defaults to `{ mode:
   * 'champion', championName: 'random', ... }`, i.e. today's actual
   * behaviour, so a config that never touches this array is unchanged from
   * before per-bot configuration existed.
   */
  bots: readonly ChampionLoadout[];
}

export interface MatchRulesConfig {
  /** 0-90. 0 reproduces today's cooldowns exactly. */
  cooldownReductionPercent: number;
  /** URF: every ability costs no mana. Off reproduces today's costs exactly. */
  manaFree: boolean;
}

export interface PregameConfig {
  player: ChampionLoadout;
  ai: AIConfig;
  rules: MatchRulesConfig;
}

export const AI_COUNT_MIN = 0;
export const AI_COUNT_MAX = 10;
export const CDR_PERCENT_MIN = 0;
export const CDR_PERCENT_MAX = 90;

/** The value every bot slot starts at, and what a freed slot is refilled with
 *  when a bot is removed from the middle of the list — see `removeBotAt` in
 *  usePregameConfig.ts. */
export const DEFAULT_CHAMPION_LOADOUT: Readonly<ChampionLoadout> = Object.freeze({
  mode: 'champion',
  championName: 'random',
  summonerD: 'Flash',
  summonerF: 'Heal',
  customSlots: Object.freeze(Array.from({ length: SLOT_COUNT }, () => 'random' as const)),
});

/**
 * Reproduces the game's behaviour before this config existed: a fully random
 * champion and kit, 5 AI champions — each also random — that fight back and
 * cast on their own but don't wander (AIChampion's own hardcoded defaults:
 * autoAttack=true, autoCast=true, autoMove=false), no cooldown reduction,
 * full mana costs.
 */
export const DEFAULT_PREGAME_CONFIG: Readonly<PregameConfig> = Object.freeze({
  player: DEFAULT_CHAMPION_LOADOUT,
  ai: Object.freeze({
    count: 5,
    autoMove: false,
    autoAttack: true,
    autoCast: true,
    bots: Object.freeze(Array.from({ length: AI_COUNT_MAX }, () => DEFAULT_CHAMPION_LOADOUT)),
  }),
  rules: Object.freeze({
    cooldownReductionPercent: 0,
    manaFree: false,
  }),
});

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
 * Sanitizes one champion/kit loadout — shared by the player and every bot
 * slot, since both are the same shape. Every field falls back independently,
 * same policy as `sanitizePregameConfig`.
 *
 * `customSlots` is coerced to exactly `SLOT_COUNT` entries: short arrays are
 * padded with `'random'`, long ones truncated, and any non-string entry
 * becomes `'random'` — a slot can never end up empty or crash a `.map`
 * downstream, whatever a corrupt or hand-edited blob contained.
 */
export const sanitizeChampionLoadout = (raw: unknown): ChampionLoadout => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChampionLoadout>;
  const mode: PlayerKitMode = source.mode === 'custom' ? 'custom' : 'champion';
  const rawSlots = Array.isArray(source.customSlots) ? source.customSlots : [];
  const customSlots: SlotChoice[] = Array.from({ length: SLOT_COUNT }, (_, i) =>
    asNonEmptyString(rawSlots[i], 'random')
  );

  return {
    mode,
    championName: asNonEmptyString(source.championName, DEFAULT_CHAMPION_LOADOUT.championName),
    summonerD: asNonEmptyString(source.summonerD, DEFAULT_CHAMPION_LOADOUT.summonerD),
    summonerF: asNonEmptyString(source.summonerF, DEFAULT_CHAMPION_LOADOUT.summonerF),
    customSlots,
  };
};

/**
 * Turns whatever came back from `JSON.parse` (or nothing at all) into a
 * config that is safe to hand to `Game`. Every field is validated
 * independently and falls back to its own default, so a config that is
 * missing a section, has a field of the wrong type, or was saved by an older
 * version of this screen still produces a playable result instead of
 * throwing during boot.
 *
 * `championName`/`summonerD`/`summonerF`/`customSlots` entries are only
 * checked for "is this a non-empty string" here — whether they still name a
 * real champion, summoner spell or catalogue entry is `preset.ts`'s job (the
 * catalog they refer to lives there, and this module deliberately knows
 * nothing about it), with the same safe-fallback-to-random policy applied at
 * resolution time.
 */
export const sanitizePregameConfig = (raw: unknown): PregameConfig => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<PregameConfig>;
  const ai = (source.ai && typeof source.ai === 'object' ? source.ai : {}) as Partial<AIConfig>;
  const rules = (source.rules && typeof source.rules === 'object'
    ? source.rules
    : {}) as Partial<MatchRulesConfig>;

  const rawBots = Array.isArray(ai.bots) ? ai.bots : [];
  const bots: ChampionLoadout[] = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
    sanitizeChampionLoadout(rawBots[i])
  );

  return {
    player: sanitizeChampionLoadout(source.player),
    ai: {
      count: clampInt(ai.count, AI_COUNT_MIN, AI_COUNT_MAX, DEFAULT_PREGAME_CONFIG.ai.count),
      autoMove: asBoolean(ai.autoMove, DEFAULT_PREGAME_CONFIG.ai.autoMove),
      autoAttack: asBoolean(ai.autoAttack, DEFAULT_PREGAME_CONFIG.ai.autoAttack),
      autoCast: asBoolean(ai.autoCast, DEFAULT_PREGAME_CONFIG.ai.autoCast),
      bots,
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
