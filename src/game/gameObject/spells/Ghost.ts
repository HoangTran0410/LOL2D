import Spell from '../Spell';
import AssetManager from '../../../managers/AssetManager';
import Speedup from '../buffs/Speedup';

export default class Ghost extends Spell {
  name = 'Tốc Hành (Ghost)';
  image = AssetManager.getAsset('spell_ghost');
  description = '<span class="buff">Tăng tốc 40%</span> trong <span class="time">5 giây</span>';
  coolDown = 10000;
  manaCost = 100;

  onSpellCast() {
    let speedupBuff = new Speedup(5000, this.owner, this.owner);
    speedupBuff.percent = 0.4;
    this.owner.addBuff(speedupBuff);
  }
}
