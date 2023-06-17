import { StatsModifier } from '../Stats.js';

export default class Blitzcrank_W extends BuffScript {
  constructor() {
    super();
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.baseBonus = 3;
    this.buffAddType = BuffAddType.STACKS_AND_RENEWS;
    this.maxStack = 1;
  }

  onActivate(targetUnit, buff) {
    targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(targetUnit, buff) {}

  onUpdate() {}
}
