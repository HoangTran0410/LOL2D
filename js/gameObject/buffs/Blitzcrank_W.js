import { StatsModifier } from '../Stats.js';
import Buff from '../Buff.js';
import BuffAddType from '../../enums/BuffAddType.js';
import ASSETS from '../../../assets/index.js';

export default class Blitzcrank_W extends Buff {
  buffAddType = BuffAddType.STACKS_AND_OVERLAPS;
  maxStacks = 3;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = 0.7;
    this.statsModifier.size.percentBaseBonus = 0.5;

    this.image = ASSETS.Buffs.blitzcrank_w;
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
