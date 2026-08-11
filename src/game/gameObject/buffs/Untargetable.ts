import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';

/**
 * The unit cannot be picked as a target or hit by anything, but keeps acting.
 * Used by the brief invulnerable windows on leaps (Fizz E, Zed R).
 *
 * `PredefinedFilters.canTakeDamageFromTeam` already tests `targetable`, so every
 * spell that queries for enemies skips the unit for free.
 */
export default class Untargetable extends Buff {
  image = AssetManager.getAsset('buff_untargetable');
  name = 'Không Thể Chọn';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  statusFlagsToDisable = StatusFlags.Targetable;

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noFill();
    stroke(200, 230, 255, 130);
    strokeWeight(2);
    for (let i = 0; i < 3; i++) {
      circle(pos.x, pos.y, size + 8 + i * 9 + sin(frameCount / 6 + i) * 3);
    }
    pop();
  }
}
