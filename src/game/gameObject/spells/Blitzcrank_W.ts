import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import Speedup from '../buffs/Speedup';

export default class Blitzcrank_W extends Spell {
  name = 'Tăng Tốc (Blitzcrank_W)';
  image = AssetManager.getAsset('spell_blitzcrank_w');
  description =
    '<span class="buff">Tăng Tốc 50%</span> trong <span class="time">4 giây</span>, sau đó bị <span class="buff">Làm Chậm 75%</span> trong <span class="time">1 giây</span>';
  coolDown = 7500;
  manaCost = 20;

  onSpellCast() {
    const speedBuff = new Speedup(4000, this.owner, this.owner);
    speedBuff.image = this.image;
    speedBuff.percent = 0.5;
    speedBuff.addDeactivateListener(() => {
      const slowBuff = new Slow(1000, this.owner, this.owner);
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      slowBuff.image = this.image;
      slowBuff.percent = 0.75;
      this.owner.addBuff(slowBuff);
    });

    this.owner.addBuff(speedBuff);
  }
}
