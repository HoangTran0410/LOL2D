import AssetManager from '../../../managers/AssetManager';
import { Circle } from '../../../libs/quadtree';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { getChampionPresetRandom } from '../../preset';
import Champion, { type ChampionOptions } from './Champion';
import type AttackableUnit from './AttackableUnit';
import { uuidv4 } from '../../../utils';
import TargetResolver, {
  defaultIsTargetable,
  defaultTargetInfo,
} from '../../spell/targeting/TargetResolver';
import type Spell from '../Spell';
import { isChargeActivation, requireChargeSpec, type CastContext } from '../../spell/runtime/types';
import type { Vec2 } from '../../spell/runtime/types';

export type AIChampionOptions = ChampionOptions;

/**
 * ms between target scans. A bot only re-queries the quadtree four times a
 * second, and the first interval is jittered per bot so five of them never scan
 * on the same frame. Scanning every frame per unit is the one thing here that
 * would cost a full board its frame rate.
 */
export const AI_ATTACK_SCAN_INTERVAL_MS = 250;
/** How far a bot looks for something to attack. Inside its 500 sight radius. */
export const AI_ATTACK_AGGRO_RANGE = 420;

export default class AIChampion extends Champion {
  _autoMove = false;
  _autoCast = true;
  _autoAttack = true;
  _autoMoveOnTakeDamage = false;
  _autoMoveOnCollideWall = true;
  _autoMoveOnCollideMapEdge = true;
  _respawnWithNewPreset = true;
  /** ms until the next scan, jittered on construction. */
  _attackScanCooldown = Math.random() * AI_ATTACK_SCAN_INTERVAL_MS;
  private pendingCharge?: {
    spell: Spell;
    context: CastContext;
    elapsedMs: number;
    releaseAtMs: number;
  };

  constructor(options: AIChampionOptions) {
    super(options);
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
      const distance = Math.hypot(
        info.position.x - this.position.x,
        info.position.y - this.position.y
      );
      if (request.range !== undefined && distance > request.range) continue;
      if (!nearest || distance < nearest.distance) nearest = { point: info.position, distance };
    }
    return nearest?.point;
  }

  moveToRandomLocation() {
    let x = random(this.game.mapSize);
    let y = random(this.game.mapSize);
    this.moveTo(x, y);
  }

  onCollideMapEdge() {
    super.onCollideMapEdge();
    if (this._autoMoveOnCollideMapEdge) this.moveToRandomLocation();
  }

  onCollideWall() {
    super.onCollideWall();
    if (this._autoMoveOnCollideWall) this.moveToRandomLocation();
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    super.takeDamage(damage, attacker);
    if (this._autoMoveOnTakeDamage) this.moveToRandomLocation();

    // Hit back. super.takeDamage may have killed us, and an order already
    // running is kept: a bot that re-targeted on every incoming hit would drop
    // the champion it was about to finish every time a turret shot it.
    if (!this._autoAttack || this.isDead || this.basicAttack.target) return;
    if (attacker instanceof Champion) this.basicAttack.order(attacker);
  }

  respawn() {
    super.respawn();

    if (this._respawnWithNewPreset) {
      let newPreset = getChampionPresetRandom();
      this.avatar = AssetManager.get(newPreset.avatar);
      this.replaceSpells((newPreset.spells ?? []).map(SpellClass => new SpellClass(this)));
    }
  }
}
