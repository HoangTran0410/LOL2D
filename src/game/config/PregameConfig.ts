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
 * made on the setup screen. Its fourth field, `difficulty`, is the one that
 * does *not* follow that shortcut and for the same reason: there has never been
 * a global for it, and nothing outside `AIChampion`'s own default could set one
 * — so a stored behaviour without a tier is a `normal` bot, which is what every
 * match that was ever played actually was. A missing `ai.botTeams` gets the stable Red/Blue
 * alternation that balances the default three bots around the Blue player, and a
 * missing `playerTeam` gets Blue — the fixed side the player owned before the
 * team tab let them switch. `world`
 * is the same story with a simpler answer: a config saved before it existed
 * meant a match with a full jungle and lane minions, because that is the only
 * match the game could boot. `mapId` (Task 10 of the content-pack extraction)
 * follows the same shape again: a blob with none gets `DEFAULT_MAP_ID`, the
 * one map that existed before a second one shipped and a choice became
 * possible.
 */
import { initialBotTeam, isMatchTeamId, MatchTeam, type MatchTeamId } from './MatchTeams';
import type { BotDifficulty } from '../ai/Difficulty';

/**
 * Re-exported so the stored schema and the panel that edits it can both name a
 * tier without importing the AI module. The import above is `import type` and
 * is erased; a *value* import of `game/ai/Difficulty` from here would be a
 * static edge out of the `pregame` chunk into `game`, i.e. the whole match in
 * front of the menu — see `tests/scenes/pregameBootPath.test.ts`.
 */
export type { BotDifficulty };

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
  /**
   * How well this bot plays — `game/ai/Difficulty.ts` holds the three tiers and
   * everything they tune. A fourth field of a *behaviour* rather than an array
   * of its own beside `botBehaviours`, because it is the same question the
   * three flags ask ("what does this bot do on its own?") about the same bot,
   * and one shape means one persisted array, one splice when a bot is removed,
   * one row in the panel and one setter — `setBotBehaviour(bot, flags)` already
   * writes only the fields it is handed.
   */
  difficulty: BotDifficulty;
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

/**
 * The five debug layers, structurally identical to `DebugFlags` in
 * `game/debug/DebugOverlay.ts` and deliberately *not* imported from it: this
 * module is pure data with no knowledge of anything that draws, and that
 * separation is what lets the menu read a config without pulling the match
 * chunk. `debug-flags-shape.test.ts` asserts the two stay the same shape.
 */
export interface DebugLayerConfig {
  routes: boolean;
  terrain: boolean;
  collision: boolean;
  vision: boolean;
  quadtree: boolean;
  /** The on-screen FPS readout (`game/debug/FpsOverlay.ts`). A plain boolean like
   *  `terrain`/`collision`/`vision`/`quadtree` — nothing live to alias onto. */
  fps: boolean;
}

/**
 * What used to be session state.
 *
 * Cheats and debug layers were deliberately never stored — the reasoning was
 * that an invulnerable champion surviving a reload reads as the game being
 * broken rather than as a restored setting. That reversed when the setup
 * screen and the practice panel became one panel: a panel with two classes of
 * control, one that comes back and one that silently does not, is a worse
 * thing to explain than a cheat that stays on. The mitigation is legibility
 * instead of forgetting — the roster row shows a shield on an invulnerable
 * participant without anything being expanded.
 *
 * `botInvulnerable` is index-aligned with `ai.bots`/`botTeams`/`botBehaviours`
 * and the same fixed `AI_COUNT_MAX` length, for the same reason those are: a
 * bot removed from the middle shifts the rest up, and a parallel array is the
 * only shape where one splice keeps all four in step.
 *
 * Stack counts are *not* here. `+1/+10/+100` acts on a live spell instance, so
 * persisting one would mean keying by slot and spell id and replaying it at
 * spawn — a different feature, and the control is not offered outside a match
 * anyway.
 */
