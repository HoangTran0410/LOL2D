import { StatsModifier } from '../Stats.js';
import Buff from '../Buff.js';
import BuffAddType from '../../enums/BuffAddType.js';

export default class Blitzcrank_W extends Buff {
  buffAddType = BuffAddType.RENEW_EXISTING;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = 0.7;
    this.statsModifier.size.flatBonus = 20;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
    console.log('deactivate');
  }

  onUpdate() {}
}
