import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import Shield from '../buffs/Shield';
import Slow from '../buffs/Slow';

export const DURATION = 5000;
export const SHIELD_AMOUNT = 80;
export const SELF_SLOW = 0.25;

export default class Rammus_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_rammus_w');
  name = 'Cuộn Mình (Rammus_W)';
  description =
    `Cuộn tròn trong <span class="time">${DURATION / 1000} giây</span>: nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>,` +
    ` đổi lại <span class="buff">chậm ${SELF_SLOW * 100}%</span> vì mai rùa quá nặng`;
  coolDown = 10000;
  manaCost = 25;

  onSpellCast() {
    const shield = new Shield(DURATION, this.owner, this.owner);
    shield.stackId = 'rammus_w_shield';
    shield.image = this.image;
    shield.amount = SHIELD_AMOUNT;
    shield.color = [180, 200, 120];
    this.owner.addBuff(shield);

    const slow = new Slow(DURATION, this.owner, this.owner);
    slow.percent = SELF_SLOW;
    this.owner.addBuff(slow);
  }
}
