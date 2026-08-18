import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';
import { StatsModifier } from '@/game/gameObject/Stats';

export default class Slow extends Buff {
  image: Buff['image'] = AssetManager.get('buff_slow');
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
