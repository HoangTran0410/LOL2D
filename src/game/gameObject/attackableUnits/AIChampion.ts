import { getChampionPresetRandom } from '@/game/preset';
import type { AssetKey } from '@/managers/AssetManager';
import Champion, { type ChampionOptions, type ChampionPresetData } from './Champion';
import type AttackableUnit from './AttackableUnit';
import { type BotDifficulty, DEFAULT_DIFFICULTY } from '@/game/ai/Difficulty';
import BotBrain from '@/game/ai/BotBrain';

export type ChampionPresetFactory = () => ChampionPresetData & { avatar: AssetKey };

export interface AIChampionOptions extends ChampionOptions {
  /**
   * Overrides for this bot's behaviour flags, resolved by the caller (`Game`,
   * from its pregame config) before construction — the flags themselves stay
   * plain instance fields other code already reads and flips directly (see
   * `tests/e2e/drive-basic-attacks.mjs` pinning `bot._autoAttack` etc.), and
   * an omitted field here just keeps that field's class default.
   */
  autoMove?: boolean;
  autoAttack?: boolean;
  autoCast?: boolean;
  /**
   * How well this bot plays. A plain option like the three behaviour flags
   * above, resolved by the caller. The pregame config does not carry it yet —
   * see §10 of the design doc for the three-line wiring a later pass adds.
   */
  difficulty?: BotDifficulty;
  /**
   * What `respawn()` rebuilds this bot's kit from, when `_respawnWithNewPreset`
   * is on. Defaults to `getChampionPresetRandom`, i.e. today's behaviour
   * unchanged: a fresh random champion and kit every life. `Game.ts` passes a
   * closure over one specific `ChampionLoadout` for a bot the player
   * configured with a fixed champion — calling the *same* resolver again on
   * every respawn is what makes that bot's identity stick across deaths,
   * while a bot left on "random" keeps re-rolling exactly as before, since
   * `getChampionPresetFromLoadout({ championName: 'random', ... })` calls
   * through to `getChampionPresetRandom` internally too.
   */
  presetFactory?: ChampionPresetFactory;
}

/**
 * ms between target scans. A bot only re-queries the quadtree four times a
 * second, and the first interval is jittered per bot so five of them never scan
 * on the same frame. Scanning every frame per unit is the one thing here that
 * would cost a full board its frame rate.
 */
export const AI_ATTACK_SCAN_INTERVAL_MS = 250;
/**
 * How far a bot looks for something to attack.
 *
 * The reach is a difficulty knob now — `DifficultyProfile.aggroRange`, which
 * `BotBrain` reads — and this is `normal`'s value, i.e. the number every bot
 * used before there were tiers. Kept exported as the record of that promise:
 * a default match's aggro range did not change when the brain landed.
 */
export const AI_ATTACK_AGGRO_RANGE = 420;

/**
 * How far a rolled wander point may be dragged onto standable ground before the
 * roll is abandoned. Wide enough to rescue a point in the middle of a wall,
 * narrow enough that a bot never treats the far side of the map as "nearby".
 */
export const ROAM_SNAP_DISTANCE = 900;

export default class AIChampion extends Champion {
  _autoMove = true;
  _autoCast = true;
  _autoAttack = true;
  /**
   * The three reflexes below are *kinds* of auto-move, not siblings of it, so
   * they are read through `wandersOnReflex()` and never on their own.
   *
   * Switching movement off used to leave all three on, and a bot the player had
   * parked took one hit and set off across the map — a flinch is still a
   * wander. Gating at the read sites rather than mirroring `_autoMove` into
   * the fields keeps one writer: `MatchDirector.setBotBehaviour`, the pregame
   * config and the e2e scripts all set `_autoMove` directly, and turning
   * movement back on restores exactly the reflexes the bot had.
   */
  _autoMoveOnTakeDamage = true;
  _autoMoveOnCollideWall = true;
  _autoMoveOnCollideMapEdge = true;
  _respawnWithNewPreset = true;
  _difficulty: BotDifficulty = DEFAULT_DIFFICULTY;
  /** ms until the next scan, jittered on construction. */
  _attackScanCooldown = Math.random() * AI_ATTACK_SCAN_INTERVAL_MS;
  /**
   * Everything this bot decides. `AIChampion` is the body: it owns the clock,
   * the walking and the attack order, and asks the brain what to do with them.
   */
  readonly brain = new BotBrain(this);
  /**
   * Match time, accumulated from `deltaTime`.
   *
   * The brain takes time as an argument and never reads a p5 global itself —
   * `src/game/ai/` may not call one, because a local shadowing `random` or
   * `map` there fails at runtime on a frame nobody is watching. This boundary
   * is where the frame clock turns into a plain number.
   */
  private _nowMs = 0;
  private presetFactory: ChampionPresetFactory;

  constructor(options: AIChampionOptions) {
    super(options);
    if (options.autoMove !== undefined) this._autoMove = options.autoMove;
    if (options.autoAttack !== undefined) this._autoAttack = options.autoAttack;
    if (options.autoCast !== undefined) this._autoCast = options.autoCast;
    if (options.difficulty !== undefined) this._difficulty = options.difficulty;
    this.presetFactory = options.presetFactory ?? getChampionPresetRandom;
  }

