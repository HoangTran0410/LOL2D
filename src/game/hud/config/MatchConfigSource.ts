/**
 * The seam that made one match-config panel possible.
 *
 * There used to be two panels — the pregame setup screen over `localStorage`
 * and the in-game practice panel over `MatchDirector` — and they disagreed
 * about which settings existed at all: the setup screen alone could pick an
 * input mode, the panel alone could assign sides or switch the jungle off.
 * Neither was a superset. Two backends had grown two independent sets of
 * controls over the same config, and every new control landed in whichever
 * component its author happened to be editing.
 *
 * So the panel is one component now, and *this* is what it talks to. Two
 * implementations satisfy it: `PregameConfigSource` (no match exists;
 * everything is a read and a write of the stored config) and
 * `MatchDirectorSource` (a match is running; every mutation goes through
 * `MatchDirector`, which applies it and then persists it). A control added to
 * the panel has to be served by both, and the contract suite checks that it is.
 *
 * ## Nothing from the running game crosses this boundary
 *
 * No `Champion`, no `Spell`, no `Camera` — only view models and ids. That is
 * not tidiness, it is what keeps the panel out of the `game` chunk: the menu
 * mounts this same panel, and one value import of a `src/game/` runtime symbol
 * would put the whole match — every spell, the navigation grid, ~2MB — in
 * front of the logo. It is the same rule `game/input/touchPreferences.ts` was
 * split out to obey, and `tests/scenes/matchConfigChunk.test.ts` is what stops
 * it being quietly broken. Type-only imports are erased and are fine.
 *
 * ## `live` is the one capability flag
 *
 * A row carries no reference to a unit, because whether the live-only controls
 * render is a property of the *source*, not of a row: in a match every
 * participant is live, outside one none is. So `source.live !== null` is the
 * single gate, and the things that genuinely need a running match — KDA, refill,
 * clear cooldowns, stack counts, the camera zoom — hang off `MatchLiveControls`
 * where the type system can see they are unavailable.
 */
import type { MatchTeamId } from '@/game/config/MatchTeams';
import type {
  BotBehaviour,
  ChampionLoadout,
  CheatConfig,
  MatchRules,
  MatchRulesConfig,
  WorldConfig,
} from '@/game/config/PregameConfig';
import type { TouchModePreference } from '@/game/input/touchPreferences';
import type { RenderFps } from '@/game/Game';
import type { RenderQuality } from '@/game/managers/ObjectManager';
import type { ScoreLine, StatGroup } from '@/game/hud/practice/participantStats';
import type { SpellDisplay } from '@/game/config/spellCatalog';
import type { QualifiedMapSummary } from '@/content/PackRegistry';

/** One Q/W/E/R icon on a roster row. */
export interface RosterAbility {
  /** `Q`, `W`, `E` or `R` — shown when the slot is empty or has no art. */
  letter: string;
  url: string | null;
  /**
   * Whether tapping the icon has a description to open. False for an empty
   * slot. The description itself comes from `describeAbility` rather than an id
   * on this object, because the two sources answer it from different places —
   * see that method.
   */
  describable: boolean;
}

export interface ConfigRosterEntry {
  /** `unit.id` in a match; `'player'` / `'bot-<i>'` outside one. Stable within one source. */
  id: string;
  /**
   * Position in the **full** roster — 0 is always the player — kept even though
   * the list is rendered grouped by side.
   *
   * It is what the DOM ids are built from (`practice-row-toggle-2`), and that
   * is deliberate rather than incidental: `id` is a uuid in a running match,
   * which no test can name, while a position is stable, readable and the thing
   * a person would say out loud. Several e2e scripts address rows this way.
   */
  index: number;
  /** "Bạn" / "Bot 1" — a position in the roster, never a unit identity. */
  label: string;
  isPlayer: boolean;
  team: MatchTeamId;
  /**
   * The champion the row names. In a match this is the unit standing on the
   * map; outside one it is what the *loadout* says — "Ngẫu Nhiên" for a bot
   * left rolling. The two are different facts and the row must not substitute
   * one for the other: reading a rolled champion back as a setting would
   * silently pin a bot that is meant to keep re-rolling on every respawn.
   */
  title: string;
  avatarUrl: string | null;
  abilities: RosterAbility[];
  loadout: ChampionLoadout;
  /**
   * Bots only — the player drives itself and has no behaviour to configure.
   * Carries the tier this bot plays at as well as its three switches, so the
   * row renders the whole of its AI from one field and writes it back through
   * one setter (`setBotBehaviour`). `undefined` here is what makes those
   * controls a bot's — the tab guards them behind it, and
   * `tests/game/hud/rosterTabDifficulty.test.ts` is what keeps them there,
   * because `tsconfig.json` sets `strict: false` and the compiler will not.
   */
  behaviour?: BotBehaviour;
  invulnerable: boolean;
}

export interface RosterStack {
  spellId: string;
  name: string;
  count: number;
}

/**
 * The controls that need a match to be running. Reachable only through
 * `MatchConfigSource.live`, which is `null` on the menu — so a tab cannot
 * render a button that would do nothing, and cannot compile one either.
 */
