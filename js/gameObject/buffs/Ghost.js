import { StatsModifier } from '../Stats.js';
import Buff from '../Buff.js';
import BuffAddType from '../../enums/BuffAddType.js';
import ASSETS from '../../../assets/index.js';

export default class Ghost extends Buff {
  image = ASSETS.Spells.ghost;
  buffAddType = BuffAddType.RENEW_EXISTING;

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
