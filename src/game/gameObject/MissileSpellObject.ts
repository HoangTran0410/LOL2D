import { Circle, Rectangle } from '../../libs/quadtree';
import VectorUtils from '../../utils/vector.utils';
import { PredefinedFilters } from '../managers/ObjectManager';
import SpellObject from './SpellObject';
import type { SpellOwner } from './SpellObject';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import TrailSystem from './helpers/TrailSystem';

/**
 * Base for skillshot projectiles: travels from `position` to `destination`, damages
 * enemies it overlaps on the way, and dies on arrival.
 *
 * A subclass normally only overrides `onHit`, `draw`, and the tuning fields. The
 * hooks (`onBeforeMove`, `onAfterMove`, `onArrive`, `getTrailPosition`) cover the
 * cases that bend the default flight, e.g. a boomerang that flips its destination
 * on arrival, or a tornado that widens as it travels.
 *
 * Declare `trailSystem` in the subclass, not here: subclass field initializers run
 * after this class's, so a trail built here could not read the subclass `size`.
 */
export default class MissileSpellObject<TOwner extends SpellOwner = AttackableUnit> extends SpellObject<TOwner> {
  declare owner: TOwner;
  isMissile = true;

  declare position: p5.Vector;
  declare destination: p5.Vector;
  speed = 7;
  size = 20;

  /** Units already hit — excluded from later queries so one unit is hit once. */
  hitTargets: any[] = [];
  /** Stops hitting after this many distinct units. Infinity pierces, 0 never collides. */
  maxHitCount = Infinity;
  /** False for missiles that keep flying after reaching `destination`. */
  removeOnArrive = true;
  /** False for missiles that survive their last hit, e.g. to latch onto the target. */
  removeOnMaxHit = true;

  /** Assigned by subclasses that want a trail; registered automatically. */
  trailSystem: TrailSystem | null = null;

  constructor(owner: TOwner) {
    super(owner);
    this.position = owner.position.copy();
    this.destination = owner.position.copy();
  }

  onAdded() {
    if (this.trailSystem && this.owner.game.objectManager.addObject) {
      this.owner.game.objectManager.addObject(this.trailSystem);
    }
  }

  update() {
    this.onBeforeMove();

    const previousPosition = this.position.copy();
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);
    if (this.hasArrived(previousPosition, this.position)) {
      this.onArrive();
      if (this.removeOnArrive) this.toRemove = true;
      if (this.shouldStopAfterArrival()) return;
    }

    this.onAfterMove();

    if (this.trailSystem) this.trailSystem.addTrail(this.getTrailPosition());

    this.checkCollision();
  }

  checkCollision() {
    // 0 means the missile never collides in flight, e.g. a bolt homing on one target
    if (this.maxHitCount <= 0) return;

    if (this.hitTargets.length >= this.maxHitCount) {
      if (this.removeOnMaxHit) this.toRemove = true;
      return;
    }

    for (const enemy of this.queryEnemies()) {
      this.hitTargets.push(enemy);
      this.onHit(enemy);

      if (this.hitTargets.length >= this.maxHitCount) {
        if (this.removeOnMaxHit) this.toRemove = true;
        break;
      }
    }
  }

  queryEnemies(): any[] {
    return this.owner.game.objectManager.queryObjects?.({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.size / 2,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.excludeObjects(this.hitTargets),
      ],
    }) ?? [];
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }

  // for override
  onBeforeMove(): void {}
  /** Runs after the step, before collision — for visuals that track distance travelled. */
  onAfterMove(): void {}
  /** Preserves the original strict endpoint arrival rule for ordinary missiles. */
  protected hasArrived(_previousPosition: p5.Vector, position: p5.Vector): boolean {
    return position.dist(this.destination) < this.speed;
  }
  /** Homing missiles stop after arrival; ordinary missiles finish their terminal hooks. */
  protected shouldStopAfterArrival(): boolean { return false; }
  onArrive(): void {}
  onHit(_enemy: any): void {}
  getTrailPosition(): p5.Vector {
    return this.position;
  }
}
