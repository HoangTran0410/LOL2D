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
import { AI_COUNT_MAX } from './config/PregameConfig';
import type { ChampionLoadout, MatchRules } from './config/PregameConfig';
import { getChampionPresetFromLoadout } from './preset';
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
  constructor(private readonly game: MatchDirectorContext) {}

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
   * Live bots, in spawn order. `toRemove` units are already gone as far as the
   * panel is concerned: the sweep that deletes them cannot run until the match
   * unpauses, and a roster still listing a bot the player just removed would be
   * showing them the pause rather than their own edit.
   */
  bots(): AIChampion[] {
    // A hand-rolled loop rather than `objects.filter((o): o is AIChampion => …)`
    // because `src/types/global.d.ts` re-declares `Array.prototype.filter` with
    // the optimized `(value, index) => boolean` signature, and a merged
    // interface puts that overload first — so the type-predicate overload never
    // gets a look in and the result comes back as `GameObject[]`. The narrowing
    // is real, so the alternative would have been a cast asserting it.
    const bots: AIChampion[] = [];
    for (const object of this.game.objectManager.objects) {
      if (object instanceof AIChampion && !object.toRemove) bots.push(object);
    }
    return bots;
  }

  /**
   * Spawns a bot at a fountain spawn point, capped at the same `AI_COUNT_MAX`
   * the pregame screen enforces — hence the nullable return: the cap is real
   * and a caller that cannot see it would silently drop the player's click.
   *
   * The bot enters the world on the next unpaused tick; a caller that needs it
   * in `roster()` right away is asking the wrong question (see the file
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
    unit.stats.health.baseValue = unit.stats.maxHealth.value;
    unit.stats.mana.baseValue = unit.stats.maxMana.value;

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
}

const behaviourOf = (bot: AIChampion): BotBehaviour => ({
  autoMove: bot._autoMove,
  autoAttack: bot._autoAttack,
  autoCast: bot._autoCast,
});
