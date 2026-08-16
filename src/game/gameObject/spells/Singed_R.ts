import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 9000;
export const BONUS_HEALTH = 50;
export const SPEED_PERCENT = 0.3;

export default class Singed_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_singed_r');
  name = 'Thuốc Điên (Singed_R)';
  description =
    `Uống thuốc trong <span class="time">${DURATION / 1000} giây</span>:` +
    ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span>, <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
    ` và <span class="buff">+6 sát thương đánh thường</span>`;
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'singed_r';
    amp.image = this.image;
    amp.name = 'Thuốc Điên';
    amp.bonuses = {
      maxHealth: { baseBonus: BONUS_HEALTH },
      health: { baseBonus: BONUS_HEALTH },
      speed: { percentBaseBonus: SPEED_PERCENT },
      attackDamage: { baseBonus: 6 },
    };
    this.owner.addBuff(amp);
  }
}
