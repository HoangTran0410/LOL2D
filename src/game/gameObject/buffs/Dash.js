import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import { hasFlag } from '../../../utils/index.js';
import Buff from '../Buff.js';
import Airborne from './Airborne.js';
import Root from './Root.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Stun from './Stun.js';
import TrailSystem from '../helpers/TrailSystem.js';

// Lướt
export default class Dash extends Buff {
  image = AssetManager.getAsset('buff_root');
  name = 'Lướt';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  // for override
  trailsDelayFrame = 0;
  trails = [];
  trailSystem = new TrailSystem({
    trailColor: [255, 100],
    maxLength: 20,
  });

  // for override
  showTrail = true;
  dashSpeed = 6;
  dashDestination = null;
  cancelable = true;
  buffsToCheckCancel = [Airborne, Root, Stun];

  static CanDash(targetUnit) {
    return hasFlag(targetUnit.status, StatusFlags.CanMove);
  }

  onCreate() {
    if (this.showTrail && this.game) {
      this.game.addSpellObject(this.trailSystem);
      this.trailSystem.trailSize = this.targetUnit.stats.size.value;
    }
  }

  onUpdate() {
    if (this.toRemove) return;

    // apply ghosted every frame
    this.targetUnit.status |= StatusFlags.Ghosted;

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

  onDeactivate() {
    this.targetUnit.status &= ~StatusFlags.Ghosted;
  }

  // for override
  onCancelled() {}
  onReachedDestination() {}
}
