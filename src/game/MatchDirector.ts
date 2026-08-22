/**
 * Every mutation of a *running* match, in one place.
 *
 * ## Why this is not `PregameConfig`
 *
 * The two describe the same match and are not interchangeable. `PregameConfig`
 * is plain, serializable data about a match that **does not exist yet**: "three
 * bots" there is a number in an object, and changing it changes nothing until
 * `Game` reads it once at construction. This is the other side — changes to a
 * match that is already running, where "three bots" is three live units holding a
 * quadtree slot, a pathfinding agent, a spell list mid-cooldown and a team id
 * other units are resolving hostility against. "Remove bot 3" is an array
 * splice on one side and, on this one, marking a unit for the sweep and letting
 * everything it owns unwind on the next tick.
 *
 * Serving both through one interface is where this would have gone wrong. The
 * two still are not interchangeable — but they are now connected, in one
 * direction and at one seam: **every mutating method here persists the match to
 * `lol2d:pregameConfig:v1` afterwards**, so the match you shaped is the match
 * you get back on reload.
 *
 * ## The rule this reverses, and why
 *
 * The panel was built to "chỉ sửa trận hiện tại" — mutate the running match,
 * never write storage, so you could flail around in a practice tool without
 * wrecking your real configuration. That rule is reversed for match
 * configuration (`2026-08-16-panel-persistence-design`): the panel turned out
 * to be a strict superset of the setup screen for everything except input mode
 * — it edits every unit's loadout and sets behaviour *per bot* where the screen
 * only sets it globally — so the surface whose work was thrown away on reload
 * was the better of the two. The clean slate a new match used to be is now the
 * "Đặt lại mặc định" button on the Trận đấu tab.
 *
 * The line under it moved too, later and for a different reason. Cheats —
 * invulnerability, reveal-map — and the debug layers used to be session state
 * that was never written, on the grounds that inheriting one silently into the
 * next visit would read as the game being broken rather than as a restored
 * setting. Then the setup screen and this panel became *one* panel
 * (`hud/config/MatchConfigPanel.vue`), mounted over the menu as well as over a
 * match, and a single panel with two classes of control — one that comes back
 * and one that silently does not — turned out to be the worse thing to explain.
 * So they persist, as `PregameConfig.cheats`, and legibility pays for it: a
 * roster row marks an invulnerable participant without its drawer being open.
 *
 * `persist()` is therefore called from the roster, loadout, rules, world **and
 * cheat** methods. What is still never written is `refill` and `clearCooldowns`
 * (actions, with nothing to store) and stack counts (a count on a live spell
 * instance, which would have to be keyed by slot and spell id and replayed at
 * spawn). `MatchDirector.persistence.test.ts` holds both halves of that line.
 *
 * Written against `MatchDirectorContext`, not `Game`, so it unit-tests under
 * plain Vitest with no p5 globals and no scene. `Game` satisfies the interface
 * structurally; nothing else needs to.
 *
 * ## Nothing here takes effect immediately, and that is the design
 *
 * The panel that drives this only opens with the match paused, and
 * `Game.update()` returns early while paused — so `ObjectManager.update()`,
 * which is what actually flushes `_objectToBeAdd` and sweeps `toRemove`, does
 * not run. Every spawn and removal lands on the first unpaused tick. The
 * picker already batches picks behind Huỷ / Xác nhận; this keeps that contract
 * for the rest of the match's settings, so the panel must never promise live
 * feedback on the canvas — its own UI reflects the pending state, and the world
 * catches up on close.
 */
import AIChampion from './gameObject/attackableUnits/AIChampion';
import type Champion from './gameObject/attackableUnits/Champion';
import type Buff from './gameObject/Buff';
import Invulnerable from './gameObject/buffs/Invulnerable';
import {
  AI_COUNT_MAX,
  CDR_PERCENT_MAX,
  CDR_PERCENT_MIN,
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_MAP_ID,
  DEFAULT_PREGAME_CONFIG,
  globalBotBehaviour,
  loadPregameConfig,
  savePregameConfig,
  toMatchRules,
} from './config/PregameConfig';
import type {
  BotBehaviour,
  ChampionLoadout,
  CheatConfig,
  MatchRules,
  MatchRulesConfig,
  PregameConfig,
  WorldConfig,
} from './config/PregameConfig';
import {
  attachRecall,
  getChampionPresetFromLoadout,
  loadChampionPresetFromLoadout,
} from './preset';
import type GameObject from './gameObject/GameObject';
import type { GameObjectRuntimeContext } from './gameObject/GameObject';
import type Monster from './gameObject/attackableUnits/Monster';
import { createDebugFlags, type DebugFlags } from './debug/DebugOverlay';
import { isMatchTeamId, teamForAddedBot, type MatchTeamId } from './config/MatchTeams';

/**
 * A bot's three "does it act on its own" switches, plus the tier it plays at.
 * Plain instance fields on `AIChampion` rather than a typed sub-object because
 * other code — the e2e scripts included — already reads and flips them
 * directly; this is a view of them, not a second home for them. `difficulty`
 * is the one field with a writer of its own (`AIChampion.setDifficulty`).
 *
 * Defined in `PregameConfig` and re-exported here, where every caller already
 * imports it from: the panel now *persists* a per-bot behaviour, so the stored
 * schema and the live one have to be the same type, and the config module is
 * the one of the two that can't import the other.
 */
export type { BotBehaviour };

type ResolvedChampionPreset = Awaited<ReturnType<typeof loadChampionPresetFromLoadout>>;

export type ChampionPresetLoader = (loadout: ChampionLoadout) => Promise<ResolvedChampionPreset>;

export interface MatchDirectorOptions {
  /** Test seam and the one async catalogue boundary used by panel mutations. */
  loadPreset?: ChampionPresetLoader;
}