export interface CheatConfig {
  /** Show the whole map on the minimap, fog or no fog. */
  revealMap: boolean;
  debug: DebugLayerConfig;
  playerInvulnerable: boolean;
  /** One flag per bot *slot* (always `AI_COUNT_MAX` entries), 0-based. */
  botInvulnerable: readonly boolean[];
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
  cheats: CheatConfig;
  /**
   * The qualified id (`<packId>:<localId>`, `PackRegistry.qualify`) of the
   * map the next match boots onto. Task 10 of the content-pack extraction:
   * `MapDefinition` existed since batch 1 with nothing that ever read
   * anything but the first installed one.
   *
   * Validated here only as "is this a non-empty string" — the same shallow
   * check every other id-shaped field in this module gets
   * (`championName`, `summonerD`, …). Whether it still names an *installed*
   * map is a question this module cannot answer: it knows nothing of
   * `PackRegistry`, on purpose (see the file header — pure data, no
   * knowledge of the content-pack seam, safe to import from `MenuScene`).
   * `GameScene.startGame()` is what resolves it against `contentCatalog()`
   * and falls back to the first available map if the id names nothing
   * installed, so a config naming an uninstalled or removed map still boots
   * instead of bricking the menu.
   */
  mapId: string;
}

export const AI_COUNT_MIN = 0;
export const AI_COUNT_MAX = 10;
export const CDR_PERCENT_MIN = 0;
export const CDR_PERCENT_MAX = 90;

/**
 * `PackRegistry.qualify('riot', 'summoners-rift')` — the map every match
 * played on before this was configurable, restated as a literal because this
 * module cannot import `PackRegistry` (see `mapId`'s own doc comment: pure
 * data, no knowledge of the content-pack seam). A second, independent copy
 * of the same fact `game/ai/Difficulty.ts`'s `BOT_DIFFICULTIES` is to
 * `BOT_DIFFICULTY_ORDER` a few lines down — held in step by
 * `tests/game/config/PregameConfig.test.ts`, which imports both sides and
 * fails if the bundled pack's id or Summoner's Rift's own local id ever
 * changes without this literal moving with them.
 */
export const DEFAULT_MAP_ID = 'riot:summoners-rift';

/**
 * The value every bot slot starts at, and what a freed slot is refilled with
 * when a bot is removed from the middle of the list — see `removeBotAt` in
 * usePregameConfig.ts.
 *
 * `summonerD`/`summonerF` are two more restated literals, for the same
 * reason `DEFAULT_MAP_ID` above is one: this module cannot import the
 * content system to ask the bundled pack's own summoner-spell shelf
 * (`spellCatalog.ts`'s `summonerSpellIds`) which two ids to default to.
 * `tests/game/config/PregameConfig.test.ts` cross-checks both against that
 * shelf so this cannot drift from it silently the way `DEFAULT_MAP_ID`
 * cannot from `PackRegistry`'s own id.
 */
export const DEFAULT_CHAMPION_LOADOUT: Readonly<ChampionLoadout> = Object.freeze({
  mode: 'champion',
  championName: 'random',
  summonerD: 'Flash',
  summonerF: 'Heal',
  customSlots: Object.freeze(Array.from({ length: SLOT_COUNT }, () => 'random' as const)),
});

/**
 * The three tiers, easiest first — the order the roster row lists them in.
 *
 * A second copy of `BOT_DIFFICULTIES` in `game/ai/Difficulty.ts`, on purpose.
 * That module is a *runtime value* in the `game` chunk, and this one is read by
 * the match-config panel, which the menu mounts: importing the AI module's
 * array here would drag the entire match in front of the logo (see the
 * re-export at the top of this file). The two are held in step by
 * `tests/game/config/PregameConfig.test.ts`, which imports both and fails if a
 * tier is added, removed or renamed on one side only.
 */
export const BOT_DIFFICULTY_ORDER: readonly BotDifficulty[] = Object.freeze([
  'easy',
  'normal',
  'hard',
] as const);

/** `AIChampion`'s own `DEFAULT_DIFFICULTY`, and what every match ran on before this was configurable. */
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'normal';

export const isBotDifficulty = (value: unknown): value is BotDifficulty =>
  typeof value === 'string' && (BOT_DIFFICULTY_ORDER as readonly string[]).includes(value);

/**
 * `AIChampion`'s own hardcoded defaults, which is what makes this the value a
 * bot slot nobody has configured must carry.
 */
export const DEFAULT_BOT_BEHAVIOUR: Readonly<BotBehaviour> = Object.freeze({
  autoMove: true,
  autoAttack: true,
  autoCast: true,
  difficulty: DEFAULT_BOT_DIFFICULTY,
});

