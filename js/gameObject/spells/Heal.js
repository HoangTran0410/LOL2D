import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import { StatModifier } from '../Stat.js';
import GhostBuff from '../buffs/Ghost.js';

export default class Heal extends Spell {
  image = ASSETS.Spells.heal;
  description = 'Hồi phục 30% máu tối đa và tăng 50% tốc độ di chuyển trong 1s';
  coolDown = 10000;

  onSpellCast() {
    // heal 50% health
    let currentHeal = this.owner.stats.health.value;
    let maxHeal = this.owner.stats.maxHealth.value;
    let newHeal = Math.min(currentHeal + maxHeal * 0.3, maxHeal);

    let modifier = new StatModifier();
    modifier.baseBonus = newHeal - currentHeal;
    this.owner.stats.health.addModifier(modifier);

    // ghost buff for 1s
    let ghostBuff = new GhostBuff(1000, this.owner, this.owner);
    ghostBuff.image = ASSETS.Spells.heal;
    this.owner.addBuff(ghostBuff);
  }
}
