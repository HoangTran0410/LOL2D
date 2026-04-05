import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';
import Airborne from './Airborne';
import Root from './Root';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import Stun from './Stun';
import TrailSystem from '../helpers/TrailSystem';
import Fear from './Fear';
import Charm from './Charm';

export default class Dash extends Buff {
  image = AssetManager.getAsset('buff_root');
  name = 'Lướt';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  // for override
  trailSystem = new TrailSystem({
    trailColor: [255, 100] as any,
    maxLength: 20,
  });
  showTrail = true;
  dashSpeed = 13;
  dashDestination: any = null;
  stayAtDestination = true;
  cancelable = true;
  buffsToCheckCancel: any[] = [Airborne, Root, Stun, Fear, Charm];

  statusFlagsToEnable = StatusFlags.Ghosted;

  static CanDash(targetUnit: any): boolean {
    return targetUnit.canMove;
  }

  onCreate(): void {
    if (this.showTrail && this.game) {
      this.game.objectManager.addObject(this.trailSystem);
      this.trailSystem.trailSize = this.targetUnit.stats.size.value;
    }
  }

  onActivate(): void {
    if (this.stayAtDestination && this.dashDestination) {
      this.targetUnit.moveTo(this.dashDestination.x, this.dashDestination.y);
    }
  }

  onUpdate(): void {
    if (this.toRemove) return;

    // apply dash
    if (this.dashDestination) {
      VectorUtils.moveVectorToVector(
        this.targetUnit.position,
        this.dashDestination,
        this.dashSpeed
      );

      if (p5.Vector.dist(this.targetUnit.position, this.dashDestination) < this.dashSpeed) {
        this.onReachedDestination?.();
        this.deactivateBuff();
      }
    }

    // cancel if target unit is have other buffs
    if (
      this.cancelable &&
      this.targetUnit.buffs.find(
        (buff: any) =>
          buff !== this &&
          buff.sourceUnit !== this.sourceUnit && // cancel if target unit is have other buffs from other source unit
          this.buffsToCheckCancel.find((buffClass: any) => buff instanceof buffClass)
      )
    ) {
      this.onCancelled?.();
      this.deactivateBuff();
    }

    // update trails
    if (this.showTrail) {
      this.trailSystem.addTrail(this.targetUnit.position);
    }
  }

  // for override
  onCancelled?(): void {}
  onReachedDestination?(): void {}
}