  update() {
    super.update();

    // Clock first: `updateAttackTargeting` reaches into the brain, which reads
    // `nowMs` to date the blackboard snapshot.
    this._nowMs += Math.max(0, deltaTime);
    this.brain.update(this._nowMs, deltaTime);
    this.updateAttackTargeting();
  }

  /**
   * Picks something to basic attack, on its own clock.
   *
   * Deliberately not folded into the brain's think tick: a swing is a reflex
   * and re-scanning for one four times a second is cheap, while a decision that
   * moves the bot or spends mana is not. The two intervals are also read by
   * different tests, and `_attackScanCooldown` is the one an e2e script pins.
   */
  updateAttackTargeting(): void {
    this._attackScanCooldown -= deltaTime;
    if (!this._autoAttack || this.isDead) return;
    if (this._attackScanCooldown > 0) return;

    this._attackScanCooldown = AI_ATTACK_SCAN_INTERVAL_MS;
    // an order already running is left alone: re-picking every scan would make a
    // bot flip between two equidistant enemies and never finish either
    if (this.basicAttack.target) return;
    this.basicAttack.order(this.findAttackTarget());
  }

  /**
   * Nearest hostile champion inside the aggro radius. Champions only — a bot
   * that wandered into the jungle and started trading with a camp, or parked
   * itself under a turret, would look broken rather than dangerous.
   *
   * The scan itself lives on the brain, where the aggro range is a difficulty
   * profile and perception has one home. This stays because it is what a bot's
   * attack order is asked for, here and in two suites.
   */
  findAttackTarget(): Champion | null {
    return this.brain.findAttackTarget();
  }

  /**
   * Picks somewhere to wander and walks a route to it.
   *
   * The point is pulled onto standable ground first. Rolling a raw pair of
   * coordinates lands inside a wall about 40% of the time on this map, and a
   * bot ordered into a wall is a bot that spends its wander pressed against
   * one. `nearestWalkable` costs a short ring scan and removes that outright.
   */
  moveToRandomLocation() {
    this.navigateToWalkable(random(this.game.mapSize), random(this.game.mapSize));
  }

  /**
   * Walk to a point, pulled onto standable ground first.
   *
   * The half of `moveToRandomLocation` that is not the dice roll. Extracted
   * rather than reused because the reflexes still want the roll and the ROAM
   * posture never does — a bot that flinches picks anywhere, a bot that is
   * loitering stays near its team.
   */
  navigateToWalkable(x: number, y: number): void {
    const navigation = this.game.navigation;
    if (navigation) {
      const reachable = navigation.nearestWalkable(x, y, this.terrainRadius, ROAM_SNAP_DISTANCE);
      if (!reachable) return;
      x = reachable.x;
      y = reachable.y;
    }
    this.navigateTo(x, y);
  }

  /** Whether a reflex may re-roll this bot's destination. See the flags above. */
  private wandersOnReflex(reflex: boolean): boolean {
    return this._autoMove && reflex;
  }

  onCollideMapEdge() {
    super.onCollideMapEdge();
    if (this.wandersOnReflex(this._autoMoveOnCollideMapEdge)) this.moveToRandomLocation();
  }

  /**
   * Touching a wall used to re-roll the destination. That was never navigation
   * — it was a flinch, and it is what made a bot that clipped a corner set off
   * across the map instead of walking round it. A bot on a route keeps the
   * route and re-plans from where it actually ended up; only a bot with no
   * route at all falls back to picking somewhere new.
   */
  onCollideWall() {
    super.onCollideWall();
    if (this.pathAgent?.repath()) return;
    if (this.wandersOnReflex(this._autoMoveOnCollideWall)) this.moveToRandomLocation();
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    super.takeDamage(damage, attacker);
    if (this.wandersOnReflex(this._autoMoveOnTakeDamage)) this.moveToRandomLocation();

    // Hit back. super.takeDamage may have killed us, and an order already
    // running is kept: a bot that re-targeted on every incoming hit would drop
    // the champion it was about to finish every time a turret shot it.
    if (!this._autoAttack || this.isDead || this.basicAttack.target) return;
    if (attacker instanceof Champion) this.basicAttack.order(attacker);
  }

  respawn() {
    super.respawn();
    if (this._respawnWithNewPreset) this.applyPreset(this.presetFactory());
  }

  /**
   * Whether the next respawn rolls this bot's champion again. On by default —
   * a bot left on "random" re-rolls every life, which is the game's own
   * behaviour. Turning it off is how a bot handed a specific kit keeps it (see
   * the picker's "clone my spells" in `hudInteractions.ts`).
   */
  setRespawnRollsNewPreset(on: boolean): void {
    this._respawnWithNewPreset = on;
  }

  /**
   * What the next respawn would roll from. `presetFactory` is private, so this
   * is the only way to rewrite it after construction — which is what makes a
   * champion swap performed mid-match survive the bot's next death instead of
   * being re-rolled back to whatever it was configured with.
   */
  setPresetFactory(factory: ChampionPresetFactory): void {
    this.presetFactory = factory;
  }

  /** The one writer for `_difficulty`, so a later UI pass has a single call site. */
  setDifficulty(value: BotDifficulty): void {
    this._difficulty = value;
  }
}
