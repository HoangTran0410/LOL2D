/**
 * Every mutation of a *running* match, in one place.
 *
 * ## Why this is not `PregameConfig`
 *
 * The two describe the same match and are not interchangeable. `PregameConfig`
 * is plain, serializable data about a match that **does not exist yet**: "five
 * bots" there is a number in an object, and changing it changes nothing until
 * `Game` reads it once at construction. This is the other side — changes to a
 * match that is already running, where "five bots" is five live units holding a
 * quadtree slot, a pathfinding agent, a spell list mid-cooldown and a team id
 * other units are resolving hostility against. "Remove bot 3" is an array
 * splice on one side and, on this one, marking a unit for the sweep and letting
 * everything it owns unwind on the next tick.
 *
 * Serving both through one interface is where this would have gone wrong, and
 * it is why the practice panel deliberately never writes
 * `lol2d:pregameConfig:v1`: the panel reshapes *this* match, and leaving it
 * returns you to whatever the setup screen has stored. A practice tool you can
 * flail around in without wrecking your real configuration.
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
  toMatchRules,
} from './config/PregameConfig';
import type { ChampionLoadout, MatchRules, MatchRulesConfig } from './config/PregameConfig';
import { getChampionPresetFromLoadout } from './preset';
import type GameObject from './gameObject/GameObject';
import type { GameObjectRuntimeContext } from './gameObject/GameObject';
import type Monster from './gameObject/attackableUnits/Monster';

/**
 * A bot's three "does it act on its own" switches. Plain instance fields on
 * `AIChampion` rather than a typed sub-object because other code — the e2e
 * scripts included — already reads and flips them directly; this is a view of
 * them, not a second home for them.
 */
export interface BotBehaviour {
  autoMove: boolean;
  autoAttack: boolean;
  autoCast: boolean;
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
  minionSpawner: { minions: { toRemove: boolean }[]; enabled: boolean };
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
   * Which `ChampionLoadout` each unit is currently carrying.
   *
   * A unit does not remember this on its own and cannot be asked: by the time
   * `getChampionPresetFromLoadout` has run, a loadout is seven resolved spell
   * classes and an avatar, and `'random'` — the default for the player and
   * every bot — has already collapsed into one particular champion. So
   * `Champion` → `ChampionLoadout` is not recoverable by inspection; a bot on
   * `'random'` that spawned as Yasuo would read back as "the Yasuo loadout",
   * which is a different match setting from the one the player chose.
   *
   * A `WeakMap` rather than a field on `Champion` because this is the *panel's*
   * bookkeeping, not the unit's: nothing in the simulation reads it, and a bot
   * swept off the roster must not be kept alive by the director's own record of
   * it.
   */
  private readonly loadouts = new WeakMap<Champion, ChampionLoadout>();

  constructor(private readonly game: MatchDirectorContext) {}

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
   * Spawns a bot at a fountain spawn point, capped at the same `AI_COUNT_MAX`
   * the pregame screen enforces — hence the nullable return: the cap is real
   * and a caller that cannot see it would silently drop the player's click.
   *
   * The bot is on the roster immediately and in the *world* on the next
   * unpaused tick — two different things, and `bots()` explains why it counts
   * both. Nothing it does is visible on the canvas until then (see the file
   * comment). `presetFactory` closes over the same loadout so the bot's
   * identity survives its own deaths — a bot the player configured as Zed
   * comes back as Zed, while one left on 'random' keeps re-rolling exactly as
   * before, because `getChampionPresetFromLoadout` re-resolves 'random' on
   * every call.
   */
  addBot(loadout: ChampionLoadout): AIChampion | null {
    if (this.bots().length >= AI_COUNT_MAX) return null;

    const spawn = this.game.randomSpawnPoint();
    const bot = new AIChampion({
      game: this.game,
      // Copied rather than handed straight through: `position` is mutated every
      // tick from here on, and a spawn point the match still holds a reference
      // to would be dragged around the map by the bot standing on it.
      position: createVector(spawn.x, spawn.y),
      preset: getChampionPresetFromLoadout(loadout),
      presetFactory: () => getChampionPresetFromLoadout(loadout),
    });
    this.game.objectManager.addObject(bot);
    this.loadouts.set(bot, loadout);
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
    unit.toRemove = true;
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
   * this method's own contract: a Yasuo on 12 HP that becomes a Zed on 12 HP
   * is not what "try this champion now" means.
   *
   * For a bot this also rewrites `presetFactory` and re-arms the respawn roll,
   * so the identity the player just chose survives the bot's next death
   * instead of coming back as whatever it was configured with — including when
   * the roll had been pinned off by the picker's "clone my spells".
   */
  applyLoadout(unit: Champion, loadout: ChampionLoadout): void {
    unit.applyPreset(getChampionPresetFromLoadout(loadout));
    this.refill(unit);
    // For the player as readily as for a bot: the editor has to reopen on
    // whatever it last committed, whoever it was committed to.
    this.loadouts.set(unit, loadout);

    if (unit instanceof AIChampion) {
      unit.setPresetFactory(() => getChampionPresetFromLoadout(loadout));
      unit.setRespawnRollsNewPreset(true);
    }
  }

  /**
   * Writes only the flags it is handed, so a UI that owns one toggle can send
   * one field without having to restate the other two.
   */
  setBotBehaviour(bot: AIChampion, flags: Partial<BotBehaviour>): void {
    if (flags.autoMove !== undefined) bot._autoMove = flags.autoMove;
    if (flags.autoAttack !== undefined) bot._autoAttack = flags.autoAttack;
    if (flags.autoCast !== undefined) bot._autoCast = flags.autoCast;
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
    this._jungleEnabled = on;

    if (on) {
      this.game.spawnJungle();
      return;
    }
    for (const monster of this.game.monsters) monster.toRemove = true;
    // Emptied here rather than left to a sweep: `Game.monsters` is the
    // spawn-side list and nothing prunes it, so a jungle switched off and on
    // again would otherwise carry every dead camp's corpse into the new list.
    this.game.monsters.length = 0;
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
   */
  set minionsEnabled(on: boolean) {
    this.game.minionSpawner.enabled = on;
    if (on) return;
    for (const minion of this.game.minionSpawner.minions) minion.toRemove = true;
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
    this._rules = {
      cooldownReductionPercent: clampPercent(rules.cooldownReductionPercent),
      manaFree: !!rules.manaFree,
    };

    const derived = toMatchRules(this._rules);
    this.game.matchRules.cooldownMultiplier = derived.cooldownMultiplier;
    this.game.matchRules.manaFree = derived.manaFree;
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

  /** Whether `unit` is currently carrying the invulnerability buff. */
  isInvulnerable(unit: Champion): boolean {
    return this.invulnerableBuffs(unit).length > 0;
  }

  /**
   * The sticky toggle. The buff is constructed here and nowhere else, so the
   * tab never has to know what invulnerability is made of.
   */
  setInvulnerable(unit: Champion, on: boolean): void {
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
 * codebase (`Veigar_Q_Power`, `ChoGath_R_Growth`). The toggle turns
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
});
