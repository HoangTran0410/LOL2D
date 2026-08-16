import Buff from '../Buff';
import CombatText from '../helpers/CombatText';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

/**
 * Sends a share of every hit straight back at whoever landed it.
 *
 * ## Why it is measured before mitigation
 *
 * `modifyIncomingDamage` runs once per buff, in the order the buffs were added,
 * and each one hands the next what is left. So *where* this sits decides what
 * it reflects: added before a shield it sees the swing, added after it sees
 * only the leftovers. It is meant to be the swing — "he hit me for 50, he takes
 * 40" is the sentence a player says about spikes — so `Rammus_W` adds this
 * first and says so. The buff itself changes nothing about the damage passing
 * through: it returns exactly what it was given.
 *
 * ## The re-entrancy guard
 *
 * The reflect is dealt with `takeDamage`, which walks the attacker's own buffs
 * — including their `DamageReflect`, if they have one. Two curled Rammuses
 * would bounce one hit between them until the stack ran out. `reflecting` is a
 * module-level latch rather than a per-buff one because the loop is *between*
 * two buffs, not inside either; the first reflect in a chain is the only one
 * that gets to happen, which is also the fairer rule (retaliation is not itself
 * an attack you can be punished for).
 */

/** True while a reflect is being paid out, anywhere. See the note above. */
let reflecting = false;

export default class DamageReflect extends Buff {
  name = 'Phản Đòn';

  /** Share of the incoming hit sent back, 0–1. */
  percent = 0.8;
  color: [number, number, number] = [255, 190, 110];

  modifyIncomingDamage(damage: number, attacker?: AttackableUnit): number {
    if (this.toRemove || !attacker || damage <= 0) return damage;
    // Self-damage is not an attack, and a cost that refunds itself is not a
    // cost — the same rule `takeDamage` applies to omnivamp.
    if (attacker === this.targetUnit || attacker.isDead) return damage;
    if (reflecting) return damage;

    const payload = Math.round(damage * this.percent);
    if (payload <= 0) return damage;

    reflecting = true;
    try {
      attacker.takeDamage(payload, this.targetUnit);

      const text = new CombatText(attacker);
      text.text = '⟲' + payload;
      text.textColor = this.color;
      this.game.objectManager.addObject(text);
    } finally {
      reflecting = false;
    }

    return damage;
  }
}
