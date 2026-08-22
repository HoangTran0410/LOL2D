import { Circle, Rectangle } from '@/libs/quadtree';
import VectorUtils from '@/utils/vector.utils';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import SpellObject from './SpellObject';
import AttackableUnit from './attackableUnits/AttackableUnit';
import TrailSystem from './helpers/TrailSystem';
import AssetManager, { type AssetHandle } from '@/managers/AssetManager';

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
export default class MissileSpellObject extends SpellObject {
  isMissile = true;

  declare position: p5.Vector;
  declare destination: p5.Vector;
  speed = 7;
  size = 20;
  image?: AssetHandle;
  visualWidth = this.size;
  visualHeight = this.size;
  visualRotationOffset = 0;

  /** Units already hit — excluded from later queries so one unit is hit once. */
  hitTargets: AttackableUnit[] = [];
  /** Stops hitting after this many distinct units. Infinity pierces, 0 never collides. */
  maxHitCount = Infinity;
  /** False for missiles that keep flying after reaching `destination`. */
  removeOnArrive = true;
  /** False for missiles that survive their last hit, e.g. to latch onto the target. */
  removeOnMaxHit = true;

  /** Assigned by subclasses that want a trail; registered automatically. */
  trailSystem: TrailSystem | null = null;

  constructor(owner: AttackableUnit) {
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
    // A missile in flight never attaches, so this is a no-op for it; missiles
    // that latch onto a body (a hooked bandage, a chained lantern) call attachTo
    // when they land and get dropped here the moment that body is gone.
    if (this.dropIfAttachmentLost()) return;

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

  queryEnemies(): AttackableUnit[] {
    return (
      this.owner.game.objectManager.queryObjects?.({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.hitTargets),
        ],
      }) ?? []
    );
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

  draw(): void {
    if (!this.image) return;
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle + this.visualRotationOffset);
    if (this.image.status === 'ready') {
      imageMode(CENTER);
      image(AssetManager.renderable(this.image), 0, 0, this.visualWidth, this.visualHeight);
    } else {
      if (this.image.status === 'idle' && this.image.key) {
        void AssetManager.ensure(this.image.key).catch(() => undefined);
      }
      stroke(235, 225, 170, 230);
      strokeWeight(Math.max(3, this.visualHeight / 5));
      line(-this.visualWidth / 2, 0, this.visualWidth / 2, 0);
    }
    pop();
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
  protected shouldStopAfterArrival(): boolean {
    return false;
  }
  onArrive(): void {}
  onHit(_enemy: AttackableUnit): void {}
  getTrailPosition(): p5.Vector {
    return this.position;
  }
}
