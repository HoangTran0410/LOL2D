/**
 * `MatchConfigSource` over a running match.
 *
 * **This file is the one place the panel's world touches the game's.** Every
 * `instanceof`, every `Champion` field, every `Spell` — all of it is here, and
 * `tests/scenes/matchConfigChunk.test.ts` exempts this file alone for that
 * reason. The panel above it sees ids and view models, which is what lets the
 * same panel mount over the menu without dragging the match into its chunk.
 *
 * It is a translation layer and nothing more: no rule about how a match works
 * lives here. `MatchDirector` still owns every mutation and still persists
 * afterwards; this only turns "the row with id `X`" back into the unit the
 * director wants, and turns units back into rows.
 *
 * ## Ids are unit ids
 *
 * Unlike `PregameConfigSource`, whose ids are positions, a row here is
 * identified by `unit.id` — a live object with a quadtree slot and a path agent
 * that keeps its identity when the bot above it is removed. The roster is
 * re-read after every mutation either way, so the difference never shows.
 */
import type MatchDirector from '@/game/MatchDirector';
import type { RosterEntry } from '@/game/MatchDirector';
import AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import type Champion from '@/game/gameObject/attackableUnits/Champion';
import type Spell from '@/game/gameObject/Spell';
import {
  AI_COUNT_MAX,
  DEFAULT_CHAMPION_LOADOUT,
  type BotBehaviour,
  type ChampionLoadout,
  type CheatConfig,
  type MatchRules,
  type MatchRulesConfig,
  type WorldConfig,
} from '@/game/config/PregameConfig';
import type { MatchTeamId } from '@/game/config/MatchTeams';
import { setZoomFactorPreference } from '@/game/gameObject/map/Camera';
import {
  setTouchModePreference,
  touchControlsPreference,
  touchModePreference,
  type TouchModePreference,
} from '@/game/input/touchPreferences';
import type { RenderFps } from '@/game/config/renderPreferences';
import type { RenderQuality } from '@/game/managers/ObjectManager';
import { scoreLine, statGroups, type ScoreLine, type StatGroup } from '../practice/participantStats';
import type { SpellDisplay } from '@/game/config/spellCatalog';
import type {
  ConfigRosterEntry,
  MatchConfigSource,
  MatchLiveControls,
  RosterAbility,
  RosterStack,
} from './MatchConfigSource';
import { ABILITY_LETTERS } from './rosterVisuals';
import { contentCatalog } from '@/content/catalog';
import type { QualifiedMapSummary } from '@/content/PackRegistry';

/**
 * What this source needs from the HUD. `HudInteractions` satisfies it
 * structurally; the interface exists so the adapter can be exercised on a
 * bench, and so this file names only what it actually uses.
 */
export interface MatchDirectorHost {
  readonly director: MatchDirector;
  readonly camera: { zoomFactor: number; setZoomFactor(factor: number): void; snapToScale(): void };
  readonly touchUi: boolean;
  /** The qualified id of the map this match is actually running on. See `MatchConfigSource.getMap`. */
  readonly activeMapId: string;
  readonly renderQuality: RenderQuality;
  readonly renderFps: RenderFps;
  setRenderQuality(quality: RenderQuality): void;
  setRenderFps(fps: RenderFps): void;
  /** Applies a touch/pointer switch to the live match — `Game.setTouchControlsEnabled`. */
  setTouchUiEnabled(enabled: boolean): void;
  requestExit(): void;
}

/** `spells` is indexed by `SpellHotKeys` — `[A, Q, W, E, R, D, F]` — so abilities are 1‑4. */
const ABILITY_SLOTS = [1, 2, 3, 4];

export default class MatchDirectorSource implements MatchConfigSource {
  readonly live: MatchLiveControls;

  constructor(private readonly host: MatchDirectorHost) {
    this.live = {
      refill: id => this.withUnit(id, unit => this.director.refill(unit)),
      clearCooldowns: id => this.withUnit(id, unit => this.director.clearCooldowns(unit)),
      scoreOf: id => this.scoreOf(id),
      statGroupsOf: id => this.statGroupsOf(id),
      stacksOf: id => this.stacksOf(id),
      addStacks: (id, spellId, amount) =>
        this.withStack(id, spellId, spell => spell.setStackCount((spell.stackCount ?? 0) + amount)),
      clearStacks: (id, spellId) => this.withStack(id, spellId, spell => spell.setStackCount(0)),

      get zoom(): number {
        return host.camera.zoomFactor;
      },
      setZoom(factor: number): void {
        host.camera.setZoomFactor(factor);
        // The match is paused while the panel is open, so `Camera.update()`
        // cannot lerp `currentScale` toward the new target before the first
        // visible frame.
        host.camera.snapToScale();
      },
      persistZoom(): void {
        setZoomFactorPreference(host.camera.zoomFactor, host.touchUi);
      },
      requestExit(): void {
        host.requestExit();
      },
    };
  }