/**
 * The behaviour a bot nobody has configured gets: the setup screen's global
 * flags, which is what those are *for*, plus the default tier — the screen has
 * no difficulty control, so the globals say nothing about it, and "normal" is
 * what every bot in every match played before this one could be set.
 *
 * One helper rather than three literals, because all three call sites
 * (`sanitizePregameConfig`, `PregameConfigSource.removeBot` refilling a freed
 * tail slot, and `MatchDirector.addBotWithPreset`) mean exactly this sentence.
 */
export const globalBotBehaviour = (
  ai: Pick<AIConfig, 'autoMove' | 'autoAttack' | 'autoCast'>
): BotBehaviour => ({
  autoMove: ai.autoMove,
  autoAttack: ai.autoAttack,
  autoCast: ai.autoCast,
  difficulty: DEFAULT_BOT_DIFFICULTY,
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
  cheats: Object.freeze({
    revealMap: false,
    debug: Object.freeze({
      routes: false,
      terrain: false,
      collision: false,
      vision: false,
      quadtree: false,
      fps: false,
    }),
    playerInvulnerable: false,
    botInvulnerable: Object.freeze(Array.from({ length: AI_COUNT_MAX }, () => false)),
  }),
  mapId: DEFAULT_MAP_ID,
});

/** The layer names, in the order the settings tab lists them. */
export const DEBUG_LAYER_KEYS = [
  'routes',
  'terrain',
  'collision',
  'vision',
  'quadtree',
  'fps',
] as const satisfies readonly (keyof DebugLayerConfig)[];

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
    // Per field like the three above, and the fallback callers hand in carries
    // `DEFAULT_BOT_DIFFICULTY`: nothing could set a tier before this field
    // existed, so a stored behaviour without one *is* a normal bot rather than
    // an unanswered question. Reading it that way is lossless.
    difficulty: isBotDifficulty(source.difficulty) ? source.difficulty : fallback.difficulty,
  };
};

/**
 * Sanitizes the cheat section, every field falling back to "off".
 *
 * "Off" is the migration answer as well as the default, and the two coincide
 * for a real reason rather than by convenience: before this section existed
 * nothing here *could* survive a reload, so a blob without it describes a
 * match with everything switched off. Reading it that way loses nothing.
 *
 * `botInvulnerable` is coerced to exactly `AI_COUNT_MAX` entries — padded,
 * truncated, and non-booleans replaced — the same treatment `customSlots` gets
 * and for the same reason: an index into it can never be `undefined`, whatever
 * a corrupt or hand-edited blob contained.
 */
export const sanitizeCheatConfig = (raw: unknown): CheatConfig => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<CheatConfig>;
  const debug = (
    source.debug && typeof source.debug === 'object' ? source.debug : {}
  ) as Partial<DebugLayerConfig>;
  const rawBots = Array.isArray(source.botInvulnerable) ? source.botInvulnerable : [];

  return {
    revealMap: asBoolean(source.revealMap, false),
    debug: {
      routes: asBoolean(debug.routes, false),
      terrain: asBoolean(debug.terrain, false),
      collision: asBoolean(debug.collision, false),
      vision: asBoolean(debug.vision, false),
      quadtree: asBoolean(debug.quadtree, false),
      fps: asBoolean(debug.fps, false),
    },
    playerInvulnerable: asBoolean(source.playerInvulnerable, false),
    botInvulnerable: Array.from({ length: AI_COUNT_MAX }, (_, i) => asBoolean(rawBots[i], false)),
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
  const globalFlags = {
    autoMove: asBoolean(ai.autoMove, DEFAULT_PREGAME_CONFIG.ai.autoMove),
    autoAttack: asBoolean(ai.autoAttack, DEFAULT_PREGAME_CONFIG.ai.autoAttack),
    autoCast: asBoolean(ai.autoCast, DEFAULT_PREGAME_CONFIG.ai.autoCast),
  };
  // Only the three flags are spread into `ai` below; the tier is per bot and
  // has no global to spread, which is why the two are separate values here.
  const globalBehaviour: BotBehaviour = globalBotBehaviour(globalFlags);
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
      ...globalFlags,
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
    cheats: sanitizeCheatConfig(source.cheats),
    // Non-empty string only — see `mapId`'s own doc comment for why "is this
    // an installed map" is a question `GameScene.startGame()` answers, never
    // this function. A blob saved before this field existed (or naming a map
    // that has since been removed) falls back to the map every match played
    // on before the choice existed.
    mapId: asNonEmptyString(source.mapId, DEFAULT_MAP_ID),
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
