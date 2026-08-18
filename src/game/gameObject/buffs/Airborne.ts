import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';
import { StatsModifier } from '@/game/gameObject/Stats';

// Hất tung
export default class Airborne extends Buff {
  image: Buff['image'] = AssetManager.get('buff_airborne');
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
