import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import Slow from '../buffs/Slow.js';
import Speedup from '../buffs/Speedup.js';

export default class Blitzcrank_W extends Spell {
  name = 'Tăng Tốc (Blitzcrank_W)';
  image = AssetManager.getAsset('spell_blitzcrank_w');
  description = 'Tăng tốc 50% trong 4s, sau đó bị giảm tốc 75% trong 1s';
  coolDown = 7500;
  manaCost = 20;

  onSpellCast() {
    let speedBuff = new Speedup(4000, this.owner, this.owner);
    speedBuff.image = this.image;
    speedBuff.percent = 0.5;
    speedBuff.addDeactivateListener(() => {
      let slowBuff = new Slow(1000, this.owner, this.owner);
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      slowBuff.image = this.image;
      slowBuff.percent = 0.75;
      this.owner.addBuff(slowBuff);
    });

    this.owner.addBuff(speedBuff);
  }
}
