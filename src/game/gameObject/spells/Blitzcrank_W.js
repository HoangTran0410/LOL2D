import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import { StatsModifier } from '../Stats.js';
import { Ghost_Buff, Ghost_Buff_Object } from './Ghost.js';

export default class Blitzcrank_W extends Spell {
  name = 'Tăng Tốc (Blitzcrank_W)';
  image = AssetManager.getAsset('spell_blitzcrank_w');
  description = 'Tăng tốc 50% trong 4s, sau đó bị giảm tốc 75% trong 1s';
  coolDown = 7500;
  manaCost = 20;

  onSpellCast() {
    let speedUpEffect = new Ghost_Buff_Object(this.owner);

    let speedupBuff = new Blitzcrank_W_Buff(4000, this.owner, this.owner);
    speedupBuff.addDeactivateListener(() => {
      let slowDownBuff = new Blitzcrank_W2_Buff(1000, this.owner, this.owner);
      this.owner.addBuff(slowDownBuff);

      speedUpEffect.toRemove = true;
    });

    this.owner.addBuff(speedupBuff);
    this.game.addSpellObject(speedUpEffect);
  }
}

export class Blitzcrank_W_Buff extends Ghost_Buff {
  image = AssetManager.getAsset('spell_blitzcrank_w');
  buffAddType = BuffAddType.STACKS_AND_OVERLAPS;
  maxStacks = 3;
  percent = 0.5;
}

export class Blitzcrank_W2_Buff extends Blitzcrank_W_Buff {
  image = AssetManager.getAsset('spell_blitzcrank_w');
  buffAddType = BuffAddType.RENEW_EXISTING;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = -0.75;
  }
}