  private get director(): MatchDirector {
    return this.host.director;
  }

  private entries(): RosterEntry[] {
    return this.director.roster();
  }

  private unitOf(id: string): Champion | null {
    for (const entry of this.entries()) if (entry.unit.id === id) return entry.unit;
    return null;
  }

  private withUnit(id: string, run: (unit: Champion) => void): void {
    const unit = this.unitOf(id);
    if (unit) run(unit);
  }

  private stackSpells(unit: Champion): Spell[] {
    const spells: Spell[] = [];
    // A hand-rolled loop rather than `filter` with a type predicate: this
    // codebase re-declares `Array.prototype.filter` (see CLAUDE.md), so the
    // predicate overload never gets a look in and the result comes back wide.
    for (const spell of unit.spells ?? []) {
      if (spell && spell.stackCount !== undefined) spells.push(spell);
    }
    return spells;
  }

  private withStack(id: string, spellId: string, run: (spell: Spell) => void): void {
    this.withUnit(id, unit => {
      for (const spell of this.stackSpells(unit)) {
        if (spell.id === spellId) {
          run(spell);
          return;
        }
      }
    });
  }

  /**
   * `entry.behaviour` being present already implies a bot, but implying is not
   * proving and the roster is built from live objects this source does not own.
   */
  private botOf(id: string): AIChampion | null {
    const unit = this.unitOf(id);
    return unit instanceof AIChampion ? unit : null;
  }

  private spellAt(unit: Champion, letter: string): Spell | null {
    const index = ABILITY_LETTERS.indexOf(letter as (typeof ABILITY_LETTERS)[number]);
    if (index < 0) return null;
    return unit.spells?.[ABILITY_SLOTS[index]] ?? null;
  }

  private abilitiesOf(unit: Champion): RosterAbility[] {
    return ABILITY_SLOTS.map((slot, i) => {
      const spell = unit.spells?.[slot];
      const image = spell?.image as { url?: string } | null | undefined;
      return {
        letter: ABILITY_LETTERS[i],
        url: image?.url ?? null,
        describable: !!spell,
      };
    });
  }

  /**
   * Built from the live spell rather than looked up in the catalogue, and that
   * is the better answer rather than a fallback: the numbers are this match's,
   * so a cooldown quoted here is after the CDR slider and a mana cost is zero
   * under URF. `effectiveCoolDownMs` and `effectiveManaCost` are the seams that
   * apply those rules (see `Spell.effectiveMana`), so this cannot express them
   * differently from a cast.
   */
  describeAbility(id: string, letter: string): SpellDisplay | null {
    const unit = this.unitOf(id);
    const spell = unit ? this.spellAt(unit, letter) : null;
    if (!spell) return null;
    const image = spell.image as { url?: string } | null | undefined;
    return {
      iconUrl: image?.url ?? null,
      name: spell.name,
      description: String(spell.description ?? ''),
      coolDownMs: spell.coolDown,
      manaCost: spell.manaCost,
      effectiveCoolDownMs: spell.effectiveCoolDownMs,
      effectiveManaCost: spell.effectiveManaCost,
    };
  }

  // ------------------------------------------------------------------ roster

  roster(): ConfigRosterEntry[] {
    return this.entries().map((entry, index) => ({
      id: entry.unit.id,
      index,
      label: index === 0 ? 'Bạn' : `Bot ${index}`,
      isPlayer: entry.isPlayer,
      team: entry.unit.teamId as MatchTeamId,
      // The unit standing on the map, not the loadout — see
      // `ConfigRosterEntry.title` for why the two must not be substituted.
      title: entry.unit.name || 'Không tên',
      avatarUrl: entry.unit.avatar?.url ?? null,
      abilities: this.abilitiesOf(entry.unit),
      loadout: this.director.loadoutOf(entry.unit),
      behaviour: entry.behaviour,
      invulnerable: this.director.isInvulnerable(entry.unit),
    }));
  }

  botCount(): number {
    return this.director.bots().length;
  }

  canAddBot(): boolean {
    return this.botCount() < AI_COUNT_MAX;
  }

  async addBot(team: MatchTeamId): Promise<void> {
    await this.director.addBotLoaded(DEFAULT_CHAMPION_LOADOUT, team);
  }

  removeBot(id: string): void {
    const bot = this.botOf(id);
    if (bot) this.director.removeBot(bot);
  }

  setTeam(id: string, team: MatchTeamId): void {
    this.withUnit(id, unit => this.director.setTeam(unit, team));
  }

