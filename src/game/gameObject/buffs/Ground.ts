import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

/**
 * Grounded: the unit can still walk, but cannot use its own movement abilities
 * (dashes, blinks). Displacements applied BY someone else still land — being
 * grounded does not make you immune to a hook or a knockback.
 *
 * Enforced in `Dash.CanDash`, which spells call before dashing their caster.
 */
export default class Ground extends Buff {
  image: Buff['image'] = AssetManager.get('buff_ground');
  name = 'Ghìm';
  buffAddType = BuffAddType.RENEW_EXISTING;

  statusFlagsToEnable = StatusFlags.Grounded;

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noFill();
    stroke(190, 140, 70, 200);
    strokeWeight(3);
    // a broken ring on the ground, so it reads as "stuck to the floor"
    for (let i = 0; i < 6; i++) {
      const start = (i * TWO_PI) / 6;
      arc(pos.x, pos.y + size * 0.3, size + 6, size * 0.5, start, start + 0.6);
    }
    pop();
  }
}
