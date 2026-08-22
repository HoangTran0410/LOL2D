import { hasFlag } from '@/utils/index';
import ActionState from '@/game/enums/ActionState';
import EventType from '@/game/enums/EventType';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { BasicAttackBolt, BasicAttackSwing, MELEE_RANGE_THRESHOLD, canBeHit } from './BasicAttack';

/**
 * Why an attack order stopped. Surfaced so callers (the AI, later an order
 * queue) can tell "it died" from "it walked out of my sight".
 */
export type AttackOrderEnd = 'KILLED' | 'LOST' | 'CLEARED' | 'DISABLED';

/**
 * Owns one unit's basic attack: the standing order, the walk into range, the
 * swing timer, and the two events that make the attack visible to spells.
 *
 * Composition rather than a base class, because the three units that already
 * attack (Minion, Monster, Turret) each grew their own loop and unifying them is
 * a separate change. This one is written to be adoptable by them as it is: it
 * only ever touches `owner.stats`, `owner.moveTo/stopMovement` and the object
 * manager.
 *
 * The controller never scans for targets. A target is always *given* to it —
 * by the player's right click or by the AI's own jittered scan — so adding a
 * champion costs zero quadtree queries per frame.
 */
export default class BasicAttackController {
  readonly owner: AttackableUnit;

  /** Standing order. Null means the unit is not attacking anything. */
  target: AttackableUnit | null = null;
  /** ms until the next swing may start. Runs whether or not there is a target,
   *  so switching targets does not refund the wind-down of the last swing. */
  cooldownMs = 0;
  /** Why the last order ended. Reset when a new one is issued. */
  lastEnd: AttackOrderEnd | null = null;
  /**
   * ms during which the owner's own move order outranks this controller's
   * "stand still and wait for the swing".
   *
   * Kiting needs it and nothing else does. Once a target is inside reach this
   * controller calls `stopMovement()` every frame, which is right for a unit
   * that has nothing better to do — and which deleted a step back before the
   * champion had taken it, so a ranged bot stood in the gaps between its own
   * swings. `BotBrain.kiteStep` opens a window here and the window closes on
   * its own; committing to a swing closes it early, so a kiting bot fires on
   * the beat rather than running away from the fight.
   *
   * A plain countdown rather than a flag, because the writer thinks four times
   * a second and this is read sixty: a flag would have to be cleared by
   * somebody, and the somebody would be a frame that never came.
   */
  repositionMs = 0;

  constructor(owner: AttackableUnit) {
    this.owner = owner;
  }

  get attackDamage(): number {
    return this.owner.stats.attackDamage.value;
  }

  /** Attacks per second, floored so a zeroed stat cannot divide by zero. */
  get attacksPerSecond(): number {
    return Math.max(0.05, this.owner.stats.attackSpeed.value);
  }

  get intervalMs(): number {
    return 1_000 / this.attacksPerSecond;
  }

  get isRanged(): boolean {
    return this.owner.stats.attackRange.value > MELEE_RANGE_THRESHOLD;
  }

  /** Surface to surface: a 40-unit reach can never satisfy itself against two
   *  55-unit bodies standing next to each other. */
  reachTo(target: AttackableUnit): number {
    return (
      this.owner.stats.attackRange.value +
      this.owner.stats.size.value / 2 +
      (target.stats?.size?.value ?? 0) / 2
    );
  }

  /**
   * How far the unit will chase before giving the order up. Its own sight: an
   * attack order should never drag a champion after something it cannot see.
   */
  leashTo(target: AttackableUnit): number {
    return this.owner.stats.visionRadius.value + (target.stats?.size?.value ?? 0) / 2;
  }

  order(target: AttackableUnit | null): void {
    if (!target || target === this.owner || target.teamId === this.owner.teamId) return;
    if (!canBeHit(target)) return;
    this.target = target;
    this.lastEnd = null;
  }