export interface MatchLiveControls {
  /** Health and mana to full. */
  refill(id: string): void;
  clearCooldowns(id: string): void;
  scoreOf(id: string): ScoreLine;
  statGroupsOf(id: string): StatGroup[];
  /** Only the unit's spells that count something; most kits have none. */
  stacksOf(id: string): RosterStack[];
  /** Relative, because the buttons are `+1 / +10 / +100`. */
  addStacks(id: string, spellId: string, amount: number): void;
  clearStacks(id: string, spellId: string): void;

  readonly zoom: number;
  setZoom(factor: number): void;
  /** Separate from `setZoom` because the slider writes on every frame of a drag and persists once. */
  persistZoom(): void;

  /** Leave the match. A scene transition, which is why it is not a config write. */
  requestExit(): void;
}

export interface MatchConfigSource {
  /** `null` outside a match. The single gate on every live-only control. */
  readonly live: MatchLiveControls | null;

  // ------------------------------------------------------------------ roster
  roster(): ConfigRosterEntry[];
  /** False at `AI_COUNT_MAX`, so the button explains itself instead of silently refusing. */
  canAddBot(): boolean;
  botCount(): number;
  /**
   * Adds a bot **to a named side**, because the control that calls this sits at
   * the end of that side's list rather than in a bar of its own. There is no
   * "add a bot and work out where" any more — the player already said where by
   * pressing the button under Đội Xanh instead of the one under Đội Đỏ.
   */
  addBot(team: MatchTeamId): Promise<void>;
  removeBot(id: string): void;
  setTeam(id: string, team: MatchTeamId): void;
  /**
   * Writes only the fields it is handed — one toggle, or the difficulty row,
   * can send its own without restating the rest. A no-op on the player.
   */
  setBotBehaviour(id: string, flags: Partial<BotBehaviour>): void;
  /**
   * The loadout the editor opens on — the *setting*, not the champion currently
   * standing on the map. See `ConfigRosterEntry.title`.
   */
  loadoutOf(id: string): ChampionLoadout;
  applyLoadout(id: string, loadout: ChampionLoadout): Promise<void>;
  /**
   * The description behind one of a row's ability icons, or `null` for an empty
   * slot.
   *
   * A method rather than a catalogue id on `RosterAbility`, because the honest
   * answer differs by source and neither can produce the other's. Outside a
   * match there is only a loadout, so the catalogue is the only thing that can
   * be asked. Inside one there is a live `Spell` — which has the description,
   * the icon and this match's *actual* cooldown and mana cost on it — and no
   * reliable way back to a catalogue id (`Spell.name` is a constructor name,
   * which a minifier is free to mangle).
   *
   * The icons used to be tappable only on the setup screen and decorative in the
   * practice panel. That was one of the divergences the single panel exists to
   * remove, so this is the seam that makes them the same control in both places.
   */
  describeAbility(id: string, letter: string): SpellDisplay | null;

  // ------------------------------------------------------------------- rules
  readonly matchRules: MatchRules;
  getRules(): MatchRulesConfig;
  /**
   * `persist: false` is the CDR slider mid-drag: apply it so the number on
   * screen is true, but do not write a value the player is still dragging past.
   */
  setRules(rules: MatchRulesConfig, persist: boolean): void;

  getWorld(): WorldConfig;
  setWorld(world: Partial<WorldConfig>): void;

  // --------------------------------------------------------------------- map
  /**
   * Every map an installed pack offers, qualified —
   * `contentCatalog().maps()` verbatim. Never empty: the bundled pack always
   * installs at least Summoner's Rift.
   */
  availableMaps(): QualifiedMapSummary[];
  /**
   * The chosen map's qualified id (`<packId>:<localId>`).
   *
   * Outside a match this is a plain setting, round-tripped through
   * `PregameConfig.mapId` — `setMap` writes it and this reads it straight
   * back. **In a running match it is read-only**: a live match already has a
   * terrain map, a nav grid and objects standing on that geometry, and
   * nothing in this seam rebuilds any of it (see `MatchDirectorSource`'s own
   * doc comment for the reasoning and the alternative it deliberately did not
   * take). There, this always reports the map that is actually running,
   * unmoved by `setMap` — a live world cannot be swapped from under it.
   */
  getMap(): string;
  /**
   * Writes the choice for the *next* match. Outside one, `getMap()` reads it
   * straight back. In a running match it changes nothing about the running
   * world — see `getMap`'s own doc comment — it only decides what boots the
   * next time this match is left and a new one started.
   */
  setMap(id: string): void;

  // ------------------------------------------------------------------ cheats
  getCheats(): CheatConfig;
  setCheats(cheats: Partial<CheatConfig>): void;
  setInvulnerable(id: string, on: boolean): void;

  // ------------------------------------------------------------------ device
  /**
   * The resolved layout, and the stored choice, which are different questions:
   * `'auto'` on a phone and `'touch'` on a phone render identically, so the
   * three-option row has to select on the choice while the hint reports the
   * result.
   */
  readonly touchUi: boolean;
  readonly inputMode: TouchModePreference;
  setInputMode(mode: TouchModePreference): void;

  readonly renderQuality: RenderQuality;
  readonly renderFps: RenderFps;
  setRenderQuality(quality: RenderQuality): void;
  setRenderFps(fps: RenderFps): void;

  /** Writes `DEFAULT_PREGAME_CONFIG` and — in a match — applies it on the spot. */
  resetToDefaults(): Promise<void>;
}
