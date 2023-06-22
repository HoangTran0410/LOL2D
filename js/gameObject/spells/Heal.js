import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import { StatModifier } from '../Stat.js';
import GhostBuff from '../buffs/Ghost.js';

export default class Heal extends Spell {
  image = ASSETS.Spells.heal;
  description = 'Hồi phục 50% máu và tăng 50% tốc độ di chuyển trong 1s';
  coolDown = 10000;

  onSpellCast() {
    // heal 50% health
    let modifier = new StatModifier();
    modifier.percentBaseBonus = 0.5;
    this.owner.stats.health.addModifier(modifier);

    // ghost buff for 1s
    let ghostBuff = new GhostBuff(1000, this.owner, this.owner);
    ghostBuff.image = ASSETS.Spells.heal;
    this.owner.addBuff(ghostBuff);
  }
}
