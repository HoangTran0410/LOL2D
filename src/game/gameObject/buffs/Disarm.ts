// https://leagueoflegends.fandom.com/wiki/Disarm
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

/**
 * Tước Vũ Khí — blocks basic attacks and nothing else. The unit keeps walking
 * and keeps casting, which is exactly what separates a disarm from a stun.
 *
 * A melee wind-up already in progress is cancelled by this, because the swing
 * re-reads `canAttack` at the strike instant; a projectile already in the air
 * still lands, because it has left the bow.
 */
export default class Disarm extends Buff {
  name = 'Tước Vũ Khí';
  buffAddType = BuffAddType.RENEW_EXISTING;
  statusFlagsToEnable = StatusFlags.Disarmed;

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noFill();
    stroke(220, 120, 60, 170);
    strokeWeight(3);
    // a struck-through ring: the unit is armed but the weapon is crossed out
    circle(pos.x, pos.y, size + 8);
    const offset = (size + 8) / 2 / Math.SQRT2;
    line(pos.x - offset, pos.y - offset, pos.x + offset, pos.y + offset);
    pop();
  }
}
