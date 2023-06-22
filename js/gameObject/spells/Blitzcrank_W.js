import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import Blitzcrank_W_Buff from '../buffs/Blitzcrank_W.js';
import Blitzcrank_W_Buff2 from '../buffs/Blitzcrank_W2.js';

export default class Blitzcrank_W extends Spell {
  image = ASSETS.Spells.blitzcrank_w;
  description = 'Tăng tốc 50% trong 2s, sau đó bị giảm tốc 75% trong 3s';
  coolDown = 5000;

  onSpellCast() {
    let speedupBuff = new Blitzcrank_W_Buff(2000, this.owner, this.owner);
    speedupBuff.addDeactivateListener(() => {
      let slowDownBuff = new Blitzcrank_W_Buff2(3000, this.owner, this.owner);
      this.owner.addBuff(slowDownBuff);
    });

    this.owner.addBuff(speedupBuff);
  }
}
