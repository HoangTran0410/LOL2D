import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Airborne from './Airborne';
import Root from './Root';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import Stun from './Stun';
import TrailSystem from '../helpers/TrailSystem';
import Fear from './Fear';
import Charm from './Charm';
import type { BuffConstructor } from '../Buff';

export default class Dash extends Buff {
  image: Buff['image'] = AssetManager.get('buff_root');
  name = 'Lướt';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  // for override
  trailSystem = new TrailSystem({
    trailColor: 'rgba(255, 255, 255, 0.39)',
    maxLength: 20,
  });
  showTrail = true;
  dashSpeed = 13;
  dashDestination: p5.Vector | null = null;
  stayAtDestination = true;
  cancelable = true;
  buffsToCheckCancel: BuffConstructor[] = [Airborne, Root, Stun, Fear, Charm];

  statusFlagsToEnable = StatusFlags.Ghosted;

  /**
   * Whether a unit may dash under its own power. Grounding blocks this, but not
   * displacements applied by someone else — those construct a Dash directly.
   */
  static CanDash(targetUnit: AttackableUnit): boolean {
    return targetUnit.canMove && !targetUnit.grounded;
  }

  onCreate(): void {
    if (this.showTrail && this.game) {
      this.game.objectManager.addObject(this.trailSystem);
      this.trailSystem.trailSize = this.targetUnit.stats.size.value;
    }
  }

  onActivate(): void {
    if (this.sourceUnit !== this.targetUnit) this.targetUnit.markDisplaced?.();
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
  onCancelled?(): void {}
  onReachedDestination?(): void {}
}
