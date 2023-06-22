import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import { StatsModifier } from '../Stats.js';
import { Ghost_Buff_Object } from './Ghost.js';

export default class Blitzcrank_W extends Spell {
  image = ASSETS.Spells.blitzcrank_w;
  description = 'Tăng tốc 50% trong 2s, sau đó bị giảm tốc 75% trong 3s';
  coolDown = 5000;

  onSpellCast() {
    let speedUpEffect = new Ghost_Buff_Object(this.owner);

    let speedupBuff = new Blitzcrank_W_Buff(2000, this.owner, this.owner);
    speedupBuff.addDeactivateListener(() => {
      let slowDownBuff = new Blitzcrank_W2_Buff(3000, this.owner, this.owner);
      this.owner.addBuff(slowDownBuff);

      speedUpEffect.toRemove = true;
    });

    this.owner.addBuff(speedupBuff);
    this.game.objects.push(speedUpEffect);
  }
}

export class Blitzcrank_W_Buff extends Buff {
  buffAddType = BuffAddType.STACKS_AND_OVERLAPS;
  maxStacks = 3;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = 0.5;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }

  onUpdate() {}
}

export class Blitzcrank_W2_Buff extends Blitzcrank_W_Buff {
  image = ASSETS.Spells.blitzcrank_w;
  buffAddType = BuffAddType.RENEW_EXISTING;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = -0.75;
  }
}
