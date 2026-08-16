import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 6000;
export const ATTACK_SPEED_PERCENT = 0.5;
export const OMNIVAMP = 0.4;
export const ON_HIT_DAMAGE = 4;

/**
 * Vicious Strikes.
 *
 * This used to carry its own `ON_ATTACK_HIT` subscription to do the healing —
 * about thirty lines of subscribe/unsubscribe bookkeeping duplicated across
 * four spells. `omnivamp` is a stat now (see `Stats.ts`), so the whole ability
 * is the buff, and the vamp works on Olaf's abilities too, which is what
 * "toàn phần" means.
 */
export default class Olaf_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_olaf_w');
  name = 'Đòn Hiểm (Olaf_W)';
  description =
    `Trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${ATTACK_SPEED_PERCENT * 100}% tốc độ đánh</span>,` +
    ` <span class="buff">+${ON_HIT_DAMAGE} sát thương mỗi đòn đánh</span> và` +
    ` <span class="buff">hút ${OMNIVAMP * 100}% máu từ mọi sát thương gây ra</span>`;
  coolDown = 10000;
  manaCost = 30;

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'olaf_w';
    amp.image = this.image;
    amp.name = 'Đòn Hiểm';
    amp.bonuses = {
      attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
      onHitDamage: { baseBonus: ON_HIT_DAMAGE },
      omnivamp: { baseBonus: OMNIVAMP },
    };
    this.owner.addBuff(amp);
  }
}
