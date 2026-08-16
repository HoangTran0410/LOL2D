import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import Shield from '../buffs/Shield';
import StatAmp from '../buffs/StatAmp';

export const DURATION = 7000;
export const SHIELD_AMOUNT = 70;

export default class Alistar_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_alistar_r');
  name = 'Ý Chí Bất Diệt (Alistar_R)';
  description =
    `Trong <span class="time">${DURATION / 1000} giây</span>: nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>` +
    ` và <span class="buff">+8 sát thương đánh thường</span>`;
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = 'alistar_r_shield';
    shield.image = this.image;
    shield.amount = SHIELD_AMOUNT;
    shield.color = [255, 235, 170];
    this.owner.addBuff(shield);

    const amp = new StatAmp(DURATION, this.owner, this.owner);
    amp.stackId = 'alistar_r';
    amp.image = this.image;
    amp.name = 'Ý Chí Bất Diệt';
    amp.bonuses = { attackDamage: { baseBonus: 8 } };
    this.owner.addBuff(amp);
  }
}
