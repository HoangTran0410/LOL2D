import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';

// Hất tung
export default class Slow extends Buff {
  image = AssetManager.getAsset('buff_slow');
  name = 'Làm Chậm';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  percent = 0;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.baseValue = -this.percent * this.targetUnit.stats.speed.baseValue;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
