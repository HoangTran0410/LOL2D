import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import Shield from '../buffs/Shield';
import StatAmp from '../buffs/StatAmp';

export default class Malphite_W extends Spell {
  image = AssetManager.getAsset('spell_malphite_w');
  name = 'Sức Mạnh Đá Tảng (Malphite_W)';
  description =
    'Malphite phình to lớp vỏ đá của mình trong <span class="time">4 giây</span>, nhận <span class="buff">Khiên hấp thụ 80 sát thương</span> và tăng kích thước cơ thể';
  coolDown = 10000;
  manaCost = 40;

  duration = 4000;
  shieldAmount = 80;
  sizeBonus = 10;

  onSpellCast() {
    const shieldBuff = new Shield(this.duration, this.owner, this.owner);
    shieldBuff.image = this.image;
    shieldBuff.amount = this.shieldAmount;
    shieldBuff.color = [180, 170, 205];
    this.owner.addBuff(shieldBuff);

    const bulkBuff = new StatAmp(this.duration, this.owner, this.owner);
    bulkBuff.stackId = 'malphite_w_bulk';
    bulkBuff.image = this.image;
    bulkBuff.name = 'Đá Tảng';
    bulkBuff.bonuses = { size: { baseBonus: this.sizeBonus } };
    this.owner.addBuff(bulkBuff);
  }
}
