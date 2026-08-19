import { Circle } from '@/libs/quadtree';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import { getChampionPresetRandom } from '@/game/preset';
import type { AssetKey } from '@/managers/AssetManager';
import Champion, { type ChampionOptions, type ChampionPresetData } from './Champion';
import type AttackableUnit from './AttackableUnit';
import { uuidv4 } from '@/utils';
import { vecDist } from '@/utils/math.utils';
import { effectiveRange } from '@/game/combat/Reach';
import TargetResolver, {
  defaultIsTargetable,
  defaultTargetInfo,
} from '@/game/spell/targeting/TargetResolver';
import type Spell from '@/game/gameObject/Spell';
import { isChargeActivation, requireChargeSpec, type CastContext } from '@/game/spell/runtime/types';
import type { Vec2 } from '@/game/spell/runtime/types';
import { type BotDifficulty, DEFAULT_DIFFICULTY } from '@/game/ai/Difficulty';

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
/** How far a bot looks for something to attack. Inside its 500 sight radius. */
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
  private pendingCharge?: {
    spell: Spell;
    context: CastContext;
    elapsedMs: number;
    releaseAtMs: number;
  };
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

    this.updateAttackTargeting();

    // an attack order owns the destination while it is running, so wandering off
    // to a random point has to wait until the order is done
    if (this._autoMove && !this.basicAttack.target) {
      let distToDest = this.position.dist(this.destination);
      if (distToDest < this.stats.speed.value) {
        this.moveToRandomLocation();
      }
    }

    if (this.pendingCharge) {
      const pending = this.pendingCharge;
      pending.elapsedMs += Math.max(0, deltaTime);
      const context = this.createSpellContext(pending.spell);
      if (context) {
        pending.context = context;
        pending.spell.hold(context);
      }
      if (pending.elapsedMs >= pending.releaseAtMs) {
        pending.spell.release(pending.context);
        this.pendingCharge = undefined;
      }
    } else if (this._autoCast) {
      if (random() < 0.1) {
        let spellIndex = floor(random(this.spells.length));
        const spell = this.spells[spellIndex];
        const context = this.createSpellContext(spell);
        if (context && spell.press(context)) {
          const castSpec = spell.castSpec;
          if (!isChargeActivation(castSpec.activation)) return;
          this.pendingCharge = {
            spell,
            context,
            elapsedMs: 0,
            releaseAtMs: requireChargeSpec(castSpec).maxDurationMs / 2,
          };
        }
      }
    }
  }

  /**
   * Picks something to basic attack. Kept separate from spell aiming on purpose:
   * `cursorForSpell` deliberately reads a live point rather than a locked unit,
   * and folding the two together would change how bots aim their abilities.
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
   */
  findAttackTarget(): Champion | null {
    // optional call for the same reason MissileSpellObject uses one: spell tests
    // hand in an object manager stub that only knows how to collect added objects
    const found =
      this.game.objectManager.queryObjects?.({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: AI_ATTACK_AGGRO_RANGE,
        }),
        filters: [
          PredefinedFilters.type(Champion),
          PredefinedFilters.canTakeDamageFromTeam(this.teamId),
          PredefinedFilters.excludeStealthed,
        ],
      }) ?? [];

    let nearest: Champion | null = null;
    let nearestDistance = Infinity;
    for (const champion of found) {
      if (champion === this) continue;
      const distance = p5.Vector.dist(this.position, champion.position);
      if (distance <= AI_ATTACK_AGGRO_RANGE && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = champion;
      }
    }
    return nearest;
  }

  private createSpellContext(spell: Spell): CastContext | undefined {
    const cursorWorld = this.cursorForSpell(spell);
    if (typeof this.game.createSpellContext === 'function') {
      return cursorWorld ? this.game.createSpellContext(spell, this, cursorWorld) : undefined;
    }
    const result = TargetResolver.resolve(spell.castSpec.targeting, {
      spellId: spell.id,
      activationId: uuidv4(),
      startedAtMs: Date.now(),
      caster: this,
      casterTeamId: this.teamId,
      origin: this.position,
      cursorWorld: cursorWorld ?? this.aimPoint(),
      ...spell.targetingRequest,
    });
    return result.ok ? result.context : undefined;
  }

  /**
   * Where a bot points a spell that is not aimed at a specific unit.
   *
   * The human player's cursor, deliberately: firing at the player is what makes
   * the bots worth fighting, and it is how they behaved before the runtime gave
   * them an aim of their own. `destination` is only a fallback for when there is
   * no cursor (headless tests) — on its own it is a bad aim, because with
   * `_autoMove` off a bot never walks anywhere, so its destination stays parked
   * on its own feet and every spell gets cast into the ground under it.
   */
  private aimPoint(): Vec2 {
    const cursor = this.game.worldMouse;
    return cursor ? { x: cursor.x, y: cursor.y } : this.destination;
  }

  private cursorForSpell(spell: Spell): Vec2 | undefined {
    if (spell.castSpec.targeting !== 'UNIT') return this.aimPoint();
    const request = spell.targetingRequest;
    const candidates = request.queryCandidates?.() ?? this.game.objectManager?.objects ?? [];
    const getTargetInfo = request.getTargetInfo ?? defaultTargetInfo;
    const isTargetable = request.isTargetable ?? defaultIsTargetable;
    let nearest: { point: Vec2; distance: number } | undefined;

    for (const candidate of candidates) {
      const info = getTargetInfo(candidate);
      if (!info || !isTargetable(candidate)) continue;
      if (request.targetTeam === 'ENEMY' && info.teamId === this.teamId) continue;
      if (request.targetTeam === 'ALLY' && info.teamId !== this.teamId) continue;
      const distance = vecDist(info.position, this.position);
      // Same size-corrected reach TargetResolver will apply a moment later; a
      // bot that aimed by the raw number would pick a victim the resolver then
      // rejects, and simply stop casting once its own body had grown.
      if (
        request.range !== undefined &&
        distance > effectiveRange(request.range, this, candidate)
      ) {
        continue;
      }
      if (!nearest || distance < nearest.distance) nearest = { point: info.position, distance };
    }
    return nearest?.point;
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
    let x = random(this.game.mapSize);
    let y = random(this.game.mapSize);

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
