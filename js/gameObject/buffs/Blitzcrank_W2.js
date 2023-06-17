import BuffScript from './BuffScript.js';
import BuffAddType from '../../enums/BuffAddType.js';
import { StatsModifier } from '../Stats.js';

export default class Blitzcrank_W2 extends BuffScript {
  constructor() {
    super();
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = -0.7;
    this.buffAddType = BuffAddType.REPLACE_EXISTING;
    this.maxStack = 1;
  }

  onActivate(targetUnit, buff) {
    targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(targetUnit, buff) {}

  onUpdate() {}
}
