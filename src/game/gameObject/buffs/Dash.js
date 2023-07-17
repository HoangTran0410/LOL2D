import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';
import Airborne from './Airborne.js';
import Root from './Root.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Stun from './Stun.js';
import TrailSystem from '../helpers/TrailSystem.js';
import Fear from './Fear.js';
import Charm from './Charm.js';

export default class Dash extends Buff {
  image = AssetManager.getAsset('buff_root');
  name = 'Lướt';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  // for override
  trailSystem = new TrailSystem({
    trailColor: [255, 100],
    maxLength: 20,
  });
  showTrail = true;
  dashSpeed = 13;
  dashDestination = null;
  stayAtDestination = true;
  cancelable = true;
  buffsToCheckCancel = [Airborne, Root, Stun, Fear, Charm];

  statusFlagsToEnable = StatusFlags.Ghosted;

  static CanDash(targetUnit) {
    return targetUnit.canMove;
  }

  onCreate() {
    if (this.showTrail && this.game) {
      this.game.addObject(this.trailSystem);
      this.trailSystem.trailSize = this.targetUnit.stats.size.value;
    }
  }

  onActivate() {
    if (this.stayAtDestination && this.dashDestination) {
      this.targetUnit.moveTo(this.dashDestination.x, this.dashDestination.y);
    }
  }

  onUpdate() {
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
        buff =>
          buff !== this &&
          buff.sourceUnit !== this.sourceUnit && // cancel if target unit is have other buffs from other source unit
          this.buffsToCheckCancel.find(buffClass => buff instanceof buffClass)
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
  onCancelled() {}
  onReachedDestination() {}
}
