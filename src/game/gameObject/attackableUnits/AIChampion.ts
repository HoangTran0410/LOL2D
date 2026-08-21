import { getChampionPresetRandom } from '@/game/preset';
import Champion, { type ChampionOptions, type ChampionPresetData } from './Champion';
import type AttackableUnit from './AttackableUnit';
import { type BotDifficulty, DEFAULT_DIFFICULTY } from '@/game/ai/Difficulty';
import BotBrain from '@/game/ai/BotBrain';

/** `avatar` is a pack's own asset key — see `ChampionPresetData.avatar`'s doc comment. */
export type ChampionPresetFactory = () => ChampionPresetData & { avatar: string };

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
   * above, resolved by the caller: it rides in `BotBehaviour` alongside them,
   * so the Đội tab's per-bot picker, `MatchDirector.setBotBehaviour` and the
   * persisted config all reach it the same way they reach `autoMove`.
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
  /** See `Champion.isBot` — this is the class the flag exists to name. */
  readonly isBot = true;
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
   *
   * This first one is **off**, unlike the two after it, and is the one flag
   * here whose default is a decision rather than an inheritance.
   *
   * Taking a hit used to re-roll the bot's destination to a random point on the
   * whole map. That predates `BotBrain`, which now answers "I am being hurt"
   * with a posture — RETREAT to the nearest friendly turret, DISENGAGE out of a
   * turret's reach — and the flinch cooperates with none of them: under
   * a turret it fired once per bolt and sent the bot somewhere arbitrary, which
   * is as likely to be deeper into the guns as out of them. Two answers to one
   * question, and the wrong one ran sixty times a second.
   *
   * Still a flag, still writable by `MatchDirector.setBotBehaviour` and the
   * pregame config, so the old reflex is one checkbox away for anyone who wants
   * to watch it.
   */
  _autoMoveOnTakeDamage = false;
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

    // The game's clock, never one of our own: every bot and the blackboard they
    // share have to be in one time domain, and bots are built mid-match. The
    // brain goes before `updateAttackTargeting`, which reaches into it — the
    // brain dates its blackboard snapshot from whatever it was last handed.
    // `?? 0` because a headless context has no clock; `deltaTime` is still the
    // frame length, which is a duration and needs no domain.
    this.brain.update(this.game.matchTimeMs ?? 0, deltaTime);
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
    // Champions first, always. `findObjectiveTarget` answers only while the
    // brain is in PUSH, which `decidePosture` ranks below every rule that
    // involves an enemy champion — so this `??` cannot promote a minion over
    // one, and the priority stays stated in exactly one place.
    this.basicAttack.order(this.findAttackTarget() ?? this.findObjectiveTarget());
  }

  /**
   * The hostile champion worth attacking, inside the tier's aggro radius.
   * Champions only — a bot that wandered into the jungle and started trading
   * with a camp, or parked itself under a turret, would look broken rather
   * than dangerous.
   *
   * Still champions only now that bots farm: this is the *aggro* question, and
   * a champion in range beats a wave. The lane objectives are a separate,
   * lower lookup — `findObjectiveTarget` below.
   *
   * Not simply the nearest one: the scan lives on the brain, which ranks what
   * it finds by `scoreTarget` — distance, how close to dead, and whether the
   * team is already on it. This stays because it is what a bot's attack order
   * is asked for, here and in two suites outside this file.
   */
  findAttackTarget(): Champion | null {
    return this.brain.findAttackTarget();
  }

  /**
   * The lane objective worth attacking when no champion is: the wave in front
   * of this bot, then the turret behind it. Answers `null` in every posture but
   * PUSH. See `BotBrain.findObjectiveTarget`.
   */
  findObjectiveTarget(): AttackableUnit | null {
    return this.brain.findObjectiveTarget();
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
    // The brain's "am I safe enough to stand still" clock. Written here rather
    // than derived from health, because a shield eats the number and not the
    // fact: being shot at is what makes a recall a bad idea, not losing health
    // to it. `matchTimeMs` and never a clock of this unit's own — see the note
    // on `BotBrain.update`.
    this.brain.lastDamagedAtMs = this.game.matchTimeMs ?? 0;
    if (this.wandersOnReflex(this._autoMoveOnTakeDamage)) this.moveToRandomLocation();

    // Hit back. super.takeDamage may have killed us, and an order already
    // running is kept: a bot that re-targeted on every incoming hit would drop
    // the champion it was about to finish every time a turret shot it.
    if (!this._autoAttack || this.isDead || this.basicAttack.target) return;
    // ...but a bot that has decided to leave does not re-enlist. RETREAT,
    // RECOVER and DISENGAGE all clear the standing order on their think tick,
    // and without this the very next incoming hit hands it straight back —
    // which under a turret is every 1.3 seconds, for as long as it takes to die.
    if (this.brain.isLeaving) return;
    // ...and it does not enlist in a fight it is not allowed to walk to. This
    // is the third acquisition path, and it used to be the only one with no
    // turret gate: `updateAttackTargeting` asks through `findAttackTarget` and
    // the posture chain asks in `decidePosture`, while an enemy standing under
    // their own turret could get an order out of this one just by poking. The
    // attack controller has never heard of a building, so it then re-issued
    // `navigateTo(attacker)` every frame and undid both of the other rules.
    if (attacker instanceof Champion && this.brain.mayFight(attacker)) {
      this.basicAttack.order(attacker);
    }
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
