import { StatsModifier } from '../Stats.js';
import BuffScript from './BuffScript.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Blitzcrank_W2 from './Blitzcrank_W2.js';

export default class Blitzcrank_W extends BuffScript {
  constructor() {
    super();
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = 1;
    this.buffAddType = BuffAddType.REPLACE_EXISTING;
    this.maxStack = 1;
  }

  onActivate(targetUnit, buff) {
    targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(targetUnit, buff) {
    let newBuff = new Buff(buff.game, Blitzcrank_W2, 3000, buff.sourceUnit, buff.targetUnit);
    targetUnit.addBuff(newBuff);
  }

  onUpdate() {}
}
