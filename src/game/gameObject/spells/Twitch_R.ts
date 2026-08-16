import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 7000;
export const BONUS_RANGE = 250;
export const BONUS_DAMAGE = 8;

export default class Twitch_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_twitch_r');
  name = 'Vãi Đạn (Twitch_R)';
  description =
    `Trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${BONUS_RANGE} tầm đánh</span>,` +
    ` <span class="buff">+${BONUS_DAMAGE} sát thương đánh thường</span> và <span class="buff">+25% tốc độ đánh</span>`;
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'twitch_r';
    amp.image = this.image;
    amp.name = 'Vãi Đạn';
    amp.bonuses = {
      attackRange: { baseBonus: BONUS_RANGE },
      attackDamage: { baseBonus: BONUS_DAMAGE },
      attackSpeed: { percentBaseBonus: 0.25 },
    };
    this.owner.addBuff(amp);
  }
}
