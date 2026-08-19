/**
 * A match's settings: player loadout, per-bot AI loadouts, AI behaviour,
 * match-wide rules (cooldown reduction, URF) and the world it runs in
 * (jungle, lane minions). Pure data — no p5 globals, no knowledge of
 * `SpellGroups`/spell classes — so it is safe to import from anywhere
 * (including `MenuScene.setup()`) and to unit test in plain node.
 *
 * `Game` reads this once, at construction (see `Game.ts`), and turns it into
 * the concrete objects (a `ChampionPresetData`, an `AIChampion` behaviour, a
 * `MatchRules`) other code actually consumes.
 *
 * ## Two writers, one key
 *
 * The pregame setup screen writes this, and so does the in-game practice
 * panel — through `MatchDirector`, which derives the whole config from the
 * live match after every mutation it makes (see its file comment). The panel
 * used to write nothing at all; persisting it is the reversal the
 * `2026-08-16-panel-persistence-design` spec asked for, on the grounds that
 * the panel is a strict superset of the setup screen for match configuration
 * and was the surface whose work got thrown away on reload.
 *
 * `MatchDirector` reads a stored config on its way to writing one, because
 * two fields here have no live counterpart for it to derive: the *global*
 * `ai.autoMove`/`autoAttack`/`autoCast` (which only the setup screen edits)
 * and the bot slots past the live bot count (kept so lowering the count and
 * raising it back does not lose a bot's customisation).
 *
 * ## Schema versioning
 *
 * The storage key stays `lol2d:pregameConfig:v1` even though this revision
 * adds fields (`player.mode`, `player.customSlots`, `ai.bots`,
 * `ai.botBehaviours`, `ai.botTeams`, `playerTeam`) that v1 never wrote. Bumping the key was
 * the other option and was rejected: a player who
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
 *
 * `ai.botBehaviours` (added with the practice panel's persistence) follows
 * exactly that pattern, and it is worth spelling out because the obvious
 * shortcut is wrong: a config with no `botBehaviours` gets a full array
 * seeded **from that config's own global flags**, not from
 * `DEFAULT_PREGAME_CONFIG`. Before this array existed, the global flags were
 * what every bot in the match ran on — so they *are* what an old blob meant
 * per bot. Seeding from the defaults would look right (the defaults are a
 * plausible answer) while silently discarding a setting the player really
 * made on the setup screen. A missing `ai.botTeams` gets the stable Red/Blue
 * alternation that balances the default three bots around the Blue player, and a
 * missing `playerTeam` gets Blue — the fixed side the player owned before the
 * team tab let them switch. `world`
 * is the same story with a simpler answer: a config saved before it existed
 * meant a match with a full jungle and lane minions, because that is the only
 * match the game could boot.
 */
import { initialBotTeam, isMatchTeamId, MatchTeam, type MatchTeamId } from './MatchTeams';

/** A `SpellGroups` champion name (see `preset.ts`), or the random-kit default. */
export type ChampionChoice = string | 'random';

/** A `preset.ts` spell catalogue id (an `AllSpells` barrel key), or 'random'. */
export type SlotChoice = string | 'random';

/**
 * `'champion'`: avatar + Q/W/E/R come from one `SpellGroups` entry. When
 * `championName` is `'random'`, one complete champion row is rolled so its
 * identity, portrait, skills and attack profile stay coherent.
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

/**
 * One bot's three "does it act on its own" switches.
 *
 * Lives here rather than next to the code that applies it (`MatchDirector`,
 * which re-exports this type) because it is now a *stored* shape: the
 * practice panel sets these per bot and the config has to hold the answer.
 * `MatchDirector` imports this module; this module importing it back would be
 * a cycle.
 */
export interface BotBehaviour {
  autoMove: boolean;
  autoAttack: boolean;
  autoCast: boolean;
}

export interface AIConfig {
  /** How many AI champions spawn alongside the player. */
  count: number;
  /**
   * The behaviour a bot gets when nobody has chosen one for it: what the
   * setup screen's `AiConfigPanel` edits, what an old config's every bot ran
   * on (hence the `botBehaviours` migration), and what `MatchDirector.addBot`
   * gives a bot added mid-match. On by default, matching `AIChampion`.
   */
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
  /**
   * One Blue/Red lane team per bot slot. It is stored beside the loadout and
   * behaviour so a roster edited mid-match boots back onto the same sides.
   * Old configs migrate to Red/Blue alternating around the fixed Blue player;
   * the setup screen rebalances only a slot as it becomes active.
   */
  botTeams: readonly MatchTeamId[];
  /**
   * One behaviour per bot *slot*, the same `AI_COUNT_MAX`-long, index-aligned
   * shape as `bots` and for the same reasons. Parallel to `bots` rather than a
   * field inside a loadout because a loadout is a *kit* — the saved-kit
   * library stores those by name, and a saved kit has no business carrying
   * "and this one wanders".
   */
  botBehaviours: readonly BotBehaviour[];
}

/**
 * Which of the match's ambient populations exist. Only the practice panel has
 * ever had switches for these; the setup screen has none, and does not need
 * any for the config to carry them.
 */
export interface WorldConfig {
  /** Whether the jungle camps are spawned. */
  jungle: boolean;
  /** Whether the lane minion waves run. */
  minions: boolean;
}

export interface MatchRulesConfig {
  /** 0-90. 0 reproduces today's cooldowns exactly. */
  cooldownReductionPercent: number;
  /** URF: every ability costs no mana. Off reproduces today's costs exactly. */
  manaFree: boolean;
}

