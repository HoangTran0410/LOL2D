import Spell from '../Spell.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';
import BuffAddType from '../../enums/BuffAddType.js';
import AssetManager from '../../../managers/AssetManager.js';
import Speedup from '../buffs/Speedup.js';

export default class Ghost extends Spell {
  name = 'Tốc Hành (Ghost)';
  image = AssetManager.getAsset('spell_ghost');
  description = 'Tăng 50% tốc độ di chuyển trong 5s';
  coolDown = 7000;
  manaCost = 100;

  onSpellCast() {
    let speedupBuff = new Speedup(5000, this.owner, this.owner);
    speedupBuff.percent = 0.5;
    this.owner.addBuff(speedupBuff);
  }
}

export class Ghost_Buff extends Buff {
  image = AssetManager.getAsset('spell_ghost');
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;

  percent = 0.5;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = this.percent;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