  setBotBehaviour(id: string, flags: Partial<BotBehaviour>): void {
    const bot = this.botOf(id);
    if (bot) this.director.setBotBehaviour(bot, flags);
  }

  loadoutOf(id: string): ChampionLoadout {
    const unit = this.unitOf(id);
    return unit ? this.director.loadoutOf(unit) : DEFAULT_CHAMPION_LOADOUT;
  }

  async applyLoadout(id: string, loadout: ChampionLoadout): Promise<void> {
    const unit = this.unitOf(id);
    if (unit) await this.director.applyLoadoutLoaded(unit, loadout);
  }

  // ------------------------------------------------------------- live detail

  private scoreOf(id: string): ScoreLine {
    const unit = this.unitOf(id);
    return unit ? scoreLine(unit) : { kills: 0, deaths: 0, cs: 0 };
  }

  private statGroupsOf(id: string): StatGroup[] {
    const unit = this.unitOf(id);
    return unit ? statGroups(unit) : [];
  }

  private stacksOf(id: string): RosterStack[] {
    const unit = this.unitOf(id);
    if (!unit) return [];
    return this.stackSpells(unit).map(spell => ({
      spellId: spell.id,
      name: spell.name,
      count: spell.stackCount ?? 0,
    }));
  }

  // ------------------------------------------------------------------- rules

  get matchRules(): MatchRules {
    return this.director.matchRules;
  }

  getRules(): MatchRulesConfig {
    return this.director.getRules();
  }

  setRules(rules: MatchRulesConfig, persist: boolean): void {
    if (persist) this.director.setRules(rules);
    else this.director.seedRules(rules);
  }

  getWorld(): WorldConfig {
    return { jungle: this.director.jungleEnabled, minions: this.director.minionsEnabled };
  }

  setWorld(world: Partial<WorldConfig>): void {
    if (world.jungle !== undefined) this.director.jungleEnabled = world.jungle;
    if (world.minions !== undefined) this.director.minionsEnabled = world.minions;
  }

  // --------------------------------------------------------------------- map

  availableMaps(): QualifiedMapSummary[] {
    return [...contentCatalog().maps()];
  }

  /**
   * The live map, read straight off the host — never `this.director.mapChoice`,
   * which is what the *next* match will boot onto and moves the moment
   * `setMap` is called. See `MatchConfigSource.getMap`'s own doc comment.
   */
  getMap(): string {
    return this.host.activeMapId;
  }

  /** Persists the choice for next time. Does not touch the running world — see `MatchConfigSource.setMap`. */
  setMap(id: string): void {
    this.director.setMapChoice(id);
  }

  // ------------------------------------------------------------------ cheats

  getCheats(): CheatConfig {
    return this.director.cheats();
  }

  setCheats(cheats: Partial<CheatConfig>): void {
    if (cheats.revealMap !== undefined) this.director.revealMap = cheats.revealMap;
    if (cheats.debug) {
      for (const [key, on] of Object.entries(cheats.debug)) {
        this.director.setDebugFlag(key as keyof CheatConfig['debug'], on);
      }
    }
    // `playerInvulnerable` / `botInvulnerable` are deliberately not handled
    // here: out here a cheat lands on a *unit*, and `setInvulnerable(id, on)`
    // is the call that names one. Writing the array would mean guessing which
    // row each index meant, which is the pregame source's question, not this
    // one's.
  }

  setInvulnerable(id: string, on: boolean): void {
    this.withUnit(id, unit => this.director.setInvulnerable(unit, on));
  }

  // ------------------------------------------------------------------ device

  get touchUi(): boolean {
    return this.host.touchUi;
  }

  get inputMode(): TouchModePreference {
    return touchModePreference();
  }

  /**
   * Mid-match, so it applies as well as remembers: `setTouchUiEnabled` swaps
   * the on-screen controls and the HUD layout on the spot. `remember` is left
   * to `setTouchModePreference` above it, which stores the tri-state — the
   * boolean the match takes cannot express `'auto'`.
   */
  setInputMode(mode: TouchModePreference): void {
    setTouchModePreference(mode);
    this.host.setTouchUiEnabled(touchControlsPreference());
  }

  get renderQuality(): RenderQuality {
    return this.host.renderQuality;
  }

  get renderFps(): RenderFps {
    return this.host.renderFps;
  }

  setRenderQuality(quality: RenderQuality): void {
    this.host.setRenderQuality(quality);
  }

  setRenderFps(fps: RenderFps): void {
    this.host.setRenderFps(fps);
  }

  async resetToDefaults(): Promise<void> {
    await this.director.resetToDefaults();
  }
}