interface AddBotWithPresetOptions {
  teamId?: MatchTeamId;
  behaviour?: BotBehaviour;
  persist?: boolean;
}

export interface RosterEntry {
  unit: Champion;
  isPlayer: boolean;
  /** Bots only — the player has no behaviour to configure. */
  behaviour?: BotBehaviour;
}

/**
 * What `MatchDirector` needs from a match. `Game` satisfies it structurally,
 * and so does `tests/game/fixtures.ts`'s `createGame()` plus the four fields
 * added below — which is the point: a bench is an object literal, not a booted
 * scene.
 *
 * It extends `GameObjectRuntimeContext` rather than listing only the handful of
 * members the director's own methods touch, because `addBot` hands this object
 * to the unit it constructs *as that unit's game*. A bot then reaches for
 * `eventManager`, `createSpellContext`, `navigation`, `mapSize` and the rest on
 * its own, every tick. A narrower interface with a cast at the `new AIChampion`
 * call site would only have hidden that requirement — and did: the first
 * version of this file took the cast, and a bot cast a spell into a context
 * with no `eventManager` on the very next tick.
 */
export interface MatchDirectorContext extends GameObjectRuntimeContext {
  /** Narrowed from `AttackableUnit`: the roster is champions, and only a champion has a kit to swap. */
  player: Champion;
  monsters: Monster[];
  minionSpawner: {
    minions: { toRemove: boolean }[];
    enabled: boolean;
    setEnabled(on: boolean): void;
  };
  matchRules: MatchRules;
  spawnJungle(): void;
}

export default class MatchDirector {
  private _jungleEnabled = true;

  /**
   * The panel's view of the rules, kept alongside `game.matchRules` rather than
   * derived back out of it: `matchRules` holds the *derived* numbers (a 0.6
   * multiplier), and inverting one into "40%" would be a second, subtly
   * different definition of a mapping that already has exactly one
   * (`toMatchRules`).
   *
   * It starts where `DEFAULT_PREGAME_CONFIG.rules` does, i.e. a match nobody
   * has retuned. A `Game` booted from a config that *did* set a rule has to
   * seed this by calling `setRules(config.rules)` — otherwise the panel would
   * open showing 0% over a match running at 40%.
   */
  private _rules: MatchRulesConfig = { cooldownReductionPercent: CDR_PERCENT_MIN, manaFree: false };

  /**
   * What the *next* match boots onto, the qualified id the panel's map picker
   * edits. Not the same question as "which map is this match running on" —
   * that is `this.game.activeMapId`, fixed for the whole match, read directly
   * by `MatchDirectorSource` (see `Game.activeMapId`'s own doc comment) — and
   * the two are expected to differ the moment the player picks a different
   * one: a live match cannot swap its own terrain, nav grid or standing
   * objects out from under itself (see this class's file header, "Nothing
   * here takes effect immediately"), so the choice can only ever describe
   * *next* time.
   *
   * Starts at `DEFAULT_MAP_ID` and `Game`'s constructor seeds it from the
   * booting config's own `mapId` right after construction, the same two-step
   * every other seeded field here takes (`_rules`, `_jungleEnabled` via
   * `seedWorld`).
   */
  private _mapChoice: string = DEFAULT_MAP_ID;

  /**
   * Which `ChampionLoadout` each unit is currently carrying.
   *
   * A unit does not remember this on its own and cannot be asked: by the time
   * `getChampionPresetFromLoadout` has run, a loadout is seven resolved spell
   * classes and an avatar, and `'random'` — the default for the player and
   * every bot — has already collapsed into one particular champion. So
   * `Champion` → `ChampionLoadout` is not recoverable by inspection; a bot on
   * `'random'` that spawned as a particular champion would read back as "the
   * loadout for that champion", which is a different match setting from the
   * one the player chose.
   *
   * A `WeakMap` rather than a field on `Champion` because this is the *panel's*
   * bookkeeping, not the unit's: nothing in the simulation reads it, and a bot
   * swept off the roster must not be kept alive by the director's own record of
   * it.
   */
  private readonly loadouts = new WeakMap<Champion, ChampionLoadout>();

  /** The same add button can outlive its Vue tab while its kit chunk loads. */
  private pendingAdd: Promise<AIChampion | null> | null = null;
  private addGeneration = 0;

  /** A reset invalidates every older apply; per-unit versions order later picks. */
  private applyEpoch = 0;
  private readonly applyVersions = new WeakMap<Champion, number>();

  /** Whichever reset or later user mutation owns this number is allowed to commit. */
  private resetGeneration = 0;

  private readonly loadPreset: ChampionPresetLoader;

  /**
   * Which debug layers are on. Plain fields, on purpose: the panel holds the
   * match paused while a tab is open, so `ObjectManager.update()` and
   * `AttackableUnit.update()` do not run, and a toggle that needed the update
   * loop to take effect would appear dead for as long as it is visible.
   *
   * `routes` is not stored here — `createDebugFlags` aliases it onto
   * `navigation.debugRoutes`, so the `N` key and the panel's checkbox are two
   * views of one boolean rather than two booleans that can disagree.
   *
   * Assigned in the constructor rather than as a field initializer because it
   * needs `game`, and a parameter property is not assigned until the
   * constructor body under `useDefineForClassFields`.
   */
  readonly debug: DebugFlags;

  constructor(
    private readonly game: MatchDirectorContext,
    options: MatchDirectorOptions = {}
  ) {
    this.loadPreset = options.loadPreset ?? loadChampionPresetFromLoadout;
    this.debug = createDebugFlags(game);
  }

