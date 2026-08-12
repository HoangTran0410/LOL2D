import MissileSpellObject from '../MissileSpellObject';

export interface HomingTarget {
  position: p5.Vector;
  collisionRadius: number;
  isDead?: boolean;
  toRemove?: boolean;
}

export type TargetLossPolicy = 'remove' | 'continue';

export default abstract class HomingMissileSpellObject<TTarget extends HomingTarget>
  extends MissileSpellObject {
  target: TTarget;
  targetLossPolicy: TargetLossPolicy = 'remove';
  maxHitCount = 0;
  private hasArrived = false;

  constructor(owner: MissileSpellObject['owner'], target: TTarget) {
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
    super.update();
  }

  onBeforeMove(): void {
    if (this.isTargetValid()) this.destination = this.target.position.copy();
  }

  getArrivalThreshold(): number {
    return this.isTargetValid() ? this.target.collisionRadius + this.size / 2 : 0;
  }

  onArrive(): void {
    if (this.hasArrived || !this.isTargetValid()) {
      this.toRemove = true;
      return;
    }
    this.hasArrived = true;
    this.onTargetArrive(this.target);
    this.toRemove = true;
  }

  abstract onTargetArrive(target: TTarget): void;

  private isTargetValid(): boolean {
    return !this.target.isDead && !this.target.toRemove;
  }
}