  /** Drop the order without stopping the unit — a move order does its own moving. */
  clear(): void {
    if (this.target) this.lastEnd = 'CLEARED';
    this.target = null;
  }

  update(): void {
    if (this.cooldownMs > 0) this.cooldownMs -= deltaTime;
    if (this.repositionMs > 0) this.repositionMs -= deltaTime;

    if (this.owner.isDead) {
      this.target = null;
      return;
    }

    const target = this.target;
    if (!target) return;

    // Crowd control ends the order, it does not pause it. A stun, charm, fear,
    // suppression or disarm all clear ActionState.CAN_ATTACK, and every one of
    // them is a moment where the unit stopped being the one deciding what it is
    // doing — coming out of it still glued to whoever it was chasing is how a
    // sticky order turns into a unit that walks itself into a losing fight. The
    // player presses again; the AI re-scans within its interval.
    if (!this.owner.canAttack) {
      this.lastEnd = 'DISABLED';
      this.target = null;
      this.owner.stopMovement();
      return;
    }

    const reach = this.reachTo(target);
    if (!this.canKeep(target)) {
      // A lock goes stale between frames: the target dies, is removed, is made
      // untargetable, vanishes into stealth, or simply outruns our sight. In
      // every one of those cases the unit stops where it is rather than picking
      // a new fight nobody ordered.
      this.lastEnd = target.isDead || target.toRemove ? 'KILLED' : 'LOST';
      this.target = null;
      this.owner.stopMovement();
      return;
    }

    const distance = p5.Vector.dist(this.owner.position, target.position);
    if (distance > reach) {
      // Routed, not straight: a chase across a wall used to end with the
      // attacker pressed into it. This is called every frame at a target that
      // keeps moving, which PathAgent collapses into one plan re-checked a few
      // times a second — see the throttles there.
      this.owner.navigateTo(target.position.x, target.position.y);
      return;
    }

    // In reach. Plant, unless somebody has claimed the next few hundred ms to
    // reposition with — see `repositionMs`.
    if (this.repositionMs <= 0) this.owner.stopMovement();
    if (this.cooldownMs > 0) return;
    if (!this.owner.canAttack) return;

    // The swing wins over the step: a kiting unit plants for the frame it fires
    // on, whatever window was still open.
    this.repositionMs = 0;
    this.owner.stopMovement();
    this.cooldownMs = this.intervalMs;
    this.launch(target, reach);
  }

  /** Whether the standing order is still worth keeping this frame. */
  canKeep(target: AttackableUnit): boolean {
    if (!canBeHit(target)) return false;
    // stealth is not untargetability, but chasing something invisible is the
    // same bad experience, so an order drops on it too
    if (hasFlag(target.stats.actionState, ActionState.STEALTHED)) return false;
    return p5.Vector.dist(this.owner.position, target.position) <= this.leashTo(target);
  }

  /**
   * Fires one swing. ON_ATTACK is emitted here, at the start, with the attacker
   * as its payload — that is the shape one channel-breaking ultimate already listens for, and
   * "the unit committed to a swing" is exactly when a channel should break.
   * ON_ATTACK_HIT comes later, from whichever object actually lands.
   */
  launch(target: AttackableUnit, reach: number): void {
    const damage = this.attackDamage;
    const ranged = this.isRanged;

    this.owner.game?.eventManager?.emit(EventType.ON_ATTACK, this.owner);

    if (ranged) {
      const bolt = new BasicAttackBolt(this.owner);
      bolt.target = target;
      bolt.damage = damage;
      bolt.position.set(this.owner.position.x, this.owner.position.y);
      bolt.destination.set(target.position.x, target.position.y);
      this.owner.game.objectManager.addObject?.(bolt);
    } else {
      const swing = new BasicAttackSwing(this.owner, target);
      swing.damage = damage;
      swing.reach = reach;
      this.owner.game.objectManager.addObject?.(swing);
    }
  }
}