export interface PregameConfig {
  player: ChampionLoadout;
  /**
   * The player's lane team. Blue by default, and the practice panel's team tab
   * can move the player to Red like any bot — so it persists here beside
   * `ai.botTeams`, for the same reason those do: the match you shaped is the one
   * you get back on reload. An old blob missing it migrates to Blue, the fixed
   * side the player always used to own.
   */
  playerTeam: MatchTeamId;
  ai: AIConfig;
  rules: MatchRulesConfig;
  world: WorldConfig;
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
 * `AIChampion`'s own hardcoded defaults, which is what makes this the value a
 * bot slot nobody has configured must carry.
 */
export const DEFAULT_BOT_BEHAVIOUR: Readonly<BotBehaviour> = Object.freeze({
  autoMove: true,
  autoAttack: true,
  autoCast: true,
});

/**
 * Reproduces the game's behaviour before this config existed: a fully random
 * champion and kit, 3 AI champions — each also random, alternating Red/Blue
 * around the Blue player for a 2v2 — that move, fight and cast on their own,
 * no cooldown reduction, full mana costs, a full jungle and lane minions.
 */
export const DEFAULT_PREGAME_CONFIG: Readonly<PregameConfig> = Object.freeze({
  player: DEFAULT_CHAMPION_LOADOUT,
  playerTeam: MatchTeam.BLUE,
  ai: Object.freeze({
    count: 3,
    autoMove: DEFAULT_BOT_BEHAVIOUR.autoMove,
    autoAttack: DEFAULT_BOT_BEHAVIOUR.autoAttack,
    autoCast: DEFAULT_BOT_BEHAVIOUR.autoCast,
    bots: Object.freeze(Array.from({ length: AI_COUNT_MAX }, () => DEFAULT_CHAMPION_LOADOUT)),
    botTeams: Object.freeze(Array.from({ length: AI_COUNT_MAX }, (_, i) => initialBotTeam(i))),
    botBehaviours: Object.freeze(Array.from({ length: AI_COUNT_MAX }, () => DEFAULT_BOT_BEHAVIOUR)),
  }),
  rules: Object.freeze({
    cooldownReductionPercent: 0,
    manaFree: false,
  }),
  world: Object.freeze({
    jungle: true,
    minions: true,
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
 * Sanitizes one bot's behaviour, falling back **per field** to `fallback` —
 * which callers pass as the config's own global flags, never as
 * `DEFAULT_BOT_BEHAVIOUR`. See the migration note in the file header: the
 * global flags are what an old config meant for every bot, and defaulting
 * past them would drop a real setting.
 */
export const sanitizeBotBehaviour = (raw: unknown, fallback: BotBehaviour): BotBehaviour => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<BotBehaviour>;
  return {
    autoMove: asBoolean(source.autoMove, fallback.autoMove),
    autoAttack: asBoolean(source.autoAttack, fallback.autoAttack),
    autoCast: asBoolean(source.autoCast, fallback.autoCast),
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
  const rules = (
    source.rules && typeof source.rules === 'object' ? source.rules : {}
  ) as Partial<MatchRulesConfig>;
  const world = (
    source.world && typeof source.world === 'object' ? source.world : {}
  ) as Partial<WorldConfig>;

  const rawBots = Array.isArray(ai.bots) ? ai.bots : [];
  const bots: ChampionLoadout[] = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
    sanitizeChampionLoadout(rawBots[i])
  );
  const rawTeams = Array.isArray(ai.botTeams) ? ai.botTeams : [];
  const botTeams: MatchTeamId[] = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
    isMatchTeamId(rawTeams[i]) ? rawTeams[i] : initialBotTeam(i)
  );

  // Resolved before the per-bot array so it can seed it — the migration this
  // module's header spells out. Note the order: the *global* flags fall back to
  // the defaults, and every per-bot entry falls back to the globals.
  const globalBehaviour: BotBehaviour = {
    autoMove: asBoolean(ai.autoMove, DEFAULT_PREGAME_CONFIG.ai.autoMove),
    autoAttack: asBoolean(ai.autoAttack, DEFAULT_PREGAME_CONFIG.ai.autoAttack),
    autoCast: asBoolean(ai.autoCast, DEFAULT_PREGAME_CONFIG.ai.autoCast),
  };
  const rawBehaviours = Array.isArray(ai.botBehaviours) ? ai.botBehaviours : [];
  const botBehaviours: BotBehaviour[] = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
    sanitizeBotBehaviour(rawBehaviours[i], globalBehaviour)
  );

  return {
    player: sanitizeChampionLoadout(source.player),
    playerTeam: isMatchTeamId(source.playerTeam)
      ? source.playerTeam
      : DEFAULT_PREGAME_CONFIG.playerTeam,
    ai: {
      count: clampInt(ai.count, AI_COUNT_MIN, AI_COUNT_MAX, DEFAULT_PREGAME_CONFIG.ai.count),
      ...globalBehaviour,
      bots,
      botTeams,
      botBehaviours,
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
    world: {
      jungle: asBoolean(world.jungle, DEFAULT_PREGAME_CONFIG.world.jungle),
      minions: asBoolean(world.minions, DEFAULT_PREGAME_CONFIG.world.minions),
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
  cooldownMultiplier:
    1 - clampInt(rules.cooldownReductionPercent, CDR_PERCENT_MIN, CDR_PERCENT_MAX, 0) / 100,
  manaFree: rules.manaFree,
});
