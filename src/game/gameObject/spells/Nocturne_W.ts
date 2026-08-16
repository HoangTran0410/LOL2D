import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import Shield from '../buffs/Shield';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 3000;
export const SHIELD_AMOUNT = 65;
export const ATTACK_SPEED_PERCENT = 0.4;
export const OMNIVAMP = 0.25;

/**
 * Shroud of Darkness. The spell shield it is in League needs an "incoming
 * ability" hook this engine does not have, so it lands as the thing that shield
 * buys him: a window he can walk into a fight through, and the attack speed
 * that made blocking one spell worth it.
 */
export default class Nocturne_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_nocturne_w');
  name = 'Màn Đêm Bao Phủ (Nocturne_W)';
  description =
    `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>, <span class="buff">+${ATTACK_SPEED_PERCENT * 100}% tốc độ đánh</span>` +
    ` và <span class="buff">hút ${OMNIVAMP * 100}% máu</span> trong <span class="time">${DURATION / 1000} giây</span>`;
  coolDown = 10000;
  manaCost = 25;

  onSpellCast() {
    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = 'nocturne_w';
    shield.image = this.image;
    shield.amount = SHIELD_AMOUNT;
    shield.color = [150, 110, 240];
    this.owner.addBuff(shield);

    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'nocturne_w_haste';
    amp.image = this.image;
    amp.name = 'Màn Đêm Bao Phủ';
    amp.bonuses = {
      attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
      omnivamp: { baseBonus: OMNIVAMP },
    };
    this.owner.addBuff(amp);
  }
}
