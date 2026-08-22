import Buff from '@/game/gameObject/Buff';
import CombatText from '@/game/gameObject/helpers/CombatText';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * Sends a share of every hit straight back at whoever landed it.
 *
 * ## Why it is not a damage modifier
 *
 * It was one at first, and that was wrong twice. `modifyIncomingDamage` runs in
 * insertion order with each buff handing the next what is left, so *where* the
 * reflect sat decided what it reflected — behind a shield it only ever saw the
 * overflow. Making the caster add it first fixed one cast and not the next:
 * recast a shield-with-burn spell while the old shield is still up (90% CDR makes that routine)
 * and the *old* shield sits in front of the *new* burn, which then never fires.
 *
 * `Buff.onDamageTaken` runs after the whole mitigation chain and is handed both
 * numbers, so order stopped being part of the answer. The reflect is measured
 * on `swung` — what was aimed at the wearer — because "he hit me for 50, he
 * takes 40" is the sentence, and a shield eating the 50 does not make the swing
 * smaller.
 *
 * Every hit is paid for. One shield-with-burn spell carried a "once per enemy per cast" ledger
 * for a while — the wiki's own wording — and it was dropped on purpose: a
 * reflect that fires once and then goes quiet reads as broken rather than as
 * limited, which is exactly how it was reported. What stops it doubling is not
 * a ledger but the `stackId`: two casts overlapping replace rather than stack.
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

  /** Share of the incoming hit sent back, 0–1. A thorns spell's whole effect. */
  percent = 0.8;

  /**
   * A fixed return on top of the share. A shield-with-burn spell is the flat kind — a shield
   * that burns whoever touches it for the same amount however hard they hit.
   * Additive rather than a mode switch, so a spell that wants both just sets
   * both and nothing here has to branch.
   */
  flat = 0;

  color: [number, number, number] = [255, 190, 110];

  onDamageTaken(swung: number, _landed: number, attacker?: AttackableUnit): void {
    if (this.toRemove || !attacker || swung <= 0) return;
    // Self-damage is not an attack, and a cost that refunds itself is not a
    // cost — the same rule `takeDamage` applies to omnivamp.
    if (attacker === this.targetUnit || attacker.isDead) return;
    if (reflecting) return;

    const payload = Math.round(this.flat + swung * this.percent);
    if (payload <= 0) return;

    reflecting = true;
    try {
      attacker.takeDamage(payload, this.targetUnit);
      CombatText.show(attacker, 'reflect', payload, this.color);
    } finally {
      reflecting = false;
    }
  }
}
