import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import Blitzcrank_W_Buff from '../buffs/Blitzcrank_W.js';

export default class Blitzcrank_W extends Spell {
  image = ASSETS.Spells.blitzcrank_w;
  coolDown = 3000;

  onSpellCast() {
    this.owner.addBuff(new Blitzcrank_W_Buff(1000, this.owner, this.owner));
  }
}