  /**
   * The derived rules every spell reads at cast time, exposed read-only.
   *
   * `getRules()` is the *editable* view (percentages, what the Trận đấu tab's
   * slider binds to); this is the applied one (`{ cooldownMultiplier,
   * manaFree }`), which is what a spell description needs to quote the
   * cooldown and mana cost this match will actually charge. The loadout editor
   * takes exactly this type — see `RosterTab.vue`, which is why the getter
   * exists at all rather than the tab reaching for `game.matchRules` past the
   * director.
   */
  get matchRules(): MatchRules {
    return this.game.matchRules;
  }

  /**
   * Records what a unit `Game` built for itself is carrying, so the panel opens
   * on the unit's real kit. `addBot` and `applyLoadout` do this on their own;
   * this is only for the player and the bots that existed before the director
   * did (`Game`'s constructor builds them ~60 lines before it builds this).
   */
  seedLoadout(unit: Champion, loadout: ChampionLoadout): void {
    this.loadouts.set(unit, loadout);
  }

  /**
   * What `unit` is carrying, for an editor that has to open on the current kit
   * rather than on a default.
   *
   * Falls back to `DEFAULT_CHAMPION_LOADOUT` — never `undefined` — for a unit
   * nobody recorded: a match booted by something other than `Game` (a test
   * bench, a future scenario loader) still has to be editable, and "a random
   * champion" is the honest description of a unit the director was never told
   * about. Returning `undefined` would have pushed that same decision into
   * every caller, where it would have been made differently each time.
   */
  loadoutOf(unit: Champion): ChampionLoadout {
    return this.loadouts.get(unit) ?? DEFAULT_CHAMPION_LOADOUT;
  }

  /**
   * The player first, then every live bot in spawn order. One definition of
   * "who is in this match" — `hudInteractions.ts` used to filter the object
   * list for `AIChampion` itself, in two places, through an `any` cast.
   */
  roster(): RosterEntry[] {
    const player: RosterEntry = { unit: this.game.player, isPlayer: true };
    const bots = this.bots().map(unit => ({
      unit,
      isPlayer: false,
      behaviour: behaviourOf(unit),
    }));
    return [player, ...bots];
  }

  /**
   * Every bot this match has, in spawn order — which is not the same set as
   * "every bot the object manager has finished processing", and the difference
   * is the whole of what the panel means by a roster.
   *
   * `toRemove` units are already gone as far as the panel is concerned: the
   * sweep that deletes them cannot run until the match unpauses, and a roster
   * still listing a bot the player just removed would be showing them the pause
   * rather than their own edit.
   *
   * Queued units are already *here* for exactly the same reason, and leaving
   * them out was a real bug rather than a nicety. `addObject` only pushes to
   * `_objectToBeAdd`, and the flush is in `ObjectManager.update()`, which
   * cannot run while the panel that calls `addBot` holds the match paused. So a
   * roster built from `objects` alone never changed as the player pressed "Thêm
   * bot" — and worse, `addBot`'s `AI_COUNT_MAX` guard reads this method, so the
   * cap was unreachable too: 25 presses in one paused session all returned a
   * bot, and all 25 arrived at once on close. Measured, not reasoned about.
   */
  bots(): AIChampion[] {
    // A hand-rolled loop rather than `objects.filter((o): o is AIChampion => …)`
    // because `src/types/global.d.ts` re-declares `Array.prototype.filter` with
    // the optimized `(value, index) => boolean` signature, and a merged
    // interface puts that overload first — so the type-predicate overload never
    // gets a look in and the result comes back as `GameObject[]`. The narrowing
    // is real, so the alternative would have been a cast asserting it.
    const bots: AIChampion[] = [];
    const collect = (objects: GameObject[]): void => {
      for (const object of objects) {
        if (object instanceof AIChampion && !object.toRemove) bots.push(object);
      }
    };
    collect(this.game.objectManager.objects);
    // Second, so spawn order still reads oldest-first across the join.
    collect(this.game.objectManager._objectToBeAdd);
    return bots;
  }

