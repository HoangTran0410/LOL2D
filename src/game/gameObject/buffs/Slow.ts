import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';
import { StatsModifier } from '../Stats';

export default class Slow extends Buff {
  image = AssetManager.getAsset('buff_slow');
  name = 'Chậm';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  percent = 0;

  statsModifier: StatsModifier = new StatsModifier();

  onCreate(): void {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = -this.percent;
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
