import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';

export default class Slow extends Buff {
  image = AssetManager.getAsset('buff_slow');
  name = 'Chậm';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  percent = 0;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = -this.percent;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