  /**
   * This match, written as the config that would boot it again.
   *
   * **Derived from live state, whole, rather than patched field by field.** A
   * patch-per-field scheme would have to be kept in step with the panel's
   * controls forever — add a control, forget its patch, and the panel silently
   * stops persisting one thing. What the roster and the rules actually *are*
   * cannot drift from what the player is looking at.
   *
   * Two things here are not derivable and so are read back from storage rather
   * than invented. The global `ai.autoMove`/`autoAttack`/`autoCast` are the
   * setup screen's control (`AiConfigPanel`) and the panel has no view of them
   * — writing a derived value would let the panel quietly overwrite a screen it
   * does not edit. Slots past the live bot count stay stored so lowering the
   * count never loses a kit or behaviour. Their saved teams remain intact too;
   * the setup screen may rebalance only a slot when it activates that bot.
   *
   * Note `bots()` and not `objectManager.objects`. That is the paused-panel
   * trap, and it is a data-loss bug rather than a nicety: the panel holds the
   * match paused, `ObjectManager.update()` is what flushes `_objectToBeAdd`, so
   * a bot the player just added is queued and not in `objects` yet. Derived
   * from `objects` alone, "add a bot, close, reload" loses the bot. See
   * `bots()`'s own comment, and the test named for it.
   */
  toPregameConfig(): PregameConfig {
    const stored = loadPregameConfig();
    const live = this.bots();

    const bots = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
      i < live.length ? this.loadoutOf(live[i]) : stored.ai.bots[i]
    );
    const botBehaviours = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
      i < live.length ? behaviourOf(live[i]) : stored.ai.botBehaviours[i]
    );
    const botTeams: MatchTeamId[] = Array.from({ length: AI_COUNT_MAX }, (_, i) => {
      if (i >= live.length) return stored.ai.botTeams[i];
      return isMatchTeamId(live[i].teamId) ? live[i].teamId : stored.ai.botTeams[i];
    });

    return {
      player: this.loadoutOf(this.game.player),
      // Read back off the live player, the same way each bot's side is — a
      // running match's player always holds a lane team, but fall back to the
      // stored side rather than inventing one if a fixture ever does not.
      playerTeam: isMatchTeamId(this.game.player.teamId)
        ? this.game.player.teamId
        : stored.playerTeam,
      ai: {
        count: live.length,
        autoMove: stored.ai.autoMove,
        autoAttack: stored.ai.autoAttack,
        autoCast: stored.ai.autoCast,
        bots,
        botTeams,
        botBehaviours,
      },
      rules: this.getRules(),
      world: { jungle: this.jungleEnabled, minions: this.minionsEnabled },
      cheats: this.getCheats(stored),
      // `this._mapChoice`, not `this.game.activeMapId` — the same split
      // `rules` above takes with `_rules` versus `game.matchRules`. There is
      // no live fact "which map do you want next time"; only "which map is
      // this one running on", which is a different question. See
      // `_mapChoice`'s own doc comment.
      mapId: this._mapChoice,
    };
  }

  /**
   * The cheat section, derived from live state exactly the way the roster and
   * the rules above are — never patched field by field. Same argument as this
   * method's own: a patch scheme has to be kept in step with the panel's
   * controls forever, and what a match *is* cannot drift from what the player
   * is looking at.
   *
   * Bot slots past the live bot count read back from storage, like every other
   * per-slot array here, so lowering the bot count and raising it again does
   * not quietly clear a flag the player set.
   *
   * That cheats are persisted at all is a reversal. They were session state on
   * the grounds that an invulnerable champion surviving a reload reads as a bug
   * — see `CheatConfig`'s own comment in `PregameConfig.ts` for why the unified
   * panel changed that answer, and what pays for it.
   */
  private getCheats(stored: PregameConfig): CheatConfig {
    const live = this.bots();
    return {
      revealMap: this._revealMap,
      debug: {
        routes: this.debug.routes,
        terrain: this.debug.terrain,
        collision: this.debug.collision,
        vision: this.debug.vision,
        quadtree: this.debug.quadtree,
        fps: this.debug.fps,
      },
      playerInvulnerable: this.isInvulnerable(this.game.player),
      botInvulnerable: Array.from({ length: AI_COUNT_MAX }, (_, i) =>
        i < live.length ? this.isInvulnerable(live[i]) : stored.cheats.botInvulnerable[i]
      ),
    };
  }

  /**
   * What the panel reads. Public counterpart to the private derivation above,
   * which needs a stored config for the inactive slots and is only ever called
   * from `toPregameConfig`.
   */
  cheats(): CheatConfig {
    return this.getCheats(loadPregameConfig());
  }

  /**
   * Apply a stored cheat section to a match that is *booting*.
   *
   * `seed*` rather than the public setters, for the reason `seedRules` and
   * `seedWorld` are: those persist, and a match being constructed has nothing
   * to save — it is being told what it already is. Writing through the setters
   * here would also mean `AI_COUNT_MAX` storage writes on every boot.
   *
   * Called from `Game`'s constructor after the roster exists, since the
   * per-slot invulnerability lands on units.
   */
  seedCheats(cheats: CheatConfig): void {
    this._revealMap = cheats.revealMap;
    this.debug.routes = cheats.debug.routes;
    this.debug.terrain = cheats.debug.terrain;
    this.debug.collision = cheats.debug.collision;
    this.debug.vision = cheats.debug.vision;
    this.debug.quadtree = cheats.debug.quadtree;
    this.debug.fps = cheats.debug.fps;

    // Both directions, not just "switch it on where the flag says so". On a
    // booting match every unit is fresh and clearing is a no-op, but this is
    // also how `resetToDefaults` puts an invulnerable player back — and a seed
    // that could only ever add would leave that one unit immortal over a config
    // that says otherwise.
    this.applyInvulnerable(this.game.player, cheats.playerInvulnerable);
    const live = this.bots();
    for (let i = 0; i < live.length; i++) {
      this.applyInvulnerable(live[i], !!cheats.botInvulnerable[i]);
    }
  }

  /**
   * Called at the end of every method that changes what the match *is*, and
   * from none of the cheats. `savePregameConfig` swallows a full quota, a
   * disabled `localStorage` and private-mode Safari on its own, so this can
   * never be the thing that breaks a mutation the player already saw happen.
   */
  private persist(): void {
    savePregameConfig(this.toPregameConfig());
  }

  /** Any later visible edit wins over a reset that is still fetching kits. */
  private invalidatePendingReset(): void {
    this.resetGeneration++;
  }

  private nextApplyVersion(unit: Champion): number {
    const version = (this.applyVersions.get(unit) ?? 0) + 1;
    this.applyVersions.set(unit, version);
    return version;
  }

  /**
   * Spawns a bot on the less populated lane team (Red wins a tie), at that
   * team's fountain, capped at the same `AI_COUNT_MAX` the pregame screen
   * enforces — hence the nullable return: the cap is real and a caller that
   * cannot see it would silently drop the player's click.
   *
   * The bot is on the roster immediately and in the *world* on the next
   * unpaused tick — two different things, and `bots()` explains why it counts
   * both. Nothing it does is visible on the canvas until then (see the file
   * comment). `presetFactory` closes over the same loadout so the bot's
   * identity survives its own deaths — a bot the player configured as a
   * particular champion comes back as that champion, while one left on
   * 'random' keeps re-rolling exactly as before, because
   * `getChampionPresetFromLoadout` re-resolves 'random' on
   * every call.
   */
  addBot(loadout: ChampionLoadout): AIChampion | null {
    this.invalidatePendingReset();
    this.addGeneration++;
    this.pendingAdd = null;
    return this.addBotWithPreset(loadout, getChampionPresetFromLoadout(loadout));
  }

  /**
   * Panel-safe addition. Unlike the synchronous engine seam above, this waits
   * for the one rolled kit before constructing the bot, so an early click
   * cannot race the background spell-catalogue warm-up.
   */
  addBotLoaded(loadout: ChampionLoadout, teamId?: MatchTeamId): Promise<AIChampion | null> {
    if (this.pendingAdd) return this.pendingAdd;

    this.invalidatePendingReset();
    const generation = ++this.addGeneration;
    let loading: Promise<ResolvedChampionPreset>;
    try {
      loading = this.loadPreset(loadout);
    } catch (error) {
      return Promise.reject(error);
    }

    const pending = loading
      .then(preset => {
        if (generation !== this.addGeneration) return null;
        // `teamId` is optional and stays optional: omitted, `addBotWithPreset`
        // balances the sides, which is what a caller with no opinion wants. The
        // panel does have one — its add button sits at the end of a *side* —
        // and naming it there is the difference between "add a bot" and "add a
        // bot to Đội Đỏ".
        return this.addBotWithPreset(loadout, preset, teamId ? { teamId } : {});
      })
      .finally(() => {
        if (this.pendingAdd === pending) this.pendingAdd = null;
      });
    this.pendingAdd = pending;
    return pending;
  }

  private addBotWithPreset(
    loadout: ChampionLoadout,
    preset: ResolvedChampionPreset,
    options: AddBotWithPresetOptions = {}
  ): AIChampion | null {
    const bots = this.bots();
    if (bots.length >= AI_COUNT_MAX) return null;

    // The setup screen's global flags are the *default* behaviour for a bot
    // nobody has chosen one for, which is exactly what a bot added mid-match
    // is. Without this it would get `AIChampion`'s hardcoded defaults instead,
    // and a player who set "bots wander" on the setup screen would find that
    // every bot they add in the panel stands still. There is no global for the
    // tier, so `globalBotBehaviour` supplies the default one — see its comment.
    const behaviour = options.behaviour ?? globalBotBehaviour(loadPregameConfig().ai);

    const teamId = options.teamId ?? teamForAddedBot([this.game.player, ...bots]);
    const spawn = this.game.randomSpawnPoint(teamId);
    const bot = attachRecall(
      new AIChampion({
        game: this.game,
        // Copied rather than handed straight through: `position` is mutated
        // every tick from here on, and a spawn point the match still holds a
        // reference to would be dragged around the map by the bot standing on
        // it.
        position: createVector(spawn.x, spawn.y),
        teamId,
        preset,
        presetFactory: () => getChampionPresetFromLoadout(loadout),
        autoMove: behaviour.autoMove,
        autoAttack: behaviour.autoAttack,
        autoCast: behaviour.autoCast,
        difficulty: behaviour.difficulty,
      })
    );
    this.game.objectManager.addObject(bot);
    this.loadouts.set(bot, loadout);
    if (options.persist !== false) this.persist();
    return bot;
  }

  /**
   * Marks a bot for the next sweep, which is also what unwinds everything it
   * owns. No-op on the player: a match with nobody in it is not a state the
   * panel can offer, and `Game` holds `player` by reference besides.
   */
  removeBot(unit: Champion): void {
    if (unit === this.game.player) return;
    if (!(unit instanceof AIChampion)) return;
    this.invalidatePendingReset();
    unit.toRemove = true;
    // After the mark, never before: `bots()` skips `toRemove` units, so the
    // config this derives is the roster the player is now looking at.
    this.persist();
  }

  /**
   * Swaps a champion under a unit that is standing there — the whole point of
   * a practice tool, and the reason `Champion.applyPreset` exists as its own
   * method. Position, team and any orders in flight are untouched; the kit,
   * name, avatar and attack profile all come from the new loadout.
   *
   * The bars are refilled here and *only* here. `applyPreset` deliberately
   * leaves them alone because its other two callers must not touch them (a
   * champion under construction, and a respawn that has already refilled), so
   * "the unit keeps standing where it is but starts the try-out at full" is
   * this method's own contract: a champion on 12 HP that becomes a different
   * champion on 12 HP is not what "try this champion now" means.
   *
   * For a bot this also rewrites `presetFactory` and re-arms the respawn roll,
   * so the identity the player just chose survives the bot's next death
   * instead of coming back as whatever it was configured with — including when
   * the roll had been pinned off by the picker's "clone my spells".
   */
  applyLoadout(unit: Champion, loadout: ChampionLoadout): void {
    this.invalidatePendingReset();
    this.nextApplyVersion(unit);
    this.applyResolvedLoadout(unit, loadout, getChampionPresetFromLoadout(loadout));
  }

  /** Awaited practice-panel path; see `addBotLoaded`. */
  async applyLoadoutLoaded(unit: Champion, loadout: ChampionLoadout): Promise<boolean> {
    this.invalidatePendingReset();
    const epoch = this.applyEpoch;
    const version = this.nextApplyVersion(unit);
    const preset = await this.loadPreset(loadout);
    if (epoch !== this.applyEpoch || version !== this.applyVersions.get(unit) || unit.toRemove) {
      return false;
    }
    this.applyResolvedLoadout(unit, loadout, preset);
    return true;
  }

  private applyResolvedLoadout(
    unit: Champion,
    loadout: ChampionLoadout,
    preset: ResolvedChampionPreset,
    persist = true
  ): void {
    unit.applyPreset(preset);
    this.refill(unit);
    // For the player as readily as for a bot: the editor has to reopen on
    // whatever it last committed, whoever it was committed to.
    this.loadouts.set(unit, loadout);

    if (unit instanceof AIChampion) {
      unit.setPresetFactory(() => getChampionPresetFromLoadout(loadout));
      unit.setRespawnRollsNewPreset(true);
    }
    if (persist) this.persist();
  }

  /**
   * Writes only the flags it is handed, so a UI that owns one toggle can send
   * one field without having to restate the other three. `difficulty` rides in
   * the same record for exactly that reason — see `BotBehaviour`.
   */
  setBotBehaviour(bot: AIChampion, flags: Partial<BotBehaviour>): void {
    this.invalidatePendingReset();
    if (flags.autoMove !== undefined) bot._autoMove = flags.autoMove;
    if (flags.autoAttack !== undefined) bot._autoAttack = flags.autoAttack;
    if (flags.autoCast !== undefined) bot._autoCast = flags.autoCast;
    // Through `setDifficulty`, which is the single writer for `_difficulty` —
    // the three above are plain fields the e2e scripts already flip directly,
    // and this one deliberately is not.
    if (flags.difficulty !== undefined) bot.setDifficulty(flags.difficulty);
    this.persist();
  }

  /**
   * Moves a champion — the player or any bot — to the given lane team, live.
   *
   * Everything that reads a side reads `teamId` at query time, so this one
   * assignment is the whole switch: `randomSpawnPoint(teamId)` finds the
   * fountain the unit respawns at, `PredefinedFilters.teamId` sorts ally from
   * enemy for every acquisition, and the turret's ally-protection and the fog's
   * ally-vision both follow the moment the field changes. Nothing is re-homed or
   * teleported — the unit keeps standing where it is, and only its next respawn
   * returns to the new fountain, which is what a paused practice switch should
   * do.
   *
   * It persists like a bot's team: `toPregameConfig` reads the side back off the
   * live unit (the player's into `playerTeam`), so the match you shaped is the
   * one you reload. A no-op switch to the current side is dropped so it never
   * writes storage for nothing.
   */
  setTeam(unit: Champion, teamId: MatchTeamId): void {
    if (unit.teamId === teamId) return;
    this.invalidatePendingReset();
    unit.setTeamId(teamId);
    this.persist();
  }

  get jungleEnabled(): boolean {
    return this._jungleEnabled;
  }

  /**
   * Off marks every camp for the sweep and forgets them; on respawns the lot
   * through `Game.spawnJungle()`, which stays the one definition of where a
   * camp lives and what is in it.
   *
   * Setting it to what it already is does nothing — flipping "on" twice must
   * not stack a second set of camps on the first, and this is the only guard
   * against that: `spawnJungle` appends unconditionally.
   *
   * The director's own flag rather than `monsters.length > 0`, because an empty
   * jungle is also what a match looks like ten minutes in with every camp
   * cleared, and that must not read as "the player switched the jungle off".
   */
  set jungleEnabled(on: boolean) {
    if (on === this._jungleEnabled) return;
    this.invalidatePendingReset();
    this._jungleEnabled = on;

    if (on) {
      this.game.spawnJungle();
      this.persist();
      return;
    }
    for (const monster of this.game.monsters) monster.toRemove = true;
    // Emptied here rather than left to a sweep: `Game.monsters` is the
    // spawn-side list and nothing prunes it, so a jungle switched off and on
    // again would otherwise carry every dead camp's corpse into the new list.
    this.game.monsters.length = 0;
    this.persist();
  }

  /** The spawner owns this flag; the director is a view of it, not a copy. */
  get minionsEnabled(): boolean {
    return this.game.minionSpawner.enabled;
  }

  /**
   * Off stops the wave clock and clears the field; on restarts the clock from a
   * full interval (`MinionSpawner` freezes its countdown rather than draining
   * it) and leaves whatever is standing alone — the player asked for waves
   * again, not for the field to be swept first.
   *
   * No `monsters.length = 0` counterpart here: the spawner prunes `toRemove`
   * minions on its own update whether it is enabled or not, so the list empties
   * itself on the first unpaused tick.
   *
   * Setting it to what it already is does nothing, mirroring the jungle's own
   * guard — so a no-op does not write storage either.
   */
  set minionsEnabled(on: boolean) {
    if (on === this.game.minionSpawner.enabled) return;
    this.invalidatePendingReset();
    this.game.minionSpawner.setEnabled(on);
    if (!on) for (const minion of this.game.minionSpawner.minions) minion.toRemove = true;
    this.persist();
  }

  /** A copy, so a caller editing the object it got back cannot retune the match. */
  getRules(): MatchRulesConfig {
    return { ...this._rules };
  }

  /**
   * `Spell.ts` reads `game.matchRules` at cast time (`:320` for the cooldown
   * multiplier, `:369` for `manaFree`) and never at construction, so this is
   * the whole of applying a rule change mid-match: every spell already built,
   * on every unit, picks it up on its next cast.
   *
   * Mutates the existing `matchRules` rather than replacing it. `Game` handed
   * that reference to every spell as `spell.game.matchRules` before the panel
   * ever opened; assigning a new object here would leave all of them reading
   * the old one forever.
   *
   * The derived numbers come from `toMatchRules` — the same function the
   * pregame screen uses — so there is exactly one definition of what a CDR
   * percentage means. The clamp is repeated only because
   * `getRules()` has to report the number the player will see clamped, and
   * `toMatchRules` clamps privately on its way to a multiplier.
   */
  setRules(rules: MatchRulesConfig): void {
    this.invalidatePendingReset();
    this.seedRules(rules);
    this.persist();
  }

  /**
   * `setRules` without the write — for `Game`'s constructor, which is telling
   * the director what the match it just built *started* as, not changing it.
   *
   * The distinction matters now that every setter persists: boot-time seeding
   * that went through the public setters would write storage on every match
   * start, and — worse — `setRules` runs before the world is seeded, so the
   * config it derived would carry a jungle flag the match had not been told
   * about yet. Same split as `seedLoadout` / `applyLoadout`.
   */
  seedRules(rules: MatchRulesConfig): void {
    this._rules = {
      cooldownReductionPercent: clampPercent(rules.cooldownReductionPercent),
      manaFree: !!rules.manaFree,
    };

    const derived = toMatchRules(this._rules);
    this.game.matchRules.cooldownMultiplier = derived.cooldownMultiplier;
    this.game.matchRules.manaFree = derived.manaFree;
  }

  /**
   * The world the match booted with, again without writing — the counterpart of
   * `seedRules`, and the reason `Game` can skip spawning a jungle the config
   * switched off rather than spawning one and clearing it a frame later.
   *
   * Assigns the backing fields directly instead of going through the two
   * setters: at boot there is nothing to clear (no camps were spawned, no
   * minions exist yet), and the jungle setter's "already on" guard would
   * otherwise make `seedWorld({ jungle: true })` and a real toggle indis-
   * tinguishable in the one case where they differ — a re-spawn of camps that
   * are already standing.
   */
  seedWorld(world: WorldConfig): void {
    this._jungleEnabled = world.jungle;
    this.game.minionSpawner.setEnabled(world.minions);
  }

  /**
   * What the *next* match boots onto, read-only. Never the same question as
   * "which map is this match running on" — see `_mapChoice`'s own doc
   * comment. `MatchDirectorSource` does not read this at all: the panel's
   * `getMap()` reads `Game.activeMapId` (via `HudInteractions`) instead,
   * precisely so it keeps reporting the running match's own world regardless
   * of what this getter answers.
   */
  get mapChoice(): string {
    return this._mapChoice;
  }

  /**
   * The map the config the match booted with named — again without writing,
   * `seedRules`/`seedWorld`'s own pattern. `Game`'s constructor calls this
   * once, after everything else is seeded, with the same `pregameConfig`
   * every other seed reads.
   */
  seedMapChoice(id: string): void {
    this._mapChoice = id;
  }

  /**
   * Writes the choice for the next match. **Does not touch the running
   * world** — no terrain rebuild, no nav grid, no respawn — a live match
   * cannot be moved onto a different map from under itself (see this class's
   * own file header). The player sees the pick reflected in the panel; the
   * match they are standing in keeps playing on the map it started on, and
   * the new choice takes effect the next time this match is left and a fresh
   * one started.
   */
  setMapChoice(id: string): void {
    this.invalidatePendingReset();
    this._mapChoice = id;
    this.persist();
  }

  /**
   * The clean slate back.
   *
   * Persisting everything took away the fresh match every restart used to be,
   * so it has to be handed back explicitly — and it applies to the *running*
   * match as well as to storage, because a button labelled "reset" that only
   * took effect next time would be the same broken-looking silence the world
   * toggles needed a note for.
   *
   * Every required kit is loaded before the first live mutation. This matters
   * on a freshly opened panel: resolving through the synchronous registry seam
   * before its background warm-up finishes turns unloaded slots into the
   * BasicAttack fallback. It also gives the reset a commit point — a newer
   * reset or roster edit can invalidate this one while its chunks are loading,
   * without a half-reset match or partial storage writes.
   */
  async resetToDefaults(): Promise<boolean> {
    const config = DEFAULT_PREGAME_CONFIG;
    const generation = ++this.resetGeneration;
    // Pending panel work belongs to the match the player is discarding.
    this.addGeneration++;
    this.pendingAdd = null;
    this.applyEpoch++;

    const loadouts = [
      config.player,
      ...Array.from({ length: config.ai.count }, (_, i) => config.ai.bots[i]),
    ];
    const presets = await Promise.all(loadouts.map(loadout => this.loadPreset(loadout)));
    if (generation !== this.resetGeneration) return false;

    for (const bot of this.bots()) bot.toRemove = true;
    this.applyResolvedLoadout(this.game.player, config.player, presets[0], false);
    // The player's side is a match setting now, so a reset puts it back on the
    // default team the same way it puts the bots back — otherwise a player who
    // switched to Red would stay Red over a config that says Blue.
    this.game.player.setTeamId(config.playerTeam);
    for (let i = 0; i < config.ai.count; i++) {
      this.addBotWithPreset(config.ai.bots[i], presets[i + 1], {
        teamId: config.ai.botTeams[i],
        behaviour: config.ai.botBehaviours[i],
        persist: false,
      });
    }

    this.seedRules(config.rules);
    if (this._jungleEnabled !== config.world.jungle) {
      this._jungleEnabled = config.world.jungle;
      if (config.world.jungle) {
        this.game.spawnJungle();
      } else {
        for (const monster of this.game.monsters) monster.toRemove = true;
        this.game.monsters.length = 0;
      }
    }
    if (this.game.minionSpawner.enabled !== config.world.minions) {
      this.game.minionSpawner.setEnabled(config.world.minions);
      if (!config.world.minions) {
        for (const minion of this.game.minionSpawner.minions) minion.toRemove = true;
      }
    }

    // Cheats are part of "a clean slate" now that they persist. Seeded rather
    // than set, for the same reason the rules and world above are: this method
    // writes the whole config once, at the end, and `setInvulnerable` per unit
    // would save `AI_COUNT_MAX` times on the way there. It clears as well as
    // sets, which is what puts an invulnerable player back to mortal; the bots
    // it reaches are the ones just added, the old ones being `toRemove` and off
    // the roster already.
    this.seedCheats(config.cheats);

    // The choice for the *next* match, put back to the default too — a
    // stale `_mapChoice` left over from before the reset would otherwise
    // overwrite `config.mapId` in storage the moment any later setter calls
    // `persist()` (`toPregameConfig()` reads it, not `stored.mapId`). Never
    // the running match's own map, which this reset does not and cannot
    // touch — see `setMapChoice`'s own doc comment.
    this.seedMapChoice(config.mapId);

    // The exact defaults, including inactive bot slots and global AI flags.
    savePregameConfig(config);
    return true;
  }

  // ------------------------------------------------------------------ cheats
  //
  // The practice tool's own half: state of a unit *inside* the match, rather
  // than which units are in it. They live here for the same reason everything
  // else does — this is the one seam that mutates a running match — and the
  // mechanisms live where this codebase already puts that kind of work: a
  // `Buff` for damage immunity, a method on `Spell` for stacks.

  /**
   * The live invulnerability buffs on `unit` — deactivated ones excluded, and
   * that exclusion is the whole subtlety here.
   *
   * `deactivateBuff()` only marks: `AttackableUnit.update()` is what filters
   * `toRemove` buffs out of the list, and it cannot run while the panel holds
   * the match paused. Counting the marked ones would make the toggle report
   * "still on" for as long as the panel that turned it off stays open, and
   * turning it back on inside that same window would find a buff already there
   * and do nothing — a switch stuck in whichever position it was last flipped
   * to.
   */
  private invulnerableBuffs(unit: Champion): Buff[] {
    return unit.buffs.filter(buff => buff instanceof Invulnerable && !buff.toRemove);
  }

  /**
   * Show the whole map on the minimap, fog or no fog.
   *
   * A plain public field, deliberately: the panel holds the match paused, so
   * `ObjectManager.update()` and `AttackableUnit.update()` do not run while a
   * tab is open, and anything a tab reads that depends on the update loop
   * having run reads a stale answer (see `invulnerableBuffs` above for what
   * that costs). A flag has no such dependency — it is true the instant it is
   * set, and `Game.minimapBlips()` is the only reader.
   *
   * It lives here rather than on the minimap because it is a cheat, and putting
   * it in Gian lận means the minimap never has to reason about balance.
   */
  private _revealMap = false;

  get revealMap(): boolean {
    return this._revealMap;
  }

  /**
   * Writes through an accessor rather than being a plain field because it
   * persists now. Every cheat does — see `getCheats` — so each one has to pass
   * through something that can call `persist()`, and a bare public field
   * cannot.
   */
  set revealMap(on: boolean) {
    this._revealMap = on;
    this.persist();
  }

  /**
   * The debug layers' write path. `debug` itself stays directly readable (and
   * `debug.routes` stays an alias onto `navigation.debugRoutes`, so the `N` key
   * and the checkbox remain one boolean) — but a write has to come through here
   * to be saved, including the one the `N` key makes.
   */
  setDebugFlag(key: keyof DebugFlags, on: boolean): void {
    this.debug[key] = on;
    this.persist();
  }

  /** Whether `unit` is currently carrying the invulnerability buff. */
  isInvulnerable(unit: Champion): boolean {
    return this.invulnerableBuffs(unit).length > 0;
  }

  /**
   * The sticky toggle. The buff is constructed here and nowhere else, so the
   * tab never has to know what invulnerability is made of.
   */
  setInvulnerable(unit: Champion, on: boolean): void {
    this.applyInvulnerable(unit, on);
    this.persist();
  }

  /**
   * The mechanism without the write, so a booting match can be handed its
   * stored flags without `AI_COUNT_MAX` storage writes — and without a match
   * that is only being *told* what it is appearing to save something. See
   * `seedCheats`.
   */
  private applyInvulnerable(unit: Champion, on: boolean): void {
    const existing = this.invulnerableBuffs(unit);
    if (on) {
      if (existing.length === 0) {
        unit.addBuff(new Invulnerable(INVULNERABLE_DURATION_MS, unit, unit));
      }
      return;
    }
    for (const buff of existing) buff.deactivateBuff();
  }

  /** Health and mana to full. The same two lines `applyLoadout` runs after a champion swap. */
  refill(unit: Champion): void {
    unit.stats.health.baseValue = unit.stats.maxHealth.value;
    unit.stats.mana.baseValue = unit.stats.maxMana.value;
  }

  /**
   * Every ability off cooldown.
   *
   * `BasicAttack` overrides `currentCooldown`'s setter with an empty one on
   * purpose, so the swing timer this does not reach is the swing timer it
   * should not reach — a reset that handed back an attack mid-swing would be
   * a different cheat than the one asked for.
   */
  clearCooldowns(unit: Champion): void {
    for (const spell of unit.spells) if (spell) spell.currentCooldown = 0;
  }
}

/**
 * Effectively permanent, matching the other never-expiring buffs in this
 * codebase (a stacking spell's own permanent-power buff, a size-growth ultimate's own permanent buff). The toggle turns
 * invulnerability off with `deactivateBuff()`, so this is a backstop rather
 * than the mechanism.
 */
const INVULNERABLE_DURATION_MS = 600_000;

/**
 * Same bounds and the same rounding the pregame screen's validator applies
 * (`sanitizePregameConfig`), so a percentage typed into the panel and the same
 * percentage typed into setup cannot mean two different matches. A junk value
 * lands on `CDR_PERCENT_MIN`, i.e. no reduction, because a rules panel that
 * silently applies `NaN` would leave every spell on a `NaN` cooldown.
 */
const clampPercent = (percent: number): number => {
  const rounded = Math.round(percent);
  if (!Number.isFinite(rounded)) return CDR_PERCENT_MIN;
  return Math.min(CDR_PERCENT_MAX, Math.max(CDR_PERCENT_MIN, rounded));
};

const behaviourOf = (bot: AIChampion): BotBehaviour => ({
  autoMove: bot._autoMove,
  autoAttack: bot._autoAttack,
  autoCast: bot._autoCast,
  difficulty: bot._difficulty,
});
