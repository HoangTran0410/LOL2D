import { StatsModifier } from '../Stats.js';
import Buff from '../Buff.js';

export default class Blitzcrank_W extends Buff {
  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = 0.7;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }

  onUpdate() {}
}
