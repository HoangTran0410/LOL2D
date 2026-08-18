import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import { withinRadiusCoords } from '@/utils/math.utils';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

export type HomingTarget = AttackableUnit;

export type TargetLossPolicy = 'remove' | 'continue';

export default abstract class HomingMissileSpellObject extends MissileSpellObject {
  target: AttackableUnit;
  targetLossPolicy: TargetLossPolicy = 'remove';
  maxHitCount = 0;
  private hasTargetArrived = false;
  private arrivalRadius = 0;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
    this.destination = target.position.copy();
  }

  update(): void {
    if (this.toRemove) return;
    if (!this.isTargetValid() && this.targetLossPolicy === 'remove') {
      this.toRemove = true;
      return;
    }
    if (!this.isTargetValid() && this.arrivalRadius === 0) {
      this.arrivalRadius = this.target.collisionRadius + this.size / 2;
    }
    super.update();
  }

  onBeforeMove(): void {
    if (!this.isTargetValid()) return;
    this.destination = this.target.position.copy();
    this.arrivalRadius = this.target.collisionRadius + this.size / 2;
  }

  protected hasArrived(previousPosition: p5.Vector, position: p5.Vector): boolean {
    const stepX = position.x - previousPosition.x;
    const stepY = position.y - previousPosition.y;
    const stepLengthSquared = stepX * stepX + stepY * stepY;
    const toTargetX = this.destination.x - previousPosition.x;
    const toTargetY = this.destination.y - previousPosition.y;
    const progress =
      stepLengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, (toTargetX * stepX + toTargetY * stepY) / stepLengthSquared));
    const nearestX = previousPosition.x + stepX * progress;
    const nearestY = previousPosition.y + stepY * progress;
    return withinRadiusCoords(
      this.destination.x,
      this.destination.y,
      nearestX,
      nearestY,
      this.arrivalRadius
    );
  }

  protected shouldStopAfterArrival(): boolean {
    return true;
  }

  onArrive(): void {
    if (this.hasTargetArrived || !this.isTargetValid()) {
      this.toRemove = true;
      return;
    }
    this.hasTargetArrived = true;
    this.onTargetArrive(this.target);
    this.toRemove = true;
  }

  abstract onTargetArrive(target: AttackableUnit): void;

  private isTargetValid(): boolean {
    return !this.target.isDead && !this.target.toRemove;
  }
}
