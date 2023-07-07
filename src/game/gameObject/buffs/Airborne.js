import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';

// Hất tung
export default class Airborne extends Buff {
  image = AssetManager.getAsset('buff_airborne');
  name = 'Hất Tung';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  height = 20;

  statusFlagsToEnable = StatusFlags.Suppressed;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.height.baseBonus = this.height;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
