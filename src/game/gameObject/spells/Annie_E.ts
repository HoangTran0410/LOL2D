import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import DamageReflect from '../buffs/DamageReflect';
import Shield from '../buffs/Shield';
import Speedup from '../buffs/Speedup';

export const DURATION = 3000;
export const SHIELD_AMOUNT = 55;
export const SPEED_PERCENT = 0.35;
export const RETURN_DAMAGE = 14;
export const STACK_ID = 'annie_e';

/**
 * Molten Shield.
 *
 * `docs/abilities/annie/e.json`: a shield plus decaying move speed, and
 * *"enemies that deal damage to it take magic damage"*. That clause is the
 * ability: it is a shield that punishes the people hitting it, not one that
 * just absorbs. The wiki's "once per enemy per cast" is deliberately not
 * implemented — see `DamageReflect`.
 *
 * ## The burn is on the damage pipeline, and used to not be
 *
 * It rode `ON_ATTACK_HIT` — chosen because "damaged the shield" needs an
 * *attacker*, and the attack event looked like the only place this engine
 * hands one over with the victim. It is not: `Buff.modifyIncomingDamage` takes
 * the attacker too, and it sees every source rather than only swings. The
 * event version was narrower than the sentence above it: a shield that
 * punishes the people hitting it did nothing at all to anyone casting a spell,
 * which is most of the damage in this game. `DamageReflect` is the seam Rammus
 * W already uses; Annie's is the flat, once-per-enemy configuration of it.
 */
export default class Annie_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_annie_e');
  name = 'Khiên Lửa (Annie_E)';
  description =
    `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> và <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
    ` trong <span class="time">${DURATION / 1000} giây</span>. <span class="buff">Mỗi lần</span> có kẻ` +
    ` gây sát thương lên Annie (kể cả khi khiên đỡ hết), kẻ đó bị đốt lại` +
    ` <span class="damage">${RETURN_DAMAGE} sát thương</span>`;
  coolDown = 10000;
  manaCost = 30;

  onSpellCast() {
    // Order-independent: `DamageReflect` runs on `Buff.onDamageTaken`, after
    // the whole mitigation chain, and is handed the damage as it arrived. That
    // is what makes "even when the shield ate all of it" work — and what makes
    // a recast while the old shield is still up work, which insertion order
    // could not.
    const burn = new DamageReflect(DURATION, this.owner, this.owner);
    burn.stackId = 'annie_e_burn';
    burn.image = this.image;
    burn.name = 'Dung Nham';
    burn.percent = 0;
    burn.flat = RETURN_DAMAGE;
    burn.color = [255, 160, 70];
    this.owner.addBuff(burn);

    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = STACK_ID;
    shield.image = this.image;
    shield.amount = SHIELD_AMOUNT;
    shield.color = [255, 160, 70];
    this.owner.addBuff(shield);

    const haste = new Speedup(DURATION, this.owner, this.owner);
    haste.stackId = 'annie_e_haste';
    haste.image = this.image;
    haste.percent = SPEED_PERCENT;
    this.owner.addBuff(haste);
  }
}
