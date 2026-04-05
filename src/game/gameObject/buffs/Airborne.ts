import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';
import { StatsModifier } from '../Stats';

// Hất tung
export default class Airborne extends Buff {
  image = AssetManager.getAsset('buff_airborne');
  name = 'Hất Tung';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  height = 20;

  statsModifier: StatsModifier = new StatsModifier();

  statusFlagsToEnable = StatusFlags.Suppressed;

  onCreate(): void {
    this.statsModifier = new StatsModifier();
    this.statsModifier.height.baseBonus = this.height;
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
