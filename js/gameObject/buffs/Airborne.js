import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';
import { StatsModifier } from '../Stats.js';

// Hất tung
export default class Airborne extends Buff {
  image = ASSETS.Buffs.airborne;
  name = 'Hất Tung';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 10;
  height = 20;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.height.baseBonus = this.height;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onUpdate() {
    this.targetUnit.status &= ~StatusFlags.CanCast;
    this.targetUnit.status &= ~StatusFlags.CanMove;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanCast;
    this.targetUnit.status |= StatusFlags.CanMove;
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
