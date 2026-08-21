import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';
import CombatText from '@/game/gameObject/helpers/CombatText';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * Absorbs incoming damage until it runs out, then expires.
 *
 *   const shield = new Shield(3000, caster, target);
 *   shield.amount = 80;
 *   target.addBuff(shield);
 *
 * Several shields can sit on one unit; they are consumed in the order applied.
 */
export default class Shield extends Buff {
  name = 'Khiên';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 5;

  /** Damage this shield can still absorb. */
  amount = 50;
  color: [number, number, number] = [255, 205, 90];

  _initialAmount = 50;

  get shieldAmount(): number {
    return this.toRemove ? 0 : this.amount;
  }

  onCreate(): void {
    this._initialAmount = this.amount;
  }

  modifyIncomingDamage(damage: number, _attacker?: AttackableUnit): number {
    if (this.toRemove || this.amount <= 0) return damage;

    const absorbed = Math.min(this.amount, damage);
    this.amount -= absorbed;

    CombatText.show(this.targetUnit, 'shield', absorbed, this.color);

    if (this.amount <= 0) this.deactivateBuff();

    return damage - absorbed;
  }

  draw(): void {
    if (this.targetUnit.isDead) return;

    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;
    // the ring thins out as the shield is chipped away
    const remaining = this._initialAmount > 0 ? this.amount / this._initialAmount : 0;

    push();
    noFill();
    stroke(this.color[0], this.color[1], this.color[2], 80 + 140 * remaining);
    strokeWeight(2 + 3 * remaining);
    circle(pos.x, pos.y, size + 10);
    pop();
  }
}
