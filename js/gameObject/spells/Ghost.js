import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import GhostBuff from '../buffs/Ghost.js';

export default class Ghost extends Spell {
  image = ASSETS.Spells.ghost;
  description = 'Tăng 50% tốc độ di chuyển trong 5s';
  coolDown = 10000;

  onSpellCast() {
    let ghostBuff = new GhostBuff(5000, this.owner, this.owner);
    this.owner.addBuff(ghostBuff);
  }
}
